// Failure evidence for the desktop smoke. The smoke proves a dozen surfaces in one run, and when a
// step failed it used to end with only "timed out waiting for ..." and nothing about the surface it
// was waiting on, so a sheet stuck mid-departure and a banner that never arrived read the same. This
// module retains, on failure only, what the renderer actually held: a bounded screenshot and a
// sanitized summary of the surface (phase, view, the sheet element and the animation it is running,
// the banner and the update state). It is sanitized on both sides, carries no page content, and never
// throws: a failure path that could itself fail would hide the failure it exists to explain.

const REDACTIONS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <hidden>'],
  [/\bgh[opsu]_[A-Za-z0-9]{20,}\b/g, '<hidden>'],
  [/\b[a-f0-9]{32,}\b/gi, '<hidden>'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '<hidden>'],
  [/(?:token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi, '<hidden>'],
  [/\/home\/[^/\s"']+/g, '/home/<user>'],
  [/\/Users\/[^/\s"']+/g, '/Users/<user>'],
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, 'C:\\Users\\<user>'],
];

// Replace anything secret-shaped, or any runner path that names a person, in one string. The smoke's
// own token and server URL are passed in because they are the values most likely to appear verbatim.
export function sanitizeText(value, secrets = []) {
  let out = String(value ?? '');
  for (const secret of secrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join('<hidden>');
  }
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

// The same, over a whole JSON-safe value, with a depth and breadth bound so a pathological tree cannot
// grow the evidence without limit.
export function sanitizeState(value, secrets = [], depth = 0) {
  if (depth > 8) return '<max-depth>';
  if (typeof value === 'string') return sanitizeText(value, secrets);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeState(item, secrets, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) out[sanitizeText(key, secrets)] = sanitizeState(item, secrets, depth + 1);
    return out;
  }
  return value;
}

// The sheet's own history, recorded as it happens rather than read once at the end. A snapshot taken after a
// timeout shows where the surface stopped, but not whether the sheet's departure ever STARTED, ended unheard,
// or was cancelled, nor whether the page was hidden while it should have run. The intermittent macOS packaged
// smoke failure (job 111169024308, run 37111099406: "timed out waiting for !document.querySelector('.sheet') &&
// ... does not update itself", after the window was hidden to the tray and raised by Check for updates) is
// exactly that question, since the sheet leaves only on its animationend. This records the sheet and scrim
// animation events, the body's leaving class and the page's visibility, with page-relative times, bounded to
// the last TRACE_LIMIT entries so a long run cannot grow it. It is installed once, by the smoke only, and it
// observes: it never changes what the page does.
export const TRACE_LIMIT = 40;

export function smokeTraceInstaller() {
  return [
    '(() => {',
    '  if (window.__smokeTrace) return true;',
    '  const trace = window.__smokeTrace = [];',
    '  const note = (entry) => { trace.push({ t: Math.round(performance.now()), ...entry }); if (trace.length > ' + TRACE_LIMIT + ') trace.shift(); };',
    '  const name = (el) => el && el.classList ? (el.classList.contains("sheet") ? "sheet" : el.classList.contains("sheet-scrim") ? "scrim" : null) : null;',
    '  for (const type of ["animationstart", "animationend", "animationcancel"]) {',
    '    document.addEventListener(type, (e) => { const who = name(e.target); if (who) note({ e: type, who, anim: e.animationName, vis: document.visibilityState }); }, true);',
    '  }',
    '  document.addEventListener("visibilitychange", () => note({ e: "visibility", vis: document.visibilityState }), true);',
    '  let leaving = document.body.classList.contains("surface--leaving");',
    '  new MutationObserver(() => { const now = document.body.classList.contains("surface--leaving"); if (now !== leaving) { leaving = now; note({ e: now ? "leaving-on" : "leaving-off", vis: document.visibilityState }); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });',
    '  return true;',
    '})()',
  ].join('\n');
}

// What the page says about its own surface. It reads the app's state and the sheet's own animation, which
// is what tells a sheet that is leaving from one that is stuck: an element still drawing a finite
// animation is on its way out, while one whose animation never ended or never ran is not.
export function smokeStateExpression() {
  return [
    '(() => {',
    '  const root = document.querySelector("app-root");',
    '  const sheet = document.querySelector(".sheet");',
    '  const scrim = document.querySelector(".sheet-scrim");',
    '  const banner = document.querySelector(".banner.update");',
    '  const anim = (el) => el ? getComputedStyle(el).animationName + " " + getComputedStyle(el).animationDuration + " " + getComputedStyle(el).animationPlayState : null;',
    '  return {',
    '    readyState: document.readyState,',
    '    url: location.href,',
    '    phase: root ? root.phase : null,',
    '    view: root ? root.view : null,',
    '    sheetShowing: root ? root.sheetShowing : null,',
    '    sheetLeaving: root ? root.sheetLeaving : null,',
    '    pendingSheet: root ? root.pendingSheet : null,',
    '    heldScreen: root ? root.heldScreen : null,',
    '    settingsRead: root ? root.settingsRead : null,',
    '    updateStatus: root ? root.updateStatus : null,',
    '    sheetPresent: Boolean(sheet),',
    '    sheetAnimation: anim(sheet),',
    '    scrimPresent: Boolean(scrim),',
    '    scrimAnimation: anim(scrim),',
    '    bodyLeaving: document.body.classList.contains("surface--leaving"),',
    '    bannerPresent: Boolean(banner),',
    '    bannerAction: banner ? Boolean(banner.querySelector(".banner-action")) : false,',
    '    bannerText: banner ? banner.textContent.trim().slice(0, 200) : null,',
    '    onboardingPresent: Boolean(document.querySelector("app-onboarding form")),',
    '    dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.getAttribute("aria-label")),',
    '    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,',
    '    visibility: document.visibilityState,',
    '    trace: Array.isArray(window.__smokeTrace) ? window.__smokeTrace.slice(-' + TRACE_LIMIT + ') : null,',
    '  };',
    '})()',
  ].join('\n');
}

const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// A bounded screenshot of the renderer, by the debugger protocol first and the Electron capture as a
// fallback, exactly as the smoke's own captures do. Answers a PNG Buffer or null; never throws.
export async function captureRenderer(wc, boundMs = 8000) {
  let png = null;
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    const result = await within(wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' }), boundMs);
    if (result && result.data) png = Buffer.from(result.data, 'base64');
  } catch { /* fall back to capturePage */ }
  if (!png) {
    try {
      const image = await within(wc.capturePage(), boundMs);
      if (image && !image.isEmpty()) png = image.toPNG();
    } catch { /* no capture on this host */ }
  }
  return png;
}

// Retain the failure's evidence. Dependencies are injected so the failure path is testable without
// Electron: evaluate(code) runs in the renderer, capture() answers a PNG Buffer, write(name, data)
// stores a file, and the outcome is the sanitized state that was written.
// shell() is optional and answers what the main process knows about the window (shown, minimised, focused), the half
// of a hidden-window question the page cannot see.
export async function retainSmokeFailure({ evaluate, capture, write, error, shell = null, secrets = [], boundMs = 8000, now = () => new Date().toISOString() }) {
  const state = { at: now(), error: (error && error.message) || String(error) };
  if (shell) {
    try { state.shell = shell(); } catch (e) { state.shell = { error: (e && e.message) || String(e) }; }
  }
  try {
    const renderer = await within(Promise.resolve().then(() => evaluate(smokeStateExpression())),
      boundMs);
    state.renderer = renderer === null ? { error: 'the renderer did not answer within ' + boundMs + 'ms' } : renderer;
  } catch (e) {
    state.renderer = { error: (e && e.message) || String(e) };
  }
  const evidence = sanitizeState(state, secrets);
  try {
    const png = await within(Promise.resolve().then(() => capture()), boundMs);
    if (png && png.length) write('failure.png', png);
    else evidence.screenshot = 'none';
  } catch (e) {
    evidence.screenshot = 'failed: ' + ((e && e.message) || String(e));
  }
  try { write('failure.json', JSON.stringify(evidence, null, 1)); } catch { /* the failure stands without it */ }
  return evidence;
}
