/* TrekkingMap — right-click menu.
 *
 * Right-click anywhere on the map to read off that point: latitude and
 * longitude in both decimal and degrees-minutes-seconds, plus the elevation
 * under it. Coordinates can be copied, and the point can be dropped straight
 * into the route builder.
 *
 * Both formats are offered because hikers hit both: decimal is what phones,
 * GPX and most apps use, DMS is what printed maps and rescue services use.
 */

window.TMContext = (function () {
'use strict';

var app, menu, current = null;

var CSS = [
  '.tmctx{position:absolute;z-index:1400;min-width:212px;background:#fffdf8;',
  '  border:1px solid var(--line);border-radius:9px;box-shadow:var(--shadow);',
  '  font-size:13px;overflow-y:auto;overflow-x:hidden;display:none}',
  '.tmctx.open{display:block}',
  '.tmctx .hd{padding:9px 11px 7px;background:var(--paper-2);border-bottom:1px solid var(--line)}',
  '.tmctx .co{font-size:13px;font-weight:650;font-variant-numeric:tabular-nums;',
  '  color:var(--ink);letter-spacing:-.1px;user-select:text;-webkit-user-select:text}',
  '.tmctx .dms{font-size:11px;color:var(--ink-soft);margin-top:2px;font-variant-numeric:tabular-nums}',
  '.tmctx .el{font-size:11px;color:var(--pine);margin-top:3px;font-weight:600}',
  '.tmctx .el.unknown{color:var(--ink-soft);font-weight:400;font-style:italic}',
  '.tmctx button{display:block;width:100%;text-align:left;padding:7px 11px;border:none;',
  '  background:none;font:inherit;font-size:12.5px;color:var(--ink);cursor:pointer}',
  '.tmctx button:hover{background:#f2f8f4;color:var(--pine)}',
  '.tmctx .sep{height:1px;background:var(--line);margin:3px 0}',
  '.tmctx .ok{color:var(--pine);font-weight:650}'
].join('');

// ---------------------------------------------------------------- formatting

function dec(lat, lon) {
  return lat.toFixed(6) + ', ' + lon.toFixed(6);
}

/** Degrees, minutes, seconds — the form printed maps and rescue services use. */
function dms(lat, lon) {
  function one(v, pos, neg) {
    var hemi = v >= 0 ? pos : neg;
    v = Math.abs(v);
    var d = Math.floor(v);
    var mFull = (v - d) * 60;
    var m = Math.floor(mFull);
    var s = (mFull - m) * 60;
    // Carry the rounding, or 59.999" prints as 60".
    if (s >= 59.95) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + '°' + String(m).padStart(2, '0') + "'" +
           s.toFixed(1).padStart(4, '0') + '"' + hemi;
  }
  return one(lat, 'N', 'S') + ' ' + one(lon, 'E', 'W');
}

// ---------------------------------------------------------------- clipboard

/**
 * Copy, with a fallback. navigator.clipboard is unavailable in some contexts,
 * so fall back to a hidden textarea and execCommand rather than silently
 * failing to copy a coordinate someone may be relying on.
 */
function copy(text, done) {
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) selectCoords();     // leave it selected so Cmd-C still works
    done(ok);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
  } else {
    fallback();
  }
}

/** Select the coordinate text, so a failed copy still leaves it grabbable. */
function selectCoords() {
  var el = document.getElementById('ctx-dec');
  if (!el || !window.getSelection) return;
  try {
    var r = document.createRange();
    r.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) { /* selection is a nicety, never a failure */ }
}

// ---------------------------------------------------------------- menu

function flash(btn, msg) {
  var was = btn.textContent;
  btn.textContent = msg;
  btn.classList.add('ok');
  setTimeout(function () { btn.textContent = was; btn.classList.remove('ok'); }, 1100);
}

