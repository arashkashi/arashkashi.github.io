/* TrekkingMap — offline support.
 *
 * Registers the service worker, and tells the user plainly whether the app is
 * actually ready to work without a connection. "Offline capable" is a promise
 * worth keeping precisely: a hiker who believes it and finds out otherwise at
 * a trailhead has been badly served.
 *
 * Service workers require a secure origin AND are unavailable on file://, so
 * this module is a no-op when the page is opened from disk. That mode still
 * works — all the data is bundled — it simply cannot cache map tiles.
 */

window.TMOffline = (function () {
'use strict';

var app, reg = null, state = 'unknown', tileCount = 0, swVersion = null;
var badge = null;

var CSS = [
  '.tmo{display:flex;align-items:center;gap:7px;margin:0 10px 6px 0;padding:5px 9px;',
  '  font-size:11.5px;font-weight:600;background:rgba(255,253,248,.95);',
  '  border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);',
  '  color:var(--ink-soft);cursor:default}',
  '.tmo .d{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:#9aa5ad}',
  '.tmo.ready .d{background:var(--pine)}',
  '.tmo.installing .d{background:#d8a13c;animation:tmpulse 1s infinite}',
  '.tmo.offline{border-color:#d8a13c;color:#8a4b1e}',
  '.tmo.offline .d{background:#d8a13c}',
  '.tmo.na{display:none}',
  '.tmo-row{display:flex;justify-content:space-between;align-items:baseline;',
  '  font-size:12px;padding:3px 0;color:var(--ink-soft)}',
  '.tmo-row b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:650}',
  '.tmo-note{font-size:10.5px;line-height:1.45;color:var(--ink-soft);margin-top:5px}',
  '.tmo-note.warn{color:#8a4b1e}'
].join('');

/**
 * What the badge can honestly claim.
 *
 * It reports CACHE READINESS, which is knowable, rather than connectivity,
 * which is not. `navigator.onLine === true` only means a network interface
 * exists — not that anything is reachable. Measured here: with the network
 * genuinely cut, a real fetch threw while navigator.onLine still reported true.
 * So connectivity is shown as a hint when the browser volunteers it, and the
 * primary message is the one we can stand behind.
 */
function setBadge() {
  if (!badge) return;
  var cls = 'tmo', txt;

  if (state === 'unsupported') {
    cls += ' na';
    txt = '';
  } else if (state === 'ready') {
    cls += navigator.onLine ? ' ready' : ' offline';
    txt = navigator.onLine ? 'Saved for offline use' : 'No connection — running from cache';
  } else if (state === 'installing') {
    cls += ' installing';
    txt = 'Saving for offline…';
  } else if (state === 'failed') {
    cls += ' offline';
    txt = 'Offline support unavailable';
  } else {
    txt = 'Offline support starting…';
  }
  badge.className = cls;
  badge.querySelector('.t').textContent = txt;
}

function buildBadge() {
  var Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      var d = L.DomUtil.create('div', 'tmo');
      d.innerHTML = '<span class="d"></span><span class="t"></span>';
      L.DomEvent.disableClickPropagation(d);
      badge = d;
      setBadge();
      return d;
    }
  });
  new Ctl().addTo(app.map);
}

/** Ask the worker how much it is holding, for the storage panel. */
function askWorker(type) {
  return new Promise(function (res) {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return res(null);
    var ch = new MessageChannel();
    var done = false;
    ch.port1.onmessage = function (e) { done = true; res(e.data); };
    navigator.serviceWorker.controller.postMessage({ type: type }, [ch.port2]);
    setTimeout(function () { if (!done) res(null); }, 2500);
  });
}

/* The worker replies on the page's own message channel too, because Safari has
   been inconsistent about MessageChannel ports from a controller. */
function listen() {
  if (!navigator.serviceWorker) return;
  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'VERSION') { swVersion = d.version; }
    if (d.type === 'TILE_COUNT') { tileCount = d.count; }
  });
}

function post(type) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: type });
  }
}

function register() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    // Not a failure — just not available from disk. Say so honestly rather
    // than claiming an offline capability the page does not have.
    state = 'unsupported';
    setBadge();
    return;
  }
  state = 'installing';
  setBadge();

  navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (r) {
    reg = r;
    if (r.active && navigator.serviceWorker.controller) {
      state = 'ready';
    }
    var sw = r.installing || r.waiting;
    if (sw) {
      sw.addEventListener('statechange', function () {
        if (sw.state === 'activated') { state = 'ready'; setBadge(); refresh(); }
      });
    }
    setBadge();
    refresh();
  }).catch(function (err) {
    state = 'failed';
    setBadge();
    if (window.console) console.warn('offline support unavailable:', err && err.message);
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    state = 'ready'; setBadge(); refresh();
  });
}

function refresh() {
  post('VERSION');
  post('TILE_COUNT');
  askWorker('TILE_COUNT').then(function (d) {
    if (d && typeof d.count === 'number') tileCount = d.count;
    if (window.TMCache && TMCache._refreshPanel) TMCache._refreshPanel();
  });
}

return {
  init: function (a) {
    app = a;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    buildBadge();
    listen();
    register();

    window.addEventListener('online', setBadge);
    window.addEventListener('offline', setBadge);
  },

  /** Rendered inside the storage panel by cache.js. */
  summary: function () {
    return {
      supported: state !== 'unsupported',
      state: state,
      version: swVersion,
      tiles: tileCount,
      online: navigator.onLine
    };
  },
  clearTiles: function () {
    post('CLEAR_TILES');
    return new Promise(function (res) {
      caches.delete('tm-tiles-v1').then(function () { tileCount = 0; res(); },
                    function () { res(); });
    });
  },
  refresh: refresh,
  _state: function () { return state; },
  _register: register
};

})();
