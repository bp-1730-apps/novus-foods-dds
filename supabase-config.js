/**
 * supabase-config.js
 *
 * ONE file to rule them all. Drop this in your repo root alongside
 * novus-core.js and load it with:
 *
 *   <script src="supabase-config.js"></script>
 *
 * BEFORE the page's own <script> block. Every page then has access
 * to the global `NovusDB` object which has the same shape as the old
 * GAS fetch calls, just much faster.
 *
 * ─── SETUP (one time) ────────────────────────────────────────────────────
 * 1. Go to supabase.com → your project → Settings → API
 * 2. Copy "Project URL" → paste as SUPABASE_URL below
 * 3. Copy "anon public" key → paste as SUPABASE_ANON_KEY below
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY anon key is fine here:
 * Your app already guards every page via sessionStorage auth in novus-core.js.
 * The anon key combined with permissive RLS policies (see SQL setup guide)
 * is the standard pattern for internal tools. Never paste the service_role key.
 */

const SUPABASE_URL      = window.PLANT_CONFIG.supabase.url;
const SUPABASE_ANON_KEY = window.PLANT_CONFIG.supabase.anonKey;

// The anon key is public by design. What protects the data is Supabase Auth
// plus the row-level-security policies in data_entries.sql: nothing is
// readable or writable until a signed-in, approved team member asks for it.
// The login session lives in sessionStorage, so it ends when the tab closes
// (same behaviour as the old login).
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
});
window._sb = _sb;

/**
 * NovusDB — thin wrapper around the Supabase client.
 * All methods return { data, error } just like the Supabase client.
 */
