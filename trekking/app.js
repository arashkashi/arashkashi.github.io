/* TrekkingMap — Liguria hut-to-hut planner
 *
 * All vector data (huts, trails, contours, DEM) is bundled locally as window
 * globals; only the raster base tiles come from the network. Rendering uses a
 * canvas renderer throughout because the contour set alone is ~6000 polylines
 * and SVG cannot keep up with that while panning.
 */

(function () {
'use strict';

// ---------------------------------------------- shared maths (see planner.js)

var P = window.TMPlanner;
var haversine = P.haversine;
var SLEEPABLE = P.SLEEPABLE;
var eleAt;                                   // bound to the DEM during init()

// =============================================================== application

var CAT_STYLE = {
  rifugio:       { color: '#c0392b', r: 6, label: 'Rifugio (staffed)' },
  unstaffed_hut: { color: '#e08a2e', r: 5, label: 'Unstaffed hut' },
  bivacco:       { color: '#8e44ad', r: 5, label: 'Bivacco' },
  hostel:        { color: '#2f5d46', r: 5, label: 'Hostel / ostello' },
  chalet:        { color: '#2f7d5d', r: 5, label: 'Chalet' },
  shelter:       { color: '#7a8b99', r: 3.5, label: 'Shelter' },
  other:         { color: '#9aa5ad', r: 3, label: 'Other' }
};

var map, canvas, layers = {}, master, meas, hutIndex;
var clickMode = null;   // set by the route builder while it is capturing clicks

function init() {
  eleAt = P.makeEleSampler(window.TM_DEM);

  canvas = L.canvas({ padding: 0.4 });

  map = L.map('map', {
    center: [44.28, 8.75], zoom: 9,
    renderer: canvas, preferCanvas: true, zoomControl: true
  });

  // ---- base layers. OpenTopoMap is the default: it already renders relief
  // shading and its own contours, which is the topographic look we want.
  var osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  // OpenTopoMap is volunteer-run and sheds load under a burst of requests,
  // which shows up as blank squares. TMTiles.layer retries dropped tiles and
  // leaves a clickable placeholder if it finally gives up.
  var topo = TMTiles.layer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc',
    attribution: osmAttr + ', <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
  });
  var standard = TMTiles.layer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: osmAttr
  });
  var cyclosm = TMTiles.layer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
    maxZoom: 18, subdomains: 'abc', attribution: osmAttr + ', CyclOSM'
  });
  var sat = TMTiles.layer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: 'Imagery &copy; Esri'
  });

  topo.addTo(map);
  L.control.layers(
    { 'OpenTopoMap (relief)': topo, 'OpenStreetMap': standard, 'CyclOSM': cyclosm, 'Satellite': sat },
    null, { position: 'topright' }
  ).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  var tileStatus = TMTiles.status().addTo(map);
  [topo, standard, cyclosm, sat].forEach(function (l) { tileStatus.watch(l); });
  map.on('baselayerchange', function () { tileStatus.update(); });

  buildLayers();
  buildRoute();
  wireUI();
  updateZoomLayers();
  map.on('zoomend', updateZoomLayers);

  // Surface the pieces the optional modules (search, GPX, offline cache) need,
  // so they stay decoupled from this file's internals.
  window.TMApp = {
    map: map,
    canvas: canvas,
    eleAt: function (lon, lat) { return eleAt(lon, lat); },
    esc: esc,
    hutPopup: hutPopup,
    hutLayer: layers.huts,
    catStyle: CAT_STYLE,
    renderProfile: renderProfile,
    hideProfile: function () {
      document.getElementById('profile').hidden = true;
      document.body.classList.remove('tm-profile-open');
    },
    focus: function (lat, lon, zoom) {
      map.setView([lat, lon], zoom || Math.max(map.getZoom(), 14), { animate: true });
    },
    fit: function (bounds, pad) {
      map.fitBounds(bounds, { padding: [pad || 40, pad || 40] });
    },
    masterRoute: function () { return master; },
    avmlMeasure: function () { return meas; },
    hutCorridor: function () { return hutIndex; },
    huts: function () { return window.TM_HUTS; },
    setClickMode: function (m) { clickMode = m; }
  };
  // Dismiss the overlay BEFORE the optional modules run. It covers the whole
  // viewport, so a throw inside any one of them would otherwise hide a fully
  // working map behind an opaque screen with no way out.
  document.getElementById('loading').classList.add('done');

  [['TMSearch', window.TMSearch], ['TMRoute', window.TMRoute],
   ['TMGpx', window.TMGpx], ['TMCache', window.TMCache],
   ['TMContext', window.TMContext], ['TMLocate', window.TMLocate]].forEach(function (m) {
    if (!m[1] || typeof m[1].init !== 'function') return;
    try { m[1].init(window.TMApp); }
    catch (err) { console.error(m[0] + ' failed to start:', err); }
  });
}

