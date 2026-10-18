// Apple's typedstream, the NSArchiver format Messages keeps a message's words in (the attributedBody column), read in
// plain JavaScript so it runs off the Mac as well as on it. The engine already recovers the words themselves; what it
// does not carry is the attributes laid over them: the text effects and styles a sender chose for a stretch of the
// message. This reads the stream generically (values, classes, objects and the references between them) and then
// reads one shape out of it, an attributed string: its words and, per run of them, the attributes in force.
//
// Only what a typedstream can hold is read. A length, a reference or a type the stream cannot hold is refused with a
// code, never guessed past, so a damaged row is a message drawn plain rather than a crash.
const TAG_INTEGER_2 = -127;
const TAG_INTEGER_4 = -126;
const TAG_FLOATING_POINT = -125;
const TAG_NEW = -124;
const TAG_NIL = -123;
const TAG_END_OF_OBJECT = -122;
const FIRST_TAG = -128;
const LAST_TAG = -111;
const FIRST_REFERENCE = LAST_TAG + 1;
// How deep objects may nest before the stream is refused: an attributed string is three or four levels.
const MAX_DEPTH = 64;

const bad = (why) => Object.assign(new Error('a damaged typedstream: ' + why), { code: 'bad_typedstream' });

// One type encoding string split into the encodings of the values it describes: iI is two values, [16c] and
// {_NSRange=QQ} are one each.
export function splitEncodings(encoding) {
  const s = String(encoding);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const start = i;
    const open = s[i];
    if (open === '[' || open === '{' || open === '(') {
      const close = open === '[' ? ']' : open === '{' ? '}' : ')';
      let depth = 0;
      for (; i < s.length; i += 1) {
        if (s[i] === open) depth += 1;
        else if (s[i] === close) { depth -= 1; if (depth === 0) break; }
      }
      if (depth !== 0) throw bad('an unclosed type encoding');
      i += 1;
    } else {
      i += 1;
    }
    out.push(s.slice(start, i));
  }
  return out;
}

/**
 * Every top level value the stream holds, in order. An object is { class, classes, groups }: its class's name, the
 * names of its class chain from itself to its root, and the typed value groups it wrote, each an array of values.
 * Integers and floats are numbers, an unshared string is a Buffer, a C string is a string, a class is { name, version,
 * superclass }, and a byte array is a Buffer.
 * @param {Buffer | Uint8Array} input
 */
export function readTypedStream(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  let at = 0;
  const need = (n) => { if (n < 0 || at + n > buf.length) throw bad('it ends early'); };
  const head = () => { need(1); const v = buf.readInt8(at); at += 1; return v; };
  if (buf.length < 13 || buf[0] !== 4 || buf[1] !== 11) throw bad('no typedstream header');
  const signature = buf.toString('latin1', 2, 13);
  const little = signature === 'streamtyped';
  if (!little && signature !== 'typedstream') throw bad('no typedstream signature');
  at = 13;

  const integer = (h, signed) => {
    if (h < FIRST_TAG || h > LAST_TAG) return signed ? h : h & 0xff;
    if (h === TAG_INTEGER_2) { need(2); const v = signed ? (little ? buf.readInt16LE(at) : buf.readInt16BE(at)) : (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at)); at += 2; return v; }
    if (h === TAG_INTEGER_4) { need(4); const v = signed ? (little ? buf.readInt32LE(at) : buf.readInt32BE(at)) : (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at)); at += 4; return v; }
    throw bad('a tag where an integer belongs');
  };
  const real = (h, size) => {
    if (h !== TAG_FLOATING_POINT) return integer(h, true);
    need(size);
    const v = size === 4 ? (little ? buf.readFloatLE(at) : buf.readFloatBE(at)) : (little ? buf.readDoubleLE(at) : buf.readDoubleBE(at));
    at += size;
    return v;
  };
  const bytes = (n) => { need(n); const v = buf.subarray(at, at + n); at += n; return v; };
  const unshared = (h) => (h === TAG_NIL ? null : bytes(integer(h, false)));

  const strings = [];
  const shared = (h) => {
    if (h === TAG_NIL) return null;
    if (h === TAG_NEW) {
      const s = unshared(head());
      if (s === null) throw bad('a nil shared string');
      const text = s.toString('latin1');
      strings.push(text);
      return text;
    }
    const i = integer(h, true) - FIRST_REFERENCE;
    if (i < 0 || i >= strings.length) throw bad('a reference to a string it does not hold');
    return strings[i];
  };

  // Objects, classes and C strings share one table, numbered in the order they are first written.
  const table = [];
  const lookup = (h) => {
    const i = integer(h, true) - FIRST_REFERENCE;
    if (i < 0 || i >= table.length) throw bad('a reference to an object it does not hold');
    return table[i];
  };
  const cString = (h) => {
    if (h === TAG_NIL) return null;
    if (h !== TAG_NEW) return lookup(h);
    const s = shared(head());
    if (s === null) throw bad('a nil C string');
    table.push(s);
    return s;
  };
  const klass = (h) => {
    const chain = [];
    while (h === TAG_NEW) {
      const name = shared(head());
      if (name === null) throw bad('a class with no name');
      chain.push({ name, version: integer(head(), true), superclass: null });
      h = head();
    }
    let superclass = h === TAG_NIL ? null : lookup(h);
    if (superclass !== null && (typeof superclass !== 'object' || !('version' in superclass))) throw bad('a class that is not one');
    for (let i = chain.length - 1; i >= 0; i -= 1) { chain[i].superclass = superclass; superclass = chain[i]; }
    for (const c of chain) table.push(c);
    return superclass;
  };
  const object = (h, depth) => {
    if (h === TAG_NIL) return null;
    if (h !== TAG_NEW) return lookup(h);
    if (depth > MAX_DEPTH) throw bad('objects nested too deep');
    const obj = { class: null, classes: [], groups: [] };
    table.push(obj);
    const c = klass(head());
    if (!c) throw bad('an object with no class');
    obj.class = c.name;
    for (let k = c; k; k = k.superclass) obj.classes.push(k.name);
    for (let next = head(); next !== TAG_END_OF_OBJECT; next = head()) obj.groups.push(group(next, depth + 1));
    return obj;
  };
  // A value of one type, its head byte already read. A single byte value (B, C, c) is the head byte itself.
  const value = (type, h, depth) => {
    if (type === 'B') return (h & 0xff) === 1;
    if (type === 'C') return h & 0xff;
    if (type === 'c') return h;
    if ('SILQ'.includes(type)) return integer(h, false);
    if ('silq'.includes(type)) return integer(h, true);
    if (type === 'f') return real(h, 4);
    if (type === 'd') return real(h, 8);
    if (type === '*') return cString(h);
    if (type === '%' || type === ':') return shared(h);
    if (type === '+') return unshared(h);
    if (type === '#') return klass(h);
    if (type === '@') return object(h, depth);
    if (type === '!') return null;
    if (type.startsWith('[')) {
      const m = /^\[(\d+)(.+)\]$/.exec(type);
      if (!m) throw bad('an array encoding it cannot read');
      const n = Number(m[1]);
      if (m[2] === 'c' || m[2] === 'C') { at -= 1; return Buffer.from(bytes(n)); }
      const out = [];
      for (let i = 0; i < n; i += 1) out.push(value(m[2], i === 0 ? h : head(), depth));
      return out;
    }
    if (type.startsWith('{')) {
      const m = /^\{[^=]*=(.*)\}$/.exec(type);
      if (!m) throw bad('a struct encoding it cannot read');
      return splitEncodings(m[1]).map((t, i) => value(t, i === 0 ? h : head(), depth));
    }
    throw bad('a type it cannot read');
  };
  const group = (h, depth) => {
    const encoding = shared(h);
    if (encoding === null) throw bad('a value group with no type');
    return splitEncodings(encoding).map((t) => value(t, head(), depth));
  };

  // The header is followed by the stream's system version, then its top level value groups.
  integer(head(), false);
  const values = [];
  while (at < buf.length) values.push(...group(head(), 0));
  return values;
}