window.NovusDB = {

  // ── Announcements ───────────────────────────────────────────────────────
  // Scoped per plant via plant_id (see plant_scoped_boards.sql). getAll
  // still works with no plantId -- returns every plant's announcements --
  // as a safety net for any old cached page that hasn't picked up the
  // plant-aware version yet; every page this app ships now always passes
  // its resolved ACTIVE_PLANT.id.
  announcements: {
    getAll: (plantId) => {
      let q = _sb.from('announcements').select('*').order('created_at', { ascending: false });
      if (plantId) q = q.eq('plant_id', plantId);
      return q;
    },

    add: (item) =>
      _sb.from('announcements').insert({
        id:        item.id,
        plant_id:  item.plant_id,
        number:    item.number,
        text:      item.text,
        date:      item.date,
        image:     item.image,
        color:     item.color,
      }),

    updateField: (id, field, value) =>
      _sb.from('announcements').update({ [field]: value }).eq('id', id),

    delete: (id) =>
      _sb.from('announcements').delete().eq('id', id),

    /** Real-time: callback fires on any INSERT / UPDATE / DELETE */
    subscribe: (callback) =>
      _sb
        .channel('announcements-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, callback)
        .subscribe(),
  },

  // ── Rules of Engagement ─────────────────────────────────────────────────
  rules: {
    getAll: () =>
      _sb.from('rules').select('*').order('created_at', { ascending: true }),

    add: (item) =>
      _sb.from('rules').insert({ id: item.id, text: item.text, date: item.date }),

    update: (id, text) =>
      _sb.from('rules').update({ text }).eq('id', id),

    delete: (id) =>
      _sb.from('rules').delete().eq('id', id),

    subscribe: (callback) =>
      _sb
        .channel('rules-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rules' }, callback)
        .subscribe(),
  },

  // ── Needs Action ────────────────────────────────────────────────────────
  needsAction: {
    getAll: () =>
      _sb.from('needs_action').select('*').order('created_at', { ascending: false }),

    add: (item) =>
      _sb.from('needs_action').insert({
        id:             item.id,
        date:           item.date,
        description:    item.description,
        owner:          item.owner,
        completed_date: '',
      }),

    setCompleted: (id, dateStr) =>
      _sb.from('needs_action').update({ completed_date: dateStr }).eq('id', id),

    updateDescription: (id, description) =>
      _sb.from('needs_action').update({ description }).eq('id', id),

    updateOwner: (id, owner) =>
      _sb.from('needs_action').update({ owner }).eq('id', id),

    delete: (id) =>
      _sb.from('needs_action').delete().eq('id', id),

    subscribe: (callback) =>
      _sb
        .channel('needs-action-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'needs_action' }, callback)
        .subscribe(),
  },

  // ── Weekly Staff Meeting ─────────────────────────────────────────────────
  weeklyStaffMeeting: {
    /**
     * Fetch all 13 department rows and reshape into the same
     * { [dept]: deptObj } map that the old GAS ?action=read returned.
     */
    getAll: async () => {
      const { data, error } = await _sb
        .from('weekly_staff_meeting')
        .select('*');
      if (error) return { data: null, error };
      // Reshape array → keyed object
      const map = {};
      (data || []).forEach(row => {
        map[row.dept] = {
          lwItems:    row.lw_items    || [],
          twItems:    row.tw_items    || [],
          frontTiles: row.front_tiles || [],
          tiles:      row.back_tiles  || [],
        };
      });
      return { data: map, error: null };
    },

    /**
     * Upsert one department's full data object.
     * Mirrors the old GAS { action:'write', dept, data } call.
     */
    saveDept: (dept, deptObj) =>
      _sb.from('weekly_staff_meeting').upsert({
        dept,
        lw_items:    deptObj.lwItems    || [],
        tw_items:    deptObj.twItems    || [],
        front_tiles: deptObj.frontTiles || [],
        back_tiles:  deptObj.tiles      || [],
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'dept' }),

    /**
     * Upload a base64 image to Supabase Storage.
     * Returns a public URL — replaces the old GAS uploadImage action.
     * Requires a public bucket named "staff-meeting-images" in Supabase.
     */
    uploadImage: async (base64DataUrl, dept) => {
      try {
        // Strip the data:image/...;base64, prefix
        const [header, b64] = base64DataUrl.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const ext  = mime.split('/')[1] || 'jpg';
        const path = `${dept.replace(/\s+/g, '_')}/${Date.now()}.${ext}`;

        // Convert base64 → Uint8Array
        const binary = atob(b64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const { error } = await _sb.storage
          .from('staff-meeting-images')
          .upload(path, bytes, { contentType: mime, upsert: false });

        if (error) throw error;

        const { data } = _sb.storage
          .from('staff-meeting-images')
          .getPublicUrl(path);

        return { ok: true, url: data.publicUrl };
      } catch (e) {
        console.error('[NovusDB.weeklyStaffMeeting.uploadImage]', e);
        return { ok: false, error: e.message };
      }
    },

    subscribe: (callback) =>
      _sb
        .channel('weekly-staffmtg-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_staff_meeting' }, callback)
        .subscribe(),
  },
  // ── DDS Highlights ──────────────────────────────────────────────────────
  // Names typed on the Level 1 cards. Scoped by plant_id (data_entries.sql v3).
  ddsHighlights: {
    getAll: (plantId) => {
      let q = _sb.from('dds_highlights').select('*').order('dept');
      if (plantId) q = q.eq('plant_id', plantId);
      return q;
    },

    upsert: (dept, employee, note, updatedBy, plantId) =>
      _sb.from('dds_highlights').upsert({
        plant_id:   plantId || window.PLANT_CONFIG.plant.id,
        dept,
        employee:   employee || '',
        note:       note     || '',
        updated_by: updatedBy || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plant_id,dept' }),

    subscribe: (callback) =>
      _sb
        .channel('dds-highlights-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dds_highlights' }, callback)
        .subscribe(),
  },

  // ── Custom Dashboard Widgets (admin-managed metric cards / charts) ──────
  // Backs the "Manage Custom Widgets" feature in dds-dashboard.html: any
  // admin can add a metric card or mini-chart, built from a field already
  // present in a plant's dashboard-data.json, to any existing panel. Global
  // per plant (scoped by plant_id) — every viewer of that plant sees the
  // same widgets, same as announcements/rules elsewhere in this file. Run
  // the migration in dashboard_custom_widgets.sql once before this is used.
  customWidgets: {
    /** All widgets for one plant */
    getAll: (plantId) =>
      _sb.from('dashboard_custom_widgets')
        .select('*')
        .eq('plant_id', plantId)
        .order('created_at', { ascending: true }),

    add: (widget) =>
      _sb.from('dashboard_custom_widgets').insert({
        id:          widget.id,
        plant_id:    widget.plant_id,
        panel_id:    widget.panel_id,
        sheet:       widget.sheet,
        field:       widget.field,
        widget_type: widget.widget_type,
        agg:         widget.agg || null,
        range_days:  widget.range_days ?? 30,
        target:      (widget.target === undefined || widget.target === null || widget.target === '') ? null : widget.target,
        target_dir:  widget.target_dir || 'gte',
        full_width:  !!widget.full_width,
        label:       widget.label,
        // `body` (text notes) is only sent when present, so older databases without
        // the column keep working for every other widget type.
        ...(widget.body !== undefined ? { body: widget.body } : {}),
        created_by:  widget.created_by || '',
        created_at:  widget.created_at || new Date().toISOString(),
      }),

    remove: (id) =>
      _sb.from('dashboard_custom_widgets').delete().eq('id', id),

    /** Edit fields of a widget (used for text notes) */
    update: (id, fields) =>
      _sb.from('dashboard_custom_widgets').update(fields).eq('id', id),

    subscribe: (callback) =>
      _sb
        .channel('dashboard-custom-widgets-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_custom_widgets' }, callback)
        .subscribe(),
  },
};

// ── Play Call ──────────────────────────────────────────────────────────────
// NOTE: was missing — this fixes play-call.html
// Scoped per plant via plant_id (see plant_scoped_boards.sql), same pattern
// as announcements above -- getAll(plantId) with no plantId returns every
// plant's plays, kept only as a safety net for a stale cached page.
window.NovusDB.playCall = {
  getAll: (plantId) => {
    let q = _sb.from('play_call').select('*').order('created_at', { ascending: true });
    if (plantId) q = q.eq('plant_id', plantId);
    return q;
  },

  add: (item) =>
    _sb.from('play_call').insert({
      id:       item.id,
      plant_id: item.plant_id,
      owner:    item.owner,
      text:     item.text,
      webhook:  item.webhook || '',
      date:     item.date    || '',
    }),

  delete: (id) =>
    _sb.from('play_call').delete().eq('id', id),

  subscribe: (callback) =>
    _sb
      .channel('play-call-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'play_call' }, callback)
      .subscribe(),
};

// ── Lean Initiatives (used only by archive/weekly-staff-meeting.html) ───────────────────────────────────────────────────────
window.NovusDB.leanInitiatives = {

  /** All initiatives — filter by dept client-side */
  getAll: () =>
    _sb.from('lean_initiatives').select('*').order('created_at', { ascending: false }),

  /** Initiatives for one department */
  getByDept: (dept) =>
    _sb.from('lean_initiatives').select('*')
      .eq('dept', dept)
      .order('created_at', { ascending: false }),

  add: (item) =>
    _sb.from('lean_initiatives').insert({
      id:                      item.id,
      dept:                    item.dept                    || '',
      title:                   item.title,
      owner:                   item.owner,
      category:                item.category                || 'Process',
      status:                  item.status                  || 'Proposed',
      est_hours_saved:         item.est_hours_saved         || 0,
      actual_hours_saved:      item.actual_hours_saved      || 0,
      est_material_savings:    item.est_material_savings    || 0,
      actual_material_savings: item.actual_material_savings || 0,
      notes:                   item.notes                   || '',
      week_flagged:            item.week_flagged            || '',
      completed_date:          item.completed_date          || '',
    }),

  updateStatus: (id, status, completedDate) => {
    const fields = { status };
    if (completedDate !== undefined) fields.completed_date = completedDate;
    return _sb.from('lean_initiatives').update(fields).eq('id', id);
  },

  update: (id, fields) =>
    _sb.from('lean_initiatives').update(fields).eq('id', id),

  delete: (id) =>
    _sb.from('lean_initiatives').delete().eq('id', id),

  subscribe: (callback) =>
    _sb
      .channel('lean-init-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lean_initiatives' }, callback)
      .subscribe(),
};

// ── Lean Department State ───────────────────────────────────────────────────
window.NovusDB.leanDeptState = {

  /** Returns all 13 rows as { dept → current_state } map */
  getAll: async () => {
    const { data, error } = await _sb.from('lean_dept_state').select('*');
    if (error) return { data: null, error };
    const map = {};
    (data || []).forEach(r => { map[r.dept] = r.current_state || ''; });
    return { data: map, error: null };
  },

  /** Upsert the current-state narrative for one department */
  save: (dept, currentState) =>
    _sb.from('lean_dept_state').upsert({
      dept,
      current_state: currentState,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'dept' }),

  subscribe: (callback) =>
    _sb
      .channel('lean-dept-state-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lean_dept_state' }, callback)
      .subscribe(),
};

