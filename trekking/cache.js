/* TrekkingMap — progressive hut loading with an offline cache.
 *
 * The bundled data covers Liguria only, so panning anywhere else showed a bare
 * rectangle of huts surrounded by nothing. This module fills the rest in as you
 * move, and remembers what it fetched.
 *
 * Two constraints shape the whole design, both verified rather than assumed:
 *
 *  1. On file:// a cross-origin fetch() is blocked outright, even though
 *     Overpass sends Access-Control-Allow-Origin: *. Script injection is not,
 *     and Overpass supports JSONP (`&jsonp=name` wraps the reply in a call).
 *     So every request here goes out as a <script>, never fetch().
 *  2. IndexedDB *does* work on file://, so the cache survives a reload.
 *
 * Requests are deliberately conservative: Overpass is a shared, free service.
 * One request in flight at a time, a minimum gap between them, a zoom floor,
 * and a cap on how much area one view may request.
 */

window.TMCache = (function () {
'use strict';

var app;

// Cell size is a request-count decision, not a data-size one. Huts are sparse
// (all of Liguria, 2.65 x 0.95 degrees, is 666 of them in a single query), so a
// big cell costs little. At 0.5 deg a zoom-10 viewport needed 21 separate
// Overpass calls; at 1 deg the same view needs six.
var CELL = 1.0;                 // degrees; ~110 x 79 km at this latitude
var MIN_ZOOM = 8;               // below this a viewport spans absurd area
var MAX_CELLS_PER_VIEW = 9;     // refuse to carpet-bomb Overpass from far out
// Overpass is a free, shared service with a usage policy that asks for
// moderate use. A tighter gap got this client connection-refused during
// testing; three seconds keeps a normal panning session well inside it.
var MIN_GAP_MS = 3000;          // politeness gap between requests
var REQ_TIMEOUT = 45000;
var DB_NAME = 'trekkingmap';
var STORE = 'regions';

var MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

var db = null, dbOpening = null;
var loaded = {};                // cellKey -> true once its huts are on the map
var queue = [], busy = false, lastReq = 0, mirror = 0;
var seenIds = {};               // OSM id -> true, so overlaps never double-draw
var layerGroup, statusEl, added = 0, failures = 0, jsonpSeq = 0;

var CSS = [
  '.tmc{display:flex;align-items:center;gap:7px;margin:0 10px 6px 0;padding:5px 9px;',
  '  font-size:11.5px;font-weight:600;background:rgba(255,253,248,.95);',
  '  border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow);color:var(--ink-soft)}',
  '.tmc .d{width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:var(--pine)}',
  '.tmc.busy .d{background:#d8a13c;animation:tmpulse 1s infinite}',
  '.tmc.hint .d{background:#9aa5ad}',
  '.tmc.bad .d{background:var(--blaze)}',
  '.tmc button{font:inherit;font-size:11px;font-weight:700;padding:2px 8px;margin-left:2px;',
  '  border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--pine);cursor:pointer}',
  '.tmc button:hover{background:#f2f8f4}',
  '.tmc-row{display:flex;justify-content:space-between;align-items:baseline;',
  '  font-size:12px;padding:3px 0;color:var(--ink-soft)}',
  '.tmc-row b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:650}',
  '.tmc-meter{height:6px;border-radius:3px;background:var(--paper-2);overflow:hidden;margin:7px 0 5px}',
  '.tmc-meter i{display:block;height:100%;background:var(--pine);border-radius:3px}',
  '.tmc-note{font-size:10.5px;line-height:1.45;color:var(--ink-soft);margin-top:4px}',
  '.tmc-btns{display:flex;gap:6px;margin-top:9px}',
  '.tmc-btns .btn{flex:1;padding:6px 8px;font-size:12px}'
].join('');

// ---------------------------------------------------------------- grid

function cellKey(ci, cj) { return ci + '_' + cj; }
function cellIndex(lat, lon) {
  return [Math.floor(lat / CELL), Math.floor(lon / CELL)];
}

function cellsInBounds(b) {
  var a = cellIndex(b.getSouth(), b.getWest());
  var c = cellIndex(b.getNorth(), b.getEast());
  var out = [];
  for (var i = a[0]; i <= c[0]; i++) {
    for (var j = a[1]; j <= c[1]; j++) out.push([i, j]);
  }
  return out;
}

function cellBBox(ci, cj) {
  // Overpass wants south,west,north,east. A hair of overlap avoids a hut
  // exactly on a boundary being missed by both neighbours.
  var pad = 0.002;
  return [(ci * CELL) - pad, (cj * CELL) - pad,
          ((ci + 1) * CELL) + pad, ((cj + 1) * CELL) + pad];
}

/** Mark the cells already covered by the bundled Liguria data as done. */
function seedFromBundled() {
  if (!window.TM_HUTS) return;
  window.TM_HUTS.features.forEach(function (f) {
    if (f.properties.id) seenIds[f.properties.id] = true;
  });
  var d = window.TM_DEM;
  if (!d) return;
  var a = cellIndex(d.south, d.west), c = cellIndex(d.north, d.east);
  for (var i = a[0]; i <= c[0]; i++) {
    for (var j = a[1]; j <= c[1]; j++) loaded[cellKey(i, j)] = 'bundled';
  }
}

// ---------------------------------------------------------------- storage

/**
 * Open once, and let everyone wait on the same promise.
 *
 * The queue used to start pumping while the open was still in flight, so
 * idbGet() saw a null handle, reported a miss, and re-downloaded a region that
 * was already on disk — defeating the cache on precisely the page load where it
 * matters. Nothing may hit the network until this has settled either way.
 */
function ensureDB() {
  if (!dbOpening) {
    dbOpening = openDB().then(function (d) { db = d; return d; });
  }
  return dbOpening;
}

function openDB() {
  return new Promise(function (res) {
    var rq;
    try { rq = indexedDB.open(DB_NAME, 1); } catch (e) { return res(null); }
    rq.onupgradeneeded = function () {
      if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE);
    };
    rq.onsuccess = function () { res(rq.result); };
    rq.onerror = function () { res(null); };
    setTimeout(function () { res(null); }, 4000);   // never block boot on storage
  });
}

function idbGet(key) {
  return new Promise(function (res) {
    if (!db) return res(null);
    try {
      var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      rq.onsuccess = function () { res(rq.result || null); };
      rq.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}

function idbPut(key, val) {
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key); }
  catch (e) { /* a full or unavailable store must not break the map */ }
}

function idbCount() {
  return new Promise(function (res) {
    if (!db) return res(0);
    try {
      var rq = db.transaction(STORE, 'readonly').objectStore(STORE).count();
      rq.onsuccess = function () { res(rq.result || 0); };
      rq.onerror = function () { res(0); };
    } catch (e) { res(0); }
  });
}

/**
 * Total bytes our own regions occupy, measured rather than estimated.
 *
 * navigator.storage.estimate() reports the whole origin — bundled data, tiles,
 * everything — so it cannot answer "how much is the hut cache costing me".
 * This walks the store and weighs the records.
 */
function idbSize() {
  return new Promise(function (res) {
    if (!db) return res({ bytes: 0, cells: 0 });
    try {
      var st = db.transaction(STORE, 'readonly').objectStore(STORE);
      var rq = st.getAll();
      rq.onsuccess = function () {
        var rows = rq.result || [], bytes = 0, huts = 0;
        rows.forEach(function (r) {
          bytes += new Blob([JSON.stringify(r)]).size;
          huts += (r.f || []).length;
        });
        res({ bytes: bytes, cells: rows.length, huts: huts });
      };
      rq.onerror = function () { res({ bytes: 0, cells: 0, huts: 0 }); };
    } catch (e) { res({ bytes: 0, cells: 0, huts: 0 }); }
  });
}

/** What the browser will let us keep, and whether it may be evicted. */
function quota() {
  if (!navigator.storage || !navigator.storage.estimate) {
    return Promise.resolve(null);
  }
  return navigator.storage.estimate().then(function (e) {
    return { quota: e.quota || 0, usage: e.usage || 0 };
  }).catch(function () { return null; });
}

function idbClear() {
  return new Promise(function (res) {
    if (!db) return res();
    try {
      var rq = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      rq.onsuccess = function () { res(); };
      rq.onerror = function () { res(); };
    } catch (e) { res(); }
  });
}

// ---------------------------------------------------------------- fetching

/**
 * Overpass over JSONP. A <script> tag is the only cross-origin channel
 * available when the page itself was opened from disk.
 */
function overpassJSONP(query) {
  return new Promise(function (resolve, reject) {
    var name = '__tmjp' + (++jsonpSeq);
    var url = MIRRORS[mirror % MIRRORS.length] +
      '?data=' + encodeURIComponent(query) + '&jsonp=' + name;
    var script = document.createElement('script');
    var timer = setTimeout(function () { finish(new Error('timeout')); }, REQ_TIMEOUT);

    function finish(err, data) {
      clearTimeout(timer);
      try { delete window[name]; } catch (e) { window[name] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      err ? reject(err) : resolve(data);
    }
    window[name] = function (data) { finish(null, data); };
    script.onerror = function () { finish(new Error('network')); };
    script.src = url;
    document.head.appendChild(script);
  });
}

function hutQuery(bb) {
  var b = bb.join(',');
  return '[out:json][timeout:60];(' +
    'nwr["tourism"="alpine_hut"](' + b + ');' +
    'nwr["tourism"="wilderness_hut"](' + b + ');' +
    'nwr["tourism"="hostel"](' + b + ');' +
    'nwr["amenity"="shelter"]["shelter_type"!="public_transport"](' + b + ');' +
    'nwr["name"~"^[Rr]ifugio|^[Bb]ivacco|^[Cc]apanna|^[Oo]stello"](' + b + ');' +
    ');out center tags;';
}

// ---------------------------------------------------------------- classify
// Mirrors scripts/fetch_osm.py so a hut fetched live is categorised exactly as
// a bundled one. Kept deliberately close to that file; change both together.

var NOT_A_HUT = ['antiaere', 'pericolant', 'antiatomic'];
var CLOSED = { 'private': 1, 'no': 1, 'permit': 1, 'customers': 1, 'members': 1 };

function classify(t) {
  var name = t.name || '', low = name.toLowerCase();
  for (var i = 0; i < NOT_A_HUT.length; i++) if (low.indexOf(NOT_A_HUT[i]) >= 0) return 'ruin';
  if (t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut' || low.indexOf('rifugio') === 0) {
    return (t.tourism === 'wilderness_hut' || low.indexOf('non gestit') >= 0)
      ? 'unstaffed_hut' : 'rifugio';
  }
  if (low.indexOf('bivacco') === 0 || low.indexOf('capanna') === 0) return 'bivacco';
  if (t.tourism === 'hostel' || low.indexOf('ostello') === 0) return 'hostel';
  if (t.tourism === 'chalet') return 'chalet';
  if (t.amenity === 'shelter') return 'shelter';
  return 'other';
}

var SLEEPABLE = { rifugio: 1, unstaffed_hut: 1, bivacco: 1, hostel: 1 };

function toFeatures(data) {
  var out = [];
  (data.elements || []).forEach(function (el) {
    var lat = el.lat, lon = el.lon;
    if (lat === undefined && el.center) { lat = el.center.lat; lon = el.center.lon; }
    if (lat === undefined) return;
    var t = el.tags || {};
    var id = el.type + '/' + el.id;
    var cat = classify(t);
    if ((cat === 'other' || cat === 'ruin') && !t.name) return;
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+lon.toFixed(6), +lat.toFixed(6)] },
      properties: {
        id: id, name: t.name || null, ele: t.ele || null, category: cat,
        sleeps: !!SLEEPABLE[cat] && !CLOSED[(t.access || '').toLowerCase()],
        capacity: t.capacity || t.beds || null,
        phone: t.phone || t['contact:phone'] || null,
        website: t.website || t['contact:website'] || null,
        operator: t.operator || null, access: t.access || null,
        seasonal: t.seasonal || null
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------- drawing

function drawFeatures(feats) {
  var style = app.catStyle;
  var n = 0;
  feats.forEach(function (f) {
    var id = f.properties.id;
    if (id && seenIds[id]) return;           // bundled data or a neighbour cell
    if (id) seenIds[id] = true;
    var st = style[f.properties.category] || style.other;
    var c = f.geometry.coordinates;
    L.circleMarker([c[1], c[0]], {
      renderer: app.canvas, radius: st.r,
      color: '#fff', weight: 1.2, fillColor: st.color, fillOpacity: .95
    }).bindPopup(app.hutPopup(f)).addTo(layerGroup);
    n++;
  });
  added += n;
  if (n) refreshPanel();          // keep the size readout live as regions arrive
  return n;
}

// ---------------------------------------------------------------- pump

/**
 * Resolve everything the local cache can answer FIRST, then queue only the rest
 * for the network.
 *
 * Cached regions used to be discovered inside the request queue, which meant a
 * region already sitting on disk waited behind slow or rate-limited Overpass
 * calls for other cells — so a reload showed nothing for tens of seconds despite
 * having the data locally. Reading storage is cheap and cannot fail slowly;
 * there is no reason for it to queue behind anything.
 */
function enqueue(cells) {
  var fresh = cells.filter(function (c) {
    var k = cellKey(c[0], c[1]);
    if (loaded[k]) return false;
    for (var i = 0; i < queue.length; i++) if (queue[i].k === k) return false;
    return true;
  });
  if (!fresh.length) { status(); return; }

  ensureDB().then(function () {
    var misses = [];
    var chain = Promise.resolve();
    fresh.forEach(function (c) {
      var k = cellKey(c[0], c[1]);
      chain = chain.then(function () {
        if (loaded[k]) return;
        return idbGet(k).then(function (hit) {
          if (hit && hit.f) {
            loaded[k] = 'cache';
            drawFeatures(hit.f);
          } else {
            misses.push({ k: k, ci: c[0], cj: c[1] });
          }
        });
      });
    });
    return chain.then(function () {
      queue = queue.concat(misses);
      status();
      pump();
    });
  });
}

function pump() {
  if (busy || !queue.length) { status(); return; }
  busy = true;
  status();
  ensureDB().then(function () {
    var wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastReq));
    setTimeout(function () { runNext(); }, wait);
  });
}

function runNext() {
  var job = queue.shift();
  if (!job) { busy = false; status(); return; }
  lastReq = Date.now();

  overpassJSONP(hutQuery(cellBBox(job.ci, job.cj)))
    .then(function (data) {
      var feats = toFeatures(data);
      loaded[job.k] = 'net';
      idbPut(job.k, { f: feats, t: Date.now() });
      drawFeatures(feats);
      failures = 0;
      busy = false; status(); pump();
    })
    .catch(function () {
      failures++;
      mirror++;                               // try the other instance next time
      busy = false;
      // Back off hard rather than hammering a struggling public service.
      lastReq = Date.now() + Math.min(failures * 4000, 20000);
      status();
      if (failures < 4) { queue.push(job); }
      pump();
    });
}

// ---------------------------------------------------------------- viewport

var moveTimer = null;

function onMove() {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(scan, 450);
}

function scan() {
  var map = app.map;
  var z = map.getZoom();
  if (z < MIN_ZOOM) { status('zoom'); return; }
  var cells = cellsInBounds(map.getBounds());
  var missing = cells.filter(function (c) { return !loaded[cellKey(c[0], c[1])]; });
  if (!missing.length) { status(); return; }
  if (missing.length > MAX_CELLS_PER_VIEW) { status('wide', missing.length); return; }
  enqueue(missing);
}

// ---------------------------------------------------------------- status

function status(mode, n) {
  if (!statusEl) return;
  var cls = 'tmc', txt = '';
  if (mode === 'zoom') {
    cls += ' hint'; txt = 'Zoom in to load huts here';
  } else if (mode === 'wide') {
    cls += ' hint'; txt = 'Zoom in to load huts (' + n + ' areas in view)';
  } else if (busy || queue.length) {
    cls += ' busy';
    txt = 'Loading huts… ' + (queue.length ? '(' + (queue.length + 1) + ' areas)' : '');
  } else if (failures >= 4) {
    cls += ' bad'; txt = 'Hut download failed — retry';
  } else {
    txt = added ? added + ' huts added nearby' : 'Huts up to date';
  }
  statusEl.className = cls;
  statusEl.querySelector('.t').textContent = txt;
  statusEl.querySelector('button').style.display = failures >= 4 ? '' : 'none';
}

function buildStatus() {
  var Ctl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      var d = L.DomUtil.create('div', 'tmc');
      d.innerHTML = '<span class="d"></span><span class="t"></span>' +
        '<button title="Try the failed downloads again">Retry</button>';
      L.DomEvent.disableClickPropagation(d);
      L.DomEvent.on(d.querySelector('button'), 'click', function (e) {
        L.DomEvent.stop(e); failures = 0; scan();
      });
      statusEl = d;
      return d;
    }
  });
  new Ctl().addTo(app.map);
}

