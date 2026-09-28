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