// ── Data Entry (spreadsheet-style) + user-defined columns ──────────────────
// Tables: public.metric_definitions and public.data_entries (data_entries.sql).
//   form_type = department name ('QA', 'Production', 'HR | Training', ...)
//   metric_definitions = the columns of that department's entry grid
//   data_entries       = one row per department + date + line/city
// dds-dashboard.html overlays these rows onto the matching dashboard sheet.
window.NovusDB.metrics = {
  /** Active (non-removed) columns for one plant + department, in order */
  getActive: (plantId, formType) =>
    _sb.from('metric_definitions').select('*')
      .eq('plant_id', plantId).eq('form_type', formType).eq('active', true)
      .order('sort', { ascending: true }).order('created_at', { ascending: true }),

  /** Every column incl. removed ones, all departments (dashboard overlay) */
  getAll: (plantId) =>
    _sb.from('metric_definitions').select('*').eq('plant_id', plantId),

  /** Insert, or re-activate/update if the same key was removed earlier */
  upsert: (m) => window.NovusDB.metrics.upsertMany([m]),

  upsertMany: (list) =>
    _sb.from('metric_definitions').upsert(list.map(m => ({
      plant_id:   m.plant_id,
      form_type:  m.form_type,
      key:        m.key,
      label:      m.label,
      type:       m.type,
      unit:       m.unit || '',
      options:    m.options || [],
      required:   !!m.required,
      sort:       m.sort ?? 0,
      active:     true,
      created_by: m.created_by || '',
    })), { onConflict: 'plant_id,form_type,key' }),

  /** "Remove" = deactivate, so past entries keep their values */
  deactivate: (id) =>
    _sb.from('metric_definitions').update({ active: false }).eq('id', id),

  subscribe: (callback) =>
    _sb.channel('metric-definitions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'metric_definitions' }, callback)
      .subscribe(),
};

window.NovusDB.dataEntries = {
  /** All rows saved for one department on one date */
  getByDate: (plantId, formType, date) =>
    _sb.from('data_entries').select('*')
      .eq('plant_id', plantId).eq('form_type', formType).eq('entry_date', date),

  /** Newest rows first (history grid) */
  getRecent: (plantId, formType, limit = 120) =>
    _sb.from('data_entries').select('*')
      .eq('plant_id', plantId).eq('form_type', formType)
      .order('entry_date', { ascending: false }).limit(limit),

  /** Dashboard feed: a plant's entries across all departments */
  getForDashboard: (plantId, limit = 5000) =>
    _sb.from('data_entries').select('form_type, entry_date, row_key, data')
      .eq('plant_id', plantId)
      .order('entry_date', { ascending: false }).limit(limit),

  /** Weekly KPIs: everything since a date, one page of rows at a time (the server caps a page at 1,000) */
  getSince: (plantId, fromDate, from, to) =>
    _sb.from('data_entries').select('form_type, entry_date, row_key, data')
      .eq('plant_id', plantId).gte('entry_date', fromDate)
      .order('entry_date', { ascending: false }).order('id', { ascending: true }).range(from, to),

  /** Insert-or-update rows (one per department + date + line/city) */
  save: (rows) =>
    _sb.from('data_entries').upsert(rows, { onConflict: 'plant_id,form_type,entry_date,row_key' }),

  subscribe: (callback) =>
    _sb.channel('data-entries-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'data_entries' }, callback)
      .subscribe(),
};


// ── Hidden dashboard items (show/hide built-in panels & metrics) ───────────
// Table: public.dashboard_hidden_items (data_entries.sql). Shared per plant.
// item_key is 'panel:<panel id>' or 'metric:<metric value element id>'.
window.NovusDB.hiddenItems = {
  getAll: (plantId) =>
    _sb.from('dashboard_hidden_items').select('item_key').eq('plant_id', plantId),

  hide: (plantId, key, user) =>
    _sb.from('dashboard_hidden_items').upsert(
      { plant_id: plantId, item_key: key, hidden_by: user || '' },
      { onConflict: 'plant_id,item_key' }),

  show: (plantId, key) =>
    _sb.from('dashboard_hidden_items').delete().eq('plant_id', plantId).eq('item_key', key),

  subscribe: (callback) =>
    _sb.channel('dashboard-hidden-items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_hidden_items' }, callback)
      .subscribe(),
};

// ── Data Entry tabs (departments) ──────────────────────────────────────────
// Custom tabs, and built-in tabs that were removed (active = false).
window.NovusDB.departments = {
  getAll: (plantId) =>
    _sb.from('entry_departments').select('*').eq('plant_id', plantId)
      .order('sort', { ascending: true }).order('created_at', { ascending: true }),

  upsert: (d) =>
    _sb.from('entry_departments').upsert({
      plant_id:   d.plant_id,
      name:       d.name,
      row_mode:   d.row_mode || 'none',
      row_label:  d.row_label || '',
      row_values: d.row_values || [],
      panel:      d.panel || 'panel-production',
      active:     d.active !== false,
      sort:       d.sort ?? 0,
      created_by: d.created_by || '',
    }, { onConflict: 'plant_id,name' }),

  /** Hide/restore a tab without touching its saved data */
  setActive: (plantId, name, active) =>
    _sb.from('entry_departments').update({ active }).eq('plant_id', plantId).eq('name', name),

  subscribe: (callback) =>
    _sb.channel('entry-departments-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entry_departments' }, callback)
      .subscribe(),
};

