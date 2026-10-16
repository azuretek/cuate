// History uses lossless engine cursors, never the rounded display timestamp (issue 394).
const MIN = -(2n ** 63n);
const MAX = 2n ** 63n - 1n;
export function historyCursor(value) {
  if (typeof value !== 'string' || value.length > 41 || !/^-?[0-9]+:[0-9]+$/.test(value)) return null;
  const [time, id] = value.split(':').map(BigInt);
  return time >= MIN && time <= MAX && id > 0n && id <= MAX ? { time, id } : null;
}

export function compareHistory(a, b) {
  const left = historyCursor(a.historyCursor);
  const right = historyCursor(b.historyCursor);
  if (left && right) {
    if (left.time !== right.time) return left.time < right.time ? -1 : 1;
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return 0;
  }
  return String(a.sentAt).localeCompare(String(b.sentAt));
}