// ---------------------------------------------------------------- map layers

function buildLayers() {
  // --- contours (from our own DEM, not the basemap)
  // Simplification can leave degenerate point features behind; L.geoJSON would
  // render those as default marker pins scattered over the map.
  var linesOnly = function (f) {
    return f.geometry && /LineString$/.test(f.geometry.type);
  };
  layers.contourMajor = L.geoJSON(window.TM_CONTOURS_MAJOR, {
    renderer: canvas, filter: linesOnly,
    style: { color: '#8a5a28', weight: 1.1, opacity: .75, fill: false, interactive: false }
  });
  layers.contourMinor = L.geoJSON(window.TM_CONTOURS_MINOR, {
    renderer: canvas, filter: linesOnly,
    style: { color: '#a9793f', weight: .6, opacity: .45, fill: false, interactive: false }
  });

  // --- other waymarked trails (regional / European long-distance)
  layers.routes = L.geoJSON(window.TM_ROUTES, {
    renderer: canvas,
    style: { color: '#4a7fa5', weight: 1.6, opacity: .55 },
    onEachFeature: function (f, l) {
      var p = f.properties;
      l.bindPopup('<div class="pop"><span class="cat">Trail</span><h4>' +
        esc(p.name || 'Unnamed route') + '</h4>' +
        (p.ref ? '<table><tr><td>Ref</td><td>' + esc(p.ref) + '</td></tr>' +
        '<tr><td>Network</td><td>' + esc(p.network || '') + '</td></tr></table>' : '') +
        '</div>');
    }
  });

  // --- the Alta Via: a white casing under a red blaze, like the waymark itself
  layers.avmlCasing = L.geoJSON(window.TM_AVML, {
    renderer: canvas, style: { color: '#ffffff', weight: 6, opacity: .85, interactive: false }
  });
  layers.avml = L.geoJSON(window.TM_AVML, {
    renderer: canvas,
    style: { color: '#c0392b', weight: 3, opacity: .95 },
    onEachFeature: function (f, l) {
      var p = f.properties;
      l.bindTooltip('AV' + String(p.stage).padStart(2, '0') + ' · ' + (p.name || ''), { sticky: true });
    }
  });

  // --- huts
  layers.huts = L.layerGroup();
  window.TM_HUTS.features.forEach(function (f) {
    var st = CAT_STYLE[f.properties.category] || CAT_STYLE.other;
    var c = f.geometry.coordinates;
    var mk = L.circleMarker([c[1], c[0]], {
      renderer: canvas, radius: st.r,
      color: '#fff', weight: 1.2, fillColor: st.color, fillOpacity: .95
    });
    mk.bindPopup(hutPopup(f));
    mk.feature = f;
    layers.huts.addLayer(mk);
  });

  // --- peaks & water
  layers.peaks = L.layerGroup();
  window.TM_PEAKS.features.forEach(function (f) {
    var c = f.geometry.coordinates, p = f.properties;
    var isPeak = p.natural === 'peak';
    var mk = L.circleMarker([c[1], c[0]], {
      renderer: canvas, radius: isPeak ? 3 : 2.4,
      color: isPeak ? '#5b4a33' : '#8a7a63', weight: 1,
      fillColor: isPeak ? '#f4efe4' : '#cbbfa6', fillOpacity: 1
    });
    mk.bindPopup('<div class="pop"><span class="cat">' + (isPeak ? 'Summit' : 'Saddle') +
      '</span><h4>' + esc(p.name) + '</h4>' +
      (p.ele ? '<table><tr><td>Elevation</td><td>' + esc(p.ele) + ' m</td></tr></table>' : '') + '</div>');
    layers.peaks.addLayer(mk);
  });

  layers.water = L.layerGroup();
  window.TM_WATER.features.forEach(function (f) {
    var c = f.geometry.coordinates;
    layers.water.addLayer(L.circleMarker([c[1], c[0]], {
      renderer: canvas, radius: 2.6, color: '#2e6f9e', weight: 1,
      fillColor: '#6fb3dd', fillOpacity: .9
    }).bindPopup('<div class="pop"><span class="cat">Water</span><h4>' +
      esc(f.properties.name || 'Water point') + '</h4></div>'));
  });

  // Default-on layers.
  [layers.contourMajor, layers.avmlCasing, layers.avml, layers.huts].forEach(function (l) {
    l.addTo(map);
  });

  renderLayerToggles();
}