// ── Which data feeds each built-in dashboard tile ─────────────────────────
window.NovusDB.metricSources = {
  getAll: (plantId) =>
    _sb.from('dashboard_metric_sources').select('*').eq('plant_id', plantId),

  set: (plantId, itemKey, src, user) =>
    _sb.from('dashboard_metric_sources').upsert({
      plant_id: plantId, item_key: itemKey,
      sheet: src.sheet, field: src.field, row_key: src.row_key || '', agg: src.agg || 'latest',
      updated_by: user || '', updated_at: new Date().toISOString(),
    }, { onConflict: 'plant_id,item_key' }),

  clear: (plantId, itemKey) =>
    _sb.from('dashboard_metric_sources').delete().eq('plant_id', plantId).eq('item_key', itemKey),

  subscribe: (callback) =>
    _sb.channel('dashboard-metric-sources-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_metric_sources' }, callback)
      .subscribe(),
};

// ── New dashboard sections (panels) + shared layout ───────────────────────
window.NovusDB.customPanels = {
  getAll: (plantId) =>
    _sb.from('dashboard_custom_panels').select('*').eq('plant_id', plantId)
      .order('created_at', { ascending: true }),

  add: (p) =>
    _sb.from('dashboard_custom_panels').insert({
      id: p.id, plant_id: p.plant_id, title: p.title, icon: p.icon || '',
      span: p.span || 4, created_by: p.created_by || '',
    }),

  update: (id, patch) =>
    _sb.from('dashboard_custom_panels').update(patch).eq('id', id),

  remove: (id) =>
    _sb.from('dashboard_custom_panels').delete().eq('id', id),

  subscribe: (callback) =>
    _sb.channel('dashboard-custom-panels-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_custom_panels' }, callback)
      .subscribe(),
};

