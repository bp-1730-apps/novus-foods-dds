// Leading2Lean (L2L) provider: the same calls the GitHub sync (sync_l2l_to_dashboard.py) makes,
// written so they can run inside a Supabase Edge Function. Pure logic: the network function is passed in,
// so it can be tested without L2L.

export interface L2LSettings {
  company: string;               // the part before .leading2lean.com
  siteNumber: number | string;   // L2L site number
  codeRedId?: number | string | null;
  codeYellowId?: number | string | null;
}
export interface PlantLine { code: string; l2lCode?: string }
export type FetchFn = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

const COMPANY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export function baseUrl(company: string): string {
  const c = String(company || '').trim();
  // Only a plain sub-domain is accepted, so the function can never be pointed at another host.
  if (!COMPANY_RE.test(c)) throw new Error('The L2L company name should be just the part before .leading2lean.com (letters, numbers and dashes).');
  return `https://${c}.leading2lean.com/api/1.0`;
}

/** Remove the key from any message before it is stored or shown (network errors can contain the full URL). */
export function scrub(message: unknown, key: string): string {
  let m = String(message == null ? '' : message);
  if (key) m = m.split(key).join('***');
  return m.replace(/auth=[^&\s)'"]+/gi, 'auth=***');
}

export async function callL2L(fetchFn: FetchFn, company: string, key: string, path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(`${baseUrl(company)}/${path}/`);
  url.searchParams.set('auth', key);
  Object.keys(params).forEach((k) => url.searchParams.set(k, String(params[k])));
  let res;
  try {
    res = await fetchFn(url.toString(), { signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new Error('Could not reach L2L: ' + scrub((e as Error).message, key));
  }
  let body: any;
  try { body = await res.json(); } catch (_) {
    throw new Error(res.status === 401 || res.status === 403 ? `L2L rejected the API key (HTTP ${res.status}).` : `L2L did not return valid data (HTTP ${res.status}).`);
  }
  if (!body || body.success === false) {
    const why = scrub(body && body.error ? body.error : 'L2L reported the request failed.', key);
    throw new Error(res.status === 401 || res.status === 403 ? `L2L rejected the API key (HTTP ${res.status}): ${why}` : why);
  }
  return body.data;
}

const addDays = (ds: string, n: number): string => {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const toNum = (v: unknown): number | null => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };

/** L2L may report OEE as 0.85 or 85.3; the dashboard stores fractions (0.85). Same rule the dashboard itself uses. */
export function normalizeOee(v: unknown): number | null {
  const n = toNum(v); if (n == null) return null;
  return Math.round((n > 2 ? n / 100 : n) * 1e6) / 1e6;
}

export interface DayResult {
  date: string;
  production: { line: string; oee: number | null; downtime: number | null }[];
  maintenance: { codeRed: number; codeYellow: number } | null;
  unmappedL2LLines: string[];
}

export async function pullDay(fetchFn: FetchFn, s: L2LSettings, key: string, lines: PlantLine[], date: string): Promise<DayResult> {
  const byL2L: Record<string, string> = {};
  lines.forEach((l) => { if (l.l2lCode) byL2L[String(l.l2lCode).trim()] = l.code; });
  const l2lCodes = Object.keys(byL2L);
  if (!l2lCodes.length) throw new Error('Match at least one of your lines to its L2L line code first.');
  const start = `${date} 00:00`, end = `${addDays(date, 1)} 00:00`;
  const site = s.siteNumber;

  const records = (await callL2L(fetchFn, s.company, key, 'reporting/production/daily_summary_data_by_line',
    { site, start, end, linecode: l2lCodes.join(',') })) || [];
  const production: DayResult['production'] = []; const unmapped: string[] = [];
  for (const r of records) {
    const code = byL2L[String(r.line ?? '').trim()];
    if (!code) { if (r.line != null) unmapped.push(String(r.line)); continue; }
    const dt = toNum(r.downtime_minutes), np = toNum(r.nonproduction_minutes) ?? 0;
    production.push({ line: code, oee: normalizeOee(r.overall_equipment_effectiveness), downtime: dt == null ? null : Math.round((dt - np) * 100) / 100 });
  }

  let maintenance: DayResult['maintenance'] = null;
  const red = s.codeRedId, yellow = s.codeYellowId;
  if ((red !== undefined && red !== null && red !== '') || (yellow !== undefined && yellow !== null && yellow !== '')) {
    const dispatches = (await callL2L(fetchFn, s.company, key, 'dispatches', {
      site, dispatched__gte: `${date}T00:00:00`, dispatched__lte: `${addDays(date, 1)}T00:00:00`, limit: 1000,
    })) || [];
    const mine = dispatches.filter((d: any) => l2lCodes.includes(String(d.linecode ?? '')));
    const count = (id: unknown) => (id === undefined || id === null || id === '') ? 0 : mine.filter((d: any) => String(d.dispatchtype) === String(id)).length;
    maintenance = { codeRed: count(red), codeYellow: count(yellow) };
  }
  return { date, production, maintenance, unmappedL2LLines: [...new Set(unmapped)] };
}
