// The part of the connection service that decides WHAT to write. It never touches the network or the
// database itself: both are passed in (see index.ts), so this file can be tested with fakes.
import { pullDay, scrub } from './l2l.ts';
import type { FetchFn, L2LSettings, PlantLine } from './l2l.ts';

export interface Entry { entry_date: string; row_key: string; data: Record<string, unknown> }
export interface MetricDef { form_type: string; key: string; label: string; type: string; unit: string; sort: number }
export interface Deps {
  fetchFn: FetchFn;
  loadEntries(plantId: string, formType: string, dates: string[]): Promise<Entry[]>;
  saveEntries(rows: { plant_id: string; form_type: string; entry_date: string; row_key: string; data: Record<string, unknown>; created_by: string; updated_at: string }[]): Promise<void>;
  ensureMetrics(plantId: string, defs: MetricDef[]): Promise<void>;
  now(): Date;
}
export interface SyncArgs { plantId: string; key: string; settings: L2LSettings & { timezone?: string }; lines: PlantLine[]; days: number }
export interface SyncResult { ok: boolean; message: string; days: number; productionRows: number; maintenanceDays: number; unmapped: string[] }

export const L2L_METRICS: MetricDef[] = [
  { form_type: 'Production', key: 'oee', label: 'OEE', type: 'percent', unit: '', sort: 0 },
  { form_type: 'Production', key: 'downtime', label: 'Downtime', type: 'number', unit: 'min', sort: 0 },
  { form_type: 'Maintenance', key: 'code_red', label: 'Code Red', type: 'number', unit: '', sort: 0 },
  { form_type: 'Maintenance', key: 'code_yellow', label: 'Code Yellow', type: 'number', unit: '', sort: 0 },
];

/** Today's date (YYYY-MM-DD) in the plant's own time zone, so a sync at 9pm Pacific does not jump to tomorrow. */
export function todayIn(tz: string | undefined, now: Date): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch (_) { return now.toISOString().slice(0, 10); }
}
export function lastDays(today: string, n: number): string[] {
  const out: string[] = []; const [y, m, d] = today.split('-').map(Number);
  for (let i = n - 1; i >= 0; i--) { const t = new Date(Date.UTC(y, m - 1, d - i)); out.push(t.toISOString().slice(0, 10)); }
  return out;
}

export async function syncL2L(deps: Deps, a: SyncArgs): Promise<SyncResult> {
  const days = Math.min(31, Math.max(1, Math.floor(a.days || 7)));
  const dates = lastDays(todayIn(a.settings.timezone, deps.now()), days);
  const results = [];
  try {
    for (const date of dates) results.push(await pullDay(deps.fetchFn, a.settings, a.key, a.lines, date));
  } catch (e) {
    return { ok: false, message: scrub((e as Error).message, a.key), days: 0, productionRows: 0, maintenanceDays: 0, unmapped: [] };
  }
  const now = deps.now().toISOString();
  const rows: Parameters<Deps['saveEntries']>[0] = [];
  // Merge into what is already saved on that day/line, so numbers people typed (Attainment, notes...) are kept.
  const existingProd = await deps.loadEntries(a.plantId, 'Production', dates);
  const existingMaint = await deps.loadEntries(a.plantId, 'Maintenance', dates);
  const find = (list: Entry[], date: string, key: string) => list.find((e) => e.entry_date === date && (e.row_key || '') === key);
  let productionRows = 0, maintenanceDays = 0; const unmapped = new Set<string>();
  for (const r of results) {
    r.unmappedL2LLines.forEach((u) => unmapped.add(u));
    for (const p of r.production) {
      const data: Record<string, unknown> = { ...(find(existingProd, r.date, p.line)?.data || {}), line: p.line };
      if (p.oee != null) data.oee = p.oee; else delete data.oee;
      if (p.downtime != null) data.downtime = p.downtime; else delete data.downtime;
      rows.push({ plant_id: a.plantId, form_type: 'Production', entry_date: r.date, row_key: p.line, data, created_by: 'L2L sync', updated_at: now });
      productionRows++;
    }
    if (r.maintenance) {
      const data: Record<string, unknown> = { ...(find(existingMaint, r.date, '')?.data || {}) };
      data.code_red = r.maintenance.codeRed; data.code_yellow = r.maintenance.codeYellow;
      rows.push({ plant_id: a.plantId, form_type: 'Maintenance', entry_date: r.date, row_key: '', data, created_by: 'L2L sync', updated_at: now });
      maintenanceDays++;
    }
  }
  if (rows.length) {
    await deps.ensureMetrics(a.plantId, L2L_METRICS.filter((m) => m.form_type === 'Production' || (a.settings.codeRedId != null && a.settings.codeRedId !== '') || (a.settings.codeYellowId != null && a.settings.codeYellowId !== '')));
    await deps.saveEntries(rows);
  }
  const un = [...unmapped];
  return {
    ok: true, days, productionRows, maintenanceDays, unmapped: un,
    message: `Pulled ${days} day${days > 1 ? 's' : ''}: ${productionRows} line result${productionRows === 1 ? '' : 's'}` +
      (maintenanceDays ? `, ${maintenanceDays} Code Red/Yellow count${maintenanceDays === 1 ? '' : 's'}` : '') +
      (un.length ? `. L2L also has lines you have not matched: ${un.join(', ')}` : '') + '.',
  };
}

/** "Test connection": one cheap call (yesterday), reporting which of the plant's lines L2L recognised. */
export async function testL2L(deps: Deps, a: Omit<SyncArgs, 'days'>): Promise<{ ok: boolean; message: string; found: string[]; missing: string[]; unmapped: string[] }> {
  const yesterday = lastDays(todayIn(a.settings.timezone, deps.now()), 2)[0];
  try {
    const r = await pullDay(deps.fetchFn, a.settings, a.key, a.lines, yesterday);
    const found = r.production.map((p) => p.line);
    const missing = a.lines.filter((l) => l.l2lCode && !found.includes(l.code)).map((l) => l.code);
    const msg = `Connected to L2L. ${found.length} of your matched lines reported on ${yesterday}` +
      (missing.length ? ` (no data for ${missing.join(', ')}: they may not have run that day)` : '') +
      (r.unmappedL2LLines.length ? `. L2L also returned lines you have not matched: ${r.unmappedL2LLines.join(', ')}` : '') + '.';
    return { ok: true, message: msg, found, missing, unmapped: r.unmappedL2LLines };
  } catch (e) {
    return { ok: false, message: scrub((e as Error).message, a.key), found: [], missing: [], unmapped: [] };
  }
}
