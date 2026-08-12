/* TrekkingMap — resilient tile loading.
 *
 * OpenTopoMap is a small volunteer-run service. It answers individual requests
 * fine, but when a pan or zoom fires 20+ requests at once it quietly drops
 * some of them, leaving blank squares on the map. Nothing is permanently
 * broken — the same tile succeeds moments later — so the fix is to retry
 * rather than to switch providers.
 *
 * This layer:
 *   - retries a failed tile a few times with increasing delay,
 *   - rotates subdomain on each retry so a struggling host is not hammered,
 *   - after giving up, leaves a clickable placeholder so a single tile can be
 *     re-fetched on demand,
 *   - reports live counts to a status control.
 */

(function () {
'use strict';

var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

var ResilientTileLayer = L.TileLayer.extend({

  options: {
    maxRetries: 4,
    retryBaseDelay: 600         // 600ms, 1.2s, 1.8s, 2.4s
  },

  initialize: function (url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this.stats = { pending: 0, ok: 0, failed: 0 };
  },

  createTile: function (coords, done) {
    var tile = L.TileLayer.prototype.createTile.call(this, coords, done);
    tile._tmCoords = coords;
    tile._tmTries = 0;
    this.stats.pending++;
    this._tmNotify();
    return tile;
  },

  // Build a URL for a retry: cache-busted, so neither the browser nor an
  // intermediate proxy hands us back the failure it just cached.
  _tmRetryUrl: function (coords, attempt) {
    // Leaflet picks the subdomain as subdomains[|x+y| % n] -- a pure function of
    // the tile coordinates. Calling getTileUrl() again therefore returns the SAME
    // host every time, so the documented rotation never happened and a struggling
    // server received all five attempts. Offset by the attempt number to move on.
    var subs = this.options.subdomains;
    var url;
    if (subs && subs.length > 1) {
      var i = (Math.abs(coords.x + coords.y) + attempt) % subs.length;
      url = L.Util.template(this._url, L.extend({
        s: subs[i], x: coords.x, y: this._globalTileRange
          ? this.options.tms ? this._globalTileRange.max.y - coords.y : coords.y
          : coords.y,
        z: coords.z, r: this.options.detectRetina && L.Browser.retina ? '@2x' : ''
      }, this.options));
    } else {
      url = this.getTileUrl(coords);
    }
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'tmr=' + attempt;
  },

  _tileOnLoad: function (done, tile) {
    if (!tile._tmSettled && !tile._tmGaveUp) {
      tile._tmSettled = true;
      this.stats.pending--;
      this.stats.ok++;
      this._tmNotify();
    }
    // A tile that gave up gets `src` set to a blank pixel, purely to clear the
    // browser's broken-image glyph. That assignment fires onload right back
    // into here — so the failure styling must survive it, or the placeholder
    // erases itself the instant it is applied.
    if (!tile._tmGaveUp) L.DomUtil.removeClass(tile, 'tm-tile-failed');
    L.TileLayer.prototype._tileOnLoad.call(this, done, tile);
  },

  _tileOnError: function (done, tile, e) {
    var layer = this;

    if (tile._tmTries < this.options.maxRetries) {
      tile._tmTries++;
      var wait = this.options.retryBaseDelay * tile._tmTries;
      setTimeout(function () {
        // The tile may have been panned out of existence while we waited.
        if (!tile.parentNode) return;
        tile.src = layer._tmRetryUrl(tile._tmCoords, tile._tmTries);
      }, wait);
      return;                       // do not settle the tile yet
    }

    // Out of retries. Leave a placeholder the user can click to try again.
    tile._tmGaveUp = true;
    if (!tile._tmSettled) {
      tile._tmSettled = true;
      this.stats.pending--;
      this.stats.failed++;
      this._tmNotify();
    }
    L.DomUtil.addClass(tile, 'tm-tile-failed');
    tile.title = 'Tile failed to load — click to retry';
    tile.src = BLANK;               // clears the browser's broken-image glyph

    if (!tile._tmClickBound) {
      tile._tmClickBound = true;
      L.DomEvent.on(tile, 'click', function (ev) {
        L.DomEvent.stop(ev);
        layer.retryTile(tile);
      });
    }
    L.TileLayer.prototype._tileOnError.call(this, done, tile, e);
  },

  /** Re-fetch one tile that had given up. */
  retryTile: function (tile) {
    if (!tile._tmGaveUp || !tile.parentNode) return;
    tile._tmGaveUp = false;
    tile._tmSettled = false;
    tile._tmTries = 0;
    this.stats.failed = Math.max(0, this.stats.failed - 1);
    this.stats.pending++;
    this._tmNotify();
    L.DomUtil.removeClass(tile, 'tm-tile-failed');
    L.DomUtil.addClass(tile, 'tm-tile-retrying');
    var layer = this;
    setTimeout(function () {
      L.DomUtil.removeClass(tile, 'tm-tile-retrying');
      tile.src = layer._tmRetryUrl(tile._tmCoords, 'manual');
    }, 60);
  },

  /** Re-fetch every tile currently showing a failure placeholder. */
  retryAllFailed: function () {
    var n = 0, layer = this;
    Object.keys(this._tiles).forEach(function (k) {
      var el = layer._tiles[k] && layer._tiles[k].el;
      if (el && el._tmGaveUp) { layer.retryTile(el); n++; }
    });
    return n;
  },

  countFailed: function () {
    var n = 0, layer = this;
    Object.keys(this._tiles).forEach(function (k) {
      var el = layer._tiles[k] && layer._tiles[k].el;
      if (el && el._tmGaveUp) n++;
    });
    return n;
  },

  /**
   * How many tiles are genuinely still in flight.
   *
   * Derived from Leaflet's own tile registry rather than a hand-maintained
   * counter. The counter drifted: it was incremented in createTile but
   * decremented only from handlers that Leaflet nulls out in _onTileRemove and
   * _abortLoading, so panning away mid-load leaked a permanent increment and the
   * chip sat at "loading 20..." with nothing actually loading.
   */
  countPending: function () {
    var n = 0, layer = this;
    Object.keys(this._tiles).forEach(function (k) {
      var t = layer._tiles[k];
      if (t && !t.loaded && t.el && !t.el._tmGaveUp) n++;
    });
    return n;
  },

  onRemove: function (map) {
    if (this._tmTimer) { clearTimeout(this._tmTimer); this._tmTimer = null; }
    L.TileLayer.prototype.onRemove.call(this, map);
  },

  _tmNotify: function () {
    if (this._tmTimer) return;                 // coalesce bursts into one update
    var layer = this;
    this._tmTimer = setTimeout(function () {
      layer._tmTimer = null;
      layer.fire('tm:status', { stats: layer.stats, failed: layer.countFailed() });
    }, 120);
  }
});

/* ---------------------------------------------------------------- control */

var TileStatus = L.Control.extend({
  options: { position: 'bottomright' },

  onAdd: function () {
    var box = L.DomUtil.create('div', 'tm-tilestatus');
    this._box = box;
    L.DomEvent.disableClickPropagation(box);

    this._dot = L.DomUtil.create('span', 'dot', box);
    this._text = L.DomUtil.create('span', 'txt', box);
    this._btn = L.DomUtil.create('button', 'retry', box);
    this._btn.textContent = 'Retry failed';
    this._btn.title = 'Re-request every tile that failed to load';

    var self = this;
    L.DomEvent.on(this._btn, 'click', function (e) {
      L.DomEvent.stop(e);
      var n = 0;
      self._layers.forEach(function (l) { if (l._map) n += l.retryAllFailed(); });
      self._flash(n ? 'Retrying ' + n + '…' : 'Nothing to retry');
    });

    this._layers = [];
    this.update();
    return box;
  },

  /** Watch a tile layer; the control shows whichever one is currently on. */
  watch: function (layer) {
    var self = this;
    this._layers = this._layers || [];
    this._layers.push(layer);
    layer.on('tm:status', function () { self.update(); });
    layer.on('load', function () { self.update(); });
    return this;
  },

  update: function () {
    if (!this._box) return;
    var pending = 0, failed = 0;
    (this._layers || []).forEach(function (l) {
      if (!l._map) return;
      pending += l.countPending();
      failed += l.countFailed();
    });

    var cls = 'tm-tilestatus', txt;
    if (failed) {
      cls += ' bad';
      txt = failed + ' tile' + (failed > 1 ? 's' : '') + ' failed';
    } else if (pending) {
      cls += ' busy';
      txt = 'loading ' + pending + '…';
    } else {
      cls += ' ok';
      txt = 'tiles ok';
    }
    this._box.className = cls;
    this._text.textContent = txt;
    this._btn.style.display = failed ? '' : 'none';
  },

  _flash: function (msg) {
    var self = this;
    this._text.textContent = msg;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(function () { self.update(); }, 1600);
  }
});

window.TMTiles = {
  layer: function (url, opts) { return new ResilientTileLayer(url, opts); },
  status: function (opts) { return new TileStatus(opts); }
};

})();
