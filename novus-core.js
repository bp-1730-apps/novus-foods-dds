// @ts-nocheck
/**
 * novus-core.js — plant Ops Hub shared utilities
 * ==========================================
 * Shared utilities loaded by every page.
 * Must be included AFTER novus-styles.css and BEFORE any page script.
 *
 * Provides:
 *   NovusCore.requireAuth()          — redirect to login if not authenticated
 *   NovusCore.navigateTo(url)        — navigate with a brief fade
 *   NovusCore.Toast.success(msg)     — green toast notification
 *   NovusCore.Toast.error(msg)       — red toast notification
 *   NovusCore.Toast.warning(msg)     — amber toast notification
 *   NovusCore.WorkbookCache.load()   — load XLSX buffer from sessionStorage
 *   NovusCore.WorkbookCache.save(f)  — save uploaded file to sessionStorage
 */

window.NovusCore = (() => {

  // Plant branding (logo, organisation name) comes from plant-config.js.
  function _brand() {
    const p = (window.PLANT_CONFIG && window.PLANT_CONFIG.plant) || {};
    return { org: p.org || p.name || '', logo: p.logo || '', logoWhite: p.logoWhite || p.logo || '' };
  }
  function _applyBrand() {
    const b = _brand();
    document.querySelectorAll('img[data-brand-logo]').forEach(img => {
      const src = img.getAttribute('data-brand-logo') === 'white' ? b.logoWhite : b.logo;
      if (src) { img.src = src; img.alt = b.org; } else { img.style.display = 'none'; }
    });
    // Admins get a Team link in the top navigation; super-admins also get Plants.
    const nav = document.querySelector('.cmd-nav');
    if (nav) {
      const add = (href, label) => {
        if (nav.querySelector('[href="' + href + '"]')) return;
        const a = document.createElement('a'); a.className = 'cmd-tab'; a.href = href; a.textContent = label; nav.appendChild(a);
      };
      if (isAdmin()) add('team.html', 'Team');
      if (isSuper()) add('plants.html', 'Plants');
      _plantSwitcher(nav);
    }
  }

  /** A small "Plant:" drop-down after the menu, shown when you belong to more than one plant. */
  function _plantSwitcher(nav) {
    const u = getUser();
    if (!u || !Array.isArray(u.plants) || u.plants.length < 2 || document.getElementById('plant-switch')) return;
    if (!document.getElementById('plant-switch-css')) {
      const st = document.createElement('style'); st.id = 'plant-switch-css';
      st.textContent = '.plant-switch{font:inherit;font-size:.78rem;font-weight:700;margin-left:10px;padding:5px 8px;border-radius:8px;border:1px solid var(--border,#d5dbe3);background:var(--surface,#fff);color:var(--ink,#1c2430);max-width:210px;cursor:pointer}';
      document.head.appendChild(st);
    }
    const sel = document.createElement('select');
    sel.id = 'plant-switch'; sel.className = 'plant-switch'; sel.setAttribute('aria-label', 'Switch plant');
    u.plants.forEach(p => {
      const o = document.createElement('option'); o.value = p.id; o.textContent = p.short_label || p.name || p.id;
      if (p.id === u.plant) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', () => switchPlant(sel.value));
    nav.appendChild(sel);
  }

  /** Show another plant: remember it for this tab and reload the page. */
  function switchPlant(id) {
    if (window.NovusAccess && NovusAccess.setActive(id)) {
      const url = new URL(location.href); url.searchParams.delete('plant');
      location.href = url.pathname.split('/').pop() === 'index.html' ? 'hub.html' : url.pathname.split('/').pop() + url.search;
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    _applyBrand();
    const pl = (window.PLANT_CONFIG && window.PLANT_CONFIG.plant) || {};
    if (pl.name && document.title.indexOf(pl.name) < 0) document.title = (document.title || 'Ops Hub') + ' – ' + pl.name;
    if (!VALUES.length) document.querySelectorAll('button.sd-item[onclick*="showCoreValues"]').forEach(b => b.remove());
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * requireAuth()
   * Call at the top of every page's onload / DOMContentLoaded.
   * If no valid session exists, redirects immediately to index.html.
   */
  const USER_KEY = 'dds_user';

  function requireAuth() {
    try {
      const raw  = sessionStorage.getItem(USER_KEY);
      const user = raw ? JSON.parse(raw) : null;
      const pid  = window.PLANT_CONFIG && window.PLANT_CONFIG.plant.id;
      if (!user || !user.role || (pid && user.plant !== pid)) {
        window.location.replace('index.html');
        return;
      }
      // Super-admin on a project with no plants yet: the only useful page is Plants.
      if (!user.plant && user.super && !/plants\.html$/.test(location.pathname)) {
        window.location.replace('plants.html');
        return;
      }
    } catch (_) {
      window.location.replace('index.html');
      return;
    }
    // The cached user above only drives what the page SHOWS. The database
    // decides what is actually allowed, using the real Supabase session.
    // If that session has expired or been revoked, go back to the login.
    if (window._sb && _sb.auth) {
      _sb.auth.getSession().then(({ data }) => {
        if (!data || !data.session) {
          try { sessionStorage.removeItem(USER_KEY); } catch (_) {}
          window.location.replace('index.html');
        }
      });
    }
  }

  /**
   * getUser()
   * { id, email, username, plant, role: 'admin'|'editor'|'viewer', loginTime }
   */
  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY));
    } catch (_) {
      return null;
    }
  }

  /** isAdmin(): may change layout, columns, tabs and people. */
  /** isSuper(): may create and delete plants and assign people to any plant. */
  function isSuper() {
    const u = getUser();
    return !!(u && u.super);
  }

  function isAdmin() {
    const u = getUser();
    return !!(u && u.role === 'admin');
  }

  /** canEditData(): may type into Data Entry and the highlight cards. */
  function canEditData() {
    const u = getUser();
    return !!(u && (u.role === 'admin' || u.role === 'editor'));
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * logout()
   * Clears all session data then redirects to the login page.
   */
  function logout() {
    try { if (window._sb) _sb.auth.signOut(); } catch(_) {}
    try { sessionStorage.clear(); } catch(_) {}
    try { localStorage.removeItem('novus_playcall_cache'); } catch(_) {}
    window.location.href = 'index.html';
  }

  // ── Toast notifications ───────────────────────────────────────────────────

  /**
   * Internal: inject the toast container once, lazily.
   */
  let _toastContainer = null;

  function _getContainer() {
    if (_toastContainer) return _toastContainer;

    const el = document.createElement('div');
    el.id = 'novus-toast-container';
    Object.assign(el.style, {
      position:      'fixed',
      bottom:        '24px',
      right:         '24px',
      zIndex:        '9999',
      display:       'flex',
      flexDirection: 'column',
      gap:           '10px',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    _toastContainer = el;
    return el;
  }

  const TOAST_COLORS = {
    success: { bg: '#065f46', border: '#059669', icon: '✓' },
    error:   { bg: '#7f1d1d', border: '#dc2626', icon: '✕' },
    warning: { bg: '#78350f', border: '#d97706', icon: '⚠' },
    info:    { bg: '#1e3a5f', border: '#3b82f6', icon: 'ℹ' },
  };

  /**
   * Toast.show(msg, type, durationMs)
   * Internal base — use .success / .error / .warning directly.
   */
  function _showToast(msg, type = 'info', duration = 3200) {
    const cfg       = TOAST_COLORS[type] || TOAST_COLORS.info;
    const container = _getContainer();

    const toast = document.createElement('div');
    Object.assign(toast.style, {
      display:       'flex',
      alignItems:    'center',
      gap:           '10px',
      background:    cfg.bg,
      border:        `1px solid ${cfg.border}`,
      borderRadius:  '10px',
      padding:       '11px 16px',
      color:         'white',
      fontSize:      '.84rem',
      fontFamily:    "'DM Sans', system-ui, sans-serif",
      fontWeight:    '600',
      boxShadow:     '0 4px 18px rgba(0,0,0,.25)',
      pointerEvents: 'auto',
      opacity:       '0',
      transform:     'translateX(20px)',
      transition:    'opacity .22s ease, transform .22s ease',
      maxWidth:      '340px',
      lineHeight:    '1.4',
      cursor:        'pointer',
    });

    const iconSpan = document.createElement('span');
    iconSpan.textContent = cfg.icon;
    Object.assign(iconSpan.style, {
      fontSize:    '1rem',
      flexShrink:  '0',
      opacity:     '.85',
    });

    const textSpan = document.createElement('span');
    textSpan.textContent = msg;

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    container.appendChild(toast);

    // Click to dismiss early
    toast.addEventListener('click', () => dismiss());

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity   = '1';
        toast.style.transform = 'translateX(0)';
      });
    });

    // Auto-dismiss
    const timer = setTimeout(() => dismiss(), duration);

    function dismiss() {
      clearTimeout(timer);
      toast.style.opacity   = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 260);
    }
  }

  const Toast = {
    success: (msg, ms) => _showToast(msg, 'success', ms),
    error:   (msg, ms) => _showToast(msg, 'error',   ms || 5000),
    warning: (msg, ms) => _showToast(msg, 'warning', ms),
    info:    (msg, ms) => _showToast(msg, 'info',    ms),
    show:    _showToast,
  };

  // ── WorkbookCache (XLSX upload fallback) ──────────────────────────────────
  // Used by the manual "Upload XLSX" button as a fallback when GAS is unavailable.
  // GAS data goes through NovusGAS.loadFromCache() (sessionStorage) separately.

  const WorkbookCache = {
    /**
     * save(file) → Promise<ArrayBuffer>
     * Reads a File object, returns its ArrayBuffer.
     * (Session caching of raw XLSX binaries was removed — GAS handles caching now.)
     */
    save(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsArrayBuffer(file);
      });
    },

    /**
     * load() → ArrayBuffer | null
     * Kept for backwards compatibility. Always returns null now
     * (GAS session cache is used instead via NovusGAS.loadFromCache).
     */
    load() {
      return null;
    },
  };

  /**
   * navigateTo(url)
   * Navigate to a URL.
   */
  function navigateTo(url) {
    window.location.href = url;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  // ── More (···) dropdown — shared across all pages ────────────────────────
  // Defined here so every page gets it just by loading novus-core.js.
  window.toggleMore = function(e) {
    e.stopPropagation();
    const dd  = document.getElementById('more-dropdown');
    const btn = document.getElementById('btn-more');
    if (!dd) return;
    const willOpen = dd.classList.contains('hidden');
    dd.classList.toggle('hidden');
    if (btn) btn.classList.toggle('active', willOpen);
  };

  window.closeMore = function() {
    const dd  = document.getElementById('more-dropdown');
    const btn = document.getElementById('btn-more');
    if (dd)  dd.classList.add('hidden');
    if (btn) btn.classList.remove('active');
  };

  document.addEventListener('click', function(e) {
    const wrap = document.getElementById('more-wrap');
    if (wrap && !wrap.contains(e.target)) window.closeMore();
  });
  // Core values come from plant-config.js ("coreValues": [{ "name": "...", "desc": "..." }]). None configured = the menu item is hidden.
  const VALUES = (window.PLANT_CONFIG && Array.isArray(window.PLANT_CONFIG.coreValues)) ? window.PLANT_CONFIG.coreValues : [];

  function _ensureCVOverlay() {
    if (document.getElementById('cv-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'cv-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `
      <div class="cv-backdrop" onclick="NovusCore.hideCoreValues()"></div>
      <div class="cv-panel">
        <div class="cv-panel-header">
          <div class="cv-panel-title">
            <img src="${_brand().logoWhite}" alt="${_brand().org}" onerror="this.style.display='none'" style="height:36px;width:auto;opacity:.95;">
            <span>Our Core Values</span>
          </div>
          <button class="cv-close" onclick="NovusCore.hideCoreValues()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="cv-sub">The principles that guide everything we do at ${_brand().org || 'our plant'}.</div>
        <div class="cv-grid">
          ${VALUES.map((v, i) => `
            <div class="cv-card" style="animation-delay:${i * 0.06}s" onclick="NovusCore._bounceCard(this)">
              <span class="cv-card-name">${v.name}</span>
              <p class="cv-card-desc">${v.desc}</p>
            </div>`).join('')}
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Escape key to close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideCoreValues();
    });
  }

  function showCoreValues() {
    _ensureCVOverlay();
    const el = document.getElementById('cv-overlay');
    el.classList.add('cv-visible');
    document.body.style.overflow = 'hidden';
  }

  function hideCoreValues() {
    const el = document.getElementById('cv-overlay');
    if (!el) return;
    el.classList.remove('cv-visible');
    document.body.style.overflow = '';
  }

  // ── Rules of Engagement Overlay ──────────────────────────────────────────
  const DEFAULT_RULES = [
    { id:'1', text:'🚀 Punctuality: Meeting starts exactly on time. Be present 2 minutes early.' },
    { id:'2', text:'📊 Preparation: Have your specific department metrics ready to discuss.' },
    { id:'3', text:'🧠 Focus: No side conversations. Stay focused on the data and the "Why" behind the numbers.' },
    { id:'4', text:'🛠️ Action Oriented: Identify gaps, assign owners, and set clear deadlines for recovery.' },
    { id:'5', text:'🤝 Respect: One person speaks at a time. Keep updates concise (under 60 seconds).' },
  ];

  function _ensureRulesOverlay() {
    if (document.getElementById('roe-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'roe-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `
      <div class="roe-backdrop" onclick="NovusCore.hideRules()"></div>
      <div class="roe-panel">
        <div class="roe-panel-header">
          <div class="roe-panel-title">
            <img src="${_brand().logoWhite}" alt="${_brand().org}" onerror="this.style.display='none'" style="height:32px;width:auto;opacity:.95;">
            <span>Rules of Engagement</span>
          </div>
          <button class="cv-close" onclick="NovusCore.hideRules()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="roe-sub">Standard protocols for daily operations meetings.</div>
        <div class="roe-list" id="roe-list">
          <div class="roe-loading">Loading rules…</div>
        </div>
        <div id="roe-footer" style="display:none;">
          <button class="roe-add-btn" onclick="NovusCore._roeAddRule()">+ Add Rule</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideRules(); });
  }

  function _roeRenderRules(rules) {
    const list = document.getElementById('roe-list');
    if (!list) return;
    const canEdit = isAdmin() && !!window.NovusDB;
    list.innerHTML = rules.map((r, i) => {
      // Split "🚀 Punctuality: description text" into name + desc
      const colonIdx = r.text.indexOf(':');
      const name = colonIdx > -1 ? r.text.slice(0, colonIdx).trim() : r.text;
      const desc = colonIdx > -1 ? r.text.slice(colonIdx + 1).trim() : '';
      return `<div class="roe-card" style="animation-delay:${i * 0.06}s" data-id="${r.id}" onclick="NovusCore._bounceCard(this)">
        ${canEdit ? `<button class="roe-delete" onclick="NovusCore._roeDelete('${r.id}')" title="Delete rule">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>` : ''}
        <span class="roe-card-name">${name}</span>
        <div class="roe-card-body" ${canEdit ? `contenteditable="true" onblur="NovusCore._roeEdit('${r.id}',this.innerText)"` : ''}>${desc}</div>
      </div>`;
    }).join('') || '<p style="color:rgba(255,255,255,.4);text-align:center;padding:20px;">No rules found.</p>';
  }

  async function _roeLoad() {
    if (window.NovusDB) {
      try {
        const { data, error } = await window.NovusDB.rules.getAll();
        if (!error && data && data.length) { _roeRenderRules(data); return; }
      } catch (_) {}
    }
    _roeRenderRules(DEFAULT_RULES);
  }

  async function _roeAddRule() {
    const text = prompt('New rule text:');
    if (!text || !window.NovusDB) return;
    await window.NovusDB.rules.add({ id: Date.now().toString(), text, date: new Date().toLocaleDateString() });
    _roeLoad();
  }

  async function _roeEdit(id, text) {
    if (!window.NovusDB) return;
    await window.NovusDB.rules.update(id, text);
  }

  async function _roeDelete(id) {
    if (!confirm('Delete this rule for everyone?') || !window.NovusDB) return;
    await window.NovusDB.rules.delete(id);
    _roeLoad();
  }

  function showRules() {
    _ensureRulesOverlay();
    const el = document.getElementById('roe-overlay');
    el.classList.add('roe-visible');
    document.body.style.overflow = 'hidden';
    const footer = document.getElementById('roe-footer');
    if (footer) footer.style.display = (isAdmin() && window.NovusDB) ? 'flex' : 'none';
    _roeLoad();
  }

  function hideRules() {
    const el = document.getElementById('roe-overlay');
    if (!el) return;
    el.classList.remove('roe-visible');
    document.body.style.overflow = '';
  }

  // ── Needs Action Overlay ─────────────────────────────────────────────────
  let _naItems = [];
  let _naShowDone = false;
  let _naUnsubscribe = null;

  function _ensureNAOverlay() {
    if (document.getElementById('na-overlay')) return;
    const el = document.createElement('div');
    el.id = 'na-overlay';
    el.setAttribute('aria-modal','true');
    el.setAttribute('role','dialog');
    el.innerHTML = `
      <div class="na-backdrop" onclick="NovusCore.hideNeedsAction()"></div>
      <div class="na-panel">

        <!-- Header -->
        <div class="na-header">
          <div class="na-header-left">
            <img src="${_brand().logoWhite}" alt="${_brand().org}" onerror="this.style.display='none'" style="height:28px;width:auto;opacity:.95;">
            <span class="na-title">Needs Action</span>
            <div class="na-dot" id="na-sync-dot"></div>
          </div>
          <button class="cv-close" onclick="NovusCore.hideNeedsAction()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Summary pills -->
        <div class="na-summary" id="na-summary">
          <div class="na-pill"><span id="na-cnt-total">—</span><span class="na-pill-label">Total</span></div>
          <div class="na-pill na-pill-open"><span id="na-cnt-open">—</span><span class="na-pill-label">Open</span></div>
          <div class="na-pill na-pill-done"><span id="na-cnt-done">—</span><span class="na-pill-label">Done</span></div>
          <div style="flex:1"></div>
          <button class="na-toggle-done" id="na-toggle-done" onclick="NovusCore._naToggleDone()">Show Completed</button>
        </div>

        <!-- Quick-add form (admin only) -->
        <div class="na-add-form admin-only-na" id="na-add-form">
          <input class="na-input" id="na-new-date" type="date">
          <input class="na-input na-input-grow" id="na-new-desc" type="text" placeholder="What needs to be done?">
          <input class="na-input" id="na-new-owner" type="text" placeholder="Owner / Dept" style="max-width:140px;">
          <button class="na-add-btn" onclick="NovusCore._naAdd()">+ Add</button>
        </div>

        <!-- Action list -->
        <div class="na-list" id="na-list">
          <div class="na-loading">Loading…</div>
        </div>

      </div>`;
    document.body.appendChild(el);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideNeedsAction(); });
  }

  function _naSync(on) {
    const d = document.getElementById('na-sync-dot');
    if (d) d.classList.toggle('on', on);
  }

  function _naUpdateSummary() {
    const open = _naItems.filter(a => !a.completedDate).length;
    const done = _naItems.length - open;
    const s = id => document.getElementById(id);
    if (s('na-cnt-total')) s('na-cnt-total').textContent = _naItems.length;
    if (s('na-cnt-open'))  s('na-cnt-open').textContent  = open;
    if (s('na-cnt-done'))  s('na-cnt-done').textContent  = done;
  }

  function _naRender() {
    const list = document.getElementById('na-list');
    if (!list) return;
    _naUpdateSummary();
    const canEdit = isAdmin() && !!window.NovusDB;
    const display = _naShowDone ? _naItems : _naItems.filter(a => !a.completedDate);
    if (!display.length) {
      list.innerHTML = `<div class="na-empty">No ${_naShowDone ? '' : 'open '}action items.</div>`;
      return;
    }
    list.innerHTML = display.map((a, i) => {
      const done = !!(a.completedDate);
      return `<div class="na-card${done ? ' na-card-done' : ''}" data-id="${a.id}" style="animation-delay:${i * 0.04}s">
        <input type="checkbox" class="na-check" ${done ? 'checked' : ''} ${!canEdit ? 'disabled' : ''}
          onchange="NovusCore._naToggle('${a.id}',this.checked)" title="${done ? 'Mark open' : 'Mark done'}">
        <div class="na-card-body">
          <div class="na-desc${done ? ' na-strike' : ''}"
            ${canEdit ? `contenteditable="true" onblur="NovusCore._naEditField('${a.id}','description',this.innerText)"` : ''}
            title="${canEdit ? 'Click to edit description' : ''}">${a.description}</div>
          <div class="na-meta">
            <span class="na-date-tag">${a.date}</span>
            <span class="na-owner${done ? ' na-strike' : ''}"
              ${canEdit ? `contenteditable="true" onblur="NovusCore._naEditField('${a.id}','owner',this.innerText)"` : ''}
              title="${canEdit ? 'Click to edit owner' : ''}">${a.owner}</span>
            ${done ? `<span class="na-done-tag">✓ ${a.completedDate}</span>` : '<span class="na-open-tag">Open</span>'}
          </div>
        </div>
        ${canEdit ? `<button class="na-delete" onclick="NovusCore._naDelete('${a.id}')" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>` : ''}
      </div>`;
    }).join('');
  }

  async function _naLoad() {
    if (!window.NovusDB) { _naItems = []; _naRender(); return; }
    try {
      const { data, error } = await window.NovusDB.needsAction.getAll();
      if (error) { console.error(error); return; }
      _naItems = (data || []).map(r => ({
        id: r.id, date: r.date,
        description: r.description,
        owner: r.owner,
        completedDate: r.completed_date || '',
      }));
      _naRender();
    } catch (e) { console.error(e); }
  }

  function _naToggleDone() {
    _naShowDone = !_naShowDone;
    const btn = document.getElementById('na-toggle-done');
    if (btn) btn.textContent = _naShowDone ? 'Hide Completed' : 'Show Completed';
    _naRender();
  }

  async function _naAdd() {
    const date  = document.getElementById('na-new-date')?.value;
    const desc  = document.getElementById('na-new-desc')?.value?.trim();
    const owner = document.getElementById('na-new-owner')?.value?.trim();
    if (!date || !desc || !owner) { alert('Please fill in all fields.'); return; }
    if (!window.NovusDB) return;
    _naSync(true);
    await window.NovusDB.needsAction.add({ id: Date.now().toString(), date, description: desc, owner });
    document.getElementById('na-new-desc').value = '';
    document.getElementById('na-new-owner').value = '';
    _naSync(false);
  }

  async function _naToggle(id, checked) {
    if (!window.NovusDB) return;
    _naSync(true);
    await window.NovusDB.needsAction.setCompleted(id, checked ? new Date().toISOString().split('T')[0] : '');
    _naSync(false);
  }

  async function _naEditField(id, field, value) {
    if (!window.NovusDB || !value?.trim()) return;
    const item = _naItems.find(a => a.id === id);
    if (!item) return;
    item[field] = value.trim();
    _naSync(true);
    if (field === 'description') await window.NovusDB.needsAction.updateDescription?.(id, value.trim());
    if (field === 'owner')       await window.NovusDB.needsAction.updateOwner?.(id, value.trim());
    // Fallback: use generic update if specific methods don't exist
    if (!window.NovusDB.needsAction.updateDescription) {
      await window.NovusDB.needsAction.add({ id, date: item.date, description: item.description, owner: item.owner });
    }
    _naSync(false);
  }

  async function _naDelete(id) {
    if (!confirm('Delete this action item?') || !window.NovusDB) return;
    _naSync(true);
    await window.NovusDB.needsAction.delete(id);
    _naSync(false);
  }

  function showNeedsAction() {
    _ensureNAOverlay();
    const el = document.getElementById('na-overlay');
    el.classList.add('na-visible');
    document.body.style.overflow = 'hidden';
    // Show admin form
    const form = document.getElementById('na-add-form');
    if (form) form.style.display = (isAdmin() && window.NovusDB) ? 'flex' : 'none';
    // Set today's date
    const dateEl = document.getElementById('na-new-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
    _naLoad();
    // Subscribe to real-time updates
    if (window.NovusDB && !_naUnsubscribe) {
      _naUnsubscribe = window.NovusDB.needsAction.subscribe(() => _naLoad());
    }
  }

  function hideNeedsAction() {
    const el = document.getElementById('na-overlay');
    if (!el) return;
    el.classList.remove('na-visible');
    document.body.style.overflow = '';
  }

  // ── Help / FAQ Overlay ───────────────────────────────────────────────────
  const FAQ = [
    {
      q: 'How do I load the latest data onto the dashboard?',
      a: 'Click the Refresh button in the top-right of the header. The first time you click it, a Microsoft login popup will appear — sign in with your ' + (_brand().org || 'your company') + ' work email. Every click after that will silently pull the latest data from SharePoint with no popup.',
    },
    {
      q: 'A metric is showing the wrong number even after refreshing.',
      a: 'That metric has a manual override saved on your computer. Look for a small amber dot in the corner of the metric box — that means the number is not from SharePoint. Click ⚙ Settings → Clear Manual Overrides, then click Refresh to restore live data.',
    },
    {
      q: 'The Microsoft login popup is being blocked.',
      a: 'Popups must be triggered by a direct button click — never automatically. Make sure you are clicking the Refresh button yourself. If your browser is still blocking it, look for a popup-blocked icon in the address bar and click Allow.',
    },
    {
      q: 'The dashboard says "Click Refresh to load data" but never auto-loads.',
      a: 'This is intentional. The app never fetches data automatically to avoid popup blockers. Simply click the Refresh button once and data will load.',
    },
    {
      q: 'I can log into the Ops Hub but Refresh shows an error.',
      a: 'The Ops Hub login and the Microsoft login are two separate systems. Your Ops Hub username and password do not grant SharePoint access. Your ' + (_brand().org || 'your company') + ' work email must have View access to the Excel file on SharePoint. Contact your administrator to have your email added.',
    },
    {
      q: 'The app works for everyone else but is broken for me.',
      a: 'This almost always means something is stored locally on your computer that is conflicting with the current version. Open the browser console (F12) and run: sessionStorage.clear() then localStorage.clear() — then close the tab, reopen the app, and try again.',
    },
    {
      q: 'Can I edit the metric values on the dashboard?',
      a: 'Yes, but only if you are logged in as an admin. Click directly on any metric number — it will become editable. Type the new value and click away to save. An amber dot will appear on that metric to indicate it is a manual entry, not live data. Viewers cannot edit values.',
    },
    {
      q: 'How do I log an action item during a meeting?',
      a: 'Click the Needs Action button in the header from any page. A panel will slide in. Fill in the date, description, and owner, then click Add. The item is saved to the cloud immediately and is visible to all users.',
    },
    {
      q: 'What is the Plant Status Bar at the top of the dashboard?',
      a: 'The colored bar below the navigation summarizes overall plant health at a glance. Green means OEE is at or above 65% and there are no Code Red issues. Amber means OEE is between 55–65% or there is one Code Red. Red means OEE is below 55% or there are multiple Code Red issues. The bar updates every time you Refresh.',
    },
    {
      q: 'How do I give someone access?',
      a: 'Ask the new person to open the login page and click "Request an account". Then a plant admin opens the Team page, finds them under "Waiting for approval" and gives them a role: Viewer (read only), Editor (can enter data) or Admin (can also change the layout and manage people).',
    },
    {
      q: 'The Needs Action / Rules / Core Values overlay is empty.',
      a: 'These features require an internet connection to the Supabase database. Check your network connection. If the network is fine, the Supabase project may be temporarily unavailable — Rules will fall back to the five default rules, and Needs Action will show empty until connectivity is restored.',
    },
    {
      q: 'My saved Staff Meeting layouts disappeared.',
      a: 'Saved layouts are stored in your browser\'s local storage. They are lost if you clear your browser cache, switch computers, or use a different browser. Before clearing your cache, export your layouts by opening the browser console and running: localStorage.getItem(\'novus_dash_layouts\') — copy and save that text somewhere safe.',
    },
    {
      q: 'How do I clear cached data if the app feels slow?',
      a: 'Three things can cause slowness. First, the workbook cache — run sessionStorage.removeItem(\'novus_' + ((window.PLANT_CONFIG && window.PLANT_CONFIG.plant.id) || '') + '_sp_wb\') in the console, then reload and Refresh. Second, stale overrides — click ⚙ Settings → Clear Manual Overrides. Third, if the Needs Action or Announcements overlays are slow, the database tables may have grown large — contact your administrator to archive old records.',
    },
    {
      q: 'Who sees what I post in Announcements or Needs Action?',
      a: 'Everyone. Announcements and Needs Action items are stored in the shared cloud database (Supabase) and are visible to every user on every device in real time. Deleting an item removes it for everyone immediately with no undo.',
    },
  ];

  function _ensureHelpOverlay() {
    if (document.getElementById('help-overlay')) return;
    const el = document.createElement('div');
    el.id = 'help-overlay';
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <div class="help-backdrop" onclick="NovusCore.hideHelp()"></div>
      <div class="help-panel">
        <div class="help-header">
          <div class="help-header-left">
            <img src="${_brand().logoWhite}" alt="${_brand().org}" onerror="this.style.display='none'" style="height:28px;width:auto;opacity:.95;">
            <span class="help-title">Help & FAQ</span>
          </div>
          <button class="cv-close" onclick="NovusCore.hideHelp()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="help-sub">Common questions about the Ops Hub.</div>
        <div class="help-search-wrap">
          <input class="help-search" id="help-search" type="text" placeholder="Search questions…" oninput="NovusCore._helpFilter(this.value)">
        </div>
        <div class="help-list" id="help-list">
          ${FAQ.map((item, i) => `
            <div class="help-card" data-index="${i}">
              <button class="help-q" onclick="NovusCore._helpToggle(${i})">
                <span>${item.q}</span>
                <svg class="help-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="help-a" id="help-a-${i}">${item.a}</div>
            </div>`).join('')}
        </div>
        <div class="help-footer">
          ${(window.PLANT_CONFIG.plant.shortLabel || '')}${window.PLANT_CONFIG.plant.location ? ' · ' + window.PLANT_CONFIG.plant.location : ''} &nbsp;·&nbsp; Ops Hub v3 "Slate &amp; Signal" &nbsp;·&nbsp;
          <span style="opacity:.4;">For technical issues contact your administrator.</span>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideHelp(); });
  }

  function _helpToggle(i) {
    const a = document.getElementById('help-a-' + i);
    const card = a?.closest('.help-card');
    if (!a || !card) return;
    const isOpen = card.classList.contains('open');
    // Close all
    document.querySelectorAll('.help-card.open').forEach(c => c.classList.remove('open'));
    // Open this one if it was closed
    if (!isOpen) card.classList.add('open');
  }

  function _helpFilter(query) {
    const q = query.toLowerCase().trim();
    document.querySelectorAll('.help-card').forEach(card => {
      const i = card.dataset.index;
      const text = (FAQ[i].q + ' ' + FAQ[i].a).toLowerCase();
      card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  }

  function showHelp() {
    _ensureHelpOverlay();
    const el = document.getElementById('help-overlay');
    el.classList.add('help-visible');
    document.body.style.overflow = 'hidden';
    // Clear search on open
    const s = document.getElementById('help-search');
    if (s) { s.value = ''; _helpFilter(''); }
  }

  function hideHelp() {
    const el = document.getElementById('help-overlay');
    if (!el) return;
    el.classList.remove('help-visible');
    document.body.style.overflow = '';
  }

  // ── Maintenance Center Overlay ───────────────────────────────────────────

  const MAINT_KEYS = {
    overrides:  'novus_maint_overrides',   // after every meeting
    monthly:    'novus_maint_monthly',     // monthly Supabase cleanup
    cache:      'novus_maint_cache',       // workbook cache clear
    quarterly:  'novus_maint_quarterly',   // Excel workbook trim
  };

  const TASKS = [
    {
      id:        'overrides',
      schedule:  'After Every Meeting',
      title:     'Clear Manual Overrides',
      icon:      '↺',
      color:     'var(--amber-l)',
      dueAfterMs: 24 * 60 * 60 * 1000,  // 1 day
      urgency:   ['On time', 'Due now', 'Overdue'],
      why:       'Manual overrides stored in localStorage silently block live SharePoint data from appearing on the dashboard. If left unchecked, metrics will show stale numbers indefinitely even after a fresh sync.',
      steps: [
        { label: 'Option A — In the app', code: null, note: 'Click ··· → Clear Manual Overrides in the dashboard header.' },
        { label: 'Option B — Browser console (F12)', code: "Object.keys(localStorage).filter(k=>k.startsWith('dds_m_')).forEach(k=>localStorage.removeItem(k))", note: 'Then click Refresh to restore live SharePoint data.' },
      ],
    },
    {
      id:        'cache',
      schedule:  'When App Feels Slow',
      title:     'Clear Workbook Cache',
      icon:      '🗄',
      color:     'var(--blue)',
      dueAfterMs: null,  // manual / as needed
      urgency:   ['Ready', 'Consider running', 'Consider running'],
      why:       'The entire Excel workbook is cached in sessionStorage after each sync. As the workbook grows with months of data, this cache can exceed 1 MB and cause noticeable lag when navigating between pages.',
      steps: [
        { label: 'Check cache size first', code: "const wb=sessionStorage.getItem('novus_"+((window.PLANT_CONFIG&&PLANT_CONFIG.plant.id)||'')+"_sp_wb'); console.log('Cache size:', wb ? (wb.length/1024).toFixed(1)+' KB' : 'Empty')", note: 'Anything over 500 KB may cause lag.' },
        { label: 'Clear the cache', code: "sessionStorage.removeItem('novus_"+((window.PLANT_CONFIG&&PLANT_CONFIG.plant.id)||'')+"_sp_wb'); sessionStorage.removeItem('novus_"+((window.PLANT_CONFIG&&PLANT_CONFIG.plant.id)||'')+"_sp_time')", note: 'Reload the page, then click Refresh to pull fresh data.' },
      ],
    },
    {
      id:        'monthly',
      schedule:  'Monthly',
      title:     'Clean Supabase Database',
      icon:      '🗃',
      color:     'var(--violet)',
      dueAfterMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
      urgency:   ['On time', 'Due this week', 'Overdue'],
      why:       'The Needs Action table keeps every item ever created — open and completed — forever. After months of use this table can have hundreds of rows, slowing down the overlay. Announcements and play call items accumulate similarly.',
      steps: [
        { label: 'Go to Supabase → SQL Editor', code: null, note: 'Open app.supabase.com → your project (the URL in plant-config.js) → SQL Editor.' },
        { label: 'Check row counts', code: "SELECT 'announcements' AS tbl, COUNT(*) AS rows FROM announcements\nUNION ALL SELECT 'needs_action', COUNT(*) FROM needs_action\nUNION ALL SELECT 'rules',        COUNT(*) FROM rules\nUNION ALL SELECT 'play_call',    COUNT(*) FROM play_call;", note: 'If needs_action exceeds 200 rows or announcements exceeds 100, run the cleanup below.' },
        { label: 'Archive old completed action items', code: "DELETE FROM needs_action\nWHERE (completed_date IS NOT NULL AND completed_date != '')\n  AND completed_date::date < CURRENT_DATE - INTERVAL '90 days';", note: 'Removes completed items older than 90 days.' },
        { label: 'Archive old announcements', code: "DELETE FROM announcements\nWHERE created_at < NOW() - INTERVAL '6 months';", note: 'Removes announcements older than 6 months.' },
        { label: 'Clear old play call items', code: "DELETE FROM play_call\nWHERE created_at < NOW() - INTERVAL '30 days';", note: 'Clears play call entries older than 30 days.' },
      ],
    },
    {
      id:        'quarterly',
      schedule:  'Quarterly',
      title:     'Trim Excel Workbook',
      icon:      '📊',
      color:     'var(--green)',
      dueAfterMs: 90 * 24 * 60 * 60 * 1000,  // 90 days
      urgency:   ['On time', 'Due this month', 'Overdue — do this soon'],
      why:       'The SharePoint Excel file is the largest piece of data the app handles. As departments add rows month over month, the file grows. The app only needs the last 60–90 days of data per sheet — older rows slow down both the SharePoint fetch and the local cache.',
      steps: [
        { label: 'Open the Excel file in SharePoint', code: null, note: 'The file is the one named under sources.sharepoint in plant-config.js.' },
        { label: 'For each active sheet', code: null, note: 'HR | Training · QA · Production · Finance · SAP · Warehouse · Inventory Control · Maintenance' },
        { label: 'Archive rows older than 90 days', code: null, note: 'Select rows where the Date column is older than 90 days → Cut → Paste into a new sheet named "Archive [Month Year]". Do NOT delete — keep them in the same workbook for records.' },
        { label: 'Save and sync', code: null, note: 'Save the file in SharePoint, then click Refresh in the Ops Hub to pull the trimmed version. Check the cache size again — it should be well under 500 KB.' },
      ],
    },
  ];

  function _maintStatus(task) {
    const last = localStorage.getItem(MAINT_KEYS[task.id]);
    if (!last || task.dueAfterMs === null) return 'none';  // manual tasks have no auto-status
    const elapsed = Date.now() - parseInt(last);
    if (elapsed < task.dueAfterMs * 0.9) return 'ok';       // well within schedule
    if (elapsed < task.dueAfterMs * 1.5) return 'warn';     // approaching or just due
    return 'overdue';                                         // significantly past due
  }

  function _maintMarkDone(id) {
    localStorage.setItem(MAINT_KEYS[id], Date.now().toString());
    // Re-render the overlay in place
    const list = document.getElementById('maint-task-list');
    if (list) _maintRenderTasks(list);
  }

  function _maintRenderTasks(container) {
    container.innerHTML = TASKS.map(task => {
      const status  = _maintStatus(task);
      const last    = localStorage.getItem(MAINT_KEYS[task.id]);
      const lastStr = last
        ? new Date(parseInt(last)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Never';

      const statusConfig = {
        none:    { dot: 'var(--text-4)',  label: 'Manual',  bg: 'rgba(148,163,184,.1)' },
        ok:      { dot: 'var(--green)',   label: 'On time', bg: 'rgba(5,150,105,.08)'  },
        warn:    { dot: 'var(--amber-l)', label: task.urgency[1], bg: 'rgba(245,158,11,.1)'  },
        overdue: { dot: 'var(--red-l)',   label: task.urgency[2], bg: 'rgba(239,68,68,.1)'   },
      }[status];

      const stepsHtml = task.steps.map((step, si) => `
        <div class="maint-step">
          <div class="maint-step-num">${si + 1}</div>
          <div class="maint-step-body">
            <div class="maint-step-label">${step.label}</div>
            ${step.code ? `<div class="maint-code-wrap"><pre class="maint-code">${step.code}</pre><button class="maint-copy-btn" onclick="NovusCore._maintCopy(this, \`${step.code.replace(/`/g,'\\`')}\`)">Copy</button></div>` : ''}
            ${step.note ? `<div class="maint-step-note">${step.note}</div>` : ''}
          </div>
        </div>`).join('');

      return `
        <div class="maint-card" id="maint-card-${task.id}">
          <div class="maint-card-header">
            <div class="maint-card-left">
              <div class="maint-card-icon">${task.icon}</div>
              <div>
                <div class="maint-card-title">${task.title}</div>
                <div class="maint-schedule-tag">${task.schedule}</div>
              </div>
            </div>
            <div class="maint-card-right">
              <div class="maint-status-pill" style="background:${statusConfig.bg};">
                <div class="maint-status-dot" style="background:${statusConfig.dot};${status==='warn'||status==='overdue'?'animation:pulse-dot 1.4s ease-in-out infinite;':''}"></div>
                <span style="color:${statusConfig.dot};">${statusConfig.label}</span>
              </div>
              <div class="maint-last-run">Last: ${lastStr}</div>
            </div>
          </div>
          <div class="maint-why">${task.why}</div>
          <div class="maint-steps">${stepsHtml}</div>
          <button class="maint-done-btn" onclick="NovusCore._maintMarkDone('${task.id}')">✓ Mark as Done</button>
        </div>`;
    }).join('');
  }

  function _maintCopy(btn, code) {
    navigator.clipboard.writeText(code).then(() => {
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1800);
    }).catch(() => {
      btn.textContent = 'Failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    });
  }

  function _ensureMaintenanceOverlay() {
    if (document.getElementById('maint-overlay')) return;
    const el = document.createElement('div');
    el.id = 'maint-overlay';
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="maint-backdrop" onclick="NovusCore.hideMaintenance()"></div>
      <div class="maint-panel">
        <div class="maint-panel-header">
          <div class="maint-panel-title">
            <img src="${_brand().logoWhite}" alt="${_brand().org}" onerror="this.style.display='none'" style="height:28px;width:auto;opacity:.95;">
            <span>Maintenance Center</span>
          </div>
          <button class="cv-close" onclick="NovusCore.hideMaintenance()" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="maint-sub">Keep the app fast and data accurate. Click "Mark as Done" after completing each task to reset its timer.</div>
        <div class="maint-task-list" id="maint-task-list"></div>
      </div>`;
    document.body.appendChild(el);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMaintenance(); });
  }

  function showMaintenance() {
    _ensureMaintenanceOverlay();
    const el = document.getElementById('maint-overlay');
    el.classList.add('maint-visible');
    document.body.style.overflow = 'hidden';
    _maintRenderTasks(document.getElementById('maint-task-list'));
  }

  function hideMaintenance() {
    const el = document.getElementById('maint-overlay');
    if (!el) return;
    el.classList.remove('maint-visible');
    document.body.style.overflow = '';
  }

  // ── Card bounce — re-triggers animation on every click ──────────────────
  function _bounceCard(el) {
    el.style.animation = 'none';
    void el.offsetWidth; // force reflow
    el.style.animation = 'card-bounce .6s cubic-bezier(0.25,1,0.5,1) both';
    el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
  }

  return { requireAuth, navigateTo, logout, getUser, isAdmin, isSuper, switchPlant, canEditData, Toast, WorkbookCache, _bounceCard,
           showCoreValues, hideCoreValues, showRules, hideRules,
           showNeedsAction, hideNeedsAction, showHelp, hideHelp,
           showMaintenance, hideMaintenance,
           _roeAddRule, _roeEdit, _roeDelete,
           _naAdd, _naToggle, _naToggleDone, _naEditField, _naDelete,
           _helpToggle, _helpFilter,
           _maintMarkDone, _maintCopy };

})();
