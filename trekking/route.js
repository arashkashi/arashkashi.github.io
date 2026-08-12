/* TrekkingMap — waypoint route builder.
 *
 * Pin a start, then click on for each next point. Every click extends the route
 * and updates the running totals: horizontal distance, vertical ascent and
 * descent, and estimated walking time. Waypoints can be dragged, inserted and
 * removed; the result exports as GPX.
 *
 * How the ground between two waypoints is computed is deliberately pluggable
 * (see setLegBuilder). Today it is a densified direct line sampled against the
 * SRTM grid, which gives honest elevation but a straight ground track; swapping
 * in a trail-following router changes only that one function.
 */

window.TMRoute = (function () {
'use strict';

var app, P;
var pts = [];           // [{lat, lon, name}]
var legs = [];          // [{coords:[[lon,lat]..], dist, up, down, hours}]
var layer, markerLayer, dayLayer, active = false, seq = 0;
var daysEl, daysOut, dayEl;

var SAMPLE_M = 30;      // spacing when densifying a leg, metres

var CSS = [
  '.rb-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
  '.rb-head .btn{flex:0 0 auto;padding:7px 11px}',
  '.rb-arm{flex:1;padding:8px 10px;font:inherit;font-size:13px;font-weight:650;cursor:pointer;',
  '  border:1px solid var(--pine);border-radius:7px;background:var(--pine);color:#fff}',
  '.rb-arm.off{background:#fff;color:var(--pine)}',
  '.rb-arm:hover{filter:brightness(1.06)}',
  '.rb-tot{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}',
  '.rb-tot div{text-align:center;padding:8px 2px;background:var(--paper-2);border-radius:7px}',
  '.rb-tot b{display:block;font-size:16px;font-weight:650;color:var(--pine);',
  '  font-variant-numeric:tabular-nums}',
  '.rb-tot span{font-size:10px;color:var(--ink-soft)}',
  '.rb-list{max-height:210px;overflow-y:auto;margin-top:4px}',
  '.rb-leg{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:6px;font-size:12px}',
  '.rb-leg:hover{background:var(--paper-2)}',
  '.rb-leg .i{flex:0 0 20px;height:20px;line-height:20px;text-align:center;border-radius:50%;',
  '  background:var(--pine);color:#fff;font-size:10px;font-weight:700}',
  '.rb-leg .d{flex:1;color:var(--ink-soft);font-variant-numeric:tabular-nums}',
  '.rb-leg .d b{color:var(--ink)}',
  '.rb-leg button{border:none;background:none;cursor:pointer;color:var(--ink-soft);padding:2px 4px;',
  '  border-radius:4px;font-size:12px}',
  '.rb-leg button:hover{background:#fff;color:var(--blaze)}',
  '.rb-hint{font-size:12px;line-height:1.45;color:var(--ink-soft);background:#fbf7ec;',
  '  border-left:3px solid var(--contour);border-radius:0 6px 6px 0;padding:8px 10px;margin:8px 0}',
  '.rb-hint b{color:var(--ink)}',
  '.rb-warn{display:block;font-size:11.5px;line-height:1.4;color:#8a4b1e;background:#fdf1e3;',
  '  border-left:3px solid #d8891f;border-radius:0 6px 6px 0;padding:6px 9px;margin:-4px 0 8px}',
  '.rb-split{margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}',
  '.rb-split label{display:block;font-size:12px;font-weight:600;color:var(--ink-soft)}',
  '.rb-split input[type=range]{width:100%;accent-color:var(--pine);margin:4px 0 0}',
  '.rb-split output{font-size:12.5px;font-weight:650;color:var(--blaze)}',
  '.rb-day{border:1px solid var(--line);border-left:3px solid var(--blaze);border-radius:0 7px 7px 0;',
  '  padding:6px 9px;margin-top:6px;background:#fff;font-size:11.5px;line-height:1.5;cursor:pointer}',
  '.rb-day:hover{background:#fbf7ec}',
  '.rb-day b{font-size:12px}',
  '.rb-day .ok{color:var(--pine);font-weight:600}',
  '.rb-day .no{color:#8a4b1e}',
  '.rb-note{display:block;font-size:11.5px;color:var(--ink-soft);padding:6px 2px}',
  '.rb-note a{color:var(--sky)}',
  '.daymark{background:var(--blaze);color:#fff;width:22px;height:22px;line-height:22px;',
  '  border-radius:50%;text-align:center;font-size:11px;font-weight:700;border:2px solid #fff}',
  '.rb-wp{background:var(--pine);color:#fff;width:24px;height:24px;line-height:24px;border-radius:50%;',
  '  text-align:center;font-size:11px;font-weight:700;border:2px solid #fff;',
  '  box-shadow:0 1px 3px rgba(60,45,25,.4);cursor:move}',
  '.rb-wp.start{background:var(--blaze)}',
  '.rb-wp.end{background:#1c7ea8}',
  'body.rb-adding .leaflet-container{cursor:crosshair}'
].join('');

// ------------------------------------------------------------- leg geometry

/**
 * Default leg builder: a direct line densified to SAMPLE_M so the elevation
 * profile and the climb totals reflect the real terrain underneath, even though
 * the ground track itself is straight.
 */
function directLeg(a, b) {
  var d = P.haversine([a.lon, a.lat], [b.lon, b.lat]);
  var n = Math.max(1, Math.round(d / SAMPLE_M));
  var out = [];
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    out.push([a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t]);
  }
  return out;
}

var legBuilder = directLeg;

// ------------------------------------------------------------- measurement

function measureLeg(coords) {
  // One shared measurement implementation (planner.js). Raw, not smoothed:
  // this geometry is sampled against the DEM, not recorded by a GPS, so there
  // is no barometric jitter to smooth away.
  var m = P.measurePolyline(coords, { eleAt: app.eleAt, paceKmh: 4.5, smoothWindow: 0 });
  return {
    coords: coords, eles: m.ele, dist: m.dist[m.n - 1],
    up: m.up, down: m.down, hours: m.hours,
    uncovered: m.uncovered, n: m.n
  };
}

/**
 * Recompute every leg. Direct legs are cheap enough that partial invalidation
 * is not worth the bookkeeping; when a trail router replaces legBuilder and a
 * leg costs a graph search, cache per-leg on the waypoint pair instead.
 */
function rebuild() {
  legs = [];
  for (var i = 0; i < pts.length - 1; i++) {
    legs.push(measureLeg(legBuilder(pts[i], pts[i + 1])));
  }
  draw();
  render();
  if (dayEl) renderDays();
}

function totals() {
  return legs.reduce(function (s, l) {
    return {
      km: s.km + l.dist / 1000, up: s.up + l.up, down: s.down + l.down,
      h: s.h + l.hours, uncovered: s.uncovered + l.uncovered, pts: s.pts + l.n
    };
  }, { km: 0, up: 0, down: 0, h: 0, uncovered: 0, pts: 0 });
}

// ------------------------------------------------------------- drawing

function draw() {
  layer.clearLayers();
  markerLayer.clearLayers();

  legs.forEach(function (leg) {
    var ll = leg.coords.map(function (c) { return [c[1], c[0]]; });
    L.polyline(ll, { color: '#fff', weight: 7, opacity: .8, interactive: false }).addTo(layer);
    L.polyline(ll, { color: '#1c7ea8', weight: 4, opacity: .95, interactive: false }).addTo(layer);
  });

  pts.forEach(function (p, i) {
    var cls = i === 0 ? 'rb-wp start' : (i === pts.length - 1 && pts.length > 1 ? 'rb-wp end' : 'rb-wp');
    var m = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: L.divIcon({ className: '', html: '<div class="' + cls + '">' + (i + 1) + '</div>',
                        iconSize: [24, 24], iconAnchor: [12, 12] })
    });
    m.on('dragend', function () {
      var ll = m.getLatLng();
      pts[i].lat = ll.lat; pts[i].lon = ll.lng;
      pts[i].name = null;
      rebuild();
    });
    m.on('click', function (ev) { L.DomEvent.stop(ev); });
    m.bindPopup(wpPopup(i));
    m.addTo(markerLayer);
  });
}

