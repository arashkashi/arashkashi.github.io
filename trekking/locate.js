/* TrekkingMap — the walker's own position.
 *
 * Shows where you are on the map, live, and — if a GPX track is loaded — how
 * far off the route you are and how far along it you have come. That last part
 * is the bit that matters on a trail: "3.2 km in, 140 m off route" answers the
 * question a hiker actually has.
 *
 * Geolocation needs a secure context. file:// counts as one (verified), so this
 * works from a double-clicked page with no server.
 */

window.TMLocate = (function () {
'use strict';

var app, watchId = null, marker = null, halo = null, statusEl = null;
var last = null, following = false;

var CSS = [
  '.tml-btn{background:#fffdf8;width:34px;height:34px;border:2px solid rgba(0,0,0,.2);',
  '  border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;',
  '  padding:0}',
  '.tml-btn:hover{background:#f2f8f4}',
  '.tml-btn svg{width:18px;height:18px}',
  '.tml-btn.on{background:var(--pine)}',
  '.tml-btn.on svg{stroke:#fff}',
  '.tml-btn.wait svg{animation:tmpulse 1s infinite}',
  '.tml-dot{width:16px;height:16px;border-radius:50%;background:#1a73e8;',
  '  border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}',
  '.tml-info{position:absolute;left:12px;bottom:12px;z-index:1200;max-width:280px;',
  '  background:rgba(255,253,248,.97);border:1px solid var(--line);border-radius:9px;',
  '  box-shadow:var(--shadow);padding:8px 11px;font-size:12px;display:none}',
  '.tml-info.on{display:block}',
  '.tml-info b{font-variant-numeric:tabular-nums}',
  '.tml-info .co{font-size:11px;color:var(--ink-soft);font-variant-numeric:tabular-nums}',
  '.tml-info .rt{margin-top:5px;padding-top:5px;border-top:1px dotted var(--line);',
  '  font-size:11.5px;color:var(--ink-soft)}',
  '.tml-info .rt b{color:var(--ink)}',
  '.tml-info .err{color:var(--blaze)}',
  '.tml-info .cls{float:right;border:none;background:none;cursor:pointer;',
  '  color:var(--ink-soft);font-size:13px;line-height:1;padding:0 0 0 8px}'
].join('');

// ---------------------------------------------------------------- route match

/**
 * Where the walker is relative to a loaded track: how far off it, and how far
 * along it. Coarse pass then refine — a recorded track can be tens of thousands
 * of points and this runs on every position update.
 */
function matchToTrack(lat, lon) {
  if (!window.TMGpx || !TMGpx._list) return null;
  var tracks = TMGpx._list().filter(function (r) { return r.visible; });
  if (!tracks.length) return null;

  var P = window.TMPlanner;
  var best = null;

  tracks.forEach(function (rec) {
    var ll = rec.m.latlngs, n = ll.length;
    var step = Math.max(1, Math.floor(n / 400));
    var bi = 0, bd = Infinity, i;

    for (i = 0; i < n; i += step) {
      var dx = (ll[i][1] - lon) * 79000, dy = (ll[i][0] - lat) * 111000;
      var d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    var lo = Math.max(0, bi - step), hi = Math.min(n - 1, bi + step);
    bd = Infinity;
    for (i = lo; i <= hi; i++) {
      var d = P.haversine([ll[i][1], ll[i][0]], [lon, lat]);
      if (d < bd) { bd = d; bi = i; }
    }
    if (!best || bd < best.off) best = { rec: rec, index: bi, off: bd };
  });
  return best;
}

// ---------------------------------------------------------------- rendering

function draw(pos) {
  var lat = pos.coords.latitude, lon = pos.coords.longitude;
  var acc = pos.coords.accuracy || 0;
  last = pos;

  if (!marker) {
    marker = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: '<div class="tml-dot"></div>',
                        iconSize: [16, 16], iconAnchor: [8, 8] }),
      zIndexOffset: 1000, interactive: false
    }).addTo(app.map);
    // The accuracy circle is the honest part: a 40 m fix is not a point.
    halo = L.circle([lat, lon], {
      radius: acc, color: '#1a73e8', weight: 1, opacity: .5,
      fillColor: '#1a73e8', fillOpacity: .12, interactive: false
    }).addTo(app.map);
  } else {
    marker.setLatLng([lat, lon]);
    halo.setLatLng([lat, lon]).setRadius(acc);
  }

  if (following) app.map.panTo([lat, lon], { animate: true });
  report(lat, lon, acc, pos.coords.altitude);
}

