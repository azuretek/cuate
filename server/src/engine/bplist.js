// A binary property list (bplist00), read and written in plain JavaScript so it runs off the Mac as well as on it. Messages
// keeps a conversation's rendered background in one (issue 417), its picture as a data value beside the luminance it was
// drawn for, so the server reads the picture out of it; the fake engine writes one the same shape. Only what a property
// list can hold is read: no references outside the file, and an offset or a size the file cannot hold is refused.
const MAGIC = 'bplist00';
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

const uint = (buf, at, size) => {
  let v = 0;
  for (let i = 0; i < size; i += 1) v = v * 256 + buf[at + i];
  return v;
};

/**
 * The top object of a binary property list: a dict is a plain object, data a Buffer, a date a Date.
 * @param {Buffer} buf
 */
export function readPlist(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 40 || buf.toString('latin1', 0, 8) !== MAGIC) throw Object.assign(new Error('not a binary property list'), { code: 'not_bplist' });
  const t = buf.length - 32;
  const offsetSize = buf[t + 6];
  const refSize = buf[t + 7];
  const count = uint(buf, t + 8, 8);
  const top = uint(buf, t + 16, 8);
  const table = uint(buf, t + 24, 8);
  const bad = () => Object.assign(new Error('a damaged property list'), { code: 'bad_bplist' });
  if (!offsetSize || !refSize || top >= count || table + count * offsetSize > t) throw bad();
  const offsetOf = (i) => {
    if (i >= count) throw bad();
    const at = uint(buf, table + i * offsetSize, offsetSize);
    if (at < 8 || at >= table) throw bad();
    return at;
  };
  const depth = new Set();
  const lengthAt = (at, low) => {
    if (low !== 0xf) return { n: low, from: at + 1 };
    const marker = buf[at + 1];
    if ((marker >> 4) !== 0x1) throw bad();
    const size = 1 << (marker & 0xf);
    return { n: uint(buf, at + 2, size), from: at + 2 + size };
  };
  const object = (i) => {
    if (depth.has(i)) throw bad();
    const at = offsetOf(i);
    const marker = buf[at];
    const high = marker >> 4;
    const low = marker & 0xf;
    const within = (from, n) => { if (from + n > table) throw bad(); };
    switch (high) {
      case 0x0: return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x1: { const size = 1 << low; within(at + 1, size); return size === 8 ? Number(buf.readBigInt64BE(at + 1)) : uint(buf, at + 1, size); }
      case 0x2: { within(at + 1, 1 << low); return low === 2 ? buf.readFloatBE(at + 1) : buf.readDoubleBE(at + 1); }
      case 0x3: within(at + 1, 8); return new Date(APPLE_EPOCH_MS + buf.readDoubleBE(at + 1) * 1000);
      case 0x4: { const { n, from } = lengthAt(at, low); within(from, n); return Buffer.from(buf.subarray(from, from + n)); }
      case 0x5: { const { n, from } = lengthAt(at, low); within(from, n); return buf.toString('latin1', from, from + n); }
      case 0x6: { const { n, from } = lengthAt(at, low); within(from, n * 2); return Buffer.from(buf.subarray(from, from + n * 2)).swap16().toString('utf16le'); }
      case 0x8: return { uid: uint(buf, at + 1, low + 1) };
      case 0xa: {
        const { n, from } = lengthAt(at, low);
        within(from, n * refSize);
        depth.add(i);
        const out = [];
        for (let k = 0; k < n; k += 1) out.push(object(uint(buf, from + k * refSize, refSize)));
        depth.delete(i);
        return out;
      }
      case 0xd: {
        const { n, from } = lengthAt(at, low);
        within(from, n * 2 * refSize);
        depth.add(i);
        const out = {};
        for (let k = 0; k < n; k += 1) {
          const key = object(uint(buf, from + k * refSize, refSize));
          out[String(key)] = object(uint(buf, from + (n + k) * refSize, refSize));
        }
        depth.delete(i);
        return out;
      }
      default: throw bad();
    }
  };
  return object(top);
}

/**
 * A binary property list holding value: plain objects, arrays, strings, numbers, booleans and Buffers.
 * @param {unknown} value
 */
export function writePlist(value) {
  const objects = [];
  const add = (v) => {
    const i = objects.length;
    objects.push(null);
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) objects[i] = { kind: 'data', v: Buffer.from(v) };
    else if (Array.isArray(v)) objects[i] = { kind: 'array', refs: v.map(add) };
    else if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      objects[i] = { kind: 'dict', keys: keys.map(add), values: keys.map((k) => add(v[k])) };
    } else objects[i] = { kind: typeof v, v };
    return i;
  };
  add(value);
  const refSize = objects.length < 256 ? 1 : 2;
  const head = (high, n) => {
    if (n < 15) return Buffer.from([(high << 4) | n]);
    const len = Buffer.alloc(5);
    len[0] = 0x12;
    len.writeUInt32BE(n, 1);
    return Buffer.concat([Buffer.from([(high << 4) | 0xf]), len]);
  };
  const refs = (list) => {
    const b = Buffer.alloc(list.length * refSize);
    list.forEach((r, k) => (refSize === 1 ? b.writeUInt8(r, k) : b.writeUInt16BE(r, k * 2)));
    return b;
  };
  const encode = (o) => {
    if (o.kind === 'data') return Buffer.concat([head(0x4, o.v.length), o.v]);
    if (o.kind === 'array') return Buffer.concat([head(0xa, o.refs.length), refs(o.refs)]);
    if (o.kind === 'dict') return Buffer.concat([head(0xd, o.keys.length), refs(o.keys), refs(o.values)]);
    if (o.kind === 'boolean') return Buffer.from([o.v ? 0x09 : 0x08]);
    if (o.kind === 'number' && Number.isInteger(o.v)) { const b = Buffer.alloc(9); b[0] = 0x13; b.writeBigInt64BE(BigInt(o.v), 1); return b; }
    if (o.kind === 'number') { const b = Buffer.alloc(9); b[0] = 0x23; b.writeDoubleBE(o.v, 1); return b; }
    if (o.kind === 'string') {
      const s = String(o.v);
      if ([...s].every((ch) => ch.charCodeAt(0) < 0x80)) return Buffer.concat([head(0x5, s.length), Buffer.from(s, 'latin1')]);
      return Buffer.concat([head(0x6, s.length), Buffer.from(s, 'utf16le').swap16()]);
    }
    return Buffer.from([0x00]);
  };
  const parts = [Buffer.from(MAGIC, 'latin1')];
  const offsets = [];
  let at = 8;
  for (const o of objects) {
    const b = encode(o);
    offsets.push(at);
    parts.push(b);
    at += b.length;
  }
  const table = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, k) => table.writeUInt32BE(o, k * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([...parts, table, trailer]);
}
