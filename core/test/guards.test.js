// Guards that hold the framework's rules: they fail the build rather than rely on anyone remembering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokensCss } from '../kit/rules/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'vendor']);
const walk = (dir) => readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const rel = dir === '.' ? e.name : dir + '/' + e.name;
  return e.isDirectory() ? walk(rel) : [rel];
});
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const importsOf = (src) => [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2] || m[3]);
const CODE = /\.(?:c|m)?js$/;

test('framework code in core/kit imports only from core/kit', () => {
  for (const f of walk('core/kit').filter((f) => CODE.test(f))) {
    for (const spec of importsOf(read(f))) {
      assert.ok(spec.startsWith('.'), f + ' imports ' + spec);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      assert.ok(target.startsWith('core/kit/'), f + ' reaches outside the kit: ' + spec);
    }
  }
});

test('rule modules do no I/O and read no clock', () => {
  const impure = /\b(?:fetch|WebSocket|XMLHttpRequest|localStorage|sessionStorage|indexedDB|setTimeout|setInterval|require)\b|performance\.now|Date\.now|process\.|new Date\(\s*\)|from\s+['"]node:/;
  for (const f of walk('core').filter((f) => /\/rules\/[^/]+\.js$/.test(f))) {
    const m = impure.exec(read(f));
    assert.equal(m, null, f + ' uses ' + (m && m[0]));
  }
});

test('every custom element is defined in core, named app- or kit-', () => {
  for (const f of [...walk('desktop'), ...walk('server'), ...walk('scripts')].filter((f) => CODE.test(f))) assert.ok(!/customElements\.define/.test(read(f)), f);
  const names = walk('core/app/components').map((f) => /customElements\.define\('([^']+)'/.exec(read(f))?.[1]).filter(Boolean);
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => n.startsWith('app-') || n.startsWith('kit-')), names.join(', '));
});

test('component CSS carries no literal colours or lengths', () => {
  for (const f of walk('core/app/styles').filter((f) => f.endsWith('.css') && !f.endsWith('tokens.css'))) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.exec(src), null, f + ' has a literal colour');
    const body = src.split('\n').filter((l) => !l.trim().startsWith('@media')).join('\n');
    const lengths = (body.match(/(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s|vh|vw)\b/g) || []).filter((v) => v !== '1px');
    assert.deepEqual(lengths, [], f + ' has literal lengths');
  }
});

test('no component writes a style attribute, which the page\'s Content-Security-Policy drops', () => {
  // style-src 'self' refuses inline style attributes, so one written in a template never applies: the System, Light,
  // Dark thumb's position was one, and it never left System (issue 135). Custom properties are set with
  // style.setProperty or chosen by an attribute selector in the stylesheet.
  for (const f of walk('core/app/components')) assert.equal(/\sstyle=/.test(read(f)), false, f + ' writes a style attribute');
});

test('the scrollbars are one set, on the containers that scroll', () => {
  // One set for the whole app, on the scroll containers rather than a component each, and no ::-webkit-scrollbar:
  // a width there turns an overlay scrollbar into a classic one, which ends the overlay behaviour a platform draws
  // its own bar with. A component that carried the styling itself would be a second set, so both fail here.
  const css = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((css.match(/scrollbar-(?:width|color)\s*:/g) || []).length, 2, 'the scrollbar styling is one set');
  assert.equal(/::-webkit-scrollbar/.test(css), false, 'a platform drawing overlay scrollbars keeps them');
  for (const f of walk('core/app/components')) assert.equal(/scrollbar/i.test(read(f)), false, f + ' styles a scrollbar');
});

test('the send arrow takes its size and weight from tokens', () => {
  // The arrow fills its circle by scaling with the button rather than by a size
  // written into the markup: its font size is derived from the button's own size
  // token and its weight is the bold token, so both follow a change to the button.
  // The glyph itself stays an arrow in the template and carries no style of its own.
  const tokens = json('core/spec/tokens.json');
  const size = tokens.font['size-send'];
  assert.equal(typeof size, 'string', 'the send glyph has a size token');
  assert.match(size, /var\(--size-avatar\)/, 'the glyph scales with the button');
  const css = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /\.send\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the .send rule exists');
  assert.match(rule[1], /font-size:\s*var\(--font-size-send\)/, 'the glyph size comes from its token');
  assert.match(rule[1], /font-weight:\s*var\(--font-weight-bold\)/, 'the glyph weight comes from the bold token');
  const markup = read('core/app/components/app-composer.js');
  assert.ok(markup.includes('class="send"') && markup.includes('u2191'), 'the button still carries the arrow glyph');
  assert.equal(/style=/.test(markup), false, 'the glyph carries no inline style');
});

test('the product name lives only where naming.json says', () => {
  const naming = json('core/spec/naming.json');
  const re = new RegExp(naming.slug, 'i');
  const files = [...walk('core'), ...walk('server'), ...walk('desktop'), ...walk('scripts')].filter((f) => CODE.test(f) || /\.(?:css|html)$/.test(f));
  for (const f of files) assert.ok(!re.test(read(f)), f + ' carries the product name');
  const pkg = json('package.json');
  assert.equal(pkg.name, naming.slug);
  assert.ok(pkg.repository.url.includes(naming.repo));
});