// ---------------------------------------------------------------- storage panel

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

var panelEl;

function refreshPanel() {
  if (!panelEl) return;
  Promise.all([idbSize(), quota()]).then(function (r) {
    var mine = r[0], q = r[1];
    var rows =
      '<div class="tmc-row"><span>Regions cached</span><b>' + mine.cells + '</b></div>' +
      '<div class="tmc-row"><span>Huts stored</span><b>' + mine.huts.toLocaleString() + '</b></div>' +
      '<div class="tmc-row"><span>Space used</span><b>' + fmtBytes(mine.bytes) + '</b></div>';

    if (q && q.quota) {
      var pct = (mine.bytes / q.quota) * 100;
      rows += '<div class="tmc-row"><span>Browser allowance</span><b>' +
        (q.quota / 1073741824).toFixed(1) + ' GB</b></div>' +
        '<div class="tmc-meter"><i style="width:' +
        Math.max(0.4, Math.min(100, pct)).toFixed(2) + '%"></i></div>' +
        '<div class="tmc-note">Using ' + (pct < 0.1 ? 'under 0.1' : pct.toFixed(1)) +
        '% of what this browser allows. At roughly ' +
        fmtBytes(mine.cells ? mine.bytes / mine.cells : 50000) +
        ' per region, there is room for tens of thousands of them.</div>';
    }
    panelEl.querySelector('.tmc-body').innerHTML = rows;
  });
}