function build() {
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  menu = L.DomUtil.create('div', 'tmctx');
  menu.innerHTML =
    '<div class="hd"><div class="co" id="ctx-dec"></div>' +
    '<div class="dms" id="ctx-dms"></div>' +
    '<div class="el" id="ctx-el"></div></div>' +
    '<button data-act="copy-dec">Copy latitude, longitude</button>' +
    '<button data-act="copy-dms">Copy as degrees / minutes</button>' +
    '<div class="sep"></div>' +
    '<button data-act="waypoint">Add route waypoint here</button>' +
    '<button data-act="centre">Centre map here</button>' +
    '<div class="sep"></div>' +
    '<button data-act="osm">Open in OpenStreetMap</button>';

  document.querySelector('.mapwrap').appendChild(menu);

  // The menu sits over the map; its own clicks and scrolls must not reach it.
  L.DomEvent.disableClickPropagation(menu);
  L.DomEvent.disableScrollPropagation(menu);

  menu.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn || !current) return;
    var lat = current.lat, lon = current.lng;

    switch (btn.dataset.act) {
      case 'copy-dec':
        copy(dec(lat, lon), function (ok) { flash(btn, ok ? 'Copied' : 'Copy failed'); });
        return;                                  // stay open so it can be seen
      case 'copy-dms':
        copy(dms(lat, lon), function (ok) { flash(btn, ok ? 'Copied' : 'Copy failed'); });
        return;
      case 'waypoint':
        if (window.TMRoute) TMRoute.addPoint(lat, lon);
        break;
      case 'centre':
        app.map.panTo([lat, lon]);
        break;
      case 'osm':
        window.open('https://www.openstreetmap.org/?mlat=' + lat.toFixed(6) +
          '&mlon=' + lon.toFixed(6) + '#map=16/' + lat.toFixed(5) + '/' + lon.toFixed(5),
          '_blank', 'noopener');
        break;
    }
    close();
  });
}

function open(latlng, containerPoint) {
  current = latlng;
  document.getElementById('ctx-dec').textContent = dec(latlng.lat, latlng.lng);
  document.getElementById('ctx-dms').textContent = dms(latlng.lat, latlng.lng);

  var el = document.getElementById('ctx-el');
  var e = app.eleAt(latlng.lng, latlng.lat);
  if (e === null || isNaN(e)) {
    el.textContent = 'elevation unknown here';
    el.className = 'el unknown';
  } else {
    el.textContent = Math.round(e) + ' m';
    el.className = 'el';
  }

  // Show it, then keep it inside the map area.
  menu.classList.add('open');
  var wrap = document.querySelector('.mapwrap').getBoundingClientRect();

  // On a short window the menu can be taller than the map itself, in which case
  // flipping cannot save it — cap the height and let it scroll instead.
  menu.style.maxHeight = Math.max(120, wrap.height - 8) + 'px';

  var w = menu.offsetWidth, h = menu.offsetHeight;
  var x = containerPoint.x, y = containerPoint.y;
  if (x + w > wrap.width) x = x - w;                  // flip to the other side
  if (y + h > wrap.height) y = y - h;
  // Then clamp, so it is never pushed off the opposite edge either.
  menu.style.left = Math.max(0, Math.min(x, wrap.width - w)) + 'px';
  menu.style.top = Math.max(0, Math.min(y, wrap.height - h)) + 'px';
}

function close() {
  if (menu) menu.classList.remove('open');
  current = null;
}

return {
  init: function (a) {
    app = a;
    build();

    app.map.on('contextmenu', function (ev) {
      if (ev.originalEvent) L.DomEvent.preventDefault(ev.originalEvent);
      open(ev.latlng, ev.containerPoint);
    });

    // Any other interaction dismisses it.
    app.map.on('movestart zoomstart click', close);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    });
    document.addEventListener('click', function (ev) {
      if (menu && !menu.contains(ev.target)) close();
    });
  },

  // exposed for tests
  _open: open,
  _close: close,
  _isOpen: function () { return !!menu && menu.classList.contains('open'); },
  _dec: dec,
  _dms: dms,
  _current: function () { return current; }
};

})();