test('tokens.css is fresh', () => {
  assert.equal(read('core/app/styles/tokens.css'), tokensCss(json('core/spec/tokens.json')));
});

test('the vendored Lit build is the pinned one', () => {
  const h = createHash('sha256').update(readFileSync(path.join(ROOT, 'core/kit/vendor/lit-core.min.js'))).digest('hex');
  assert.equal(h, 'f607f470475d8ab790754cb70f72cdbe2390c4a57ab59df6cdb360eeb72bd87c');
});

test('the API spec is complete and consistent', () => {
  const api = json('core/spec/api.json');
  const known = new Set(['string', 'number', 'boolean', 'object', 'binary', ...Object.keys(api.models)]);
  const base = (t) => t.replace(/\?$/, '').replace(/\[\]$/, '');
  const scopes = new Set(Object.values(api.scopes).flat());
  for (const r of api.routes) {
    assert.ok(r.id && r.method && r.path && r.scope, JSON.stringify(r));
    assert.ok(r.scope === 'none' || r.scope === 'any' || scopes.has(r.scope), r.id + ' has an unknown scope');
    assert.ok(known.has(base(r.returns)), r.id + ' returns an unknown type');
    if (r.body) assert.ok(known.has(r.body), r.id + ' takes an unknown body');
  }
  for (const t of Object.values(api.events)) assert.ok(known.has(t), t);
  for (const [name, p] of Object.entries(api.paging)) assert.ok(Number.isInteger(p.default) && Number.isInteger(p.max) && p.default >= 1 && p.default <= p.max, 'paging for ' + name);
  for (const [name, fields] of Object.entries(api.models)) for (const t of Object.values(fields)) assert.ok(known.has(base(t)), name + ' uses ' + t);
});

test('every log event has a level, a message and typed fields', () => {
  const spec = json('core/spec/log-events.json');
  for (const [name, e] of Object.entries(spec.events)) {
    assert.ok(spec.levels.includes(e.level), name);
    assert.equal(typeof e.msg, 'string', name);
    for (const t of Object.values(e.fields)) assert.match(t, /^(?:string|number|boolean)\??$/, name);
  }
});

test('no em dash anywhere in the repository', () => {
  for (const f of walk('.').filter((f) => /\.(?:c|m)?js$|\.(?:json|md|css|html|ya?ml)$/.test(f))) assert.ok(!read(f).includes('\u2014'), f);
});

test('the app never names the messaging transport', () => {
  // The transport is an implementation fact. The repository says which client it provides (README.md, package.json),
  // the docs explain the engine, the engine adapter maps its JSON, the server drives the Mac app that carries it, and
  // the fixtures, the generated bundle and the server's log spec hold it (issue 56). Everywhere a person reads the
  // app it is not named. These allowed paths are named here, so a match anywhere else fails rather than by accident.
  const NAMES = /\biMessage\b|\bMessages\b/;
  const ALLOWED = ['README.md', 'package.json', 'docs/', 'server/', 'core/test/', 'core/build/', 'core/fixtures/',
    'core/spec/log-events.json', 'core/app/rules/engine-imsg.js', 'scripts/gen-engine-fixtures.mjs'];
  const allowed = (f) => ALLOWED.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
  for (const f of walk('.').filter((f) => /\.(?:c|m)?js$|\.(?:json|md|css|html|ya?ml)$/.test(f))) {
    if (allowed(f)) continue;
    const m = NAMES.exec(read(f));
    assert.equal(m, null, f + ' names the transport: ' + (m && m[0]));
  }
});

