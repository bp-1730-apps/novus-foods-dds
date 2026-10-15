/**
 * sharepoint-config.js — optional SharePoint/Excel source
 * ================================================
 * Loads MSAL via ES module dynamic import (no CDN globals, no version guessing).
 * Works from GitHub Pages and local dev servers.
 */

// ── Azure / SharePoint settings come from plant-config.js (sources.sharepoint) ──
// If a plant does not use SharePoint, leave "enabled": false and nothing below is used.
const _SPC          = (window.PLANT_CONFIG && window.PLANT_CONFIG.sources && window.PLANT_CONFIG.sources.sharepoint) || {};
const SP_ENABLED    = !!_SPC.enabled;
const SP_CLIENT_ID  = _SPC.clientId   || '';
const SP_TENANT_ID  = _SPC.tenantId   || '';
const SP_FILE_OWNER = _SPC.fileOwner  || '';
const SP_FILE_ID    = _SPC.fileId     || '';
const SP_SHARING_URL = _SPC.sharingUrl || '';
// ──────────────────────────────────────────────────────────────────────────

const _MSAL_CONFIG = {
  auth: {
    clientId:    SP_CLIENT_ID,
    authority:   'https://login.microsoftonline.com/' + SP_TENANT_ID,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation:          'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

const _GRAPH_SCOPES = ['Files.Read', 'User.Read'];

// ── Load MSAL via dynamic ES module import ────────────────────────────────
// msal-browser.min.js from jsDelivr is the ESM build — it exports
// PublicClientApplication directly. No globals, no script-tag injection needed.
const _msalReady = !SP_ENABLED ? Promise.resolve(null) : (async function () {

  const URLS = [
    // jsDelivr +esm mode rewrites bare module specifiers (like '@azure/msal-common')
    // to CDN URLs, making the full dependency tree browser-importable
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/+esm',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.36.0/+esm',
    'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.32.0/+esm',
  ];

  let lastErr;
  for (const url of URLS) {
    try {
      const mod = await import(url);
      // ESM export shape: mod.PublicClientApplication
      // CJS-wrapped shape: mod.default.PublicClientApplication
      const PCA = mod.PublicClientApplication
               || mod.default?.PublicClientApplication;
      if (PCA) return { PublicClientApplication: PCA };
      lastErr = new Error('PublicClientApplication not found in module at ' + url);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error('Could not load MSAL. ' + (lastErr?.message || ''));

}());

// ── NovusSP public API ────────────────────────────────────────────────────
window.NovusSP = (function () {

  let _msalInstance = null;

  async function _getApp() {
    if (_msalInstance) return _msalInstance;
    const msalLib    = await _msalReady;
    if (!msalLib) throw new Error('SharePoint is not enabled in plant-config.js');
    _msalInstance    = new msalLib.PublicClientApplication(_MSAL_CONFIG);
    return _msalInstance;
  }

  async function _getToken() {
    const app      = await _getApp();
    await app.handleRedirectPromise();

    const accounts = app.getAllAccounts();
    const request  = { scopes: _GRAPH_SCOPES, account: accounts[0] };

    if (accounts.length > 0) {
      try {
        const silent = await app.acquireTokenSilent(request);
        return silent.accessToken;
      } catch (e) {
        console.info('[NovusSP] Silent token failed, trying popup:', e.errorCode || e.message);
      }
    }

    const popup = await app.acquireTokenPopup({ scopes: _GRAPH_SCOPES });
    return popup.accessToken;
  }

  // Encode a OneDrive sharing URL to a Graph share token
  function _encodeSharingUrl(url) {
    const b64 = btoa(url);
    return 'u!' + b64.replace(/=/g, '').replace(/[+]/g, '-').replace(/[/]/g, '_');
  }

  async function fetchWorkbook() {
    const token = await _getToken();

    // Path 1: Sharing link — works for ALL org users, no admin consent needed.
    // Fill in SP_SHARING_URL above to enable this for your team.
    if (SP_SHARING_URL) {
      try {
        const shareToken = _encodeSharingUrl(SP_SHARING_URL);
        const r1 = await fetch(
          'https://graph.microsoft.com/v1.0/shares/' + shareToken + '/driveItem/content',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (r1.ok) return r1.arrayBuffer();
      } catch (_) {}
    }

    // Path 2: Owner drive path — always works for Albert.
    const ownerUrl = 'https://graph.microsoft.com/v1.0/users/'
                   + encodeURIComponent(SP_FILE_OWNER)
                   + '/drive/items/' + SP_FILE_ID + '/content';
    const res = await fetch(ownerUrl, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) return res.arrayBuffer();

    const status = res.status;

    // Path 3: sharedWithMe — fallback for other users when the file is shared with them.
    if (status === 404 || status === 403) {
      try {
        const sr = await fetch(
          'https://graph.microsoft.com/v1.0/me/drive/sharedWithMe?$select=id,name,remoteItem',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (sr.ok) {
          const body  = await sr.json();
          const match = (body.value || []).find(function(i) {
            return i.name && i.name.toLowerCase().indexOf('all_department_data') !== -1;
          });
          if (match && match.remoteItem) {
            const driveId = match.remoteItem.parentReference && match.remoteItem.parentReference.driveId;
            const realId  = match.remoteItem.id || SP_FILE_ID;
            if (driveId) {
              const r3 = await fetch(
                'https://graph.microsoft.com/v1.0/drives/' + driveId + '/items/' + realId + '/content',
                { headers: { Authorization: 'Bearer ' + token } }
              );
              if (r3.ok) return r3.arrayBuffer();
            }
          }
        }
      } catch (_) {}
    }

    // All paths failed
    var hint = status === 404
      ? ' Paste your OneDrive sharing link into SP_SHARING_URL in sharepoint-config.js.'
      : status === 403
        ? ' Share the file with this user in OneDrive.'
        : status === 401
          ? ' Auth expired — sign out and back in.'
          : '';
    throw new Error('SharePoint sync failed (' + status + ').' + hint);
  }

  async function getDisplayName() {
    try {
      const token = await _getToken();
      const res   = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const json  = await res.json();
      return json.displayName || null;
    } catch (_) { return null; }
  }

  async function hasAccount() {
    try {
      const app = await _getApp();
      return app.getAllAccounts().length > 0;
    } catch (_) { return false; }
  }

  return { fetchWorkbook: fetchWorkbook, getDisplayName: getDisplayName, hasAccount: hasAccount };

}());
