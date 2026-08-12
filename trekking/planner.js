/* TrekkingMap — pure planning maths.
 *
 * Deliberately free of DOM and Leaflet so it can be exercised from Node
 * (see scripts/test_planner.js) as well as the browser.
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TMPlanner = api;
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var R = 6371008.8;                                    // mean Earth radius, m

function haversine(a, b) {
  var la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  var dla = la2 - la1, dlo = (b[0] - a[0]) * Math.PI / 180;
  var h = Math.sin(dla / 2) * Math.sin(dla / 2) +
          Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bilinear sample of the bundled DEM.
 *
 * Returns null — never 0 — when the terrain is unknown, either because the
 * point is outside the grid or because it falls on a nodata cell. Conflating
 * "no data" with "sea level" makes a route across an uncovered area report a
 * confident 0 m of climb, and a route crossing the boundary invent a cliff.
 */
function makeEleSampler(dem) {
  var nodata = (dem && typeof dem.nodata === 'number') ? dem.nodata : null;
  return function (lon, lat) {
    if (!dem) return null;
    var fx = (lon - dem.west) / (dem.east - dem.west) * (dem.cols - 1);
    var fy = (dem.north - lat) / (dem.north - dem.south) * (dem.rows - 1);
    if (!(fx >= 0 && fy >= 0 && fx <= dem.cols - 1 && fy <= dem.rows - 1)) return null;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var x1 = Math.min(x0 + 1, dem.cols - 1), y1 = Math.min(y0 + 1, dem.rows - 1);
    var e = dem.ele;
    var a = e[y0 * dem.cols + x0], b = e[y0 * dem.cols + x1];
    var c = e[y1 * dem.cols + x0], d = e[y1 * dem.cols + x1];
    // Refuse to interpolate across a hole -- averaging a real height with a
    // nodata sentinel would produce a plausible-looking wrong number.
    if (nodata !== null && (a === nodata || b === nodata || c === nodata || d === nodata)) {
      return null;
    }
    var tx = fx - x0, ty = fy - y0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

/** True when the DEM can answer for this point. */
function makeCoverageTest(dem) {
  var sampler = makeEleSampler(dem);
  return function (lon, lat) { return sampler(lon, lat) !== null; };
}

// ------------------------------------------------------ trail reassembly
//
// OSM relation members arrive as a bag of ways whose order and direction are
// not guaranteed. To measure distance along the trail and cut it into days we
// need one continuous, correctly-oriented polyline.

function segLength(s) {
  var t = 0;
  for (var i = 1; i < s.length; i++) t += haversine(s[i - 1], s[i]);
  return t;
}

/**
 * Chain a stage's ways into a single run of coordinates.
 *
 * Grows from BOTH ends of the chain, and keeps going until every way is
 * consumed. An earlier version seeded on an arbitrary way and only appended to
 * the tail; when the seed sat mid-stage it could never reach the ways behind it
 * and silently dropped them — that lost 96 km of the 404 km trail. Bridging an
 * occasional gap is far preferable to discarding a quarter of the route, so
 * gaps wider than `tolM` are joined anyway and reported via `gaps`.
 */
function stitch(lines, tolM) {
  tolM = tolM || 400;
  if (!lines.length) return [];
  var pool = lines.slice();

  // Seed on the longest way so the chain grows outward from the stage's spine.
  var seed = 0, seedLen = -1;
  for (var i = 0; i < pool.length; i++) {
    var L = segLength(pool[i]);
    if (L > seedLen) { seedLen = L; seed = i; }
  }
  var chain = pool.splice(seed, 1)[0].slice();
  var gaps = [];

  while (pool.length) {
    var head = chain[0], tail = chain[chain.length - 1];
    var best = -1, bestD = Infinity, rev = false, end = 'tail';

    for (var j = 0; j < pool.length; j++) {
      var s = pool[j], a = s[0], b = s[s.length - 1];
      var d;
      d = haversine(tail, a); if (d < bestD) { bestD = d; best = j; rev = false; end = 'tail'; }
      d = haversine(tail, b); if (d < bestD) { bestD = d; best = j; rev = true;  end = 'tail'; }
      d = haversine(head, b); if (d < bestD) { bestD = d; best = j; rev = false; end = 'head'; }
      d = haversine(head, a); if (d < bestD) { bestD = d; best = j; rev = true;  end = 'head'; }
    }
    if (best < 0) break;

    var seg = pool.splice(best, 1)[0];
    if (rev) seg = seg.slice().reverse();
    if (bestD > tolM) gaps.push(bestD);

    if (end === 'tail') {
      // seg now starts at the chain's tail
      chain = chain.concat(bestD < 1 ? seg.slice(1) : seg);
    } else {
      // seg now ends at the chain's head
      chain = (bestD < 1 ? seg.slice(0, -1) : seg).concat(chain);
    }
  }
  chain.gaps = gaps;
  return chain;
}

/** Concatenate the ordered stages into one continuous polyline. */
function buildMasterRoute(fc) {
  var stages = fc.features.slice().sort(function (a, b) {
    return (a.properties.stage || 0) - (b.properties.stage || 0);
  });

  var route = [], marks = [];
  stages.forEach(function (f) {
    var run = stitch(f.geometry.coordinates);
    if (run.length < 2) return;
    if (route.length) {
      var end = route[route.length - 1];
      if (haversine(end, run[run.length - 1]) < haversine(end, run[0])) {
        run = run.slice().reverse();
      }
    }
    marks.push({
      index: route.length, ref: f.properties.ref,
      name: f.properties.name, stage: f.properties.stage
    });
    route = route.concat(route.length ? run.slice(1) : run);
  });
  return { coords: route, stages: marks };
}

/**
 * Measure a polyline: distance, elevation, climb and Naismith effort.
 *
 * This is the single implementation. The route builder, the GPX importer and
 * the itinerary planner all call it, because three separate copies drifted by
 * up to 15% on identical geometry and quoted the difference with identical
 * confidence.
 *
 * `smoothWindow` is a declared policy, not a hidden default: recorded GPS
 * traces need smoothing (barometric jitter of a few metres per point inflates
 * total climb badly), while a polyline sampled against the DEM does not.
 *
 * Vertices with unknown elevation are excluded from the climb totals and
 * counted in `uncovered`, so callers can say so instead of implying zero.
 */
function measurePolyline(coords, opts) {
  opts = opts || {};
  var eleAt = opts.eleAt;
  var pace = opts.paceKmh || 4.5;
  var win = opts.smoothWindow || 0;
  var given = opts.ele || null;            // elevations supplied by the source

  var n = coords.length;
  var dist = new Float64Array(n);
  var ele = new Float64Array(n);
  var known = new Uint8Array(n);
  var uncovered = 0, i;

  for (i = 0; i < n; i++) {
    var v = null;
    if (given && given[i] !== null && given[i] !== undefined && isFinite(given[i])) {
      v = given[i];
    } else if (eleAt) {
      v = eleAt(coords[i][0], coords[i][1]);
    }
    if (v === null || v === undefined || isNaN(v)) {
      known[i] = 0; uncovered++;
      ele[i] = NaN;
    } else {
      known[i] = 1; ele[i] = v;
    }
    if (i > 0) dist[i] = dist[i - 1] + haversine(coords[i - 1], coords[i]);
  }

  if (win > 1) ele = smoothKnown(ele, known, win);

  var up = 0, down = 0, hours = 0;
  for (i = 1; i < n; i++) {
    var d = dist[i] - dist[i - 1];
    hours += (d / 1000) / pace;
    // Only count climb where both ends are real measurements.
    if (!known[i] || !known[i - 1]) continue;
    var dz = ele[i] - ele[i - 1];
    if (dz > 0) { up += dz; hours += dz / 600; }
    else { down -= dz; if (d > 0 && dz / d < -0.20) hours += (-dz) / 1800; }
  }

  return {
    dist: dist, ele: ele, eleKnown: known, n: n,
    up: up, down: down, hours: hours,
    uncovered: uncovered,
    covered: n - uncovered,
    fullyCovered: uncovered === 0,
    eff: cumulativeEffort(dist, ele, known, pace)
  };
}

/** Moving average that skips unknown samples rather than averaging through them. */
function smoothKnown(ele, known, win) {
  var n = ele.length;
  if (n < win * 2) return ele;
  var out = new Float64Array(n), half = win >> 1;
  for (var i = 0; i < n; i++) {
    if (!known[i]) { out[i] = NaN; continue; }
    var sum = 0, cnt = 0;
    for (var j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      if (known[j]) { sum += ele[j]; cnt++; }
    }
    out[i] = cnt ? sum / cnt : NaN;
  }
  return out;
}

function cumulativeEffort(dist, ele, known, pace) {
  var n = dist.length, eff = new Float64Array(n);
  for (var i = 1; i < n; i++) {
    var d = dist[i] - dist[i - 1];
    var h = (d / 1000) / pace;
    if (known[i] && known[i - 1]) {
      var dz = ele[i] - ele[i - 1];
      if (dz > 0) h += dz / 600;
      else if (d > 0 && dz / d < -0.20) h += (-dz) / 1800;
    }
    eff[i] = eff[i - 1] + h;
  }
  return eff;
}

/** Back-compatible wrapper for callers that pass positional arguments. */
function measure(coords, paceKmh, eleAt) {
  return measurePolyline(coords, { eleAt: eleAt, paceKmh: paceKmh });
}

var SLEEPABLE = { rifugio: 1, unstaffed_hut: 1, bivacco: 1, hostel: 1, chalet: 1 };

/**
 * For every sleepable hut near the route, record where along the route it sits.
 * This is what lets a day's end snap to a real roof instead of a bare coordinate.
 */
function indexHutsAlongRoute(coords, m, huts, maxOffsetM) {
  var out = [];
  var step = 4;                       // coarse pass, then refine around the hit
  huts.features.forEach(function (f) {
    if (!f.properties.sleeps) return;
    var c = f.geometry.coordinates;
    var bestI = -1, bestD = Infinity, i;
    for (i = 0; i < coords.length; i += step) {
      var dx = (coords[i][0] - c[0]) * 79000;         // rough m/deg lon at 44°N
      var dy = (coords[i][1] - c[1]) * 111000;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; bestI = i; }
    }
    if (bestI < 0) return;
    var lo = Math.max(0, bestI - step), hi = Math.min(coords.length - 1, bestI + step);
    bestD = Infinity;
    for (i = lo; i <= hi; i++) {
      var d = haversine(coords[i], c);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestD <= maxOffsetM) {
      out.push({ feature: f, index: bestI, offset: bestD, eff: m.eff[bestI], dist: m.dist[bestI] });
    }
  });
  out.sort(function (a, b) { return a.index - b.index || a.offset - b.offset; });

  // De-duplicate by route index. Popular refuges are frequently mapped twice in
  // OSM (a node and a building, or two spellings); both collapse to the same
  // vertex, and an optimiser allowed to choose both produces a zero-kilometre
  // day between two names for the same roof. Keep the closest to the trail.
  var dedup = [];
  for (var k = 0; k < out.length; k++) {
    var prev = dedup[dedup.length - 1];
    if (prev && out[k].index === prev.index) continue;
    dedup.push(out[k]);
  }
  return dedup;
}

function nearestIndexByEff(m, target, lo, hi) {
  // An empty range (hi < lo) previously fell through and returned `lo`
  // unchecked, pushing each successive night one index further past the end.
  if (hi < lo) return Math.max(0, Math.min(lo, hi, m.n - 1));
  var best = lo, bd = Infinity;
  for (var i = lo; i <= hi; i++) {
    var d = Math.abs(m.eff[i] - target);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function maxIn(a, i0, i1) {
  var v = -Infinity;
  for (var i = i0; i <= i1; i++) if (a[i] > v) v = a[i];
  return v === -Infinity ? NaN : v;   // NaN is visibly wrong; -1e9 renders as a number
}
function minIn(a, i0, i1) {
  var v = Infinity;
  for (var i = i0; i <= i1; i++) if (a[i] < v) v = a[i];
  return v === Infinity ? NaN : v;
}

/**
 * Cut the selected span into `days` legs of roughly equal effort, pulling each
 * overnight onto the best nearby hut. This is the point of the tool: the day
 * count changes where you sleep, not just a label.
 */
function planDays(iStart, iEnd, days, m, hutIdx) {
  // A span must have at least one vertex per day; two clicks a few metres apart
  // at high zoom otherwise produced legs running backwards.
  if (!(iEnd > iStart) || (iEnd - iStart) < days) return null;
  var per = (m.eff[iEnd] - m.eff[iStart]) / days;
  var nights = days - 1;
  var splits;

  // Candidate overnights: huts strictly inside the selected span.
  var cand = [];
  for (var h = 0; h < hutIdx.length; h++) {
    var c = hutIdx[h];
    if (c.index > iStart + 5 && c.index < iEnd - 5) cand.push(c);
  }

  if (nights === 0) {
    splits = [];
  } else {
    // Choose the whole set of overnights at once, by dynamic programming.
    // Greedily taking the best hut for night 1, then night 2, and so on gives
    // badly lopsided trips: an early compromise pushes every later day out of
    // shape and there is no way to take it back. DP scores complete schedules,
    // so a slightly worse night 1 is accepted when it balances the rest.
    splits = optimiseNights(iStart, iEnd, nights, per, m, cand);
    if (!splits) splits = evenSplits(iStart, iEnd, nights, per, m);
  }

  var bounds = [iStart].concat(splits.map(function (s) { return s.index; }), [iEnd]);
  var legs = [];
  for (var d = 0; d < days; d++) {
    var a = bounds[d], b = bounds[d + 1];
    var up = 0, down = 0;
    for (var i = a + 1; i <= b; i++) {
      var dz = m.ele[i] - m.ele[i - 1];
      if (dz > 0) up += dz; else down -= dz;
    }
    legs.push({
      day: d + 1, from: a, to: b,
      km: (m.dist[b] - m.dist[a]) / 1000,
      up: up, down: down,
      hours: m.eff[b] - m.eff[a],
      stay: d < splits.length ? splits[d] : null,
      hiEle: maxIn(m.ele, a, b), loEle: minIn(m.ele, a, b)
    });
  }
  return legs;
}

/**
 * Pick `nights` overnight huts minimising total squared deviation from an even
 * daily effort, plus a penalty for detouring off-trail to reach a hut.
 * Returns null when there are not enough candidate huts to fill the nights.
 */
function optimiseNights(iStart, iEnd, nights, per, m, cand) {
  var N = cand.length;
  if (N < nights) return null;

  var INF = Infinity;
  var cost = [], prev = [], k, i, j;
  for (k = 0; k < nights; k++) {
    cost.push(new Float64Array(N).fill(INF));
    prev.push(new Int32Array(N).fill(-1));
  }

  // Deviation of one leg from the ideal daily effort, in squared hours.
  function legCost(a, b) {
    var x = (m.eff[b] - m.eff[a]) - per;
    return x * x;
  }
  // Walking off-trail to the hut and back, expressed the same way.
  function detour(c) {
    var hrs = (c.offset / 1000) / 3.5 * 2;
    return hrs * hrs * 0.5;
  }

  for (j = 0; j < N; j++) {
    cost[0][j] = legCost(iStart, cand[j].index) + detour(cand[j]);
  }
  for (k = 1; k < nights; k++) {
    for (j = 0; j < N; j++) {
      var best = INF, bi = -1;
      for (i = 0; i < j; i++) {
        if (cost[k - 1][i] === INF) continue;
        var c2 = cost[k - 1][i] + legCost(cand[i].index, cand[j].index);
        if (c2 < best) { best = c2; bi = i; }
      }
      if (bi >= 0) { cost[k][j] = best + detour(cand[j]); prev[k][j] = bi; }
    }
  }

  var bestEnd = INF, bj = -1;
  for (j = 0; j < N; j++) {
    if (cost[nights - 1][j] === INF) continue;
    var tot = cost[nights - 1][j] + legCost(cand[j].index, iEnd);
    if (tot < bestEnd) { bestEnd = tot; bj = j; }
  }
  if (bj < 0) return null;

  var chain = [];
  k = nights - 1; j = bj;
  while (k >= 0 && j >= 0) { chain.unshift(cand[j]); j = prev[k][j]; k--; }
  if (chain.length !== nights) return null;

  return chain.map(function (c) {
    return { index: c.index, hut: c.feature, offset: c.offset };
  });
}

/** Fallback when no hut chain exists: cut at equal effort and flag it. */
function evenSplits(iStart, iEnd, nights, per, m) {
  var out = [], prevIndex = iStart;
  for (var k = 1; k <= nights; k++) {
    var idx = nearestIndexByEff(m, m.eff[iStart] + per * k, prevIndex + 1, iEnd - 1);
    out.push({ index: idx, hut: null, offset: 0 });
    prevIndex = idx;
  }
  return out;
}

/**
 * Find a span of trail that makes a good `days`-day trip, hut to hut.
 *
 * Matching total hours is not enough on its own: a span can hit the right
 * total and still be unwalkable as a schedule, because the huts inside it are
 * clustered and leave one enormous day. So we shortlist spans by total hours,
 * then actually run the night-optimiser on each and keep the one whose daily
 * efforts are most even.
 */
function suggestSection(days, hutIdx, hoursPerDay, m) {
  var targetH = days * (hoursPerDay || 6.0);
  var nights = days - 1;
  var shortlist = [];

  for (var s = 0; s < hutIdx.length; s++) {
    for (var e = s + 1; e < hutIdx.length; e++) {
      var h = hutIdx[e].eff - hutIdx[s].eff;
      if (h > targetH * 1.45) break;
      // The span must contain enough huts to sleep in, not merely the right
      // number of hours -- otherwise the planner is forced to invent camps.
      if (e - s - 1 < nights) continue;
      var err = Math.abs(h - targetH);
      if (err > targetH * 0.45) continue;
      shortlist.push({ s: s, e: e, err: err });
    }
  }
  if (!shortlist.length) return null;

  shortlist.sort(function (a, b) { return a.err - b.err; });
  shortlist = shortlist.slice(0, 80);           // bound the DP work per click

  // Without `m` we cannot score balance; fall back to the closest total.
  if (!m) return [hutIdx[shortlist[0].s].index, hutIdx[shortlist[0].e].index];

  var best = null, bestScore = Infinity;
  for (var k = 0; k < shortlist.length; k++) {
    var sp = shortlist[k];
    var iStart = hutIdx[sp.s].index, iEnd = hutIdx[sp.e].index;
    var per = (m.eff[iEnd] - m.eff[iStart]) / days;

    var cand = [];
    for (var q = 0; q < hutIdx.length; q++) {
      var c = hutIdx[q];
      if (c.index > iStart + 5 && c.index < iEnd - 5) cand.push(c);
    }
    var nightsPicked = nights === 0 ? [] : optimiseNights(iStart, iEnd, nights, per, m, cand);
    if (nights > 0 && !nightsPicked) continue;

    var bounds = [iStart].concat(nightsPicked.map(function (x) { return x.index; }), [iEnd]);
    var hi = -Infinity, lo = Infinity;
    for (var b = 0; b < bounds.length - 1; b++) {
      var hrs = m.eff[bounds[b + 1]] - m.eff[bounds[b]];
      if (hrs > hi) hi = hrs;
      if (hrs < lo) lo = hrs;
    }
    // Spread dominates; total-hours error only breaks ties between even trips.
    var score = (hi - lo) + sp.err * 0.25;
    if (score < bestScore) { bestScore = score; best = [iStart, iEnd]; }
  }
  return best;
}

return {
  haversine: haversine,
  makeEleSampler: makeEleSampler,
  makeCoverageTest: makeCoverageTest,
  measurePolyline: measurePolyline,
  stitch: stitch,
  buildMasterRoute: buildMasterRoute,
  measure: measure,
  indexHutsAlongRoute: indexHutsAlongRoute,
  planDays: planDays,
  optimiseNights: optimiseNights,
  suggestSection: suggestSection,
  SLEEPABLE: SLEEPABLE
};
}));
