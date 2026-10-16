// The desktop smoke's handling of the update notice (issue 404).
//
// The About checks press Check for updates and wait for the notice softly, so a notice that does not appear in
// time is a failed check. The press that dismissed it used to run whether or not it appeared, so a slow notice threw
// in the renderer and ended the whole run with no report. Here the wait answers what it measured, and a dismissal
// with no notice answers false, so the run goes on and fails on the check by name.
//
// Both take the smoke's own `js` (run an expression in the page) and `waitFor` (poll one until true or throw),
// so they touch neither Electron nor the filesystem and are unit tested against a stand-in page.

// What the page shows: whether a notice is there, its words (whitespace folded, bounded) and whether it can be closed.
export const NOTICE_STATE = "(() => { const n = document.querySelector('.app-notice'); if (!n) return { present: false, text: null, closable: false }; return { present: true, text: String(n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160), closable: Boolean(document.querySelector('.app-notice .close-button')) }; })()";

// Press the notice's close control if there is one, and answer whether it was pressed.
export const NOTICE_DISMISS = "(() => { const d = document.querySelector('.app-notice .close-button'); if (!d) return false; d.click(); return true; })()";

// Wait for `expr` up to `ms`, then read the notice whichever way the wait went. Never throws.
export async function awaitNotice({ js, waitFor }, expr, ms, now = Date.now) {
  const t0 = now();
  let error = null;
  try {
    await waitFor(expr, ms);
  } catch (err) {
    error = String((err && err.message) || err).slice(0, 200);
  }
  const waitedMs = now() - t0;
  const notice = await js(NOTICE_STATE).catch(() => null);
  return { seen: error === null, waitedMs, notice, error };
}

// Close the notice if one is shown. Answers true when its close control was pressed, false when there was none.
export async function dismissNotice({ js }) {
  try {
    return (await js(NOTICE_DISMISS)) === true;
  } catch {
    return false;
  }
}
