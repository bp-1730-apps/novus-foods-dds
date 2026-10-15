/* dds-editor.js — edit the dashboard in place.
 *
 * Admins press "Edit dashboard". The real page becomes editable: each section
 * gets a small control bar, each number gets hover controls, each section has a
 * "+" to add things, and ONE popover (the "inspector") is used for every kind
 * of edit. Nothing is saved until the admin presses "Save for everyone".
 *
 * This file only draws the editing screen. The draft / undo / save engine
 * (LS, lsChange, lsSave, ...) lives in dds-dashboard.html.
 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EDIT = window.EDIT = { on: false, token: null };
  const SPANS = [[4, '⅓'], [6, '½'], [8, '⅔'], [12, 'Full']];
  const WIDGET_TYPES = [['metric', 'Number card'], ['trend', 'Trend card (value, change & sparkline)'], ['line', 'Line chart'], ['area', 'Area chart'], ['bar', 'Bar chart'], ['hbar', 'Horizontal bar chart'], ['doughnut', 'Doughnut / gauge'], ['text', 'Text note']];
  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('x' + Date.now().toString(36) + Math.random().toString(36).slice(2));
  const me = () => (window.NovusCore && NovusCore.getUser && NovusCore.getUser()) || {};
  const plantId = () => window.PLANT_CONFIG.plant.id;
  const draftKey = () => 'dds_draft_' + plantId() + '_' + (me().id || me().username || 'user');
  const tipsKey = 'dds_edit_tips_seen';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (_) {} };

  // ── Names for sections ──────────────────────────────────────────────────
  function panelTitle(id, st) {
    const cp = st.panels.find(p => cpId(p) === id);
    if (cp) return (cp.icon ? cp.icon + ' ' : '') + cp.title;
    const b = CW_PANELS.find(p => p.id === id);
    if (id === 'panel-production' && typeof PROD_CFG === 'object' && PROD_CFG) return (PROD_CFG.icon ? PROD_CFG.icon + ' ' : '') + PROD_CFG.title;
    if (b) return b.label;
    const el = document.getElementById(id), t = el && el.querySelector('.panel-title');
    return (t && t.textContent.trim()) || id;
  }

  // ═══ The inspector: one popover for every edit ═══════════════════════════
  const Insp = {
    el: null, opts: null,
    open(opts) {
      this.close(true);
      const e = this.el = document.createElement('div');
      e.id = 'ed-insp'; e.className = 'ed-keep' + (opts.wide ? ' wide' : '');
      e.setAttribute('role', 'dialog'); e.setAttribute('aria-label', opts.title);
      e.innerHTML = `<div class="ed-insp-head"><strong>${esc(opts.title)}</strong><button type="button" class="ed-ic" data-i="x" aria-label="Close">✕</button></div>
        <div class="ed-insp-body"></div>
        <div class="ed-insp-foot">${(opts.extra || []).map((b, i) => `<button type="button" class="ed-btn ${b.cls || ''}" data-extra="${i}">${esc(b.label)}</button>`).join('')}<span class="sp"></span>
          <button type="button" class="ed-btn" data-i="cancel">Cancel</button>${opts.noApply ? '' : `<button type="button" class="ed-btn primary" data-i="apply">${esc(opts.applyLabel || 'Apply')}</button>`}</div>`;
      document.body.appendChild(e);
      this.opts = opts;
      const body = $('.ed-insp-body', e);
      if (typeof opts.html === 'string') body.innerHTML = opts.html; else if (opts.build) opts.build(body);
      e.addEventListener('click', ev => {
        const t = ev.target.closest('[data-i],[data-extra]'); if (!t) return;
        if (t.dataset.i === 'x' || t.dataset.i === 'cancel') this.close();
        else if (t.dataset.i === 'apply') this.apply();
        else if (t.dataset.extra != null) { const r = opts.extra[+t.dataset.extra].onClick(body); if (r !== false) this.close(true); }
      });
      e.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') { ev.stopPropagation(); this.close(); }
        else if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA' && ev.target.tagName !== 'BUTTON' && !opts.noApply) { ev.preventDefault(); this.apply(); }
      });
      this.place(opts.anchor);
      const first = $('input,select,textarea', body); if (first) first.focus(); else $('.ed-insp-foot .primary,.ed-insp-foot button', e).focus();
      if (opts.anchor) opts.anchor.classList && opts.anchor.classList.add('ed-picked');
    },
    apply() {
      const o = this.opts; if (!o) return;
      const r = o.onApply ? o.onApply($('.ed-insp-body', this.el)) : true;
      if (r !== false) this.close(true);
    },
    close(silent) {
      if (!this.el) return;
      if (!silent && this.opts && this.opts.onCancel) this.opts.onCancel();
      $$('.ed-picked').forEach(n => n.classList.remove('ed-picked'));
      this.el.remove(); this.el = null; this.opts = null;
    },
    place(anchor) {
      const e = this.el; if (!e) return;
      if (e.classList.contains('wide') || window.innerWidth < 700 || !anchor || !anchor.getBoundingClientRect) { e.classList.add('sheet'); return; }
      const r = anchor.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24);
      e.style.width = w + 'px';
      let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12), top = r.bottom + 8;
      e.style.left = left + 'px'; e.style.top = top + 'px';
      const h = e.offsetHeight;
      if (top + h > window.innerHeight - 70) { top = Math.max(12, r.top - h - 8); if (top < 12 || top + h > window.innerHeight - 70) { top = Math.max(12, window.innerHeight - h - 80); } }
      e.style.top = top + 'px';
    }
  };
  EDIT.insp = Insp;

  const row = (label, input, id) => `<label class="ed-f"${id ? ` id="${id}"` : ''}><span>${esc(label)}</span>${input}</label>`;
  const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
  const chk = (id, label, on) => `<label class="ed-chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> <span>${esc(label)}</span></label>`;

  // ── Widget (number card / chart / note) ────────────────────────────────
  function widgetForm(panelId, existing, anchor) {
    lsEnsure();
    const d = LS.draft, w = existing || null, sheets = dashSheetNames();
    const sheetNow = w && w.widget_type !== 'text' ? w.sheet : sheets[0];
    const panels = lsNormOrder(d.order, d.panels).map(id => [id, panelTitle(id, d)]);
    Insp.open({
      title: w ? 'Edit this item' : 'Add to this section', anchor, applyLabel: w ? 'Update' : 'Add',
      build(b) {
        b.innerHTML =
          row('Section', `<select id="ei-panel">${panels.map(([id, t]) => opt(id, t, id === (w ? w.panel_id : panelId))).join('')}</select>`) +
          row('Show it as', `<select id="ei-type">${WIDGET_TYPES.map(([v, l]) => opt(v, l, v === (w ? w.widget_type : 'metric'))).join('')}</select>`) +
          `<div id="ei-data">` +
          row('Where from (sheet)', `<select id="ei-sheet">${sheets.map(s => opt(s, s, s === sheetNow)).join('')}</select>`) +
          row('Column', `<select id="ei-field"></select>`) +
          row('Which value', `<select id="ei-agg"></select>`, 'ei-agg-row') +
          row('How far back', `<select id="ei-range">${[[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days'], [180, 'Last 180 days'], [365, 'Last 365 days'], [0, 'All data']].map(([v, l]) => opt(v, l, v === (w && w.range_days != null ? w.range_days : 30))).join('')}</select>`, 'ei-range-row') +
          `<div class="ed-2" id="ei-target-row">${row('Goal (optional)', `<input type="number" step="any" id="ei-target" value="${w && w.target != null ? esc(w.target) : ''}" placeholder="e.g. 95">`)}${row('Goal is met when', `<select id="ei-dir">${opt('gte', 'at or above', !w || w.target_dir !== 'lte')}${opt('lte', 'at or below', w && w.target_dir === 'lte')}</select>`)}</div></div>` +
          row('Note text', `<textarea id="ei-text" rows="4" placeholder="A reminder or callout for this section…">${esc(w && w.body || '')}</textarea>`, 'ei-text-row') +
          row('Title (optional)', `<input type="text" id="ei-label" maxlength="60" value="${esc(w ? w.label : '')}" placeholder="Defaults to the column name">`) +
          chk('ei-full', 'Take the full width of the section', w && w.full_width) +
          `<p class="ed-hint">Stays in your draft until you press <b>Save for everyone</b>.</p>`;
        const g = id => $('#' + id, b);
        const fillFields = keep => { const fs = getAvailableFields(g('ei-sheet').value); g('ei-field').innerHTML = fs.length ? fs.map(f => opt(f, f, f === keep)).join('') : opt('', 'No columns found yet', true); };
        const sync = () => {
          const t = g('ei-type').value, text = t === 'text';
          g('ei-data').style.display = text ? 'none' : ''; g('ei-text-row').style.display = text ? '' : 'none';
          g('ei-agg-row').style.display = (t === 'metric' || t === 'trend') ? '' : 'none';
          const names = t === 'trend' ? [['latest', "Last entry of the day"], ['sum', "Total of the day's entries"], ['avg', "Average of the day's entries"]] : [['latest', 'Latest day'], ['sum', 'Total'], ['avg', 'Average']];
          const cur = g('ei-agg').value || (w && w.agg) || 'latest';
          g('ei-agg').innerHTML = names.map(([v, l]) => opt(v, l, v === cur)).join('');
          g('ei-range-row').style.display = (!text && t !== 'doughnut' && !(t === 'metric' && g('ei-agg').value === 'latest')) ? '' : 'none';
        };
        fillFields(w && w.field); sync();
        g('ei-type').onchange = sync; g('ei-agg').onchange = sync; g('ei-sheet').onchange = () => fillFields();
      },
      onApply(b) {
        const v = id => $('#' + id, b).value, type = v('ei-type'), text = type === 'text';
        const field = v('ei-field'), body = v('ei-text').trim(), tRaw = v('ei-target').trim(), target = tRaw === '' ? null : Number(tRaw);
        if (text && !body) { toast('Type the note text first.'); return false; }
        if (!text && !field) { toast('Pick a column first.'); return false; }
        if (tRaw !== '' && isNaN(target)) { toast('The goal must be a number.'); return false; }
        const widget = Object.assign({}, w || {}, {
          id: w ? w.id : uid(), plant_id: plantId(), panel_id: v('ei-panel'), widget_type: type,
          sheet: text ? '(text)' : v('ei-sheet'), field: text ? '(text)' : field,
          agg: (type === 'metric' || type === 'trend') ? v('ei-agg') : null,
          range_days: text ? 0 : (parseInt(v('ei-range'), 10) || 0), target: text ? null : target, target_dir: v('ei-dir') || 'gte',
          full_width: $('#ei-full', b).checked, label: v('ei-label').trim() || (text ? 'Note' : field)
        });
        if (text) widget.body = body; else delete widget.body;
        lsChange(d => { const i = d.cw.findIndex(x => x.id === widget.id); if (i > -1) d.cw[i] = widget; else d.cw.push(widget); });
      },
      extra: w ? [{ label: 'Remove', cls: 'danger', onClick() { lsChange(d => { d.cw = d.cw.filter(x => x.id !== w.id); }); } }] : []
    });
  }

  // ── A built-in number: where it comes from, or hide it ─────────────────
  function tileForm(key, label, anchor) {
    lsEnsure();
    const cur = LS.draft.src[key] || {}, sheets = dashSheetNames(), hidden = LS.draft.hidden.includes(key), canSrc = key.indexOf('#') < 0;
    Insp.open({
      title: label, anchor, applyLabel: 'Use this', noApply: !canSrc,
      build(b) {
        const sh = cur.sheet || '';
        b.innerHTML = (canSrc ? `<p class="ed-hint" style="margin-top:0">Where should “${esc(label)}” get its number?</p>` +
          row('Sheet', `<select id="ei-s-sheet">${opt('', 'Original (as built)', !sh)}${sheets.map(x => opt(x, x, x === sh)).join('')}</select>`) +
          row('Column', `<select id="ei-s-field"></select>`, 'ei-s-fieldrow') + row('Row', `<select id="ei-s-row"></select>`, 'ei-s-rowrow') +
          row('Show', `<select id="ei-s-agg">${Object.keys(SRC_AGG_LABELS).map(a => opt(a, SRC_AGG_LABELS[a], a === (cur.agg || 'latest'))).join('')}</select>`, 'ei-s-aggrow') : '<p class="ed-hint">This number is part of a built-in table, so you can only hide it.</p>');
        if (!canSrc) return;
        const g = id => $('#' + id, b);
        const refresh = () => {
          const s = g('ei-s-sheet').value;
          ['ei-s-fieldrow', 'ei-s-aggrow'].forEach(i => g(i).style.display = s ? '' : 'none');
          g('ei-s-field').innerHTML = (s ? getAvailableFields(s) : []).map(f => opt(f, f, f === cur.field)).join('');
          const rows = s ? srcRowOptions(s) : [];
          g('ei-s-rowrow').style.display = s && rows.length ? '' : 'none';
          g('ei-s-row').innerHTML = opt('', 'All rows', !cur.row_key) + rows.map(r => opt(r.key, r.label, r.key === (cur.row_key || '').toLowerCase())).join('');
        };
        g('ei-s-sheet').onchange = () => { cur.field = ''; refresh(); }; refresh();
      },
      onApply(b) {
        const s = $('#ei-s-sheet', b).value;
        if (!s) { lsChange(d => { delete d.src[key]; }); return; }
        const field = $('#ei-s-field', b).value; if (!field) { toast('Pick a column first.'); return false; }
        const src = { sheet: s, field, row_key: $('#ei-s-row', b).value, agg: $('#ei-s-agg', b).value };
        lsChange(d => { d.src[key] = src; });
      },
      extra: [{ label: hidden ? 'Show this number' : 'Hide this number', onClick() { lsChange(d => { const h = new Set(d.hidden); h.has(key) ? h.delete(key) : h.add(key); d.hidden = [...h]; }); } }]
        .concat(canSrc && LS.draft.src[key] ? [{ label: 'Back to original', onClick() { lsChange(d => { delete d.src[key]; }); } }] : [])
    });
  }

  // ── Level 1 highlight card ─────────────────────────────────────────────
  const ICONS = ['🥇', '🏆', '⭐', '🛡️', '⚙️', '🧼', '🏭', '🔧', '📦', '💲', '❤️', '🚚', '🧪', '🌟'];
  function highlightForm(key, anchor) {
    lsEnsure();
    const c = key ? LS.draft.hl.find(x => x.key === key) : null;
    Insp.open({
      title: c ? 'Edit highlight card' : 'Add highlight card', anchor, applyLabel: c ? 'Update' : 'Add',
      build(b) {
        b.innerHTML = row('Card name', `<input type="text" id="ei-hl-label" maxlength="30" value="${esc(c ? c.label : '')}" placeholder="e.g. Safety">`) +
          row('Icon', `<input type="text" id="ei-hl-icon" maxlength="4" value="${esc(c ? (c.icon || '') : '⭐')}">`) +
          `<div class="ed-icons">${ICONS.map(i => `<button type="button" data-ic="${i}">${i}</button>`).join('')}</div>` +
          `<p class="ed-hint">The person’s name on each card is still typed on the dashboard itself.</p>`;
        b.addEventListener('click', e => { const t = e.target.closest('[data-ic]'); if (t) $('#ei-hl-icon', b).value = t.dataset.ic; });
      },
      onApply(b) {
        const label = $('#ei-hl-label', b).value.trim(), icon = $('#ei-hl-icon', b).value.trim() || '⭐';
        if (!label) { toast('Give the card a name.'); return false; }
        lsChange(d => { if (c) { const x = d.hl.find(h => h.key === key); if (x) { x.label = label; x.icon = icon; } } else d.hl.push({ key: 'c-' + uid().slice(0, 8), label, icon }); });
      },
      extra: c ? [{ label: 'Remove card', cls: 'danger', onClick() { if (LS.draft.hl.length <= 1 && !confirm('Remove the last card? The section will be empty.')) return false; lsChange(d => { d.hl = d.hl.filter(h => h.key !== key); }); } }] : []
    });
  }

  // ── New section / rename a custom section ──────────────────────────────
  function sectionForm(id, anchor) {
    lsEnsure();
    const p = id ? LS.draft.panels.find(x => cpId(x) === id) : null;
    Insp.open({
      title: p ? 'Rename section' : 'Add a section', anchor, applyLabel: p ? 'Update' : 'Add section',
      build(b) {
        b.innerHTML = row('Name', `<input type="text" id="ei-sec-title" maxlength="60" value="${esc(p ? p.title : '')}" placeholder="e.g. Shipping dock">`) +
          row('Icon (optional)', `<input type="text" id="ei-sec-icon" maxlength="4" value="${esc(p ? (p.icon || '') : '')}" placeholder="e.g. 🚚">`) +
          (p ? '' : row('Width', `<select id="ei-sec-span">${SPANS.map(([n, l]) => opt(n, l === 'Full' ? 'Full row' : l + ' of the row', n === 4)).join('')}</select>`));
      },
      onApply(b) {
        const title = $('#ei-sec-title', b).value.trim(), icon = $('#ei-sec-icon', b).value.trim();
        if (!title) { toast('Give the section a name first.'); return false; }
        if (p) { lsChange(d => { const x = d.panels.find(q => q.id === p.id); if (x) { x.title = title; x.icon = icon; } }); return; }
        const np = { id: uid(), title, icon, span: Number($('#ei-sec-span', b).value) || 4 };
        lsChange(d => { d.panels.push(np); d.order.push(cpId(np)); d.spans[cpId(np)] = np.span; });
        setTimeout(() => { const el = document.getElementById(cpId(np)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 120);
      }
    });
  }

  // ── Production Summary: rename blocks, pick lines, columns and tiles ──
  function productionForm(anchor) {
    lsEnsure();
    const cur = prodSanitize(LS.draft.prod || (window.PLANT_CONFIG.productionSummary) || PROD_DEFAULT);
    const W = JSON.parse(JSON.stringify(cur));
    const sheets = dashSheetNames(), lines = (window.ACTIVE_PLANT && ACTIVE_PLANT.lines) || [];
    const fieldOpts = (sheetName, now) => { const fs = getAvailableFields(sheetName).slice(); if (now && !fs.includes(now)) fs.unshift(now); return fs.map(f => opt(f, f, f === now)).join(''); };
    const selOf = (obj, map) => Object.keys(map).map(k => opt(k, map[k], k === obj)).join('');
    const tileRow = (t, i, grp) => `<div class="ed-card" data-grp="${grp}" data-i="${i}">
      <div class="ed-2"><label class="ed-f"><span>Label</span><input data-k="label" value="${esc(t.label)}" maxlength="40"></label>
        <label class="ed-f"><span>Sheet</span><select data-k="sheet">${sheets.map(s => opt(s, s, s === t.sheet)).join('')}</select></label></div>
      <div class="ed-2"><label class="ed-f"><span>Column</span><select data-k="field">${fieldOpts(t.sheet, t.field)}</select></label>
        <label class="ed-f"><span>Combine rows as</span><select data-k="agg">${selOf(t.agg, PROD_AGGS)}</select></label></div>
      <div class="ed-2"><label class="ed-f"><span>Show as</span><select data-k="format">${selOf(t.format, PROD_FORMATS)}</select></label>
        <label class="ed-f"><span>Which day</span><select data-k="date">${opt('selected', 'The chosen day', t.date === 'selected')}${opt('latest', 'Latest day with data', t.date === 'latest')}</select></label></div>
      ${prodIsL2L(t.sheet, t.field) ? '<div class="ed-hint">This number comes from L2L automatically.</div>' : ''}
      <button type="button" class="ed-link danger" data-rm="${grp}|${i}">Remove</button></div>`;
    const colRow = (c, i) => `<div class="ed-card" data-grp="col" data-i="${i}">
      <div class="ed-2"><label class="ed-f"><span>Heading</span><input data-k="label" value="${esc(c.label)}" maxlength="24"></label>
        <label class="ed-f"><span>Column</span><select data-k="field">${fieldOpts('Production', c.field)}</select></label></div>
      <div class="ed-2"><label class="ed-f"><span>Show as</span><select data-k="format">${selOf(c.format, PROD_FORMATS)}</select></label>
        <label class="ed-f"><span>Which day</span><select data-k="date">${opt('selected', 'The chosen day', c.date === 'selected')}${opt('latest', 'Latest day with data', c.date === 'latest')}</select></label></div>
      ${prodIsL2L('Production', c.field) ? '<div class="ed-hint">This number comes from L2L automatically.</div>' : ''}
      <button type="button" class="ed-link danger" data-rm="col|${i}">Remove</button></div>`;
    const pillRow = (p, i) => `<div class="ed-card" data-grp="pill" data-i="${i}"><div class="ed-2"><label class="ed-f"><span>Short name</span><input data-k="label" value="${esc(p.label)}" maxlength="12"></label>
        <label class="ed-f"><span>Yes/No column</span><select data-k="field">${fieldOpts('Production', p.field)}</select></label></div><button type="button" class="ed-link danger" data-rm="pill|${i}">Remove</button></div>`;
    const render = b => {
      b.innerHTML = `<div class="ed-2">${row('Section title', `<input id="ep-title" maxlength="60" value="${esc(W.title)}">`)}${row('Icon', `<input id="ep-icon" maxlength="4" value="${esc(W.icon)}">`)}</div>
        <h4>Which lines</h4><div class="ed-lines">${lines.map(l => `<label class="ed-chk"><input type="checkbox" data-line="${esc(l)}"${(W.lines === 'all' || W.lines.includes(l)) ? ' checked' : ''}> <span>${esc(prodLineLabel(l))}</span></label>`).join('') || '<span class="ed-hint">Add your lines in plant-config.js</span>'}</div>
        <h4>${chk('ep-left-show', 'Left block', W.left.show)}</h4>${row('Title', `<input id="ep-left-title" maxlength="60" value="${esc(W.left.title)}">`)}
        <div class="ed-sub">Ready / not-ready ticks for each line</div>${W.left.pills.map(pillRow).join('')}<button type="button" class="ed-link" data-add="pill">+ Add a tick</button>
        <h4>${chk('ep-right-show', 'Right block', W.right.show)}</h4>${row('Title', `<input id="ep-right-title" maxlength="60" value="${esc(W.right.title)}">`)}
        <div class="ed-2">${row('Day shown by default', `<select id="ep-mode">${opt('yesterday', 'Yesterday', W.right.dateMode === 'yesterday')}${opt('today', 'Today', W.right.dateMode === 'today')}${opt('latest', 'Latest day with data', W.right.dateMode === 'latest')}</select>`)}
          <div>${chk('ep-picker', 'Let viewers pick a day', W.right.picker)}</div></div>
        <div class="ed-sub">Number tiles</div>${W.right.tiles.map((t, i) => tileRow(t, i, 'tile')).join('')}<button type="button" class="ed-link" data-add="tile">+ Add a tile</button>
        <div class="ed-sub">${chk('ep-drv-show', 'Top downtime drivers box', W.right.drivers.show)}</div>${row('Box title', `<input id="ep-drv-title" maxlength="60" value="${esc(W.right.drivers.title)}">`)}
        <div class="ed-sub">${chk('ep-tbl-show', 'Table of lines', W.right.table.show)}</div>${row('Table title', `<input id="ep-tbl-title" maxlength="40" value="${esc(W.right.table.title)}">`)}
        ${W.right.table.columns.map(colRow).join('')}<button type="button" class="ed-link" data-add="col">+ Add a column</button>
        <h4>${chk('ep-tot-show', 'Totals row', W.totals.show)}</h4>${W.totals.tiles.map((t, i) => tileRow(t, i, 'total')).join('')}<button type="button" class="ed-link" data-add="total">+ Add a total</button>
        <p class="ed-hint">OEE, Downtime, Code Red and Code Yellow always come from L2L and can’t be typed over. Stays in your draft until you press <b>Save for everyone</b>.</p>`;
    };
    const pull = b => {   // read every input back into W
      W.title = $('#ep-title', b).value; W.icon = $('#ep-icon', b).value;
      const picked = $$('[data-line]', b).filter(x => x.checked).map(x => x.dataset.line);
      W.lines = picked.length === lines.length ? 'all' : picked;
      W.left.show = $('#ep-left-show', b).checked; W.left.title = $('#ep-left-title', b).value;
      W.right.show = $('#ep-right-show', b).checked; W.right.title = $('#ep-right-title', b).value; W.right.dateMode = $('#ep-mode', b).value; W.right.picker = $('#ep-picker', b).checked;
      W.right.drivers.show = $('#ep-drv-show', b).checked; W.right.drivers.title = $('#ep-drv-title', b).value;
      W.right.table.show = $('#ep-tbl-show', b).checked; W.right.table.title = $('#ep-tbl-title', b).value; W.totals.show = $('#ep-tot-show', b).checked;
      const listOf = g => g === 'tile' ? W.right.tiles : g === 'total' ? W.totals.tiles : g === 'col' ? W.right.table.columns : W.left.pills;
      $$('.ed-card', b).forEach(c => { const o = listOf(c.dataset.grp)[+c.dataset.i]; if (!o) return; $$('[data-k]', c).forEach(inp => { o[inp.dataset.k] = inp.value; }); });
    };
    Insp.open({
      title: 'Customize Production Summary', anchor, wide: true, applyLabel: 'Apply',
      build(b) {
        render(b);
        b.addEventListener('change', e => { if (e.target.matches('[data-k="sheet"]')) { pull(b); const c = e.target.closest('.ed-card'), o = (c.dataset.grp === 'tile' ? W.right.tiles : W.totals.tiles)[+c.dataset.i]; o.field = getAvailableFields(o.sheet)[0] || ''; render(b); } });
        b.addEventListener('click', e => {
          const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
          if (!add && !rm) return; pull(b);
          if (add) {
            const k = add.dataset.add;
            if (k === 'tile') W.right.tiles.push({ id: 'ptile-' + Date.now().toString(36), label: 'New tile', sheet: 'Production', field: getAvailableFields('Production')[0] || '', agg: 'last', format: 'number', date: 'selected' });
            if (k === 'total') W.totals.tiles.push({ id: 'ptotal-' + Date.now().toString(36), label: 'New total', sheet: 'Production', field: getAvailableFields('Production')[0] || '', agg: 'sum', format: 'number', date: 'latest' });
            if (k === 'col') W.right.table.columns.push({ label: 'New', field: getAvailableFields('Production')[0] || '', agg: 'avg', format: 'number', date: 'selected' });
            if (k === 'pill') W.left.pills.push({ label: 'NEW', field: getAvailableFields('Production')[0] || '' });
          } else {
            const [g, i] = rm.dataset.rm.split('|'); (g === 'tile' ? W.right.tiles : g === 'total' ? W.totals.tiles : g === 'col' ? W.right.table.columns : W.left.pills).splice(+i, 1);
          }
          render(b);
        });
      },
      onApply(b) {
        pull(b);
        const clean = prodSanitize(W), def = prodSanitize(window.PLANT_CONFIG.productionSummary || PROD_DEFAULT);
        lsChange(d => { d.prod = JSON.stringify(clean) === JSON.stringify(def) ? null : clean; });
      },
      extra: [{ label: 'Back to default', cls: 'danger', onClick() { lsChange(d => { d.prod = null; }); } }]
    });
  }

  // ═══ Decorating the real page ═════════════════════════════════════════
  const mk = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function curSpan(el) { const m = /span\s+(\d+)/.exec(el.style.gridColumn || ''); return m ? +m[1] : 12; }
  function decorate() {
    $$('.ed-x').forEach(n => n.remove());
    if (!EDIT.on || !LS.draft) return;
    const d = LS.draft, hidden = new Set(d.hidden);
    $$('#main-sortable > .panel').forEach(p => {
      const id = p.id, custom = id.indexOf('cpanel-') === 0, off = hidden.has('panel:' + id), span = d.spans[id] || curSpan(p);
      const bar = mk('div', 'ed-x ed-pbar' + (off ? ' off' : ''),
        `<span class="ed-grip" title="Drag to move this section" tabindex="0" role="button" aria-label="Move section">⋮⋮</span>
         <span class="ed-ptitle">${esc(panelTitle(id, d))}${off ? ' <em>· hidden</em>' : ''}</span>
         <span class="ed-ptools">
          <button type="button" class="ed-ic" data-a="left" title="Move earlier" aria-label="Move earlier">◀</button>
          <button type="button" class="ed-ic" data-a="right" title="Move later" aria-label="Move later">▶</button>
          ${SPANS.map(([n, l]) => `<button type="button" class="ed-ic txt${span === n ? ' on' : ''}" data-span="${n}" title="${l === 'Full' ? 'Full width' : l + ' of the row'}">${l}</button>`).join('')}
          ${id === 'panel-production' ? '<button type="button" class="ed-ic txt" data-a="prod">✎ Customize</button>' : ''}
          ${custom ? '<button type="button" class="ed-ic txt" data-a="rename">✎ Rename</button>' : ''}
          <button type="button" class="ed-ic txt" data-a="eye">${off ? 'Show' : 'Hide'}</button>
          ${custom ? '<button type="button" class="ed-ic txt del" data-a="del">Remove</button>' : ''}
         </span>`);
      bar.dataset.panel = id; p.insertBefore(bar, p.firstChild);
      const host = $('.panel-body', p) || p;
      const add = mk('button', 'ed-x ed-add', id === 'panel-highlights' ? '+ Add a highlight card' : '+ Add a number, chart or note');
      add.type = 'button'; add.dataset.add = id; host.appendChild(add);
    });
    LS_BUILTIN = layItems();
    LS_BUILTIN.forEach(it => it.boxes.forEach(b => {
      const key = b.key, off = hidden.has(key), src = d.src[key];
      const ctl = mk('span', 'ed-x ed-tilectl' + (src ? ' fed' : ''), `<button type="button" data-tile="${esc(key)}" data-label="${esc(b.label)}" title="Change this number">⚙</button><button type="button" data-hide="${esc(key)}" title="${off ? 'Show this number again' : 'Hide this number'}">${off ? '↺' : '×'}</button>`);
      b.el.appendChild(ctl);
      if (src) b.el.classList.add('ed-fed'); else b.el.classList.remove('ed-fed');
    }));
    $$('.custom-widget').forEach(w => {
      const id = w.id.replace(/^cw-/, '');
      w.appendChild(mk('span', 'ed-x ed-tilectl', `<button type="button" data-cwedit="${esc(id)}" title="Edit">✎</button><button type="button" data-cwrm="${esc(id)}" title="Remove">×</button>`));
    });
    const hg = $('#highlights-grid');
    if (hg) $$('.hl-card', hg).forEach(c => {
      c.appendChild(mk('span', 'ed-x ed-tilectl', `<button type="button" data-hlmv="${esc(c.dataset.dept)}|-1" title="Move earlier">◂</button><button type="button" data-hlmv="${esc(c.dataset.dept)}|1" title="Move later">▸</button><button type="button" data-hledit="${esc(c.dataset.dept)}" title="Rename or change icon">✎</button>`));
    });
  }
  EDIT.decorate = () => { if (EDIT.on) { clearTimeout(EDIT._dt); EDIT._dt = setTimeout(decorate, 30); } };

  // ═══ The bottom bar ═══════════════════════════════════════════════════
  function buildBar() {
    if ($('#ed-bar')) return;
    const bar = mk('div', 'ed-keep', `
      <div class="ed-bar-row">
        <strong class="ed-title">✎ Editing dashboard</strong>
        <span id="ed-sum" class="ed-sum" role="status"></span><span class="sp"></span>
        <button type="button" class="ed-btn" id="ed-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
        <button type="button" class="ed-btn" id="ed-redo" title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <button type="button" class="ed-btn" id="ed-more" aria-haspopup="true">⋯ More</button>
        <button type="button" class="ed-btn" id="ed-cancel">Cancel</button>
        <button type="button" class="ed-btn primary" id="ed-save" title="Ctrl+S">Save for everyone</button>
      </div>
      <div id="ed-menu" class="ed-menu" hidden>
        <button type="button" data-m="section">＋ Add a section</button>
        <button type="button" data-m="history">🕘 Earlier versions…</button>
        <button type="button" data-m="export">⬇ Save this layout to a file</button>
        <button type="button" data-m="import">⬆ Load a layout from a file</button>
        <button type="button" data-m="starter">▦ Start from a ready-made layout…</button>
        <button type="button" data-m="reset">↺ Back to original order & size</button>
      </div>`);
    bar.id = 'ed-bar'; document.body.appendChild(bar);
    $('#ed-undo').onclick = () => lsUndo(); $('#ed-redo').onclick = () => lsRedo();
    $('#ed-cancel').onclick = () => EDIT.cancel(); $('#ed-save').onclick = () => EDIT.save();
    $('#ed-more').onclick = e => { const m = $('#ed-menu'); m.hidden = !m.hidden; e.stopPropagation(); };
    $('#ed-menu').addEventListener('click', e => {
      const t = e.target.closest('[data-m]'); if (!t) return; $('#ed-menu').hidden = true;
      const a = t.dataset.m, anchor = $('#ed-more');
      if (a === 'section') sectionForm(null, anchor);
      else if (a === 'history') EDIT.historyForm(anchor);
      else if (a === 'export') EDIT.exportLayout();
      else if (a === 'import') EDIT.pickFile();
      else if (a === 'starter') EDIT.starterForm(anchor);
      else if (a === 'reset' && confirm('Put every section back in its original place and size? (Hidden items and added items stay as they are.)')) layoutReset();
    });
    document.addEventListener('click', e => { const m = $('#ed-menu'); if (m && !m.hidden && !e.target.closest('#ed-menu')) m.hidden = true; });
  }
  EDIT.updateBar = () => {
    const bar = $('#ed-bar'); if (!bar) return;
    const dirty = lsDirty(), sum = dirty ? lsSummary() : [];
    if (dirty) { const t = $('#ed-tips'); if (t) t.remove(); }
    $('#ed-sum').textContent = dirty ? 'Unsaved: ' + sum.join(' · ') : 'No changes yet. Drag, resize, or click things to change them.';
    bar.classList.toggle('dirty', dirty);
    $('#ed-save').disabled = !dirty; $('#ed-undo').disabled = LS.hi <= 0; $('#ed-redo').disabled = LS.hi >= LS.hist.length - 1;
  };
  function toast(msg) { lsToast(msg); }

  // ═══ Entering / leaving ═══════════════════════════════════════════════
  EDIT.toggle = () => EDIT.on ? EDIT.cancel() : EDIT.enter();
  EDIT.enter = () => {
    if (!(NovusCore.isAdmin && NovusCore.isAdmin())) return;
    if (typeof closeMore === 'function') closeMore();
    lsEnsure(); EDIT.on = true; document.body.classList.add('editing');
    $$('[contenteditable="true"]').forEach(el => { el.dataset.edCe = '1'; el.contentEditable = 'false'; });
    if (typeof setDragEnabled === 'function') setDragEnabled(true);
    buildBar(); lsApply(LS.draft); decorate(); EDIT.updateBar(); EDIT.tips();
  };
  EDIT.leave = () => {
    Insp.close(true); EDIT.on = false; document.body.classList.remove('editing');
    $$('.ed-x,.ed-keep').forEach(n => n.remove());
    $$('[data-ed-ce]').forEach(el => { el.removeAttribute('data-ed-ce'); });
    if (typeof setDragEnabled === 'function') setDragEnabled(false);
    if (typeof applyRoleAccess === 'function') applyRoleAccess();
    if (typeof applyHidden === 'function') applyHidden();
  };
  EDIT.cancel = () => {
    if (lsDirty() && !confirm('Throw away your unsaved changes?')) return;
    lsDel(draftKey()); LS.draft = null; EDIT.leave(); lsApply(lsSavedState());
  };
  EDIT.refresh = () => { if (!EDIT.on) return; lsApply(LS.draft); decorate(); EDIT.updateBar(); };

  // Local safety copy of the draft: survives a refresh or a closed tab.
  EDIT.persist = () => {
    if (!LS.draft) return;
    if (!lsDirty()) { lsDel(draftKey()); return; }
    lsSet(draftKey(), JSON.stringify({ ts: Date.now(), token: EDIT.token, draft: LS.draft }));
  };
  EDIT.afterLoad = () => {
    let saved = null; try { saved = JSON.parse(lsGet(draftKey()) || 'null'); } catch (_) {}
    if (!saved || !saved.draft || !(NovusCore.isAdmin && NovusCore.isAdmin())) return;
    if (EDIT.on || $('#ed-resume')) return;
    const when = new Date(saved.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const b = mk('div', 'ed-keep ed-resume', `<span>You have unsaved dashboard changes from ${esc(when)}.</span><button type="button" class="ed-btn primary" data-r="go">Keep editing</button><button type="button" class="ed-btn" data-r="drop">Discard them</button>`);
    b.id = 'ed-resume'; document.body.appendChild(b);
    b.addEventListener('click', e => {
      const t = e.target.closest('[data-r]'); if (!t) return;
      if (t.dataset.r === 'go') {
        LS.draft = saved.draft; LS.hist = [JSON.stringify(LS.draft)]; LS.hi = 0; if (saved.token != null) EDIT.draftBase = saved.token;
        b.remove(); EDIT.enter();
        if (saved.token !== EDIT.token) toast('Heads up: someone saved changes after this draft was started. You will be asked before anything is overwritten.');
      } else { lsDel(draftKey()); b.remove(); }
    });
  };

  // ═══ Saving, with a check that nobody else saved in the meantime ═══════
  EDIT.loadToken = async () => {
    try { const { data } = await NovusDB.layoutHistory.list(plantId(), 1); EDIT.token = data && data[0] ? data[0].id : null; } catch (_) { EDIT.token = null; }
  };
  EDIT.save = async () => {
    if (!lsDirty()) return;
    const btn = $('#ed-save'); btn.disabled = true; btn.textContent = 'Checking…';
    let newest = null;
    try { const { data } = await NovusDB.layoutHistory.list(plantId(), 1); newest = data && data[0] ? data[0] : null; } catch (_) {}
    const base = EDIT.draftBase !== undefined ? EDIT.draftBase : EDIT.token;
    if ((newest ? newest.id : null) !== (base == null ? null : base)) {
      btn.textContent = 'Save for everyone'; btn.disabled = false;
      const who = newest ? esc(newest.saved_by || 'Someone') + ' saved changes ' + esc(new Date(newest.saved_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'The dashboard was changed';
      Insp.open({
        title: 'Someone else changed the dashboard', noApply: true, wide: false, anchor: $('#ed-save'),
        html: `<p>${who} while you were editing.</p><p>If you save now, your version replaces theirs. You can reload to see theirs first; your draft stays on this computer so you can still get your changes back.</p>`,
        extra: [{ label: 'Reload their version', onClick() { EDIT.persist(); location.reload(); return false; } }, { label: 'Replace with mine', cls: 'danger', onClick() { EDIT.draftBase = newest ? newest.id : null; EDIT.save(); } }]
      });
      return;
    }
    btn.textContent = 'Saving…';
    const ok = await lsSave();
    btn.textContent = 'Save for everyone';
    if (ok) {
      lsDel(draftKey()); EDIT.draftBase = undefined;
      const snap = lsSavedState(); let id = null;
      try { await NovusDB.layoutHistory.add(plantId(), snap, '', me().username); const { data } = await NovusDB.layoutHistory.list(plantId(), 1); id = data && data[0] ? data[0].id : null; } catch (_) {}
      EDIT.token = id; EDIT.leave(); toast('Saved. Everyone now sees this layout.');
    } else EDIT.updateBar();
  };

  // ═══ Earlier versions, layout files, ready-made layouts ═══════════════
  EDIT.historyForm = async anchor => {
    const { data, error } = await NovusDB.layoutHistory.list(plantId(), 20);
    Insp.open({
      title: 'Earlier versions', anchor, noApply: true, wide: true,
      build(b) {
        if (error) { b.innerHTML = `<p class="ed-hint">Could not load versions: ${esc(error.message)}</p>`; return; }
        b.innerHTML = (data && data.length ? `<p class="ed-hint" style="margin-top:0">Pick a version to load it into your draft. You can look it over and then save, or cancel.</p>` +
          data.map(r => `<div class="ed-card"><div><b>${esc(new Date(r.saved_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b><br><span class="ed-hint">${esc(r.saved_by || '')}</span></div><button type="button" class="ed-btn" data-load="${esc(r.id)}">Load into draft</button></div>`).join('')
          : '<p class="ed-hint">Nothing here yet. Every time you press “Save for everyone”, that version is kept so you can come back to it.</p>');
        b.addEventListener('click', async e => {
          const t = e.target.closest('[data-load]'); if (!t) return;
          const { data: row, error: e2 } = await NovusDB.layoutHistory.get(t.dataset.load);
          if (e2 || !row) { toast('Could not load that version.'); return; }
          EDIT.applySnapshot(row.snapshot); Insp.close(true); toast('Loaded into your draft. Press Save for everyone to keep it.');
        });
      }
    });
  };
  // Takes a saved-state style object and puts it into the draft.
  EDIT.applySnapshot = snap => {
    lsChange(d => {
      const n = normalizeLayout(snap, d);
      d.panels = n.panels; d.order = n.order; d.spans = n.spans; d.hidden = n.hidden; d.cw = n.cw; d.src = n.src; d.hl = n.hl; d.prod = n.prod;
    });
  };
  // Makes any layout object safe to use: known shapes only.
  function normalizeLayout(s, d) {
    s = s || {};
    const panels = (Array.isArray(s.panels) ? s.panels : []).filter(p => p && p.id && p.title).map(p => ({ id: String(p.id), title: String(p.title).slice(0, 60), icon: String(p.icon || '').slice(0, 4), span: Math.max(2, Math.min(12, Number(p.span) || 4)) }));
    const known = new Set(CW_PANELS.map(p => p.id).concat(panels.map(cpId)));
    const spans = {}; Object.keys(s.spans || {}).forEach(k => { if (known.has(k)) spans[k] = Math.max(2, Math.min(12, Number(s.spans[k]) || 4)); });
    const full = Object.assign(lsDefaultSpans(panels), spans);
    const hidden = (Array.isArray(s.hidden) ? s.hidden : []).filter(k => typeof k === 'string' && /^(panel|metric):/.test(k));
    const cw = (Array.isArray(s.cw) ? s.cw : []).filter(w => w && known.has(w.panel_id) && w.widget_type).map(w => Object.assign({}, w, { plant_id: plantId() }));
    const src = {}; Object.keys(s.src || {}).forEach(k => { const r = s.src[k]; if (r && r.sheet && r.field) src[k] = { sheet: String(r.sheet), field: String(r.field), row_key: String(r.row_key || ''), agg: ['latest', 'avg7', 'sum7'].includes(r.agg) ? r.agg : 'latest' }; });
    const hl = (Array.isArray(s.hl) && s.hl.length ? s.hl : (d && d.hl) || HL_DEFAULT).filter(c => c && c.key && c.label).map(c => ({ key: String(c.key), label: String(c.label).slice(0, 30), icon: String(c.icon || '⭐').slice(0, 4) }));
    return { panels, order: lsNormOrder(s.order, panels).filter(id => known.has(id)), spans: full, hidden, cw, src, hl, prod: s.prod ? prodSanitize(s.prod) : null };
  }
  // Layout files: ids of sections / widgets are renamed so a layout can be loaded more than once.
  EDIT.exportLayout = () => {
    const st = LS.draft || lsSavedState();
    const out = { format: 'dds-layout', version: 1, name: (window.PLANT_CONFIG.plant.name || 'layout') + ' layout', exportedAt: new Date().toISOString(),
      panels: st.panels, order: st.order, spans: st.spans, hidden: st.hidden, cw: st.cw.map(w => { const c = Object.assign({}, w); delete c.plant_id; delete c.created_by; delete c.created_at; return c; }), src: st.src, hl: st.hl, prod: st.prod || null };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    a.download = 'dds-layout-' + plantId() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    toast('Layout saved to a file. Load it on another dashboard with “Load a layout from a file”.');
  };
  EDIT.importLayout = obj => {
    if (!obj || obj.format !== 'dds-layout') { toast('That file is not a dashboard layout.'); return false; }
    const map = {};
    const panels = (obj.panels || []).map(p => { const nid = uid(); map['cpanel-' + p.id] = 'cpanel-' + nid; return Object.assign({}, p, { id: nid }); });
    const re = id => map[id] || id;
    const snap = { panels, order: (obj.order || []).map(re), spans: {}, hidden: (obj.hidden || []).map(k => k.indexOf('panel:') === 0 ? 'panel:' + re(k.slice(6)) : k),
      cw: (obj.cw || []).map(w => Object.assign({}, w, { id: uid(), panel_id: re(w.panel_id) })), src: obj.src || {}, hl: obj.hl, prod: obj.prod };
    Object.keys(obj.spans || {}).forEach(k => { snap.spans[re(k)] = obj.spans[k]; });
    EDIT.applySnapshot(snap); return true;
  };
  EDIT.pickFile = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => { const f = i.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (EDIT.importLayout(o)) toast('Layout loaded into your draft. Press Save for everyone to keep it.'); } catch (_) { toast('Could not read that file.'); } };
    i.click();
  };
  EDIT.starterForm = async anchor => {
    let list = [];
    try { const r = await fetch('layouts/index.json?v=' + Date.now(), { cache: 'no-cache' }); if (r.ok) list = (await r.json()).layouts || []; } catch (_) {}
    Insp.open({
      title: 'Ready-made layouts', anchor, noApply: true, wide: true,
      build(b) {
        b.innerHTML = '<p class="ed-hint" style="margin-top:0">Loading one replaces the sections in your draft. Nothing changes for anyone until you press Save for everyone.</p>' +
          (list.length ? list.map((l, i) => `<div class="ed-card"><div><b>${esc(l.name)}</b><br><span class="ed-hint">${esc(l.description || '')}</span></div><button type="button" class="ed-btn" data-st="${i}">Use this</button></div>`).join('') : '<p class="ed-hint">No ready-made layouts were found in the layouts folder.</p>');
        b.addEventListener('click', async e => {
          const t = e.target.closest('[data-st]'); if (!t) return;
          if (lsDirty() && !confirm('This replaces what is in your draft. Continue?')) return;
          try { const r = await fetch('layouts/' + list[+t.dataset.st].file + '?v=' + Date.now(), { cache: 'no-cache' }); const o = await r.json(); if (EDIT.importLayout(o)) { Insp.close(true); toast('Loaded “' + list[+t.dataset.st].name + '” into your draft.'); } } catch (_) { toast('Could not load that layout.'); }
        });
      }
    });
  };

  // ═══ First-time tips ══════════════════════════════════════════════════
  EDIT.tips = () => {
    if (lsGet(tipsKey) || $('#ed-tips')) return;
    const t = mk('div', 'ed-keep', `<b>You’re now editing the real dashboard.</b>
      <ul><li>Drag a section by its <b>⋮⋮</b> handle, or use <b>◀ ▶</b>. Choose <b>⅓ ½ ⅔ Full</b> for its width.</li>
      <li>Click <b>⚙</b> on any number to change where it comes from, or <b>×</b> to hide it.</li>
      <li>Use <b>＋</b> at the bottom of a section to add a number, chart or note.</li>
      <li>Nothing is shared until you press <b>Save for everyone</b>. <b>Cancel</b> throws your changes away, and every saved version is kept under <b>⋯ More → Earlier versions</b>.</li></ul>
      <button type="button" class="ed-btn primary">Got it</button>`);
    t.id = 'ed-tips'; document.body.appendChild(t);
    $('button', t).onclick = () => { lsSet(tipsKey, '1'); t.remove(); };
  };

  // ═══ Clicks on the decorated page ═════════════════════════════════════
  document.addEventListener('click', e => {
    if (!EDIT.on) return;
    const pbar = e.target.closest('.ed-pbar');
    if (pbar) {
      const id = pbar.dataset.panel, a = e.target.closest('[data-a]'), sp = e.target.closest('[data-span]');
      if (sp) lsChange(d => { d.spans[id] = Number(sp.dataset.span); });
      else if (a) {
        const act = a.dataset.a;
        if (act === 'eye') lsChange(d => { const h = new Set(d.hidden), k = 'panel:' + id; h.has(k) ? h.delete(k) : h.add(k); d.hidden = [...h]; });
        else if (act === 'left' || act === 'right') lsChange(d => { const o = lsNormOrder(d.order, d.panels), i = o.indexOf(id), j = act === 'left' ? i - 1 : i + 1; if (j < 0 || j >= o.length) return; o.splice(j, 0, o.splice(i, 1)[0]); d.order = o; });
        else if (act === 'prod') productionForm(a);
        else if (act === 'rename') sectionForm(id, a);
        else if (act === 'del') {
          const n = LS.draft.cw.filter(x => x.panel_id === id).length;
          if (!confirm('Remove this section' + (n ? ' and its ' + n + ' item' + (n > 1 ? 's' : '') : '') + '? It only disappears for everyone when you press Save.')) return;
          lsChange(d => { d.cw = d.cw.filter(w => w.panel_id !== id); d.panels = d.panels.filter(p => cpId(p) !== id); d.order = d.order.filter(x => x !== id); delete d.spans[id]; d.hidden = d.hidden.filter(k => k !== 'panel:' + id); });
        }
      }
      return;
    }
    const add = e.target.closest('.ed-add');
    if (add) { e.preventDefault(); if (add.dataset.add === 'panel-highlights') highlightForm(null, add); else widgetForm(add.dataset.add, null, add); return; }
    const t = e.target.closest('[data-tile]'); if (t) { e.preventDefault(); tileForm(t.dataset.tile, t.dataset.label, t); return; }
    const hd = e.target.closest('[data-hide]'); if (hd) { e.preventDefault(); const k = hd.dataset.hide; lsChange(d => { const h = new Set(d.hidden); h.has(k) ? h.delete(k) : h.add(k); d.hidden = [...h]; }); return; }
    const ce = e.target.closest('[data-cwedit]'); if (ce) { e.preventDefault(); const w = LS.draft.cw.find(x => x.id === ce.dataset.cwedit); if (w) widgetForm(w.panel_id, w, ce); return; }
    const cr = e.target.closest('[data-cwrm]'); if (cr) { e.preventDefault(); lsChange(d => { d.cw = d.cw.filter(x => x.id !== cr.dataset.cwrm); }); return; }
    const he = e.target.closest('[data-hledit]'); if (he) { e.preventDefault(); e.stopPropagation(); highlightForm(he.dataset.hledit, he); return; }
    const hm = e.target.closest('[data-hlmv]'); if (hm) { e.preventDefault(); e.stopPropagation(); const [k, dir] = hm.dataset.hlmv.split('|'); lsChange(d => { const i = d.hl.findIndex(c => c.key === k), j = i + Number(dir); if (i < 0 || j < 0 || j >= d.hl.length) return; d.hl.splice(j, 0, d.hl.splice(i, 1)[0]); }); return; }
  }, true);
  // Keyboard: arrows on the grip move a section; Ctrl+Z / Ctrl+S work like anywhere else.
  document.addEventListener('keydown', e => {
    if (!EDIT.on) return;
    const typing = e.target.matches && e.target.matches('input,textarea,select,[contenteditable="true"]');
    if (e.target.classList && e.target.classList.contains('ed-grip') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); const bar = e.target.closest('.ed-pbar'); const b = $(`[data-a="${(e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? 'left' : 'right'}"]`, bar); if (b) b.click();
      setTimeout(() => { const g = $(`.ed-pbar[data-panel="${bar.dataset.panel}"] .ed-grip`); if (g) g.focus(); }, 80); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); EDIT.save(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? lsRedo() : lsUndo(); }
    else if (e.key === 'Escape' && !Insp.el) { const m = $('#ed-menu'); if (m && !m.hidden) m.hidden = true; }
  });
  window.addEventListener('beforeunload', e => { if (window.LS && LS.draft && lsDirty()) { EDIT.persist(); e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', () => { if (Insp.el && !Insp.el.classList.contains('sheet')) Insp.place(Insp.opts && Insp.opts.anchor); });
})();