function buildPanel() {
  var sec = document.createElement('section');
  sec.className = 'block';
  sec.innerHTML = '<h2>Offline data</h2><div class="tmc-body"></div>' +
    '<div class="tmc-btns">' +
    '<button class="btn ghost" id="tmc-keep" title="Ask the browser not to evict this data">Keep offline</button>' +
    '<button class="btn ghost" id="tmc-clear">Clear cache</button></div>' +
    '<div class="tmc-note" id="tmc-persist"></div>';
  document.querySelector('.panel').appendChild(sec);
  panelEl = sec;

  sec.querySelector('#tmc-clear').addEventListener('click', function () {
    idbClear().then(function () {
      Object.keys(loaded).forEach(function (k) {
        if (loaded[k] !== 'bundled') delete loaded[k];
      });
      layerGroup.clearLayers();
      added = 0;
      status();
      refreshPanel();
    });
  });

  var keep = sec.querySelector('#tmc-keep');
  var note = sec.querySelector('#tmc-persist');
  function showPersist() {
    if (!navigator.storage || !navigator.storage.persisted) {
      note.textContent = ''; keep.style.display = 'none'; return;
    }
    navigator.storage.persisted().then(function (yes) {
      note.textContent = yes
        ? 'Storage is persistent — the browser will not clear it automatically.'
        : 'Storage is best-effort: the browser may clear it if space runs low, ' +
          'or after a long period without visiting.';
      keep.style.display = yes ? 'none' : '';
    });
  }
  keep.addEventListener('click', function () {
    if (!navigator.storage || !navigator.storage.persist) return;
    navigator.storage.persist().then(function () { showPersist(); });
  });
  showPersist();
  refreshPanel();
}

