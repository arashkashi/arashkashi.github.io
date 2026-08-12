/* TrekkingMap — GPX import.
 *
 * Loads GPX files the user picks or drags onto the map, draws them as overlays,
 * and reports distance / ascent / descent for each. Elevation comes from the
 * file when it carries <ele>, and is otherwise sampled from the bundled DEM, so
 * a track recorded without barometric data still gets a profile.
 *
 * Self-contained: it injects its own panel and styles, and talks to the app only
 * through the window.TMApp surface.
 */

window.TMGpx = (function () {
'use strict';

var app, list = [], seq = 0, pendingSample = null, sampleLoaded = false;

// Distinct from the itinerary's day colours so an import never reads as a plan.
var COLORS = ['#6d3fa0', '#1c7ea8', '#a8571c', '#0f7a6a', '#8f2f6b', '#4a5da8'];

var CSS = [
  '.gpx-drop{border:1px dashed var(--line);border-radius:8px;padding:12px 10px;text-align:center;',
  '  font-size:12px;color:var(--ink-soft);cursor:pointer;transition:.15s;background:#fffdf8}',
  '.gpx-drop:hover,.gpx-drop.over{border-color:var(--pine-2);background:#f2f8f4;color:var(--ink)}',
  '.gpx-drop b{display:block;font-size:13px;color:var(--pine);margin-bottom:2px}',
  '.gpx-item{border:1px solid var(--line);border-left:3px solid var(--sky);border-radius:0 8px 8px 0;',
  '  padding:8px 10px;margin-top:7px;background:#fff}',
  '.gpx-item .hd{display:flex;align-items:center;gap:6px}',
  '.gpx-item .nm{flex:1;font-size:12.5px;font-weight:650;overflow:hidden;',
  '  text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
  '.gpx-item .nm:hover{text-decoration:underline}',
  '.gpx-item button{border:none;background:none;cursor:pointer;font-size:12px;padding:2px 4px;',
  '  color:var(--ink-soft);border-radius:4px;line-height:1}',
  '.gpx-item button:hover{background:var(--paper-2);color:var(--ink)}',
  '.gpx-item .nums{font-size:11px;color:var(--ink-soft);margin-top:4px;font-variant-numeric:tabular-nums}',
  '.gpx-item .nums b{color:var(--ink)}',
  '.gpx-item.off{opacity:.5}',
  '.gpx-err{font-size:11.5px;color:var(--blaze);margin-top:6px}',
  '.gpx-wpt{background:#fff;border:2px solid #6d3fa0;border-radius:50%;width:9px;height:9px}',
  '.gpx-tot{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:7px 0 6px}',
  '.gpx-tot div{text-align:center;padding:6px 2px;background:var(--paper-2);border-radius:6px}',
  '.gpx-tot b{display:block;font-size:15px;font-weight:650;color:var(--pine);',
  '  font-variant-numeric:tabular-nums}',
  '.gpx-tot span{font-size:9.5px;color:var(--ink-soft)}',
  '.gpx-bar{display:flex;height:9px;border-radius:5px;overflow:hidden;margin:6px 0 5px;',
  '  box-shadow:inset 0 0 0 1px rgba(0,0,0,.10)}',
  '.gpx-bar span{display:block;height:100%}',
  '.gpx-leg{display:flex;flex-wrap:wrap;gap:3px 9px;font-size:10px;color:var(--ink-soft);',
  '  margin-bottom:6px}',
  '.gpx-leg span{display:flex;align-items:center;gap:4px}',
  '.gpx-leg i{width:8px;height:8px;border-radius:2px;display:inline-block}',
  '.gpx-leg b{color:var(--ink);font-variant-numeric:tabular-nums}',
  '.gpx-tbl{width:100%;border-collapse:collapse;font-size:10.5px}',
  '.gpx-tbl td{padding:1px 0;color:var(--ink)}',
  '.gpx-tbl td:nth-child(odd){color:var(--ink-soft);padding-right:5px}',
  '.gpx-tbl td:nth-child(3){padding-left:8px}',
  '.gpx-src{font-size:9.5px;color:var(--ink-soft);margin-top:5px;font-style:italic}',
  '.gpx-cred{font-size:9.5px;color:var(--ink-soft);margin-top:3px;padding-top:3px;',
  '  border-top:1px dotted var(--line);line-height:1.4}',
  '.gpx-cred a{color:var(--sky)}',
  '.gpx-sample{display:block;margin-top:6px;font-size:11.5px;color:var(--sky);cursor:pointer;',
  '  background:none;border:none;padding:0;text-decoration:underline;font-family:inherit}',
  '.gpx-sample:hover{color:var(--pine)}',
  '.gpx-warn{font-size:11px;color:#8a4b1e;background:#fdf1e3;border-radius:5px;padding:5px 7px}',
  '.gpx-scrub{margin:2px 0 7px}',
  '.gpx-scrub input{width:100%;accent-color:var(--blaze);margin:0;height:16px}',
  '.gpx-scrubout{font-size:10.5px;color:var(--ink-soft);margin-top:2px;',
  '  font-variant-numeric:tabular-nums;min-height:14px}',
  '.gpx-scrubout b{color:var(--ink)}',
  '.gpx-scrubout .up{color:#a8571c}',
  '.gpx-scrubout .dn{color:#2f6f9d}',
  '.gpx-scrubout span{color:var(--ink-soft)}',
  '.gpx-probe{position:absolute;z-index:1300;pointer-events:none;display:none;',
  '  background:rgba(255,253,248,.97);border:1px solid var(--line);border-radius:9px;',
  '  box-shadow:var(--shadow);padding:8px 11px;min-width:150px}',
  '.gpx-probe.on{display:block}',
  '.gpx-probe .pk{font-size:15px;font-weight:650;color:var(--ink);',
  '  font-variant-numeric:tabular-nums;line-height:1.15}',
  '.gpx-probe .pk em{display:block;font-style:normal;font-size:10px;font-weight:400;',
  '  color:var(--ink-soft);margin-top:1px}',
  '.gpx-probe .pv{display:flex;gap:10px;margin-top:5px;font-size:12.5px;font-weight:650;',
  '  font-variant-numeric:tabular-nums}',
  '.gpx-probe .pv .up{color:#a8571c}',
  '.gpx-probe .pv .dn{color:#2f6f9d}',
  '.gpx-probe .pe{font-size:10px;color:var(--ink-soft);margin-top:4px}',
  '.gpx-probe .pn{font-size:9.5px;color:var(--ink-soft);margin-top:4px;padding-top:4px;',
  '  border-top:1px dotted var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
].join('\n');

// ------------------------------------------------------------------ parsing

/**
 * GPX declares a default XML namespace, and files in the wild disagree about
 * prefixes and about 1.0 vs 1.1. Matching on local name with a wildcard
 * namespace is the only thing that reads all of them.
 */
function tags(node, name) {
  return Array.prototype.slice.call(node.getElementsByTagNameNS('*', name));
}
function text(node, name) {
  var el = tags(node, name)[0];
  return el ? el.textContent.trim() : null;
}
/**
 * Direct children only. Searching descendants for <name> from the <gpx> root
 * finds whichever <name> comes first in document order — typically a waypoint's
 * — so the file ends up labelled after a random waypoint.
 */
function childText(node, name) {
  if (!node) return null;
  for (var c = node.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) {
      var t = c.textContent.trim();
      return t || null;
    }
  }
  return null;
}

function parseGPX(str) {
  var doc = new DOMParser().parseFromString(str, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not valid XML');
  var root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'gpx') throw new Error('not a GPX file');

  function pt(el) {
    var lat = parseFloat(el.getAttribute('lat')), lon = parseFloat(el.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return null;
    var e = text(el, 'ele');
    return { lat: lat, lon: lon, ele: e === null ? null : parseFloat(e) };
  }

  var segs = [];
  tags(root, 'trk').forEach(function (trk) {
    tags(trk, 'trkseg').forEach(function (seg) {
      var pts = tags(seg, 'trkpt').map(pt).filter(Boolean);
      if (pts.length > 1) segs.push(pts);
    });
  });
  // A <rte> is a planned route rather than a recorded track; treat it the same.
  tags(root, 'rte').forEach(function (rte) {
    var pts = tags(rte, 'rtept').map(pt).filter(Boolean);
    if (pts.length > 1) segs.push(pts);
  });

  var wpts = tags(root, 'wpt').map(function (w) {
    var p = pt(w);
    if (p) p.name = childText(w, 'name');
    return p;
  }).filter(Boolean);

  if (!segs.length && !wpts.length) throw new Error('no tracks or waypoints found');

  // Prefer the file's own title, then the first track's, then the first route's.
  var name = childText(tags(root, 'metadata')[0], 'name') ||
             childText(tags(root, 'trk')[0], 'name') ||
             childText(tags(root, 'rte')[0], 'name');
  return { name: name, segs: segs, wpts: wpts };
}

// ------------------------------------------------------------------ measuring

function measure(segs) {
  var P = window.TMPlanner;
  var coords = [], given = [], latlngs = [], hadEle = false;

  segs.forEach(function (seg) {
    seg.forEach(function (p) {
      coords.push([p.lon, p.lat]);
      latlngs.push([p.lat, p.lon]);
      if (p.ele !== null && isFinite(p.ele)) { given.push(p.ele); hadEle = true; }
      else given.push(null);
    });
  });

  // smoothWindow is declared here rather than buried in the module. A recorded
  // track's barometric elevation jitters by metres per point, which inflates
  // total climb; measured against the same geometry, smoothing changes the
  // figure by ~12%. A DEM-sampled polyline needs none, so the route builder
  // passes 0. Same code, different stated policy.
  var m = P.measurePolyline(coords, {
    eleAt: app.eleAt,          // fills gaps where the file carries no <ele>
    ele: hadEle ? given : null,
    paceKmh: 4.5,
    smoothWindow: 5
  });

  var hi = -Infinity, lo = Infinity;
  for (var i = 0; i < m.n; i++) {
    if (!m.eleKnown[i]) continue;
    if (m.ele[i] > hi) hi = m.ele[i];
    if (m.ele[i] < lo) lo = m.ele[i];
  }

  // Running totals at every vertex. The overall up/down figures answer "how
  // hard is this walk"; these answer "how much of it have I already done",
  // which is what someone standing on the trail actually wants.
  var cumUp = new Float64Array(m.n), cumDown = new Float64Array(m.n);
  for (i = 1; i < m.n; i++) {
    cumUp[i] = cumUp[i - 1];
    cumDown[i] = cumDown[i - 1];
    if (m.eleKnown[i] && m.eleKnown[i - 1]) {
      var dz = m.ele[i] - m.ele[i - 1];
      if (dz > 0) cumUp[i] += dz; else cumDown[i] -= dz;
    }
  }

  return {
    dist: m.dist, ele: m.ele, eleKnown: m.eleKnown, latlngs: latlngs, n: m.n,
    km: m.dist[m.n - 1] / 1000, up: m.up, down: m.down,
    hours: m.hours,                       // Naismith estimate, used by the readout
    hi: hi === -Infinity ? null : hi, lo: lo === Infinity ? null : lo,
    hadEle: hadEle, uncovered: m.uncovered,
    cumUp: cumUp, cumDown: cumDown
  };
}

// ------------------------------------------------------------------ slope
//
// Steepness is what a hiker actually feels, and it is invisible in a plain
// coloured line. Gradient is mapped from cold (flat, easy) to red (steep), on
// the map and on the elevation profile, so both read as one picture.

var SLOPE_CLASSES = [
  { max: 0.05,     color: '#1a6faf', label: 'flat',       hint: 'under 5%' },
  { max: 0.10,     color: '#2f8f8f', label: 'gentle',     hint: '5–10%' },
  { max: 0.20,     color: '#d9a520', label: 'moderate',   hint: '10–20%' },
  { max: 0.30,     color: '#e0662b', label: 'steep',      hint: '20–30%' },
  { max: Infinity, color: '#c0392b', label: 'very steep', hint: 'over 30%' }
];

function slopeClass(g) {
  var a = Math.abs(g);
  for (var i = 0; i < SLOPE_CLASSES.length; i++) if (a < SLOPE_CLASSES[i].max) return i;
  return SLOPE_CLASSES.length - 1;
}

/**
 * Gradient at each point, measured over a ~60 m window rather than between
 * neighbouring points. A recorded track has points every few metres, and raw
 * point-to-point gradient is dominated by GPS noise — it paints the whole line
 * red regardless of the terrain.
 */
function slopes(m) {
  // 250 m window. Shorter than this and the measurement is dominated by point
  // spacing rather than terrain: this track averages 64 m between points, so a
  // 60 m window made almost every point its own gradient and painted the
  // profile as a barcode. A quarter-kilometre is also the scale a walker
  // actually experiences as "this bit is steep".
  var n = m.n, out = new Float64Array(n), HALF = 125;
  for (var i = 0; i < n; i++) {
    var lo = i, hi = i;
    while (lo > 0 && m.dist[i] - m.dist[lo] < HALF) lo--;
    while (hi < n - 1 && m.dist[hi] - m.dist[i] < HALF) hi++;
    var dd = m.dist[hi] - m.dist[lo];
    var dz = (m.eleKnown[hi] && m.eleKnown[lo]) ? m.ele[hi] - m.ele[lo] : 0;
    out[i] = dd > 1 ? dz / dd : 0;
  }
  return out;
}

/**
 * Consecutive points sharing a steepness class, as [from, to, classIndex].
 *
 * Runs shorter than MIN_RUN_M are absorbed into the neighbour they most
 * resemble. Without that, a single point flicking across a class boundary
 * splits a long even climb into dozens of one-pixel bands.
 */
function slopeRuns(sl, dist) {
  var MIN_RUN_M = 150;
  var runs = [], start = 0, cur = slopeClass(sl[0]);
  for (var i = 1; i < sl.length; i++) {
    var c = slopeClass(sl[i]);
    if (c !== cur) { runs.push([start, i, cur]); start = i; cur = c; }
  }
  runs.push([start, sl.length - 1, cur]);
  if (!dist) return runs;

  var merged = [];
  runs.forEach(function (r) {
    var len = dist[r[1]] - dist[r[0]];
    var prev = merged[merged.length - 1];
    if (prev && len < MIN_RUN_M) { prev[1] = r[1]; return; }   // absorb the sliver
    if (prev && prev[2] === r[2]) { prev[1] = r[1]; return; }  // same class, join
    merged.push([r[0], r[1], r[2]]);
  });
  return merged;
}

/** How much ground, and how much climb, falls in each steepness class. */
function slopeStats(m, sl) {
  var byClass = SLOPE_CLASSES.map(function () { return { m: 0, up: 0, down: 0 }; });
  var maxUp = 0, maxDown = 0;
  for (var i = 1; i < m.n; i++) {
    var c = slopeClass(sl[i]);
    var d = m.dist[i] - m.dist[i - 1];
    byClass[c].m += d;
    if (m.eleKnown[i] && m.eleKnown[i - 1]) {
      var dz = m.ele[i] - m.ele[i - 1];
      if (dz > 0) byClass[c].up += dz; else byClass[c].down -= dz;
    }
    if (sl[i] > maxUp) maxUp = sl[i];
    if (sl[i] < maxDown) maxDown = sl[i];
  }
  return { byClass: byClass, maxUp: maxUp, maxDown: maxDown };
}

// ------------------------------------------------------------- position readout

var probe = null, probeBox = null, probeRec = null;

/** Index of the vertex closest to a given distance along the track. */
function indexAtDistance(m, metres) {
  var lo = 0, hi = m.n - 1;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (m.dist[mid] < metres) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Nearest vertex to a lat/lng, searched only within a known index range. */
function nearestIndex(rec, latlng, from, to) {
  var P = window.TMPlanner, best = from, bd = Infinity;
  for (var i = from; i <= to; i++) {
    var d = P.haversine([rec.m.latlngs[i][1], rec.m.latlngs[i][0]], [latlng.lng, latlng.lat]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function ensureProbe() {
  if (probeBox) return;
  probeBox = document.createElement('div');
  probeBox.className = 'gpx-probe';
  document.querySelector('.mapwrap').appendChild(probeBox);
}

/** Show the marker and the floating readout at vertex `i` of `rec`. */
function showAt(rec, i, pinToPoint) {
  ensureProbe();
  var m = rec.m;
  var total = m.dist[m.n - 1] || 1;
  var ll = m.latlngs[i];

  if (!probe) {
    probe = L.circleMarker(ll, {
      radius: 7, color: '#fff', weight: 3, fillColor: '#c0392b', fillOpacity: 1,
      interactive: false
    }).addTo(app.map);
  } else {
    probe.setLatLng(ll);
  }
  probe.setStyle({ fillColor: rec.color });
  probeRec = rec;

  var known = m.eleKnown[i];
  probeBox.innerHTML =
    '<div class="pk">' + (m.dist[i] / 1000).toFixed(2) + ' km' +
      '<em>of ' + (total / 1000).toFixed(1) + ' · ' +
      ((m.dist[i] / total) * 100).toFixed(0) + '%</em></div>' +
    '<div class="pv">' +
      '<span class="up">↑ ' + Math.round(m.cumUp[i]) + ' m</span>' +
      '<span class="dn">↓ ' + Math.round(m.cumDown[i]) + ' m</span>' +
    '</div>' +
    '<div class="pe">' + (known ? Math.round(m.ele[i]) + ' m here' : 'elevation unknown') +
      ' · ' + Math.round(m.cumUp[i] + m.cumDown[i]) + ' m climbed so far</div>' +
    '<div class="pn">' + app.esc(rec.name) + '</div>';

  // Place it beside the point, flipping near the edges so it never leaves the map.
  var pt = pinToPoint || app.map.latLngToContainerPoint(ll);
  probeBox.classList.add('on');
  var wrap = document.querySelector('.mapwrap').getBoundingClientRect();
  var w = probeBox.offsetWidth, h = probeBox.offsetHeight;
  var x = pt.x + 14, y = pt.y + 14;
  if (x + w > wrap.width) x = pt.x - w - 14;
  if (y + h > wrap.height) y = pt.y - h - 14;
  probeBox.style.left = Math.max(4, Math.min(x, wrap.width - w - 4)) + 'px';
  probeBox.style.top = Math.max(4, Math.min(y, wrap.height - h - 4)) + 'px';
}

function hideProbe(keepMarker) {
  if (probeBox) probeBox.classList.remove('on');
  if (!keepMarker && probe) { app.map.removeLayer(probe); probe = null; probeRec = null; }
}

// ------------------------------------------------------------------ rendering

function addTrack(parsed, filename) {
  var m = measure(parsed.segs);
  if (!m.n) throw new Error('track had no usable points');

  var sl = slopes(m);
  var runs = slopeRuns(sl, m.dist);
  var stats = slopeStats(m, sl);
  var color = COLORS[seq % COLORS.length];
  var group = L.layerGroup();

  // A white casing under the whole line keeps it legible over a busy topo map,
  // then each steepness run is drawn on top in its own colour.
  L.polyline(m.latlngs, { color: '#fff', weight: 7, opacity: .85, interactive: false })
    .addTo(group);

  runs.forEach(function (r) {
    var seg = m.latlngs.slice(r[0], r[1] + 1);
    if (seg.length < 2) return;
    var cls = SLOPE_CLASSES[r[2]];
    L.polyline(seg, { color: cls.color, weight: 4, opacity: .95, interactive: false })
      .addTo(group);
  });



  parsed.wpts.forEach(function (w) {
    L.circleMarker([w.lat, w.lon], {
      radius: 5, color: '#333', weight: 2, fillColor: '#fff', fillOpacity: 1
    }).bindPopup('<div class="pop"><span class="cat" style="background:' + color +
      '">GPX waypoint</span><h4>' + app.esc(w.name || 'Waypoint') + '</h4>' +
      (w.ele != null && isFinite(w.ele) ? '<table><tr><td>Elevation</td><td>' +
        Math.round(w.ele) + ' m</td></tr></table>' : '') + '</div>').addTo(group);
  });

  group.addTo(app.map);

  var rec = {
    id: ++seq, name: parsed.name || filename.replace(/\.gpx$/i, ''),
    color: color, group: group, m: m, sl: sl, runs: runs, stats: stats,
    visible: true, bounds: L.latLngBounds(m.latlngs), sample: pendingSample
  };
  pendingSample = null;
  list.push(rec);
  render();
  updateSampleLink();
  app.fit(rec.bounds, 40);
  profileTrack(rec.id);
  return rec;
}

function removeTrack(id) {
  var i = list.findIndex(function (r) { return r.id === id; });
  if (i < 0) return;
  if (probeRec === list[i]) hideProbe();
  app.map.removeLayer(list[i].group);
  list.splice(i, 1);
  render();
  updateSampleLink();
}

function toggleTrack(id) {
  var r = list.find(function (x) { return x.id === id; });
  if (!r) return;
  r.visible = !r.visible;
  if (r.visible) r.group.addTo(app.map); else app.map.removeLayer(r.group);
  render();
}

function profileTrack(id) {
  var r = list.find(function (x) { return x.id === id; });
  if (!r) return;
  // Same colour encoding as the map, so a red bulge in the profile and a red
  // stretch of the line are recognisably the same climb.
  var bands = r.runs.map(function (run) {
    return {
      from: run[0], to: run[1], color: SLOPE_CLASSES[run[2]].color,
      label: '', divider: false, dense: true,
      fillOnly: true, fillOpacity: '.55'          // colour lives in the shading
    };
  });
  // One unbroken line over the top, so the profile still reads as a shape.
  bands.push({
    from: 0, to: r.m.n - 1, color: '#4a4034', label: '',
    divider: false, dense: true, lineOnly: true, weight: 1.4
  });
  app.renderProfile(r.m, bands, 0, r.m.n - 1,
    'Elevation profile · ' + r.name + ' · coloured by steepness' +
    (r.m.hadEle ? '' : ' (elevation from SRTM)'));
}

// ------------------------------------------------------------- hover detection

var HOVER_PX = 14;          // how close the pointer must be to a track, in pixels
var hoverPending = false;

/**
 * Find the nearest point on any visible track to the pointer, in SCREEN space.
 *
 * This deliberately does not use a clickable layer. An earlier version put a
 * wide invisible polyline under each track to make hovering forgiving — but it
 * was drawn after the huts on the same canvas, so it captured every click and
 * made huts under a track unselectable. Watching the map's own mousemove keeps
 * hovering forgiving while leaving clicks to reach whatever is really there.
 */
function hoverProbe(ev) {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(function () {
    hoverPending = false;
    var best = null;
    list.forEach(function (rec) {
      if (!rec.visible) return;
      var i = nearestIndex(rec, ev.latlng, 0, rec.m.n - 1);
      var pt = app.map.latLngToContainerPoint(rec.m.latlngs[i]);
      var dx = pt.x - ev.containerPoint.x, dy = pt.y - ev.containerPoint.y;
      var px = Math.sqrt(dx * dx + dy * dy);
      if (!best || px < best.px) best = { rec: rec, index: i, px: px };
    });
    if (best && best.px <= HOVER_PX) {
      showAt(best.rec, best.index, ev.containerPoint);
      syncSlider(best.rec, best.index);
    } else {
      hideProbe();
    }
  });
}

// ------------------------------------------------------------------ UI

/** Keep the sidebar slider and its caption in step with a hover on the map. */
function syncSlider(rec, i) {
  var sl = document.querySelector('[data-scrub="' + rec.id + '"]');
  if (!sl) return;
  var total = rec.m.dist[rec.m.n - 1] || 1;
  sl.value = Math.round((rec.m.dist[i] / total) * 1000);
  writeScrubOut(rec, i);
}

function writeScrubOut(rec, i) {
  var out = document.getElementById('gpx-scrubout-' + rec.id);
  if (!out) return;
  var m = rec.m, total = m.dist[m.n - 1] || 1;
  out.innerHTML =
    '<b>' + (m.dist[i] / 1000).toFixed(2) + ' km</b> ' +
    '<span>(' + ((m.dist[i] / total) * 100).toFixed(0) + '%)</span> · ' +
    '<b class="up">↑' + Math.round(m.cumUp[i]) + '</b> ' +
    '<b class="dn">↓' + Math.round(m.cumDown[i]) + '</b> m' +
    (m.eleKnown[i] ? ' · ' + Math.round(m.ele[i]) + ' m' : '');
}

var listEl, errEl;

function fmtKm(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }

function render() {
  if (!listEl) return;
  listEl.innerHTML = list.map(function (r) {
    var m = r.m, st = r.stats;
    var noEle = m.uncovered === m.n;
    var total = m.dist[m.n - 1] || 1;

    // Headline figures: the two the user asked to see, side by side.
    var head =
      '<div class="gpx-tot">' +
        '<div><b>' + m.km.toFixed(2) + '</b><span>km horizontal</span></div>' +
        '<div><b>' + (noEle ? '—' : Math.round(m.up)) + '</b><span>m ascent</span></div>' +
        '<div><b>' + (noEle ? '—' : Math.round(m.down)) + '</b><span>m descent</span></div>' +
      '</div>';

    var detail = noEle ? '<div class="gpx-warn">No elevation data for this area.</div>' :
      '<table class="gpx-tbl">' +
        '<tr><td>Net change</td><td>' + (m.ele[m.n - 1] - m.ele[0] >= 0 ? '+' : '') +
          Math.round(m.ele[m.n - 1] - m.ele[0]) + ' m</td>' +
          '<td>High / low</td><td>' + Math.round(m.hi) + ' / ' + Math.round(m.lo) + ' m</td></tr>' +
        '<tr><td>Steepest up</td><td>' + (st.maxUp * 100).toFixed(0) + '%</td>' +
          '<td>Steepest down</td><td>' + (Math.abs(st.maxDown) * 100).toFixed(0) + '%</td></tr>' +
        '<tr><td>Est. time</td><td>' + m.hours.toFixed(1) + ' h</td>' +
          '<td>Climb rate</td><td>' + Math.round(m.up / Math.max(0.1, m.km)) + ' m/km</td></tr>' +
      '</table>';

    // A single bar showing how much of the walk is flat versus punishing.
    var bar = '', legend = '';
    if (!noEle) {
      bar = '<div class="gpx-bar">' + SLOPE_CLASSES.map(function (c, i) {
        var frac = st.byClass[i].m / total;
        if (frac <= 0.002) return '';
        return '<span style="width:' + (frac * 100).toFixed(2) + '%;background:' + c.color +
          '" title="' + c.label + ' (' + c.hint + '): ' + fmtKm(st.byClass[i].m) + '"></span>';
      }).join('') + '</div>';
      legend = '<div class="gpx-leg">' + SLOPE_CLASSES.map(function (c, i) {
        var d = st.byClass[i].m;
        if (d / total <= 0.002) return '';
        return '<span><i style="background:' + c.color + '"></i>' + c.label +
          ' <b>' + fmtKm(d) + '</b></span>';
      }).join('') + '</div>';
    }

    var src = m.hadEle ? 'elevation from the file'
                       : 'elevation sampled from SRTM (file had none)';
    if (m.uncovered && !noEle) src += ' · ' + m.uncovered + ' points outside coverage';

    return '<div class="gpx-item' + (r.visible ? '' : ' off') +
      '" style="border-left-color:' + r.color + '">' +
      '<div class="hd"><span class="nm" data-zoom="' + r.id + '" title="Zoom to track">' +
        app.esc(r.name) + '</span>' +
      '<button data-profile="' + r.id + '" title="Show elevation profile">◠</button>' +
      '<button data-toggle="' + r.id + '" title="Show / hide">' + (r.visible ? '◉' : '○') + '</button>' +
      '<button data-remove="' + r.id + '" title="Remove">✕</button></div>' +
      head +
      '<div class="gpx-scrub">' +
        '<input type="range" min="0" max="1000" value="0" data-scrub="' + r.id + '" ' +
          'aria-label="Position along ' + app.esc(r.name) + '">' +
        '<div class="gpx-scrubout" id="gpx-scrubout-' + r.id + '">' +
          'Drag to walk the route' + '</div>' +
      '</div>' +
      bar + legend + detail +
      '<div class="gpx-src">' + src + '</div>' +
      (r.sample ? '<div class="gpx-cred">Sample route · ' + app.esc(r.sample.author || '') +
        (r.sample.source ? ' · <a href="' + app.esc(r.sample.source) +
          '" target="_blank" rel="noopener">source</a>' : '') + '</div>' : '') +
      '</div>';
  }).join('');
}

function readFiles(files) {
  errEl.textContent = '';
  Array.prototype.slice.call(files).forEach(function (f) {
    if (!/\.gpx$/i.test(f.name)) {
      errEl.textContent = f.name + ' is not a .gpx file';
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      try {
        addTrack(parseGPX(String(fr.result)), f.name);
      } catch (e) {
        errEl.textContent = f.name + ': ' + e.message;
      }
    };
    fr.onerror = function () { errEl.textContent = 'could not read ' + f.name; };
    fr.readAsText(f);
  });
}

/**
 * Load the bundled example tour. Goes through parseGPX like any other file, so
 * the sample exercises the real import path rather than a shortcut — if import
 * breaks, the sample breaks too, visibly.
 */
function loadSample() {
  if (!window.TM_SAMPLE_GPX) return null;
  try {
    pendingSample = window.TM_SAMPLE_GPX_META || {};
    var rec = addTrack(parseGPX(window.TM_SAMPLE_GPX), 'sample.gpx');
    sampleLoaded = true;
    updateSampleLink();
    return rec;
  } catch (e) {
    pendingSample = null;
    if (errEl) errEl.textContent = 'sample tour failed to load: ' + e.message;
    return null;
  }
}

function updateSampleLink() {
  var b = document.getElementById('gpx-sample');
  if (!b) return;
  var present = list.some(function (r) { return r.sample; });
  b.style.display = present ? 'none' : '';
}

function buildUI() {
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var sec = document.createElement('section');
  sec.className = 'block';
  sec.innerHTML =
    '<h2>Import GPX</h2>' +
    '<div class="gpx-drop" id="gpx-drop"><b>Choose a .gpx file</b>' +
    'or drag one onto the map</div>' +
    '<input type="file" id="gpx-file" accept=".gpx,application/gpx+xml" multiple hidden>' +
    '<div class="gpx-err" id="gpx-err"></div>' +
    '<button class="gpx-sample" id="gpx-sample">Load the example tour</button>' +
    '<div id="gpx-list"></div>';

  var panel = document.querySelector('.panel');
  var layersBlock = panel.querySelector('#layer-toggles');
  panel.insertBefore(sec, layersBlock ? layersBlock.closest('.block') : null);

  listEl = sec.querySelector('#gpx-list');
  errEl = sec.querySelector('#gpx-err');
  var input = sec.querySelector('#gpx-file');
  var drop = sec.querySelector('#gpx-drop');

  drop.addEventListener('click', function () { input.click(); });
  sec.querySelector('#gpx-sample').addEventListener('click', function () { loadSample(); });
  input.addEventListener('change', function () { readFiles(input.files); input.value = ''; });

  // Scrubbing is by distance, not by point index: half way along the slider
  // should mean half the kilometres, and points are not evenly spaced.
  listEl.addEventListener('input', function (ev) {
    var sl = ev.target.closest('[data-scrub]');
    if (!sl) return;
    var r = list.find(function (x) { return x.id === +sl.dataset.scrub; });
    if (!r) return;
    var total = r.m.dist[r.m.n - 1] || 1;
    var i = indexAtDistance(r.m, (sl.value / 1000) * total);
    showAt(r, i);
    writeScrubOut(r, i);
  });

  listEl.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-zoom],[data-remove],[data-toggle],[data-profile]');
    if (!t) return;
    if (t.dataset.remove) removeTrack(+t.dataset.remove);
    else if (t.dataset.toggle) toggleTrack(+t.dataset.toggle);
    else if (t.dataset.profile) profileTrack(+t.dataset.profile);
    else if (t.dataset.zoom) {
      var r = list.find(function (x) { return x.id === +t.dataset.zoom; });
      if (r) app.fit(r.bounds, 40);
    }
  });

  // Drag a file anywhere onto the map.
  var mapEl = document.getElementById('map');
  ['dragenter', 'dragover'].forEach(function (e) {
    mapEl.addEventListener(e, function (ev) {
      ev.preventDefault(); ev.stopPropagation(); drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (e) {
    mapEl.addEventListener(e, function (ev) {
      ev.preventDefault(); ev.stopPropagation(); drop.classList.remove('over');
    });
  });
  mapEl.addEventListener('drop', function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files.length) readFiles(ev.dataTransfer.files);
  });
}

return {
  init: function (a) {
    app = a;
    buildUI();
    app.map.on('mousemove', hoverProbe);
    app.map.on('mouseout', function () { hideProbe(); });

    // Deferred so a large sample never delays first paint of the map.
    if (window.TM_SAMPLE_GPX) setTimeout(loadSample, 250);
  },
  loadSample: loadSample,
  // exposed for tests
  _parse: parseGPX,
  _load: function (str, name) { return addTrack(parseGPX(str), name || 'test.gpx'); },
  _list: function () { return list; },
  _showAt: showAt,
  _hideProbe: hideProbe,
  _indexAtDistance: indexAtDistance,
  _hoverProbe: hoverProbe,
  _hoverPx: function () { return HOVER_PX; }
};

})();
