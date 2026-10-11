// Pure: the motion maths behind the tokens that are not plain numbers. The sibling app (Chela) runs its arrival as a
// SwiftUI spring; CSS has none, so the same spring is sampled into a linear() easing and the time it takes to settle,
// and core/spec/tokens.json carries the result as motion.spring-ease and motion.spring. A test recomputes both from
// motionSource.spring here and compares, so the stylesheet's string is checked rather than trusted. This is the same
// function as Chela's core/ui/motion.js springCurve(), so the two clients move on the same curve.

/**
 * A damped spring released from 0 towards 1, with the natural frequency SwiftUI derives from `response`
 * (2 pi / response) and the damping ratio as given, sampled into CSS. The duration is how long it takes to settle
 * within `settle` of rest, so the animation ends where the motion does.
 * @param {{ responseMs: number, dampingFraction: number }} spring
 * @param {{ samples?: number, settle?: number }} [options]
 * @returns {{ durationMs: number, linear: string }}
 */
export function springCurve(spring, { samples = 24, settle = 0.001 } = {}) {
  const omega = (2 * Math.PI) / (spring.responseMs / 1000);
  const zeta = spring.dampingFraction;
  const position = (t) => {
    if (zeta < 1) {
      const damped = omega * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
    }
    return 1 - Math.exp(-omega * t) * (1 + omega * t);
  };
  const settleS = Math.log(1 / settle) / (Math.min(zeta, 1) * omega);
  const durationMs = Math.round((settleS * 1000) / 10) * 10;
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const value = i === samples ? 1 : position((i / samples) * (durationMs / 1000));
    points.push(Number(value.toFixed(3)));
  }
  return { durationMs, linear: `linear(${points.join(', ')})` };
}

// Where a thing that grows out of another starts (issue 316): the translate and scale that put an element drawn at
// to over the rectangle from, applied as the individual translate and scale properties, which come before any
// transform the element already wears. origin is the point the scale is about, the element's layout centre, which
// differs from its drawn centre only when a transform has moved it (the media viewer's pan and top lift).
export function flipDelta(from, to, origin = null) {
  const w = Number(to && to.width) || 0;
  const h = Number(to && to.height) || 0;
  if (!(w > 0) || !(h > 0) || !from) return { dx: 0, dy: 0, sx: 1, sy: 1 };
  const sx = (Number(from.width) || 0) / w;
  const sy = (Number(from.height) || 0) / h;
  const tc = { x: to.left + w / 2, y: to.top + h / 2 };
  const fc = { x: from.left + (Number(from.width) || 0) / 2, y: from.top + (Number(from.height) || 0) / 2 };
  const o = origin || tc;
  return { dx: fc.x - (o.x + sx * (tc.x - o.x)), dy: fc.y - (o.y + sy * (tc.y - o.y)), sx: sx > 0 ? sx : 1, sy: sy > 0 ? sy : 1 };
}

// The messages that ARRIVED in an update, so only they animate in (issue 316): those after the newest one already
// shown. A first draw, a switch to another conversation and a page of older history arrive as a place, not as news,
// so none of them is animated; neither is our own sent message coming back from the server under its real id, since
// its local copy already rose from the composer.
export function newArrivals(before, after, { sameChat = true } = {}) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  if (!sameChat || !prev.length) return [];
  const known = new Set(prev.map((m) => m.id));
  let last = -1;
  next.forEach((m, i) => { if (known.has(m.id)) last = i; });
  const gone = prev.some((m) => String(m.id).startsWith('local:') && !next.some((n) => n.id === m.id));
  return next.slice(last + 1).filter((m) => !known.has(m.id) && !(gone && m.fromMe && !String(m.id).startsWith('local:'))).map((m) => ({ id: m.id, sent: Boolean(m.fromMe) && String(m.id).startsWith('local:') }));
}
