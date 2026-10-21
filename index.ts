// Edge Function "integrations-run": pulls each plant's numbers from its own Leading2Lean account.
//
//   { action: "test", plant_id }            admin of that plant (signed in) - check the saved key and settings
//   { action: "sync", plant_id, days? }     admin of that plant (signed in) - pull the last 1-31 days now
//   { action: "cron" }                      header x-cron-secret - pull every connected plant (scheduled)
//
// Keys are never returned to the browser. They are read here, server-side, from Supabase Vault
// through integration_key(), which only the service role may call.
// Deploy:  supabase functions deploy integrations-run --no-verify-jwt     (see PLANT_SETUP.md)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncL2L, testL2L } from './core.ts';
import type { Deps } from './core.ts';
import { scrub } from './l2l.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const deps: Deps = {
  fetchFn: (url, init) => fetch(url, init as RequestInit) as any,
  now: () => new Date(),
  async loadEntries(plantId, formType, dates) {
    const { data, error } = await admin.from('data_entries').select('entry_date,row_key,data')
      .eq('plant_id', plantId).eq('form_type', formType).in('entry_date', dates);
    if (error) throw new Error('Could not read saved entries: ' + error.message);
    return data || [];
  },
  async saveEntries(rows) {
    const { error } = await admin.from('data_entries').upsert(rows, { onConflict: 'plant_id,form_type,entry_date,row_key' });
    if (error) throw new Error('Could not save entries: ' + error.message);
  },
  async ensureMetrics(plantId, defs) {
    const { data, error } = await admin.from('metric_definitions').select('form_type,key').eq('plant_id', plantId);
    if (error) throw new Error('Could not read columns: ' + error.message);
    const have = new Set((data || []).map((r: any) => r.form_type + '|' + r.key));
    const missing = defs.filter((d) => !have.has(d.form_type + '|' + d.key))
      .map((d) => ({ plant_id: plantId, form_type: d.form_type, key: d.key, label: d.label, type: d.type, unit: d.unit, options: [], sort: d.sort, created_by: 'L2L sync' }));
    if (missing.length) {
      const { error: e2 } = await admin.from('metric_definitions').insert(missing);
      if (e2) throw new Error('Could not add columns: ' + e2.message);
    }
  },
};

async function loadPlant(plantId: string) {
  const [pl, it] = await Promise.all([
    admin.from('plants').select('id,config').eq('id', plantId).maybeSingle(),
    admin.from('plant_integrations').select('*').eq('plant_id', plantId).maybeSingle(),
  ]);
  if (pl.error || !pl.data) throw new Error('There is no such plant.');
  if (it.error || !it.data) throw new Error('No connection is saved for this plant yet.');
  return { plant: pl.data, integ: it.data };
}
async function loadKey(plantId: string): Promise<string> {
  const { data, error } = await admin.rpc('integration_key', { p_plant: plantId });
  if (error || !data) throw new Error('No API key is saved for this plant.');
  return String(data);
}
// last_run_at means "last time numbers were pulled"; a connection test only updates the status line.
async function record(plantId: string, ok: boolean, message: string, pulled = true) {
  const patch: Record<string, unknown> = { last_status: ok ? 'ok' : 'error', last_message: String(message).slice(0, 400) };
  if (pulled) patch.last_run_at = new Date().toISOString();
  await admin.from('plant_integrations').update(patch).eq('plant_id', plantId);
}

async function run(plantId: string, action: 'test' | 'sync', days: number) {
  const { plant, integ } = await loadPlant(plantId);
  if (integ.provider !== 'l2l') return { ok: false, message: 'Only Leading2Lean connections are available so far.' };
  const key = await loadKey(plantId);
  const lines = ((plant.config && plant.config.lines) || []).map((l: any) => typeof l === 'string' ? { code: l } : { code: l.code, l2lCode: l.l2lCode });
  const args = { plantId, key, settings: integ.settings || {}, lines };
  if (action === 'test') {
    const r = await testL2L(deps, args);
    await record(plantId, r.ok, r.message, false);
    return r;
  }
  const r = await syncL2L(deps, { ...args, days });
  await record(plantId, r.ok, r.message);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, message: 'POST only' }, 405);
  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ ok: false, message: 'Bad request' }, 400); }
  try {
    // Scheduled run: every connected plant, last 7 days.
    if (body.action === 'cron') {
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ ok: false, message: 'Not allowed' }, 401);
      const { data } = await admin.from('plant_integrations').select('plant_id').eq('enabled', true).eq('provider', 'l2l');
      const out: Record<string, string> = {};
      for (const r of data || []) {
        try { out[r.plant_id] = (await run(r.plant_id, 'sync', 7) as any).message; }
        catch (e) { const m = scrub((e as Error).message, ''); out[r.plant_id] = m; await record(r.plant_id, false, m); }
      }
      return json({ ok: true, plants: out });
    }

    // Signed-in admin of that plant.
    const plantId = String(body.plant_id || '');
    if (!plantId || (body.action !== 'test' && body.action !== 'sync')) return json({ ok: false, message: 'Bad request' }, 400);
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, message: 'Please sign in again.' }, 401);
    const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false } });
    const { data: isAdmin, error } = await asUser.rpc('dds_is_admin', { p: plantId });
    if (error || isAdmin !== true) return json({ ok: false, message: 'Only an admin of this plant can use the connection.' }, 403);

    if (body.action === 'sync') {
      // Do not let the button be hammered: at most one manual pull every 20 seconds per plant.
      const { data: it } = await admin.from('plant_integrations').select('last_run_at').eq('plant_id', plantId).maybeSingle();
      if (it && it.last_run_at && Date.now() - new Date(it.last_run_at).getTime() < 20000) return json({ ok: false, message: 'A pull just ran. Wait a moment and try again.' });
    }
    return json(await run(plantId, body.action, Number(body.days) || 7));
  } catch (e) {
    return json({ ok: false, message: scrub((e as Error).message, '') });
  }
});