// One row per plant: the order of the panels and how wide each one is.
// Saved by admins when they drag / resize; everyone else just reads it.
window.NovusDB.layout = {
  get: (plantId) =>
    _sb.from('dashboard_layout').select('panel_order, panel_spans').eq('plant_id', plantId).maybeSingle(),

  save: (plantId, order, spans, user) =>
    _sb.from('dashboard_layout').upsert({
      plant_id: plantId, panel_order: order, panel_spans: spans,
      updated_by: user || '', updated_at: new Date().toISOString(),
    }, { onConflict: 'plant_id' }),

  clear: (plantId) =>
    _sb.from('dashboard_layout').delete().eq('plant_id', plantId),

  subscribe: (callback) =>
    _sb.channel('dashboard-layout-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_layout' }, callback)
      .subscribe(),
};

// ── Level 1 DDS Highlights: which cards a plant shows (label, icon, order) ──
window.NovusDB.highlightCards = {
  getAll: (plantId) =>
    _sb.from('dashboard_highlight_cards').select('*').eq('plant_id', plantId).order('sort', { ascending: true }),

  /** Saves the whole list in order; cards no longer in the list are removed. */
  save: async (plantId, cards, user) => {
    const rows = cards.map((c, i) => ({ plant_id: plantId, card_key: c.key, label: c.label, icon: c.icon || '',
      sort: i, updated_by: user || '', updated_at: new Date().toISOString() }));
    let r = await _sb.from('dashboard_highlight_cards').upsert(rows, { onConflict: 'plant_id,card_key' });
    if (r.error) return r;
    const have = await _sb.from('dashboard_highlight_cards').select('card_key').eq('plant_id', plantId);
    if (have.error) return have;
    const keep = new Set(cards.map(c => c.key));
    for (const row of (have.data || [])) {
      if (!keep.has(row.card_key)) {
        r = await _sb.from('dashboard_highlight_cards').delete().eq('plant_id', plantId).eq('card_key', row.card_key);
        if (r.error) return r;
      }
    }
    return { error: null };
  },

  /** Back to the standard five cards */
  clear: (plantId) =>
    _sb.from('dashboard_highlight_cards').delete().eq('plant_id', plantId),

  subscribe: (callback) =>
    _sb.channel('dashboard-highlight-cards-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dashboard_highlight_cards' }, callback)
      .subscribe(),
};

