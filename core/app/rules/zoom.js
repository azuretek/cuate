// Pure: the image viewer's zoom and pan. No DOM, no clock: the viewer measures the picture and the stage, hands the
// numbers in, and draws what comes back, so every shell (the desktop, and the phones' web views) zooms by one set of
// rules rather than a copy each.
//
// The model is one view: { scale, x, y }. scale is a multiple of the FITTED picture, the size it is drawn at when the
// viewer opens (1 is fit), and x and y move the picture's centre away from the stage's centre, in screen pixels. A
// point is also measured from the stage's centre, so a pointer at the middle of the stage is { x: 0, y: 0 }. The
// picture is drawn as translate(x, y) scale(scale) about its own centre, which is what makes the maths below hold.
//
// The box is what the viewer measured: { width, height } is the fitted picture, { stageWidth, stageHeight } the space
// it sits in.

export const ZOOM_FIT = 1;
// The step one click or one key press takes, as a factor of the scale it starts from.
export const ZOOM_STEP = 2;
// The scale a double tap goes to from fit: a photo viewer's "look closer" rather than a single step.
export const ZOOM_DOUBLE_TAP = 2.5;
// How far one arrow key press moves the picture, in screen pixels.
export const ZOOM_PAN_STEP = 48;
// A press that moves less than this, in screen pixels, is a click or a tap; more is a drag.
export const ZOOM_SLOP = 6;
// Two taps this close in time (ms) and space (px) are a double tap.
export const ZOOM_DOUBLE_TAP_MS = 300;
export const ZOOM_DOUBLE_TAP_PX = 32;

export const zoomFit = () => ({ scale: ZOOM_FIT, x: 0, y: 0 });

// Whether an event asks to zoom or resize the whole page (issue 180): a pinch, which arrives as a wheel with ctrl held or
// as a WebKit gesture, or a zoom key with ctrl or cmd held. Only the media viewer zooms, so the page refuses each of
// these everywhere else; the viewer handles its own. Text size is the text-size setting's, never a page zoom.
const PAGE_ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);
export function pageZoomAttempt({ type, ctrlKey = false, metaKey = false, key = '' } = {}) {
  if (type === 'wheel') return Boolean(ctrlKey);
  if (type === 'gesturestart' || type === 'gesturechange') return true;
  if (type === 'keydown') return Boolean(ctrlKey || metaKey) && PAGE_ZOOM_KEYS.has(key);
  return false;
}

// The most the picture may be zoomed: four times fit, or twice the picture's own pixels where that is further, so a
// large photo can still be read pixel for pixel; never past sixteen, where a pan would be hunting in the dark.
// native is how many of the picture's own pixels sit in one fitted screen pixel (natural width over fitted width).
export function zoomMax(native) {
  const n = Number(native);
  const byPixels = Number.isFinite(n) && n > 0 ? n * 2 : 0;
  return Math.min(16, Math.max(4, byPixels));
}

export function clampScale(scale, max) {
  const s = Number(scale);
  const top = Number(max) > ZOOM_FIT ? Number(max) : ZOOM_FIT;
  if (!Number.isFinite(s)) return ZOOM_FIT;
  return Math.min(top, Math.max(ZOOM_FIT, s));
}

// How far the picture's centre may sit from the stage's centre on one axis. While the zoomed picture is narrower than
// the stage it stays centred; once it is wider it may move until an edge reaches the stage's edge, never past it, so
// the zoomed picture always covers the stage on that axis and can never be dragged off it.
function axisReach(size, scale, stage) {
  const drawn = size * scale;
  return drawn > stage ? (drawn - stage) / 2 : 0;
}

export function panBounds(view, box) {
  return { x: axisReach(box.width, view.scale, box.stageWidth), y: axisReach(box.height, view.scale, box.stageHeight) };
}

const within = (v, reach) => (reach === 0 ? 0 : Math.min(reach, Math.max(-reach, v)));

export function clampPan(view, box) {
  const reach = panBounds(view, box);
  return { scale: view.scale, x: within(view.x, reach.x), y: within(view.y, reach.y) };
}

