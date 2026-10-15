/* kpi-source.js — builds the Weekly KPI data from the same numbers the dashboard uses.
 *
 * Feeds (each one optional, switched in plant-config.js "sources"):
 *   - Power Automate file   (dashboard-data.json)
 *   - L2L file              (l2l-data.json)  -> owns OEE, Downtime, Code Red, Code Yellow
 *   - Data Entry            (Supabase data_entries + metric_definitions)
 *
 * Every KPI is "one column, rolled up by week": e.g. Production › Actual Pounds, total.
 * The KPI list comes from plant-config.js "weeklyKpis", plus (optionally) every column
 * found in the feeds, plus whatever an admin changed on the Weekly KPIs page
 * (saved in dashboard_panel_config, panel_id 'weekly-kpis').
 *
 * The result has the shape kpi-boards.html already understands:
 *   { meta:{weeks, latestWeek, notes, ...}, sections:[{name, groups:[{name, kpis:[...]}]}] }
 */
(function () {
  'use strict';
  const PANEL_ID = 'weekly-kpis', BOARDS_ID = 'weekly-kpi-boards';
  const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const L2L_OWNED = { 'Production': ['OEE', 'Downtime'], 'Maintenance': ['Code Red', 'Code Yellow'] };
  const META_FIELDS = new Set(['date', 'line', 'city', 'psa bin', 'item', 'row', 'week ending', 'plant']);
  const ROLLUPS = { sum: 'Total for the week', avg: 'Average for the week', last: 'Last value of the week', min: 'Lowest of the week', max: 'Highest of the week', count: 'Number of entries' };
  const UNITS = { num: 'Number', count: 'Whole number', usd: 'Dollars', pct_frac: 'Percent (stored as 0–1)', pct_pts: 'Percent (stored as 0–100)' };

  const cfg = () => Object.assign({ enabled: true, weekEndsOn: 'sunday', weeks: 52, autoDiscover: true, includeCurrentWeek: false, kpis: [], starterBoards: null }, (window.PLANT_CONFIG && window.PLANT_CONFIG.weeklyKpis) || {});
  const src = () => (window.PLANT_CONFIG && window.PLANT_CONFIG.sources) || {};
  const pid = () => window.PLANT_CONFIG.plant.id;
  const p2 = n => (n < 10 ? '0' : '') + n;
  const iso = d => d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
  const slug = s => String(s).toLowerCase().replace(/%/g, ' pct ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const isNum = v => typeof v === 'number' && isFinite(v);

  function parseDay(val) {            // Excel serial, ISO text, or Date -> 'YYYY-MM-DD' (UTC calendar day) or null
    if (val == null || val === '') return null;
    let d;
    if (val instanceof Date) d = val;
    else if (typeof val === 'number' || (/^\d+(\.\d+)?$/.test(String(val).trim()) && Number(val) > 20000)) d = new Date((Number(val) - 25569) * 86400000);
    else if (/^\d{4}-\d{2}-\d{2}/.test(String(val))) return String(val).slice(0, 10);
    else d = new Date(val);
    return d && !isNaN(d.getTime()) ? iso(d) : null;
  }
  function toNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).trim().replace(/[$,%\s]/g, '');
    if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
    return Number(s);
  }
  function weekEndOf(day, dow) {      // the first `dow` on or after the day
    const d = new Date(day + 'T00:00:00Z'), add = (dow - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + add); return iso(d);
  }
  const todayISO = () => { const t = new Date(); return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()); };
  const dimOf = r => { for (const k of ['Line', 'City', 'PSA Bin', 'Item', 'Row']) { const key = Object.keys(r).find(x => x.trim().toLowerCase() === k.toLowerCase()); if (key && r[key] != null && r[key] !== '') return String(r[key]).trim(); } return ''; };
  const cleanRow = r => { const o = {}; Object.keys(r).forEach(k => { if (!k.startsWith('@') && !k.startsWith('__') && k !== 'ItemInternalId') o[k] = r[k]; }); return o; };

  // ── 1. Gather the feeds into  sheets[name] = [ {Date, Line.., Field: value} ] ──
  async function fetchJson(url) {
    const r = await fetch(url + (url.indexOf('?') < 0 ? '?v=' + Date.now() : ''), { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' (' + r.status + ')');
    return r.json();
  }
  async function loadFeeds() {
    const S = src(), sheets = {}, info = {}, notes = [], used = [];
    const l2lOn = !!(S.l2l && S.l2l.enabled);
    const upsert = (rows, match, vals) => { const m = rows.find(r => Object.keys(match).every(k => String(r[k] == null ? '' : r[k]).trim() === String(match[k]).trim())); if (m) Object.assign(m, vals); else rows.push(Object.assign({}, match, vals)); };

    if (S.powerAutomate && S.powerAutomate.enabled && S.powerAutomate.dataUrl) {
      try {
        const j = await fetchJson(S.powerAutomate.dataUrl);
        Object.keys(j).forEach(k => { if (Array.isArray(j[k])) sheets[k] = j[k].map(cleanRow); });
        used.push('Power Automate file');
      } catch (e) { notes.push('Check: the Power Automate file could not be read (' + e.message + ').'); }
    }
    if (l2lOn) {
      Object.keys(L2L_OWNED).forEach(sh => (sheets[sh] || []).forEach(r => L2L_OWNED[sh].forEach(f => delete r[f])));
      if (S.l2l.dataUrl) {
        try {
          const j = await fetchJson(S.l2l.dataUrl);
          const pr = sheets['Production'] = sheets['Production'] || [], mr = sheets['Maintenance'] = sheets['Maintenance'] || [];
          (j['Production'] || []).forEach(r => upsert(pr, { Date: r.Date, Line: r.Line }, { OEE: r.OEE, Downtime: r.Downtime }));
          (j['Maintenance'] || []).forEach(r => upsert(mr, { Date: r.Date }, { 'Code Red': r['Code Red'], 'Code Yellow': r['Code Yellow'] }));
          used.push('L2L file');
        } catch (e) { notes.push('Check: the L2L file could not be read (' + e.message + ').'); }
      }
    }
    if (S.dataEntry && S.dataEntry.enabled !== false && window.NovusDB && NovusDB.metrics && NovusDB.dataEntries) {
      try {
        const from = new Date(); from.setDate(from.getDate() - cfg().weeks * 7 - 14);
        const [defs, ents] = await Promise.all([NovusDB.metrics.getAll(pid()), allEntries(iso(from))]);
        if (defs.error) throw defs.error;
        const label = {};
        (defs.data || []).forEach(d => { if (d.active) { label[d.form_type + '|' + d.key] = d.label; info[d.form_type + '|' + d.label] = { type: d.type, unit: d.unit || '', calcKind: (d.options || [])[1] }; } });
        const byDept = {};
        ents.forEach(e => (byDept[e.form_type] = byDept[e.form_type] || []).push(e));
        Object.keys(byDept).forEach(dept => {
          const rows = sheets[dept] = sheets[dept] || [], index = new Map();
          rows.forEach(r => { const d = parseDay(r.Date); if (d) index.set(d + '|' + dimOf(r).toLowerCase(), r); });
          byDept[dept].forEach(e => {
            const vals = {};
            Object.keys(e.data || {}).forEach(k => {
              const lb = label[dept + '|' + k], v = e.data[k];
              if (lb === undefined || v === '' || v == null) return;
              if (l2lOn && (L2L_OWNED[dept] || []).includes(lb)) return;
              vals[lb] = v;
            });
            if (!Object.keys(vals).length) return;
            const key = e.entry_date + '|' + String(e.row_key || '').trim().toLowerCase();
            let row = index.get(key);
            if (row) Object.assign(row, vals);
            else {
              row = Object.assign({ Date: e.entry_date }, vals);
              if (e.data && e.data.line) row.Line = e.data.line; if (e.data && e.data.city) row.City = e.data.city;
              if (e.data && e.data.psa_bin) row['PSA Bin'] = e.data.psa_bin; if (e.data && e.data.item) row.Item = e.data.item;
              if (e.row_key && !row.Line && !row.City && !row['PSA Bin'] && !row.Item) row.Row = e.row_key;
              rows.push(row); index.set(key, row);
            }
          });
        });
        used.push('Data Entry');
      } catch (e) { notes.push('Check: Data Entry could not be read (' + (e && e.message || e) + ').'); }
    }
    return { sheets, info, notes, used };
  }
  // Pages through data_entries (the server hands back at most 1,000 rows at a time).
  async function allEntries(fromDate) {
    const out = [];
    for (let a = 0; a < 200000; a += 1000) {
      const { data, error } = await NovusDB.dataEntries.getSince(pid(), fromDate, a, a + 999);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  // ── 2. KPI definitions: config + discovered + admin changes ──
  const guessRollup = (field, info) => {
    if (info && (info.type === 'percent' || (info.type === 'calc' && info.calcKind === 'percent'))) return 'avg';
    return /%|\brate\b|\bper\b|\/|ratio|yield|attainment|oee|score|index|average|avg|pct|percent/i.test(field) ? 'avg' : 'sum';
  };
  function discover(sheets, info, have) {
    const defs = [];
    Object.keys(sheets).sort().forEach(sh => {
      const fields = new Set();
      sheets[sh].forEach(r => Object.keys(r).forEach(k => { if (!META_FIELDS.has(k.trim().toLowerCase())) fields.add(k); }));
      [...fields].sort().forEach(f => {
        let numeric = 0, total = 0;
        sheets[sh].forEach(r => { if (r[f] != null && r[f] !== '') { total++; if (toNum(r[f]) != null) numeric++; } });
        if (!total || numeric / total < 0.8) return;                 // text columns are not KPIs
        const id = slug(sh + '-' + f);
        if (have.has(id)) return;
        const inf = info[sh + '|' + f];
        defs.push({ id, name: f, section: sh, group: 'All columns', sheet: sh, field: f, rollup: guessRollup(f, inf), auto: true,
          unit: inf && inf.type === 'percent' ? 'auto-pct' : 'auto', decimals: null });
      });
    });
    return defs;
  }
  async function loadOverrides() {
    try {
      const { data } = await NovusDB.panelConfig.get(pid(), PANEL_ID);
      return (data && data.config) || {};
    } catch (_) { return {}; }
  }
  async function saveOverrides(obj, user) {
    return NovusDB.panelConfig.save(pid(), PANEL_ID, obj, user);
  }
  async function loadSharedBoards() {
    try { const { data } = await NovusDB.panelConfig.get(pid(), BOARDS_ID); return data && data.config && Array.isArray(data.config.boards) ? data.config.boards : null; } catch (_) { return null; }
  }
  async function saveSharedBoards(boards, user) {
    return boards && boards.length ? NovusDB.panelConfig.save(pid(), BOARDS_ID, { boards }, user) : NovusDB.panelConfig.clear(pid(), BOARDS_ID);
  }

  // ── 3. Roll the daily rows up by week ──
  function rollup(kind, points) {      // points: [{d:'YYYY-MM-DD', v:number}]
    if (!points.length) return null;
    if (kind === 'count') return points.length;
    if (kind === 'min') return Math.min(...points.map(p => p.v));
    if (kind === 'max') return Math.max(...points.map(p => p.v));
    if (kind === 'last') { const m = points.reduce((a, p) => (p.d > a ? p.d : a), ''); const l = points.filter(p => p.d === m); return l.reduce((a, p) => a + p.v, 0) / l.length; }
    const s = points.reduce((a, p) => a + p.v, 0);
    return kind === 'avg' ? s / points.length : s;
  }
  function pointsOf(rows, def, dim) {
    const pts = [];
    rows.forEach(r => {
      if (dim != null && dimOf(r).toLowerCase() !== dim) return;
      const key = Object.keys(r).find(k => k.trim().toLowerCase() === def.field.toLowerCase());
      const v = key ? toNum(r[key]) : null, d = parseDay(r.Date);
      if (v != null && d) pts.push({ d, v });
    });
    return pts;
  }
  function weeklySeries(pts, kind, dow) {
    const by = {};
    pts.forEach(p => { (by[weekEndOf(p.d, dow)] = by[weekEndOf(p.d, dow)] || []).push(p); });
    const out = {}; Object.keys(by).forEach(w => { const v = rollup(kind, by[w]); if (v != null) out[w] = Math.round(v * 1e6) / 1e6; });
    return out;
  }

  // ── 4. Put it all together ──
  async function load() {
    const c = cfg(), dow = DOW[String(c.weekEndsOn).toLowerCase()] ?? 0;
    const feeds = await loadFeeds(), notes = feeds.notes.slice();
    const ov = await loadOverrides();
    // definitions
    let defs = (c.kpis || []).map(k => Object.assign({}, k));
    const have = new Set(defs.map(k => k.id || slug((k.sheet || '') + '-' + (k.field || ''))));
    defs.forEach(k => { if (!k.id) k.id = slug((k.sheet || '') + '-' + (k.field || '') + (k.rowKey ? '-' + k.rowKey : '')); });
    if (c.autoDiscover !== false) defs = defs.concat(discover(feeds.sheets, feeds.info, have));
    (ov.added || []).forEach(k => { if (k && k.id && k.sheet && k.field && !defs.some(d => d.id === k.id)) defs.push(Object.assign({ custom: true }, k)); });
    const edits = ov.edits || {}, hide = new Set(ov.hide || []);
    defs.forEach(d => { const e = edits[d.id]; if (e) Object.assign(d, e); });
    const catalog = defs.map(d => Object.assign({}, d, { hidden: hide.has(d.id) }));   // what the manage dialog edits
    defs = defs.filter(d => !hide.has(d.id));

    const today = todayISO();
    const items = [];
    defs.forEach(d => {
      const rows = feeds.sheets[d.sheet] || [];
      if (!rows.length) return;
      const dim = d.rowKey ? String(d.rowKey).toLowerCase() : null;
      const pts = pointsOf(rows, d, dim);
      if (!pts.length) return;
      const series = weeklySeries(pts, d.rollup || 'sum', dow);
      let unit = d.unit || 'num';
      const vals = Object.keys(series).map(w => series[w]);
      if (unit === 'auto-pct') unit = vals.every(v => Math.abs(v) <= 2) ? 'pct_frac' : 'pct_pts';
      if (unit === 'auto') unit = 'num';
      const dec = d.decimals != null ? d.decimals : (unit === 'pct_frac' || unit === 'pct_pts') ? 1 : vals.every(v => Math.floor(v) === v) ? 0 : 2;
      const t = d.target && d.target.op && isNum(Number(d.target.value)) ? { op: d.target.op, value: Number(d.target.value), scored: true } : null;
      if (t) t.label = (t.op === '>=' ? '≥ ' : t.op === '<=' ? '≤ ' : t.op === '>' ? '> ' : '< ') + (unit === 'pct_frac' ? (t.value * 100) + '%' : unit === 'pct_pts' ? t.value + '%' : unit === 'usd' ? '$' + t.value : t.value);
      const k = { id: d.id, name: d.name || d.field, unit, decimals: dec, target: t, better: d.better || '', series: Object.keys(series).sort().map(w => [w, series[w]]), _sec: d.section || d.sheet, _grp: d.group || 'General', rollup: d.rollup || 'sum' };
      // per-line / per-city breakdown, when the sheet has one
      if (d.breakdown !== false && !dim) {
        const dims = [...new Set(rows.map(dimOf).filter(Boolean))].sort();
        if (dims.length > 1 && dims.length <= 14) {
          k.children = [];
          dims.forEach(x => {
            const s = weeklySeries(pointsOf(rows, d, x.toLowerCase()), d.rollup || 'sum', dow);
            if (Object.keys(s).length) k.children.push({ id: d.id + '--' + slug(x), name: x, unit, decimals: dec, target: null, better: d.better || '', series: Object.keys(s).sort().map(w => [w, s[w]]) });
          });
        }
      }
      items.push(k);
    });

    // weeks: every completed week from the first value to the latest (current, unfinished week left out)
    const all = new Set(); const walk = k => { k.series.forEach(p => all.add(p[0])); (k.children || []).forEach(walk); }; items.forEach(walk);
    let ws = [...all].sort();
    if (!c.includeCurrentWeek) { const n = ws.length; ws = ws.filter(w => w < today); if (ws.length < n) notes.push('The current week is still in progress, so it is not shown until it ends. Turn this on with "includeCurrentWeek" in plant-config.js.'); }
    let weeks = [];
    if (ws.length) {
      const d = new Date(ws[0] + 'T00:00:00Z'), end = ws[ws.length - 1];
      while (iso(d) <= end) { weeks.push(iso(d)); d.setUTCDate(d.getUTCDate() + 7); }
      weeks = weeks.slice(-Math.max(4, c.weeks));
    }
    const keep = new Set(weeks), trim = k => { k.series = k.series.filter(p => keep.has(p[0])); (k.children || []).forEach(trim); }; items.forEach(trim);
    const kept = items.filter(k => k.series.length);
    // sections / groups
    const secs = [], sIx = {};
    kept.forEach(k => {
      const sn = k._sec, gn = k._grp; delete k._sec; delete k._grp;
      let s = sIx[sn]; if (!s) { s = sIx[sn] = { name: sn, groups: [], _g: {} }; secs.push(s); }
      let g = s._g[gn]; if (!g) { g = s._g[gn] = { name: gn, kpis: [] }; s.groups.push(g); }
      g.kpis.push(k);
    });
    secs.forEach(s => delete s._g);
    if (!weeks.length) notes.push('No weekly numbers yet. Enter data on the Data Entry page (or connect a data source in plant-config.js) and they will appear here.');
    notes.push('Weekly numbers are worked out from daily entries. A week ends on ' + String(c.weekEndsOn) + '. Each KPI is rolled up with the rule shown in Manage KPIs (total, average, last value, and so on).');
    return {
      data: { meta: { title: 'Weekly KPIs', source: feeds.used.join(' + ') || 'No data source', generated: today, weeks, latestWeek: weeks[weeks.length - 1] || '', notes }, sections: secs },
      used: feeds.used, catalog, sheets: feeds.sheets, overrides: ov
    };
  }

  function starterBoards() { const b = cfg().starterBoards; return Array.isArray(b) && b.length ? b : null; }

  window.KpiSource = { load, loadOverrides, saveOverrides, loadSharedBoards, saveSharedBoards, starterBoards, ROLLUPS, UNITS, slug, cfg, _t: { weekEndOf, parseDay, rollup, weeklySeries, toNum, guessRollup } };
})();