// ── Panel settings (Production Summary layout) + saved-layout history ───────
// Tables: dashboard_panel_config, dashboard_layout_history (data_entries.sql v3).
window.NovusDB.panelConfig = {
  get: (plantId, panelId) =>
    _sb.from('dashboard_panel_config').select('*').eq('plant_id', plantId).eq('panel_id', panelId).maybeSingle(),
  save: (plantId, panelId, config, user) =>
    _sb.from('dashboard_panel_config').upsert({
      plant_id: plantId, panel_id: panelId, config, updated_by: user || '', updated_at: new Date().toISOString(),
    }, { onConflict: 'plant_id,panel_id' }),
  clear: (plantId, panelId) =>
    _sb.from('dashboard_panel_config').delete().eq('plant_id', plantId).eq('panel_id', panelId),
};

window.NovusDB.layoutHistory = {
  add: (plantId, snapshot, note, user) =>
    _sb.from('dashboard_layout_history').insert({ plant_id: plantId, snapshot, note: note || '', saved_by: user || '' }),
  list: (plantId, limit) =>
    _sb.from('dashboard_layout_history').select('id,note,saved_by,saved_at').eq('plant_id', plantId)
      .order('saved_at', { ascending: false }).limit(limit || 20),
  get: (id) =>
    _sb.from('dashboard_layout_history').select('*').eq('id', id).single(),
};
