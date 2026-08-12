/* TrekkingMap — search.
 *
 * Searches the bundled OSM data first: huts, summits, passes, named springs,
 * Alta Via stages and waymarked trails — around 5,000 named features, matched
 * locally so results appear instantly and work with no connection.
 *
 * Place names that are not in our data (towns, hamlets, addresses) are only
 * looked up remotely, on explicit request, via Nominatim.
 */

window.TMSearch = (function () {
'use strict';

var app, index = null, results = [], sel = -1, lastRemote = 0;

/* Ranking weight by kind. A rifugio called "Antola" should outrank the mountain
   of the same name, because someone typing it is usually planning to sleep. */
var KIND = {
  rifugio:       { w: 60, icon: '⌂', label: 'Rifugio' },
  unstaffed_hut: { w: 52, icon: '⌂', label: 'Unstaffed hut' },
  bivacco:       { w: 48, icon: '⌂', label: 'Bivacco' },
  hostel:        { w: 42, icon: '⌂', label: 'Hostel' },
  chalet:        { w: 38, icon: '⌂', label: 'Chalet' },
  shelter:       { w: 20, icon: '⌂', label: 'Shelter' },
  stage:         { w: 56, icon: '▬', label: 'Alta Via stage' },
  trail:         { w: 44, icon: '▬', label: 'Trail' },
  peak:          { w: 34, icon: '▲', label: 'Summit' },
  saddle:        { w: 28, icon: '⋀', label: 'Pass' },
  water:         { w: 12, icon: '◦', label: 'Water' },
  place:         { w: 30, icon: '◉', label: 'Place' }
};

var CSS = [
  '.tm-search{position:relative}',
  '.tm-search input{width:100%;padding:9px 30px 9px 30px;font:inherit;font-size:13px;',
  '  border:1px solid var(--line);border-radius:8px;background:#fff url("data:image/svg+xml;utf8,',
  '<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\'>',
  '<g fill=\'none\' stroke=\'%236b6154\' stroke-width=\'1.8\'><circle cx=\'7\' cy=\'7\' r=\'5\'/>',
  '<path d=\'M11 11l4 4\' stroke-linecap=\'round\'/></g></svg>") 8px center no-repeat}',
  '.tm-search input:focus{outline:none;border-color:var(--pine-2);box-shadow:0 0 0 3px rgba(47,93,70,.12)}',
  '.tm-search .clr{position:absolute;right:8px;top:9px;border:none;background:none;cursor:pointer;',
  '  color:var(--ink-soft);font-size:14px;line-height:1;display:none}',
  '.tm-search.has .clr{display:block}',
  '.tm-res{position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:1200;',
  '  background:#fffdf8;border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);',
  '  max-height:340px;overflow-y:auto;display:none}',
  '.tm-res.open{display:block}',
  '.tm-res .row{display:flex;align-items:center;gap:9px;padding:7px 10px;cursor:pointer;',
  '  border-bottom:1px solid #f0e9db}',
  '.tm-res .row:last-child{border-bottom:none}',
  '.tm-res .row:hover,.tm-res .row.on{background:#f2f8f4}',
  '.tm-res .ic{flex:0 0 20px;text-align:center;font-size:13px;color:var(--pine)}',
  '.tm-res .tx{flex:1;min-width:0}',
  '.tm-res .t1{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.tm-res .t1 mark{background:#f5e6b8;color:inherit;border-radius:2px;padding:0 1px}',
  '.tm-res .t2{font-size:11px;color:var(--ink-soft)}',
  '.tm-res .el{font-size:11px;color:var(--ink-soft);font-variant-numeric:tabular-nums}',
  '.tm-res .none{padding:10px;font-size:12px;color:var(--ink-soft);text-align:center}',
  '.tm-res .web{padding:8px 10px;font-size:12px;color:var(--sky);cursor:pointer;text-align:center;',
  '  border-top:1px solid var(--line);background:#fbf7ec}',
  '.tm-res .web:hover{background:#f2f8f4}'
].join('');

// ------------------------------------------------------------------ indexing

/** Strip accents so "Perdio" finds "Pèrdio" and vice versa. */
function norm(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function centroid(geom) {
  if (geom.type === 'Point') return [geom.coordinates[1], geom.coordinates[0]];
  var lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
  var flat = [];
  lines.forEach(function (l) { l.forEach(function (c) { flat.push(c); }); });
  if (!flat.length) return null;
  var mid = flat[Math.floor(flat.length / 2)];
  return [mid[1], mid[0]];
}

function bboxOf(geom) {
  var lines = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
  var s = 90, w = 180, n = -90, e = -180;
  lines.forEach(function (l) {
    l.forEach(function (c) {
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
    });
  });
  return [[s, w], [n, e]];
}

/* Built on first keystroke rather than at boot: it walks ~10,000 features and
   there is no reason to pay for that before anyone searches. */
function build() {
  if (index) return index;
  index = [];

  function add(name, kind, latlng, extra) {
    if (!name || !latlng) return;
    index.push({
      name: name, n: norm(name), kind: kind,
      lat: latlng[0], lon: latlng[1],
      ele: extra && extra.ele, sub: extra && extra.sub,
      feature: extra && extra.feature, bounds: extra && extra.bounds
    });
  }

  /**
   * Index alternate names as their own entries, displayed under the primary
   * name. Liguria's border summits are often mapped only in French — the
   * highest peak in the region is name="Mont Saccarel" — so without this,
   * searching "Saccarello" finds nothing at all.
   */
  function addAlts(f, kind, latlng, extra) {
    var alt = f.properties.alt;
    if (!alt || !latlng) return;
    alt.forEach(function (a) {
      index.push({
        name: a, n: norm(a), kind: kind,
        lat: latlng[0], lon: latlng[1],
        ele: extra && extra.ele,
        sub: 'also “' + f.properties.name + '”',
        feature: extra && extra.feature
      });
    });
  }

  (window.TM_HUTS ? TM_HUTS.features : []).forEach(function (f) {
    var p = f.properties, c = centroid(f.geometry);
    var extra = {
      ele: p.ele, feature: f,
      sub: (KIND[p.category] || KIND.shelter).label + (p.capacity ? ' · ' + p.capacity + ' beds' : '')
    };
    add(p.name, p.category || 'shelter', c, extra);
    addAlts(f, p.category || 'shelter', c, extra);
  });

  (window.TM_PEAKS ? TM_PEAKS.features : []).forEach(function (f) {
    var p = f.properties, c = centroid(f.geometry);
    var kind = p.natural === 'saddle' ? 'saddle' : 'peak';
    add(p.name, kind, c, { ele: p.ele });
    addAlts(f, kind, c, { ele: p.ele });
  });

  (window.TM_WATER ? TM_WATER.features : []).forEach(function (f) {
    if (f.properties.name) add(f.properties.name, 'water', centroid(f.geometry), {});
  });

  (window.TM_AVML ? TM_AVML.features : []).forEach(function (f) {
    var p = f.properties;
    add(p.name, 'stage', centroid(f.geometry), {
      sub: 'Alta Via ' + (p.ref || ''), bounds: bboxOf(f.geometry)
    });
    if (p.ref) add(p.ref + ' — ' + (p.name || ''), 'stage', centroid(f.geometry), {
      sub: 'Alta Via stage', bounds: bboxOf(f.geometry)
    });
  });

  (window.TM_ROUTES ? TM_ROUTES.features : []).forEach(function (f) {
    var p = f.properties;
    add(p.name, 'trail', centroid(f.geometry), {
      sub: 'Waymarked trail' + (p.ref ? ' · ' + p.ref : ''), bounds: bboxOf(f.geometry)
    });
  });

  return index;
}

// ------------------------------------------------------------------ matching

function score(entry, q) {
  var n = entry.n, i = n.indexOf(q);
  if (i < 0) return 0;
  var base;
  if (n === q) base = 1000;
  else if (i === 0) base = 600;
  else if (/[\s'\-·]/.test(n.charAt(i - 1))) base = 400;   // start of a word
  else base = 150;
  // Prefer tighter matches: "Antola" should beat "Monte Antola Nord Ovest".
  base += Math.max(0, 60 - (n.length - q.length));
  return base + (KIND[entry.kind] ? KIND[entry.kind].w : 0);
}

function search(query, limit) {
  var q = norm(query.trim());
  if (q.length < 2) return [];
  var idx = build(), out = [];
  for (var i = 0; i < idx.length; i++) {
    var s = score(idx[i], q);
    if (s > 0) out.push({ e: idx[i], s: s });
  }
  out.sort(function (a, b) { return b.s - a.s || a.e.name.length - b.e.name.length; });

  // Collapse duplicates: the same summit is often mapped more than once.
  var seen = {}, res = [];
  for (i = 0; i < out.length && res.length < (limit || 12); i++) {
    var k = out[i].e.n + '|' + out[i].e.kind;
    if (seen[k]) continue;
    seen[k] = 1;
    res.push(out[i].e);
  }
  return res;
}

// ------------------------------------------------------------------ remote

/**
 * Nominatim, only when the user explicitly asks — it is a shared free service
 * with a strict usage policy, so it must never be called per keystroke.
 */
function remote(query, cb) {
  var now = Date.now();
  if (now - lastRemote < 1200) { cb(null, 'please wait a moment'); return; }
  lastRemote = now;
  var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8' +
    '&viewbox=7.2,44.9,10.4,43.6&bounded=0&q=' + encodeURIComponent(query);
  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (rows) {
      cb(rows.map(function (r) {
        return {
          name: r.display_name.split(',')[0], n: norm(r.display_name),
          kind: 'place', lat: +r.lat, lon: +r.lon,
          sub: r.display_name.split(',').slice(1, 3).join(',').trim(),
          bounds: r.boundingbox && [[+r.boundingbox[0], +r.boundingbox[2]],
                                    [+r.boundingbox[1], +r.boundingbox[3]]]
        };
      }));
    })
    .catch(function (e) { cb(null, 'lookup failed (' + e.message + ')'); });
}

// ------------------------------------------------------------------ UI

var input, box, wrap;

function highlight(name, q) {
  var i = norm(name).indexOf(norm(q));
  if (i < 0) return app.esc(name);
  return app.esc(name.slice(0, i)) + '<mark>' + app.esc(name.slice(i, i + q.length)) +
         '</mark>' + app.esc(name.slice(i + q.length));
}

function draw(q, remoteRows, note) {
  var rows = results.map(function (e, i) {
    var k = KIND[e.kind] || KIND.place;
    return '<div class="row' + (i === sel ? ' on' : '') + '" data-i="' + i + '">' +
      '<span class="ic">' + k.icon + '</span><span class="tx">' +
      '<span class="t1">' + highlight(e.name, q) + '</span>' +
      '<span class="t2">' + app.esc(e.sub || k.label) + '</span></span>' +
      (e.ele ? '<span class="el">' + app.esc(e.ele) + ' m</span>' : '') + '</div>';
  }).join('');

  if (!rows) rows = '<div class="none">' + (note || 'Nothing in the local data') + '</div>';
  else if (note) rows += '<div class="none">' + app.esc(note) + '</div>';

  if (!remoteRows) {
    rows += '<div class="web" data-web="1">Search OpenStreetMap for “' + app.esc(q) + '”…</div>';
  }
  box.innerHTML = rows;
  box.classList.add('open');
}

function choose(i) {
  var e = results[i];
  if (!e) return;
  close();
  input.value = e.name;
  wrap.classList.add('has');

  if (e.bounds) {
    app.fit(e.bounds, 40);
  } else {
    app.focus(e.lat, e.lon, 15);
  }

  var html = e.feature
    ? app.hutPopup(e.feature)
    : '<div class="pop"><span class="cat">' + app.esc((KIND[e.kind] || KIND.place).label) +
      '</span><h4>' + app.esc(e.name) + '</h4>' +
      (e.ele ? '<table><tr><td>Elevation</td><td>' + app.esc(e.ele) + ' m</td></tr></table>' : '') +
      (e.sub ? '<div style="font-size:11px;color:#6b6154;margin-top:4px">' +
        app.esc(e.sub) + '</div>' : '') + '</div>';
  L.popup({ autoPan: true }).setLatLng([e.lat, e.lon]).setContent(html).openOn(app.map);
}

function close() { box.classList.remove('open'); sel = -1; }

function run() {
  var q = input.value.trim();
  wrap.classList.toggle('has', !!q);
  if (q.length < 2) { close(); return; }
  results = search(q, 12);
  sel = -1;
  draw(q, false);
}

function buildUI() {
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var sec = document.createElement('section');
  sec.className = 'block';
  sec.innerHTML = '<h2>Find a place</h2>' +
    '<div class="tm-search" id="tm-search">' +
    '<input type="search" id="tm-q" placeholder="Rifugio, summit, pass, trail…" ' +
    'autocomplete="off" spellcheck="false" aria-label="Search the map">' +
    '<button class="clr" id="tm-clr" title="Clear" aria-label="Clear search">✕</button>' +
    '<div class="tm-res" id="tm-res" role="listbox"></div></div>';

  var panel = document.querySelector('.panel');
  panel.insertBefore(sec, panel.firstChild);

  wrap = sec.querySelector('#tm-search');
  input = sec.querySelector('#tm-q');
  box = sec.querySelector('#tm-res');

  var t = null;
  input.addEventListener('input', function () {
    clearTimeout(t);
    t = setTimeout(run, 110);
  });
  input.addEventListener('focus', function () { if (results.length) box.classList.add('open'); });

  sec.querySelector('#tm-clr').addEventListener('click', function () {
    input.value = ''; wrap.classList.remove('has'); close(); input.focus();
  });

  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { close(); input.blur(); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(sel >= 0 ? sel : 0);
      return;
    }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    if (!results.length) return;
    sel += ev.key === 'ArrowDown' ? 1 : -1;
    if (sel < 0) sel = results.length - 1;
    if (sel >= results.length) sel = 0;
    draw(input.value.trim(), true);
    var on = box.querySelector('.row.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  });

  box.addEventListener('click', function (ev) {
    var web = ev.target.closest('[data-web]');
    if (web) {
      var q = input.value.trim();
      web.textContent = 'Searching OpenStreetMap…';
      remote(q, function (rows, err) {
        if (err || !rows) { draw(q, true, err || 'no remote results'); return; }
        results = results.concat(rows);
        draw(q, true, rows.length ? null : 'no remote results');
      });
      return;
    }
    var row = ev.target.closest('[data-i]');
    if (row) choose(+row.dataset.i);
  });

  document.addEventListener('click', function (ev) {
    if (!wrap.contains(ev.target)) close();
  });

  // "/" focuses search, the way it works in most map and code tools.
  document.addEventListener('keydown', function (ev) {
    if (ev.key === '/' && document.activeElement !== input &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      ev.preventDefault(); input.focus();
    }
  });
}

return {
  init: function (a) { app = a; buildUI(); },
  _search: search,
  _index: function () { return build(); }
};

})();