// ---------------------------------------------------------------- init

return {
  init: function (a) {
    app = a;
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    layerGroup = L.layerGroup().addTo(app.map);
    seedFromBundled();
    buildStatus();

    ensureDB().then(function () {
      status();
      buildPanel();
      scan();
    });

    app.map.on('moveend zoomend', onMove);
  },

  // --- exposed for tests -------------------------------------------------
  _cells: cellsInBounds,
  _cellBBox: cellBBox,
  _classify: classify,
  _toFeatures: toFeatures,
  _loaded: function () { return loaded; },
  _queueLen: function () { return queue.length; },
  _added: function () { return added; },
  _scan: scan,
  _cached: idbCount,
  _clear: function () {
    return idbClear().then(function () {
      Object.keys(loaded).forEach(function (k) {
        if (loaded[k] !== 'bundled') delete loaded[k];
      });
      layerGroup.clearLayers();
      added = 0;
      status();
    });
  },
  _storageAvailable: function () { return !!db; },
  _size: idbSize,
  _quota: quota,
  _refreshPanel: refreshPanel,
  _dbReady: function () { return ensureDB().then(function (d) { return !!d; }); },
  _config: { CELL: CELL, MIN_ZOOM: MIN_ZOOM, MAX_CELLS_PER_VIEW: MAX_CELLS_PER_VIEW }
};

})();