function wpPopup(i) {
  var p = pts[i];
  var e = app.eleAt(p.lon, p.lat);
  var d = 0;
  for (var k = 0; k < i; k++) d += legs[k] ? legs[k].dist : 0;
  return '<div class="pop"><span class="cat">Waypoint ' + (i + 1) + '</span>' +
    '<h4>' + app.esc(p.name || ('Point ' + (i + 1))) + '</h4><table>' +
    (e !== null ? '<tr><td>Elevation</td><td>' + Math.round(e) + ' m</td></tr>' : '') +
    '<tr><td>From start</td><td>' + (d / 1000).toFixed(2) + ' km</td></tr></table>' +
    '<div class="setbtns"><button onclick="TMRoute.remove(' + i + ')">Remove</button></div></div>';
}

// ------------------------------------------------------------- panel

var totEl, listEl, armBtn, hintEl, covEl, dlEl;

function render() {
  var t = totals();
  // Distance is always known; the vertical figures are only as good as the DEM
  // beneath them. Showing "0 m ascent" for terrain we have no data for is the
  // one failure mode that actively misleads, so it is never done.
  var noTerrain = t.pts > 0 && t.uncovered === t.pts;
  var partial = t.uncovered > 0 && !noTerrain;
  var upTxt = noTerrain ? '—' : Math.round(t.up);
  var downTxt = noTerrain ? '—' : Math.round(t.down);
  var hTxt = noTerrain ? '—' : t.h.toFixed(1);

  totEl.innerHTML =
    '<div><b>' + t.km.toFixed(2) + '</b><span>km horizontal</span></div>' +
    '<div><b>' + upTxt + '</b><span>m ascent</span></div>' +
    '<div><b>' + downTxt + '</b><span>m descent</span></div>' +
    '<div><b>' + hTxt + '</b><span>h estimated</span></div>';

  covEl.innerHTML = noTerrain
    ? '<span class="rb-warn">No terrain data here — vertical figures unavailable ' +
      'outside the mapped region.</span>'
    : (partial
      ? '<span class="rb-warn">Partial terrain data — ' + t.uncovered + ' of ' + t.pts +
        ' points uncovered; climb is under-reported.</span>'
      : '');

  if (!pts.length) {
    listEl.innerHTML = '';
    hintEl.innerHTML = active
      ? '<b>Click the map</b> to drop your start point.'
      : 'Press <b>Add points</b>, then click the map to build a route.';
    return;
  }

  hintEl.innerHTML = active
    ? 'Click to add point <b>' + (pts.length + 1) + '</b>. Drag any marker to adjust.'
    : '<b>' + pts.length + '</b> point' + (pts.length > 1 ? 's' : '') +
      '. Press <b>Add points</b> to continue, or drag markers to adjust.';

  listEl.innerHTML = pts.map(function (p, i) {
    var leg = i > 0 ? legs[i - 1] : null;
    return '<div class="rb-leg" data-i="' + i + '"><span class="i">' + (i + 1) + '</span>' +
      '<span class="d">' + (leg
        ? '<b>' + (leg.dist / 1000).toFixed(2) + ' km</b>' +
          (leg.uncovered === leg.n
            ? ' · <i>no terrain data</i>'
            : ' · ↑<b>' + Math.round(leg.up) + '</b> ↓<b>' + Math.round(leg.down) +
              '</b> m · <b>' + leg.hours.toFixed(1) + ' h</b>' +
              (leg.uncovered ? ' <i>(partial)</i>' : ''))
        : app.esc(p.name || 'Start')) + '</span>' +
      '<button data-go="' + i + '" title="Centre on this point">◎</button>' +
      '<button data-rm="' + i + '" title="Remove this point">✕</button></div>';
  }).join('');
}

