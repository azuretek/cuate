// Pure: W3C Trace Context. The random source is injected, so these run the same on every host.
export function newTraceparent(randomHex) {
  return formatTraceparent({ traceId: randomHex(16), spanId: randomHex(8), sampled: true });
}

export function formatTraceparent({ traceId, spanId, sampled = true }) {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

export function parseTraceparent(header) {
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(header ?? '').trim());
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}
