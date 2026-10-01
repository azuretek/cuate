// Pure: a strict validator for the models declared in core/spec/api.json.
// Types: string, number, boolean, object, a model name, "T[]" for arrays and "T?" for optional (null allowed).
export function validate(value, type, models, where = '$') {
  const problems = [];
  const check = (v, t, p) => {
    const optional = t.endsWith('?');
    const base = optional ? t.slice(0, -1) : t;
    if (v === undefined || v === null) { if (!optional) problems.push(`${p}: missing`); return; }
    if (base.endsWith('[]')) {
      if (!Array.isArray(v)) { problems.push(`${p}: expected an array`); return; }
      v.forEach((x, i) => check(x, base.slice(0, -2), `${p}[${i}]`));
      return;
    }
    if (base === 'string' || base === 'number' || base === 'boolean') {
      if (typeof v !== base) problems.push(`${p}: expected ${base}, got ${typeof v}`);
      return;
    }
    if (base === 'object') { if (typeof v !== 'object' || Array.isArray(v)) problems.push(`${p}: expected an object`); return; }
    const model = models[base];
    if (!model) { problems.push(`${p}: unknown type ${base}`); return; }
    if (typeof v !== 'object' || Array.isArray(v)) { problems.push(`${p}: expected ${base}`); return; }
    for (const [k, kt] of Object.entries(model)) check(v[k], kt, `${p}.${k}`);
    for (const k of Object.keys(v)) if (!Object.hasOwn(model, k)) problems.push(`${p}.${k}: not declared in ${base}`);
  };
  check(value, type, where);
  return problems;
}

// The same declared types as JSON Schema, so the OpenAPI document and the MCP tool schemas describe exactly the
// shapes this validator enforces. A model becomes a $ref under the prefix a caller gives (OpenAPI components, or
// an MCP tool's own $defs), so there is one owner of a shape and not two.
export function jsonSchema(type, models, refPrefix = '#/components/schemas/') {
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  if (base.endsWith('[]')) return { type: 'array', items: jsonSchema(base.slice(0, -2), models, refPrefix) };
  if (base === 'string') return { type: 'string' };
  if (base === 'number') return { type: 'number' };
  if (base === 'boolean') return { type: 'boolean' };
  if (base === 'object') return { type: 'object' };
  if (base === 'binary') return { type: 'string', format: 'binary' };
  if (!models[base]) throw new Error('unknown type ' + base);
  return { $ref: refPrefix + base };
}

// One model as an object schema, with its non-optional fields required, matching what validate() enforces.
export function modelJsonSchema(name, models, refPrefix = '#/components/schemas/') {
  const model = models[name];
  if (!model) throw new Error('unknown model ' + name);
  const properties = {};
  const required = [];
  for (const [key, type] of Object.entries(model)) {
    properties[key] = jsonSchema(type, models, refPrefix);
    if (!type.endsWith('?')) required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
