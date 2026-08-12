/* TrekkingMap — the bottom sheet.
 *
 * On a phone the panel and the map compete for a very small screen. This turns
 * the panel into a sheet you can drag: down out of the way for a full-screen
 * map, back up to plan. Three snap points rather than free resizing, because
 * on a touch screen a sheet that lands anywhere is fiddly to place and easy to
 * knock out of position.
 *
 * Desktop is untouched — there the sidebar sits beside the map and there is no
 * competition to resolve.
 */

window.TMSheet = (function () {
'use strict';

var app;
var STATES = ['down', 'mid', 'up'];     // map full → split → panel tall
var state = 'mid';
var handle = null, dragging = false, startY = 0, startFrac = 0, movedPx = 0;

/* Fraction of the shell's height given to the MAP in each state. */
var MAP_FRAC = { down: 1.0, mid: 0.58, up: 0.28 };

var CSS = [
  /* The handle exists on every width but only shows where it does something. */
  '.tm-grab{display:none}',
  '@media (max-width: 900px){',
  /* The stylesheet gives .mapwrap a 300px floor so it can never collapse when
     nothing is managing it. The sheet manages it explicitly, and that floor
     stops the panel from ever getting more than about half the screen. */
  '  .mapwrap{min-height:0}',
  '  .tm-grab{display:block;position:sticky;top:0;z-index:20;margin:-12px -12px 8px;',
  '    padding:7px 0 6px;background:var(--paper);border-bottom:1px solid var(--line);',
  '    cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}',
  '  .tm-grab:active{cursor:grabbing}',
  '  .tm-grab i{display:block;width:40px;height:4px;margin:0 auto;border-radius:2px;',
  '    background:var(--line)}',
  '  .tm-grab .lbl{display:block;text-align:center;font-size:10px;letter-spacing:.06em;',
  '    text-transform:uppercase;color:var(--ink-soft);margin-top:4px;font-weight:700}',
  /* While dragging, kill transitions so the sheet tracks the finger exactly. */
  '  body:not(.tm-dragging) .mapwrap,',
  '  body:not(.tm-dragging) .panel{transition:flex-basis .22s ease}',
  /* Fully down: only the handle remains, pinned to the bottom of the screen. */
  '  body.tm-sheet-down .panel{overflow:hidden}',
  '  body.tm-sheet-down .tm-grab{margin-bottom:0}',
  /* A floating button to bring it back, since the handle is easy to miss. */
  '  .tm-sheet-btn{position:absolute;right:10px;bottom:10px;z-index:1250;',
  '    display:none;align-items:center;gap:6px;padding:8px 12px;',
  '    font:inherit;font-size:12px;font-weight:650;color:#fff;background:var(--pine);',
  '    border:none;border-radius:20px;box-shadow:var(--shadow);cursor:pointer}',
  '  body.tm-sheet-down .tm-sheet-btn{display:inline-flex}',
  '}'
].join('\n');

function shellHeight() {
  var s = document.querySelector('.shell');
  return s ? s.getBoundingClientRect().height : window.innerHeight;
}

function apply(frac, animate) {
  var mapEl = document.querySelector('.mapwrap');
  var panel = document.querySelector('.panel');
  if (!mapEl || !panel) return;
  frac = Math.max(0.20, Math.min(1, frac));
  var h = shellHeight();
  mapEl.style.flex = '0 0 ' + Math.round(h * frac) + 'px';
  panel.style.flex = '1 1 auto';
  document.body.classList.toggle('tm-sheet-down', frac > 0.97);
  // Leaflet caches the container size; without this the map renders into the
  // old box and tiles come out misaligned after the sheet moves.
  if (app && app.map) {
    if (animate) setTimeout(function () { app.map.invalidateSize({ pan: false }); }, 240);
    else app.map.invalidateSize({ pan: false });
  }
}

function go(next, animate) {
  state = next;
  apply(MAP_FRAC[next], animate !== false);
  setLabel();
}

function setLabel() {
  if (!handle) return;
  var l = handle.querySelector('.lbl');
  if (l) l.textContent = state === 'down' ? 'Pull up to plan'
                        : state === 'up' ? 'Drag down for the map'
                        : 'Drag to resize';
}

function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

/** Nearest snap point to a given map fraction. */
function snapTo(frac) {
  var best = 'mid', bd = Infinity;
  STATES.forEach(function (s) {
    var d = Math.abs(MAP_FRAC[s] - frac);
    if (d < bd) { bd = d; best = s; }
  });
  return best;
}

function onDown(ev) {
  if (!isMobile()) return;
  dragging = true;
  movedPx = 0;
  startY = (ev.touches ? ev.touches[0].clientY : ev.clientY);
  startFrac = document.querySelector('.mapwrap').getBoundingClientRect().height / shellHeight();
  document.body.classList.add('tm-dragging');
  if (handle.setPointerCapture && ev.pointerId !== undefined) {
    try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
  }
}

function onMove(ev) {
  if (!dragging) return;
  var y = (ev.touches ? ev.touches[0].clientY : ev.clientY);
  var dy = y - startY;
  movedPx = Math.max(movedPx, Math.abs(dy));
  apply(startFrac + dy / shellHeight(), false);
  if (ev.cancelable) ev.preventDefault();
}

function onUp() {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('tm-dragging');
  var frac = document.querySelector('.mapwrap').getBoundingClientRect().height / shellHeight();

  // A press without movement is a tap: toggle between the split view and a
  // full-screen map, which is the thing people actually want most often.
  if (movedPx < 6) {
    go(state === 'down' ? 'mid' : 'down');
    return;
  }
  go(snapTo(frac));
}

function build() {
  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var panel = document.querySelector('.panel');
  handle = document.createElement('div');
  handle.className = 'tm-grab';
  handle.setAttribute('role', 'button');
  handle.setAttribute('tabindex', '0');
  handle.setAttribute('aria-label', 'Resize the panel, or collapse it for a full map');
  handle.innerHTML = '<i></i><span class="lbl"></span>';
  panel.insertBefore(handle, panel.firstChild);

  // Pointer events cover mouse and touch; the touch pair is a fallback for
  // older iOS, which an iPhone 7 on iOS 15 may well be.
  if (window.PointerEvent) {
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  } else {
    handle.addEventListener('touchstart', onDown, { passive: true });
    handle.addEventListener('touchmove', onMove, { passive: false });
    handle.addEventListener('touchend', onUp);
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  handle.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(state === 'down' ? 'mid' : 'down'); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); go(state === 'down' ? 'mid' : 'up'); }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); go(state === 'up' ? 'mid' : 'down'); }
  });

  var btn = document.createElement('button');
  btn.className = 'tm-sheet-btn';
  btn.type = 'button';
  btn.textContent = '☰ Planner';
  btn.addEventListener('click', function (e) { e.stopPropagation(); go('mid'); });
  document.querySelector('.mapwrap').appendChild(btn);

  setLabel();
}

function reset() {
  var mapEl = document.querySelector('.mapwrap');
  var panel = document.querySelector('.panel');
  if (!mapEl || !panel) return;
  if (isMobile()) {
    go(state, false);
  } else {
    // Hand layout back to the stylesheet on wide screens.
    mapEl.style.flex = '';
    panel.style.flex = '';
    document.body.classList.remove('tm-sheet-down');
    if (app && app.map) app.map.invalidateSize({ pan: false });
  }
}

return {
  init: function (a) {
    app = a;
    build();
    reset();
    window.addEventListener('resize', reset);
    window.addEventListener('orientationchange', function () { setTimeout(reset, 250); });
  },
  // exposed for tests
  _go: go,
  _state: function () { return state; },
  _mapFrac: function () {
    return document.querySelector('.mapwrap').getBoundingClientRect().height / shellHeight();
  }
};

})();