// ------------------------------------------------------------- actions

function addPoint(lat, lon, name) {
  pts.push({ lat: lat, lon: lon, name: name || null });
  rebuild();
  if (pts.length > 1) profile();
}

function remove(i) {
  if (i < 0 || i >= pts.length) return;
  pts.splice(i, 1);
  app.map.closePopup();
  rebuild();
  if (pts.length > 1) profile(); else app.hideProfile();
}

function clear() {
  pts = []; legs = [];
  layer.clearLayers(); markerLayer.clearLayers(); dayLayer.clearLayers();
  app.hideProfile();
  render();
}

function undo() { if (pts.length) remove(pts.length - 1); }

function setActive(on) {
  active = on;
  document.body.classList.toggle('rb-adding', on);
  armBtn.classList.toggle('off', !on);
  armBtn.textContent = on ? 'Click map to add — done' : 'Add points';
  if (app.setClickMode) app.setClickMode(on ? 'route' : null);
  render();
}

function profile() {
  // Concatenate the legs into one series for the shared profile renderer.
  var dist = [], ele = [], bands = [], run = 0, idx = 0;
  legs.forEach(function (leg, li) {
    var from = idx;
    for (var i = (li === 0 ? 0 : 1); i < leg.coords.length; i++) {
      if (i > 0) run += P.haversine(leg.coords[i - 1], leg.coords[i]);
      dist.push(run); ele.push(leg.eles[i]); idx++;
    }
    bands.push({ from: from, to: idx - 1, color: '#1c7ea8', label: '' });
  });
  if (dist.length < 2) return;
  // One band per leg would stripe the chart; a single band reads better here.
  app.renderProfile({ dist: dist, ele: ele },
    [{ from: 0, to: dist.length - 1, color: '#1c7ea8', label: '' }],
    0, dist.length - 1, 'Elevation profile · your route');
}

