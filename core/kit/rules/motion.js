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