// Every button in the app goes through the kit's one press behaviour (issue 140): its click is press(...), or a handler
// the component built with press(...), and a submit button's form submits through press(...). A button that set its
// own busy state or its own busy disabling would be a second behaviour beside the kit's, so both fail here too.
test('every button in core/app goes through the kit press behaviour', () => {
  const tags = (src) => {
    const out = [];
    for (let i = src.indexOf('<button'); i >= 0; i = src.indexOf('<button', i + 1)) {
      let depth = 0;
      let j = i;
      for (; j < src.length; j += 1) {
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
        else if (src[j] === '>' && depth === 0) break;
      }
      out.push(src.slice(i, j + 1));
    }
    return out;
  };
  let seen = 0;
  for (const f of walk('core/app').filter((f) => CODE.test(f))) {
    const src = read(f);
    const built = new Set([...src.matchAll(/this\.(\w+)\s*=\s*press\(/g)].map((m) => m[1]));
    const viaPress = (expr) => /^press\(/.test(expr) || (/^this\.(\w+)$/.test(expr) && built.has(expr.slice(5)));
    for (const tag of tags(src)) {
      seen += 1;
      const click = /@click=\$\{\s*([^\s}]+(?:\([^]*?)?)/.exec(tag);
      if (/type="submit"/.test(tag)) {
        const submit = /@submit=\$\{\s*([\w.]+\(?)/.exec(src);
        assert.ok(submit && viaPress(submit[1].replace(/\($/, '(')), f + ': a submit button whose form does not submit through press(): ' + tag.slice(0, 80));
      } else {
        assert.ok(click && viaPress(click[1]), f + ': a button that does not go through press(): ' + tag.slice(0, 80));
      }
      assert.ok(!/aria-busy|aria-disabled|data-press/.test(tag), f + ': a button that draws its own press state: ' + tag.slice(0, 80));
      assert.ok(!/\?disabled=\$\{[^}]*(?:busy|Busy|loading|Loading|pending|Pending)/.test(tag), f + ': a button with its own busy disabling: ' + tag.slice(0, 80));
    }
  }
  assert.ok(seen > 20, 'the guard found the buttons');
});

// Every scroll container keeps its place across a re-render and a resize (issue 142): each selector the stylesheet
// lets scroll is the scroller of a keepScroll() in a component.
test('every scrolled view keeps its place through the kit', () => {
  const css = read('core/app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const scrolled = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /overflow(?:-y|-x)?\s*:\s*(?:auto|scroll)/.test(m[2]))
    .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    .filter((s) => s && !s.startsWith('@'));
  assert.ok(scrolled.length >= 4, 'the guard found the scroll containers: ' + scrolled.join(', '));
  const components = walk('core/app/components').map(read).join('\n');
  const kept = new Set([...components.matchAll(/keepScroll\(this,\s*\{\s*scroller:\s*'([^']+)'/g)].map((m) => m[1]));
  for (const s of scrolled) assert.ok(kept.has(s), s + ' scrolls but no component keeps its place with keepScroll()');
});

// Nothing reloads the page or rebuilds a view from empty (issue 142). No code asks the page or the window to load
// again, and no component empties a list and then waits for its replacement: data is replaced in one step.
test('nothing reloads the page or clears a list before its replacement arrives', () => {
  const RELOAD = /location\.reload|location\.(?:assign|replace)\(|location\.href\s*=|window\.location\s*=|webContents\.reload|\.reloadIgnoringCache|\.loadURL\(/;
  for (const f of [...walk('core/app'), ...walk('core/kit'), ...walk('desktop/src')].filter((f) => CODE.test(f))) {
    const src = read(f);
    const hits = src.split('\n').filter((l) => RELOAD.test(l));
    // The shell loads the page once, when it creates the window.
    const allowed = f === 'desktop/src/main.js' ? hits.filter((l) => !/win\.loadURL\('app:\/\/bundle\/app\/index\.html'\)/.test(l)) : hits;
    assert.deepEqual(allowed, [], f + ' reloads the page');
    if (f === 'desktop/src/main.js') assert.equal(hits.length, 1, 'the window loads the page once');
  }
  for (const f of walk('core/app/components').filter((f) => CODE.test(f))) {
    const src = read(f);
    for (const m of src.matchAll(/\n {2}async (\w+)\([^)]*\)\s*\{([\s\S]*?)\n {2}\}\n/g)) {
      const body = m[2];
      const cleared = /this\.\w+\s*=\s*(?:\[\]|\{\})/.exec(body);
      if (!cleared) continue;
      const waits = body.indexOf('await', cleared.index);
      assert.equal(waits, -1, f + ' ' + m[1] + '() clears ' + cleared[0] + ' and then waits for its replacement');
    }
  }
});

// The Android shell handles a rotation, a split-screen resize, a keyboard and a dark-mode change itself, so none of them
// recreates the activity, which would load the page again from nothing (issue 142). iOS's web view never reloads on
// rotation, so it needs no counterpart.
test('the Android shell keeps its page through rotation and resizing', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const m = /android:name="\.MainActivity"[\s\S]*?android:configChanges="([^"]+)"/.exec(manifest);
  assert.ok(m, 'MainActivity declares the changes it handles');
  const handled = new Set(m[1].split('|'));
  for (const c of ['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'keyboard', 'keyboardHidden', 'navigation', 'uiMode']) assert.ok(handled.has(c), 'a change of ' + c + ' would reload the page');
});
// A reactive property named like one of the element's own methods replaces that method on the instance, so the next
// render calls a value and throws. It happened once (issue 134: a `section` property over the method that draws a
// section), and only the desktop smoke caught it, so it is held here.
test('no component declares a property with the name of one of its methods', () => {
  for (const f of walk('core/app/components').filter((f) => f.endsWith('.js'))) {
    const src = read(f);
    const block = /static properties = \{([\s\S]*?)\n {2}\};|static properties = \{([^\n]*)\};/.exec(src);
    if (!block) continue;
    const props = [...(block[1] || block[2]).matchAll(/(\w+):\s*\{/g)].map((m) => m[1]);
    const methods = new Set([...src.matchAll(/^ {2}(?:async |get |set |static )?(\w+)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]));
    for (const p of props) assert.ok(!methods.has(p), f + ': the property ' + p + ' would replace the method ' + p + '()');
  }
});