const isKind = (o, name) => Boolean(o) && typeof o === 'object' && Array.isArray(o.classes) && o.classes.includes(name);

// A Foundation object as the plain value it stands for: an NSString its words, an NSNumber its number, an NSDictionary
// a Map of the same, and anything else the object itself.
export function plain(o) {
  if (isKind(o, 'NSString')) {
    const b = o.groups[0] && o.groups[0][0];
    return Buffer.isBuffer(b) ? b.toString('utf8') : '';
  }
  if (isKind(o, 'NSValue')) return o.groups[1] ? o.groups[1][0] : null;
  if (isKind(o, 'NSDictionary')) {
    const out = new Map();
    const count = Number(o.groups[0] && o.groups[0][0]) || 0;
    for (let i = 0; i < count; i += 1) {
      const k = o.groups[1 + i * 2];
      const v = o.groups[2 + i * 2];
      if (!k || !v) break;
      out.set(plain(k[0]), plain(v[0]));
    }
    return out;
  }
  return o;
}

/**
 * The attributed string a typedstream holds: its words, and its runs in order, each a start and a length in UTF-16
 * code units (as NSString counts, and as JavaScript does) with the attributes in force over it as a Map.
 * @param {Buffer | Uint8Array} input
 * @returns {{ text: string, runs: { start: number, length: number, attributes: Map<string, any> }[] }}
 */
export function readAttributedString(input) {
  const top = readTypedStream(input).find((v) => isKind(v, 'NSAttributedString'));
  if (!top) throw bad('no attributed string');
  const [first, ...rest] = top.groups;
  const text = first && isKind(first[0], 'NSString') ? plain(first[0]) : null;
  if (text === null) throw bad('an attributed string with no words');
  // Each run is its length after an index into the attribute dictionaries met so far, numbered from 1: an index one
  // past the last is a dictionary not seen before, written in the group that follows.
  const dictionaries = [];
  const runs = [];
  let start = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const g = rest[i];
    if (g.length !== 2 || typeof g[0] !== 'number' || typeof g[1] !== 'number') throw bad('a run it cannot read');
    const [index, length] = g;
    if (index === dictionaries.length + 1) {
      const d = rest[i + 1] && rest[i + 1][0];
      if (!isKind(d, 'NSDictionary')) throw bad('a run with no attributes');
      dictionaries.push(plain(d));
      i += 1;
    } else if (index < 1 || index > dictionaries.length) {
      throw bad('a run naming attributes it does not hold');
    }
    if (length < 0 || start + length > text.length) throw bad('a run past the words');
    runs.push({ start, length, attributes: dictionaries[index - 1] });
    start += length;
  }
  return { text, runs };
}
