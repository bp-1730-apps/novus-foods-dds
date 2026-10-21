/* plant-context.js — which plant is this browser tab showing?
 * Loaded right after plant-config.js on every page, BEFORE anything reads
 * PLANT_CONFIG. plant-config.js describes the base setup; when a signed-in
 * person has chosen a plant (login page or the plant switcher), this file
 * overlays that plant's id, name, location and production lines on top of it,
 * so every page keeps working unchanged.
 * Nothing here talks to the database: the plant list was stored in the
 * session when the person signed in (see NovusAccess in supabase-config.js). */
(function () {
  var C = window.PLANT_CONFIG; if (!C || !C.plant) return;
  C.plant.fileId = C.plant.id;                       // the plant plant-config.js was written for
  var u = null;
  try { u = JSON.parse(sessionStorage.getItem('dds_user')); } catch (e) {}
  if (!u || u.plant === undefined || u.plant === null) return;

  C.plant.id = u.plant;
  var info = null;
  (u.plants || []).forEach(function (p) { if (p.id === u.plant) info = p; });
  if (info) {
    var cfg = info.config || {};
    if (info.name) C.plant.name = info.name;
    if (info.short_label) C.plant.shortLabel = info.short_label;
    else if (info.name) C.plant.shortLabel = info.name;
    if (info.location !== undefined && (info.location || u.plant !== C.plant.fileId)) C.plant.location = info.location || '';
    if (cfg.lines && cfg.lines.length) {
      C.lines = cfg.lines.map(function (l) {
        return typeof l === 'string' ? { code: l, label: l } : { code: l.code, label: l.label || l.code, l2lCode: l.l2lCode || '' };
      });
    }
    if (cfg.contact) C.plant.contact = cfg.contact;
    // A live Connection (Leading2Lean) owns the plant's production numbers.
    C.connection = info.integration && info.integration.enabled ? { provider: info.integration.provider, enabled: true } : { provider: '', enabled: false };
  }
  if (u.plant !== C.plant.fileId) {
    // Another plant: the file's Power Automate / L2L feeds belong to the file's plant, so switch them off.
    C.plant.contact = (info && info.config && info.config.contact) || '';
    if (C.branding) C.branding.heroTag = (info && info.config && info.config.heroTag) || (C.plant.shortLabel || C.plant.name || '');
    if (C.sources) Object.keys(C.sources).forEach(function (k) {
      var s = C.sources[k]; if (s && typeof s === 'object' && 'enabled' in s) s.enabled = false;
    });
  }
  /* Older page code asks for a list of plants; a tab always shows exactly one. */
  var p = C.plant, src = C.sources || {};
  var on = function (k) { return src[k] && src[k].enabled; };
  window.PLANTS_CONFIG_PROMISE = Promise.resolve({ plants: [{
    id: p.id, name: p.name, shortLabel: p.shortLabel, location: p.location,
    dataUrl: on('powerAutomate') ? src.powerAutomate.dataUrl : '',
    l2lDataUrl: on('l2l') && !(C.connection && C.connection.enabled) ? src.l2l.dataUrl : '',
    lines: (C.lines || []).map(function (l) { return l.code; })
  }] });
})();