// Zoom to a new scale about a point: the part of the picture under the point stays under it, which is what makes a
// click, a wheel turn or a pinch feel anchored to the pointer rather than to the middle of the screen. Only the pan
// bounds can move it, and only where the picture would otherwise leave the stage.
export function zoomTo(view, scale, point, box, max) {
  const next = clampScale(scale, max);
  const k = next / view.scale;
  const p = point || { x: 0, y: 0 };
  return clampPan({ scale: next, x: p.x - (p.x - view.x) * k, y: p.y - (p.y - view.y) * k }, box);
}

export function zoomBy(view, factor, point, box, max) {
  return zoomTo(view, view.scale * factor, point, box, max);
}

export function panBy(view, dx, dy, box) {
  return clampPan({ scale: view.scale, x: view.x + dx, y: view.y + dy }, box);
}

// A double tap: from fit (or near it) to a closer look about the tap, and from any zoom back to fit.
export function toggleZoom(view, point, box, max) {
  if (view.scale > ZOOM_FIT + 0.01) return zoomFit();
  return zoomTo(view, ZOOM_DOUBLE_TAP, point, box, max);
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Two fingers: the view the pinch started from, the two points then and the two points now. The scale follows the
// spread of the fingers and the picture follows their midpoint, so a pinch can zoom and pan in one movement, and the
// part of the picture that was between the fingers stays between them.
export function pinch(start, from, to, box, max) {
  const d0 = distance(from[0], from[1]);
  const d1 = distance(to[0], to[1]);
  if (!(d0 > 0) || !(d1 > 0)) return clampPan(start, box);
  const c0 = middle(from[0], from[1]);
  const c1 = middle(to[0], to[1]);
  const next = clampScale(start.scale * (d1 / d0), max);
  const k = next / start.scale;
  return clampPan({ scale: next, x: c1.x - (c0.x - start.x) * k, y: c1.y - (c0.y - start.y) * k }, box);
}

// A wheel turn, or a trackpad pinch (which the browser reports as a wheel with ctrlKey), as a zoom factor: smooth, so
// a trackpad's many small deltas and a mouse wheel's few large ones both feel right. deltaMode 1 is lines, 2 pages.
export function wheelFactor(deltaY, deltaMode = 0, pinching = false) {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  const d = Math.max(-400, Math.min(400, (Number(deltaY) || 0) * unit));
  return Math.exp(-d * (pinching ? 0.01 : 0.002));
}

// Whether a press was a click or a tap rather than a drag.
export function isClick(down, up) {
  if (!down || !up) return false;
  return distance(down, up) < ZOOM_SLOP;
}

// Whether a tap is the second of a double tap, from the tap before it ({ x, y, at }) and this one. The times come in
// from the caller, which reads the event's own timestamp, so the rule reads no clock.
export function isDoubleTap(prev, tap) {
  if (!prev || !tap) return false;
  const dt = tap.at - prev.at;
  return dt >= 0 && dt <= ZOOM_DOUBLE_TAP_MS && distance(prev, tap) <= ZOOM_DOUBLE_TAP_PX;
}

// The keyboard: + and = zoom in, - and _ zoom out, 0 goes back to fit, the arrows pan (the arrow names the way the
// view looks, so the picture moves the other way), Escape closes. Anything else is not the viewer's.
const KEYS = {
  '+': { kind: 'zoom', factor: ZOOM_STEP }, '=': { kind: 'zoom', factor: ZOOM_STEP },
  '-': { kind: 'zoom', factor: 1 / ZOOM_STEP }, _: { kind: 'zoom', factor: 1 / ZOOM_STEP },
  0: { kind: 'reset' }, Escape: { kind: 'close' },
  ArrowLeft: { kind: 'pan', dx: ZOOM_PAN_STEP, dy: 0 }, ArrowRight: { kind: 'pan', dx: -ZOOM_PAN_STEP, dy: 0 },
  ArrowUp: { kind: 'pan', dx: 0, dy: ZOOM_PAN_STEP }, ArrowDown: { kind: 'pan', dx: 0, dy: -ZOOM_PAN_STEP },
};

export function zoomKey(key) {
  return Object.prototype.hasOwnProperty.call(KEYS, key) ? KEYS[key] : null;
}