/** Contours and dense point layers only make sense past certain zooms. */
function updateZoomLayers() {
  var z = map.getZoom();
  toggleByZoom(layers.contourMinor, z >= 12 && isOn('contours'));
  toggleByZoom(layers.peaks, z >= 13 && isOn('peaks'));
  toggleByZoom(layers.water, z >= 13 && isOn('water'));
}
function toggleByZoom(layer, want) {
  var has = map.hasLayer(layer);
  if (want && !has) map.addLayer(layer);
  else if (!want && has) map.removeLayer(layer);
}

// ---------------------------------------------------------------- popups

function hutPopup(f) {
  var p = f.properties, st = CAT_STYLE[p.category] || CAT_STYLE.other;
  var rows = '';
  function row(k, v) { if (v) rows += '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
  row('Elevation', p.ele ? esc(p.ele) + ' m' : null);
  row('Beds', p.capacity ? esc(p.capacity) : null);
  row('Operator', p.operator ? esc(p.operator) : null);
  row('Phone', p.phone ? esc(p.phone) : null);
  row('Season', p.seasonal ? esc(p.seasonal) : null);
  row('Access', p.access ? esc(p.access) : null);
  if (p.website) {
    var u = /^https?:/.test(p.website) ? p.website : 'http://' + p.website;
    row('Web', '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(p.website.slice(0, 34)) + '</a>');
  }
  return '<div class="pop"><span class="cat" style="background:' + st.color + '">' + st.label +
    '</span><h4>' + esc(p.name || 'Unnamed') + '</h4>' +
    (rows ? '<table>' + rows + '</table>' : '') +
    '<div style="margin-top:6px;font-size:11px;color:#6b6154">' +
    (p.sleeps ? 'Can be used as an overnight stop.'
      : (p.category === 'ruin' ? 'Not a mountain refuge — do not plan to sleep here.'
      : (p.access ? 'Access is ' + esc(p.access) + ' — not a walk-up overnight.'
      : 'Day shelter only — not an overnight.'))) +
    '</div></div>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------------------------------------------------------------- route setup

function buildRoute() {
  master = P.buildMasterRoute(window.TM_AVML);
  rebuildMeasure();

  document.getElementById('stat-huts').textContent = window.TM_HUTS.features.length;
  document.getElementById('stat-trails').textContent = window.TM_ROUTES.features.length + master.stages.length;
  document.getElementById('stat-contours').textContent =
    (window.TM_CONTOURS_MINOR.features.length + window.TM_CONTOURS_MAJOR.features.length).toLocaleString();
}

/** Measure the Alta Via once, so modules can reuse it (hut corridor, stats). */
function rebuildMeasure() {
  meas = P.measure(master.coords, 4.5, eleAt);
  hutIndex = P.indexHutsAlongRoute(master.coords, meas, window.TM_HUTS, 2500);
}

// ---------------------------------------------------------------- profile

/**
 * Draw an elevation profile.
 *
 * Generic over any distance/elevation series so the planned itinerary and an
 * imported GPX track can share one renderer.
 *   series : {dist, ele}  index-aligned arrays, metres
 *   bands  : [{from, to, color, label}]  index ranges to fill and label
 */
function renderProfile(series, bands, from, to, title) {
  var host = document.getElementById('profile-chart');
  document.getElementById('profile').hidden = false;
  var titleEl = document.getElementById('profile-title');
  if (titleEl) titleEl.textContent = title || 'Elevation profile';
  document.body.classList.add('tm-profile-open');

  var W = host.clientWidth || 800, H = host.clientHeight || 150;
  var padL = 42, padR = 12, padT = 10, padB = 20;
  var dist = series.dist, ele = series.ele;

  var d0 = dist[from], d1 = dist[to];
  if (!(d1 > d0)) d1 = d0 + 1;
  var lo = 1e9, hi = -1e9, i;
  for (i = from; i <= to; i++) { if (ele[i] < lo) lo = ele[i]; if (ele[i] > hi) hi = ele[i]; }
  lo = Math.floor(lo / 100) * 100; hi = Math.ceil((hi + 20) / 100) * 100;
  if (hi <= lo) hi = lo + 100;

  var X = function (k) { return padL + (dist[k] - d0) / (d1 - d0) * (W - padL - padR); };
  var Y = function (e) { return padT + (1 - (e - lo) / (hi - lo)) * (H - padT - padB); };
  var base = (H - padB).toFixed(1);

  var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'];

  var stepE = (hi - lo) > 1200 ? 400 : 200;
  for (var e = lo; e <= hi; e += stepE) {
    svg.push('<line x1="' + padL + '" y1="' + Y(e).toFixed(1) + '" x2="' + (W - padR) +
      '" y2="' + Y(e).toFixed(1) + '" stroke="#d5c9b2" stroke-width="1"/>');
    svg.push('<text x="' + (padL - 6) + '" y="' + (Y(e) + 3.5).toFixed(1) +
      '" text-anchor="end" font-size="9" fill="#6b6154">' + e + '</text>');
  }

  var stride = Math.max(1, Math.floor((to - from) / 1200));
  bands.forEach(function (band, bi) {
    var pts = [];
    var step = band.dense ? 1 : stride;
    for (var k = band.from; k <= band.to; k += step) pts.push(X(k).toFixed(1) + ',' + Y(ele[k]).toFixed(1));
    pts.push(X(band.to).toFixed(1) + ',' + Y(ele[band.to]).toFixed(1));
    // A band may contribute only its shaded area or only its line. Colouring a
    // track by steepness produces hundreds of narrow bands: drawn as both, they
    // stripe the chart into a barcode and the shape of the climb disappears.
    // The fills carry the colour; one continuous line over the top carries the
    // shape.
    if (!band.lineOnly) {
      svg.push('<polygon points="' + X(band.from).toFixed(1) + ',' + base + ' ' + pts.join(' ') +
        ' ' + X(band.to).toFixed(1) + ',' + base + '" fill="' + band.color +
        '" fill-opacity="' + (band.fillOpacity || '.22') + '"/>');
    }
    if (!band.fillOnly) {
      svg.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + band.color +
        '" stroke-width="' + (band.weight || 1.6) + '"/>');
    }

    if (bi > 0 && band.divider !== false) {
      svg.push('<line x1="' + X(band.from).toFixed(1) + '" y1="' + padT + '" x2="' + X(band.from).toFixed(1) +
        '" y2="' + base + '" stroke="#2c2822" stroke-width="1" stroke-dasharray="3 3" opacity=".5"/>');
    }
    if (band.label) {
      svg.push('<text x="' + ((X(band.from) + X(band.to)) / 2).toFixed(1) + '" y="' + (padT + 10) +
        '" text-anchor="middle" font-size="10" font-weight="700" fill="' + band.color + '">' +
        esc(band.label) + '</text>');
    }
  });

  var km0 = d0 / 1000, km1 = d1 / 1000;
  var span = km1 - km0;
  var kmStep = span > 120 ? 25 : span > 50 ? 10 : span > 20 ? 5 : span > 8 ? 2 : 1;
  for (var km = Math.ceil(km0 / kmStep) * kmStep; km <= km1; km += kmStep) {
    var xi = padL + (km - km0) / (km1 - km0) * (W - padL - padR);
    svg.push('<text x="' + xi.toFixed(1) + '" y="' + (H - 6) +
      '" text-anchor="middle" font-size="9" fill="#6b6154">' + Math.round(km - km0) + ' km</text>');
  }

  svg.push('</svg>');
  host.innerHTML = svg.join('');
}

// ---------------------------------------------------------------- UI wiring

var TOGGLES = [
  { id: 'contours', label: 'Contours 500 m <em>(100 m at zoom 12+)</em>', on: true, swatch: '#a9793f' },
  { id: 'avml', label: 'Alta Via dei Monti Liguri', on: true, swatch: '#c0392b' },
  { id: 'routes', label: 'Other waymarked trails', on: false, swatch: '#4a7fa5' },
  { id: 'huts', label: 'Huts, rifugi & shelters', on: true, dot: '#c0392b' },
  { id: 'peaks', label: 'Summits & passes <em>(zoom 13+)</em>', on: true, dot: '#f4efe4' },
  { id: 'water', label: 'Springs & drinking water <em>(zoom 13+)</em>', on: false, dot: '#6fb3dd' }
];

function isOn(id) {
  var el = document.querySelector('[data-layer="' + id + '"]');
  return el ? el.checked : false;
}

function renderLayerToggles() {
  var host = document.getElementById('layer-toggles');
  host.innerHTML = TOGGLES.map(function (t) {
    var mark = t.swatch
      ? '<span class="swatch" style="background:' + t.swatch + '"></span>'
      : '<span class="dot" style="background:' + t.dot + ';border:1px solid #7a6a52"></span>';
    return '<label><input type="checkbox" data-layer="' + t.id + '"' + (t.on ? ' checked' : '') + '>' +
      mark + '<span>' + t.label + '</span></label>';
  }).join('');

  host.addEventListener('change', function (ev) {
    var id = ev.target.dataset.layer;
    if (!id) return;
    var on = ev.target.checked;
    if (id === 'contours') {
      toggleByZoom(layers.contourMajor, on);
      updateZoomLayers();
    } else if (id === 'avml') {
      toggleByZoom(layers.avmlCasing, on); toggleByZoom(layers.avml, on);
    } else if (id === 'routes') {
      toggleByZoom(layers.routes, on);
    } else if (id === 'huts') {
      toggleByZoom(layers.huts, on);
    } else {
      updateZoomLayers();
    }
  });

  document.getElementById('legend').innerHTML = Object.keys(CAT_STYLE).map(function (k) {
    var s = CAT_STYLE[k];
    return '<div><span class="dot" style="background:' + s.color + '"></span>' + s.label + '</div>';
  }).join('');
}

function wireUI() {
  document.getElementById('profile-close').addEventListener('click', function () {
    document.getElementById('profile').hidden = true;
    document.body.classList.remove('tm-profile-open');
  });
}

// ---------------------------------------------------------------- boot

function boot() {
  var missing = ['TM_DEM', 'TM_HUTS', 'TM_AVML', 'TM_CONTOURS_MINOR', 'TM_CONTOURS_MAJOR', 'TM_PEAKS', 'TM_WATER', 'TM_ROUTES']
    .filter(function (k) { return !window[k]; });
  if (missing.length) {
    document.getElementById('loading').innerHTML =
      '<p style="max-width:420px;text-align:center">Missing data files: <b>' + missing.join(', ') +
      '</b>.<br>Run <code>python3 scripts/fetch_osm.py</code> and <code>python3 scripts/build_dem.py</code> first.</p>';
    return;
  }
  try {
    init();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      '<p style="max-width:520px;text-align:center;color:#c0392b">Startup error: ' + esc(err.message) + '</p>';
    throw err;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