/**
 * Split the built route into `days` legs of roughly equal effort, each night
 * landing on a real hut near the line. Same optimiser the Alta Via planner used;
 * it now runs on the route the user actually drew, which is what makes it useful.
 */
function splitDays(days) {
  if (pts.length < 2) return null;
  var coords = flatCoords();
  if (coords.length < days + 1) return null;

  var m = P.measurePolyline(coords, { eleAt: app.eleAt, paceKmh: 4.5, smoothWindow: 0 });
  var huts = app.huts ? app.huts() : null;
  var idx = huts ? P.indexHutsAlongRoute(coords, m, huts, 2500) : [];
  var out = P.planDays(0, coords.length - 1, days, m, idx);
  return out ? { legs: out, m: m, coords: coords } : null;
}

/** The whole route as one coordinate run, legs joined end to end. */
function flatCoords() {
  var out = [];
  legs.forEach(function (leg, li) {
    for (var i = (li === 0 ? 0 : 1); i < leg.coords.length; i++) out.push(leg.coords[i]);
  });
  return out;
}

function renderDays() {
  var days = parseInt(daysEl.value, 10);
  daysOut.textContent = days + (days === 1 ? ' day' : ' days');
  var plan = splitDays(days);
  dayLayer.clearLayers();

  if (!plan) {
    dayEl.innerHTML = pts.length < 2
      ? '<div class="rb-note">Build a route first.</div>'
      : '<div class="rb-note">Route is too short to split into ' + days + ' days.</div>';
    return;
  }

  var hrs = plan.legs.map(function (l) { return l.hours; });
  var spread = Math.max.apply(null, hrs) - Math.min.apply(null, hrs);

  var rows = plan.legs.map(function (leg, i) {
    // The walk out to a hut and back the next morning is real distance. The
    // optimiser already prices it; showing it keeps the day's figure honest.
    var spur = leg.stay && leg.stay.hut ? leg.stay.offset : 0;
    var spurKm = spur / 1000;
    var stay = leg.stay && leg.stay.hut
      ? '<span class="ok">' + app.esc(leg.stay.hut.properties.name || 'hut') + '</span>' +
        (spur > 150 ? ' <i>+' + (2 * spurKm).toFixed(1) + ' km return detour</i>' : '')
      : (i < plan.legs.length - 1 ? '<span class="no">no hut in range — camp</span>' : '<i>finish</i>');
    return '<div class="rb-day" data-d="' + i + '" style="border-left-color:' +
      DAY_COLORS[i % DAY_COLORS.length] + '">' +
      '<b>Day ' + leg.day + '</b> ' + leg.km.toFixed(1) + ' km · ↑' + Math.round(leg.up) +
      ' ↓' + Math.round(leg.down) + ' m · ' + leg.hours.toFixed(1) + ' h<br>' + stay + '</div>';
  }).join('');

  // A split is only as good as where huts happen to be. When they cluster, the
  // optimiser is forced into a 5-hour day beside a 40-minute one; presenting
  // that as a plan without comment would be misleading.
  var withHut = plan.legs.filter(function (l) { return l.stay && l.stay.hut; }).length;
  var needed = plan.legs.length - 1;
  var note = '';
  if (spread > 4 && plan.legs.length > 1) {
    note = '<div class="rb-warn">Days are very uneven (' +
      Math.min.apply(null, hrs).toFixed(1) + '–' + Math.max.apply(null, hrs).toFixed(1) +
      ' h). Only ' + withHut + ' usable hut' + (withHut === 1 ? '' : 's') +
      ' lie near this route, so the overnights cannot be spaced evenly. ' +
      'Try fewer days, or extend the route past more huts.</div>';
  } else if (withHut < needed) {
    note = '<div class="rb-warn">' + (needed - withHut) + ' of ' + needed +
      ' nights have no hut within 2.5 km — plan to camp.</div>';
  }
  dayEl.innerHTML = note + rows;

  plan.legs.forEach(function (leg, i) {
    var ll = [];
    for (var k = leg.from; k <= leg.to; k++) ll.push([plan.coords[k][1], plan.coords[k][0]]);
    L.polyline(ll, { color: DAY_COLORS[i % DAY_COLORS.length], weight: 5, opacity: .9 })
      .bindTooltip('Day ' + leg.day + ' · ' + leg.km.toFixed(1) + ' km', { sticky: true })
      .addTo(dayLayer);
    if (leg.stay && leg.stay.hut) {
      var c = leg.stay.hut.geometry.coordinates;
      L.marker([c[1], c[0]], { icon: L.divIcon({ className: '',
        html: '<div class="daymark">' + leg.day + '</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .bindPopup(app.hutPopup(leg.stay.hut)).addTo(dayLayer);
    }
  });

  var bands = plan.legs.map(function (leg, i) {
    return { from: leg.from, to: leg.to, color: DAY_COLORS[i % DAY_COLORS.length], label: 'D' + leg.day };
  });
  app.renderProfile(plan.m, bands, 0, plan.coords.length - 1,
    'Elevation profile · ' + plan.legs.length + '-day plan');
}

var DAY_COLORS = ['#c0392b', '#2f5d46', '#4a7fa5', '#e08a2e', '#8e44ad', '#2f7d5d', '#b03a6a'];

function toGPX() {
  var x = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="TrekkingMap" xmlns="http://www.topografix.com/GPX/1/1">',
    '<metadata><name>TrekkingMap route</name></metadata>'];
  pts.forEach(function (p, i) {
    var e = app.eleAt(p.lon, p.lat);
    x.push('<wpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '">' +
      (e !== null ? '<ele>' + Math.round(e) + '</ele>' : '') +
      '<name>' + app.esc(p.name || ('Point ' + (i + 1))) + '</name></wpt>');
  });
  x.push('<trk><name>TrekkingMap route</name><trkseg>');
  legs.forEach(function (leg, li) {
    for (var i = (li === 0 ? 0 : 1); i < leg.coords.length; i++) {
      x.push('<trkpt lat="' + leg.coords[i][1].toFixed(6) + '" lon="' + leg.coords[i][0].toFixed(6) +
        '"><ele>' + Math.round(leg.eles[i]) + '</ele></trkpt>');
    }
  });
  x.push('</trkseg></trk></gpx>');
  return x.join('\n');
}

/**
 * Download the route as GPX.
 *
 * Safari's support for the `download` attribute on a blob URL is unreliable
 * when the page itself was opened over file:// — it may render the XML in the
 * tab or do nothing at all. Since file:// is this app's normal mode, a silent
 * failure would lose the user's work, so a visible manual link is always left
 * behind rather than trusting the click.
 */
function download() {
  if (pts.length < 2) {
    if (dlEl) dlEl.innerHTML = '<span class="rb-note">Add at least two points first.</span>';
    return;
  }
  var name = 'trekkingmap-route.gpx';
  var url;
  try {
    url = URL.createObjectURL(new Blob([toGPX()], { type: 'application/gpx+xml' }));
  } catch (e) {
    url = 'data:application/gpx+xml;charset=utf-8,' + encodeURIComponent(toGPX());
  }
  var a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  try { a.click(); } catch (e) { /* fall through to the manual link */ }
  document.body.removeChild(a);

  if (dlEl) {
    dlEl.innerHTML = '<span class="rb-note">If the download did not start, ' +
      '<a href="' + url + '" download="' + name + '">save it here</a> ' +
      '(or right-click → Save Link As).</span>';
  }
}

// ------------------------------------------------------------- setup

function buildUI() {
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var sec = document.createElement('section');
  sec.className = 'block';
  sec.innerHTML =
    '<h2>Route builder</h2>' +
    '<div class="rb-head"><button class="rb-arm off" id="rb-arm">Add points</button>' +
    '<button class="btn ghost" id="rb-undo" title="Remove the last point">Undo</button>' +
    '<button class="btn ghost" id="rb-clear" title="Start over">Clear</button></div>' +
    '<div class="rb-hint" id="rb-hint"></div>' +
    '<div class="rb-tot" id="rb-tot"></div>' +
    '<div id="rb-cov"></div>' +
    '<div class="rb-list" id="rb-list"></div>' +
    '<div class="rb-split"><label>Split into <input type="range" id="rb-days" min="1" max="7" ' +
    'value="1" step="1"><output id="rb-days-out">1 day</output></label>' +
    '<div id="rb-daylist"></div></div>' +
    '<button class="btn wide" id="rb-gpx">Download route as GPX</button>' +
    '<div id="rb-dl"></div>';

  var panel = document.querySelector('.panel');
  // Directly under search, above the Alta Via itinerary block.
  var after = panel.querySelector('#tm-search');
  panel.insertBefore(sec, after ? after.closest('.block').nextSibling : panel.firstChild);

  totEl = sec.querySelector('#rb-tot');
  listEl = sec.querySelector('#rb-list');
  hintEl = sec.querySelector('#rb-hint');
  covEl = sec.querySelector('#rb-cov');
  dlEl = sec.querySelector('#rb-dl');
  armBtn = sec.querySelector('#rb-arm');
  daysEl = sec.querySelector('#rb-days');
  daysOut = sec.querySelector('#rb-days-out');
  dayEl = sec.querySelector('#rb-daylist');
  daysEl.addEventListener('input', renderDays);
  dayEl.addEventListener('click', function (ev) {
    var d = ev.target.closest('[data-d]');
    if (!d) return;
    var plan = splitDays(parseInt(daysEl.value, 10));
    if (!plan) return;
    var leg = plan.legs[+d.dataset.d], ll = [];
    for (var k = leg.from; k <= leg.to; k++) ll.push([plan.coords[k][1], plan.coords[k][0]]);
    app.fit(L.latLngBounds(ll), 50);
  });

  armBtn.addEventListener('click', function () { setActive(!active); });
  sec.querySelector('#rb-undo').addEventListener('click', undo);
  sec.querySelector('#rb-clear').addEventListener('click', clear);
  sec.querySelector('#rb-gpx').addEventListener('click', download);

  listEl.addEventListener('click', function (ev) {
    var rm = ev.target.closest('[data-rm]'), go = ev.target.closest('[data-go]');
    if (rm) remove(+rm.dataset.rm);
    else if (go) {
      var p = pts[+go.dataset.go];
      if (p) app.focus(p.lat, p.lon, Math.max(app.map.getZoom(), 14));
    }
  });

  render();
}

return {
  init: function (a) {
    app = a; P = window.TMPlanner;
    layer = L.layerGroup().addTo(app.map);
    dayLayer = L.layerGroup().addTo(app.map);
    markerLayer = L.layerGroup().addTo(app.map);
    buildUI();
    app.map.on('click', function (ev) {
      if (!active) return;
      addPoint(ev.latlng.lat, ev.latlng.lng);
    });
  },
  /** Swap in a trail-following router: fn(a, b) -> [[lon,lat], ...]. */
  setLegBuilder: function (fn) { legBuilder = fn || directLeg; rebuild(); },
  addPoint: addPoint,
  remove: remove,
  clear: clear,
  splitDays: splitDays,
  undo: undo,
  setActive: setActive,
  isActive: function () { return active; },
  points: function () { return pts; },
  totals: totals,
  toGPX: toGPX
};

})();