function report(lat, lon, acc, alt) {
  if (!statusEl) return;
  var ele = app.eleAt(lon, lat);
  var html = '<button class="cls" title="Hide">✕</button>' +
    '<b>You are here</b>' +
    '<div class="co">' + lat.toFixed(5) + ', ' + lon.toFixed(5) +
    ' · ±' + Math.round(acc) + ' m' +
    (alt != null && isFinite(alt) ? ' · GPS ' + Math.round(alt) + ' m' : '') +
    (ele !== null && !isNaN(ele) ? ' · map ' + Math.round(ele) + ' m' : '') +
    '</div>';

  var m = matchToTrack(lat, lon);
  if (m) {
    var t = m.rec.m, total = t.dist[t.n - 1] || 1;
    html += '<div class="rt">On <b>' + app.esc(m.rec.name) + '</b><br>' +
      '<b>' + (t.dist[m.index] / 1000).toFixed(2) + ' km</b> in (' +
      ((t.dist[m.index] / total) * 100).toFixed(0) + '%) · ' +
      '↑<b>' + Math.round(t.cumUp[m.index]) + '</b> ↓<b>' +
      Math.round(t.cumDown[m.index]) + '</b> m done<br>' +
      '<b>' + (t.dist[t.n - 1] - t.dist[m.index] > 0
        ? ((total - t.dist[m.index]) / 1000).toFixed(2) + ' km</b> to go · ' : '0 km</b> · ') +
      (m.off < 30 ? 'on the route' : Math.round(m.off) + ' m off route') +
      '</div>';
  }
  statusEl.innerHTML = html;
  statusEl.classList.add('on');
  statusEl.querySelector('.cls').addEventListener('click', function () {
    statusEl.classList.remove('on');
  });
}

function fail(err) {
  var msg = {
    1: 'Location permission was denied. Allow it in Safari settings to use this.',
    2: 'Position unavailable — no GPS or network fix right now.',
    3: 'Timed out waiting for a position fix.'
  }[err && err.code] || 'Could not get a position.';
  if (statusEl) {
    statusEl.innerHTML = '<button class="cls" title="Hide">✕</button><span class="err">' +
      app.esc(msg) + '</span>';
    statusEl.classList.add('on');
    statusEl.querySelector('.cls').addEventListener('click', function () {
      statusEl.classList.remove('on');
    });
  }
  stop();
}

// ---------------------------------------------------------------- control

var btn;

function setBtn(state) {
  if (!btn) return;
  btn.classList.toggle('on', state === 'on');
  btn.classList.toggle('wait', state === 'wait');
  btn.title = state === 'on' ? 'Stop following your position'
            : state === 'wait' ? 'Waiting for a position fix…'
            : 'Show where I am';
}

function start() {
  if (!navigator.geolocation) { fail({ code: 2 }); return; }
  setBtn('wait');
  following = true;
  watchId = navigator.geolocation.watchPosition(function (pos) {
    setBtn('on');
    draw(pos);
  }, fail, {
    enableHighAccuracy: true,     // a walker needs metres, not the cell tower
    maximumAge: 5000,
    timeout: 20000
  });
}

function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  following = false;
  setBtn('off');
  if (marker) { app.map.removeLayer(marker); marker = null; }
  if (halo) { app.map.removeLayer(halo); halo = null; }
}

function toggle() { watchId === null ? start() : stop(); }

return {
  init: function (a) {
    app = a;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var Ctl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var wrap = L.DomUtil.create('div', 'leaflet-bar');
        btn = L.DomUtil.create('button', 'tml-btn', wrap);
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="#2f5d46" stroke-width="2" ' +
          'stroke-linecap="round"><circle cx="12" cy="12" r="4"/>' +
          '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(btn, 'click', function (e) { L.DomEvent.stop(e); toggle(); });
        setBtn('off');
        return wrap;
      }
    });
    new Ctl().addTo(app.map);

    statusEl = document.createElement('div');
    statusEl.className = 'tml-info';
    document.querySelector('.mapwrap').appendChild(statusEl);

    // Dragging the map means you want to look elsewhere; stop chasing the dot.
    app.map.on('dragstart', function () { following = false; });
  },

  // exposed for tests
  _draw: draw,
  _fail: fail,
  _match: matchToTrack,
  _isWatching: function () { return watchId !== null; },
  _toggle: toggle,
  _stop: stop
};

})();
