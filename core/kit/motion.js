// The page's one way to play a motion (issue 316), so every arrival moves on the shared tokens and every one of them
// stops for reduced motion. A component names a duration and an easing token; this reads them from the page's own
// stylesheet, so the CSS and the script can never disagree about how long a thing takes. The geometry is the pure
// core/kit/rules/motion.js.
import { flipDelta } from './rules/motion.js';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function cssVar(el, name) {
  if (!el || typeof getComputedStyle !== 'function') return '';
  return getComputedStyle(el).getPropertyValue(name).trim();
}

const toMs = (v) => (String(v).endsWith('ms') ? parseFloat(v) : String(v).endsWith('s') ? parseFloat(v) * 1000 : parseFloat(v)) || 0;

// Play keyframes on an element with a motion token's duration and easing: { duration: 'spring', easing: 'spring-ease' }
// names --motion-spring and --motion-spring-ease. Nothing plays for reduced motion or where the page cannot animate,
// and an easing a web view does not know (an older one without linear()) falls back to the shared curve.
export function play(el, keyframes, { duration = 'spring', easing = 'spring-ease', ...rest } = {}) {
  if (!el || typeof el.animate !== 'function' || reducedMotion()) return null;
  const ms = toMs(cssVar(el, '--motion-' + duration));
  if (!(ms > 0)) return null;
  const ease = cssVar(el, '--motion-' + easing) || 'ease-out';
  try {
    return el.animate(keyframes, { duration: ms, easing: ease, ...rest });
  } catch {
    return el.animate(keyframes, { duration: ms, easing: cssVar(el, '--motion-ease') || 'ease-out', ...rest });
  }
}

const finished = (a) => (a && a.finished ? a.finished.catch(() => {}) : Promise.resolve());

// An element grows out of a rectangle on screen (where it came from) into its own place; with back, it shrinks into it.
export function growFrom(el, from, { origin = null, back = false, fade = false, duration = 'spring', easing = 'spring-ease' } = {}) {
  if (!el || !from) return Promise.resolve();
  const d = flipDelta(from, el.getBoundingClientRect(), origin);
  const start = { translate: d.dx + 'px ' + d.dy + 'px', scale: d.sx + ' ' + d.sy, opacity: fade ? 0 : 1 };
  const end = { translate: '0px 0px', scale: '1 1', opacity: 1 };
  return finished(play(el, back ? [end, start] : [start, end], { duration, easing, fill: back ? 'forwards' : 'none' }));
}
