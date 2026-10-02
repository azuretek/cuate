// The About page's one action: put the whole bug-report block on the clipboard. Kept out of core/kit/rules because it
// reaches for the page's clipboard, and the engine bundle is built from the rules and must run with no page. The
// dependencies are injected, so the path is tested without a browser.
export function copyToClipboard(text, { clipboard, document: doc } = {}) {
  const board = clipboard === undefined && typeof navigator !== 'undefined' ? navigator.clipboard : clipboard;
  const page = doc === undefined && typeof globalThis !== 'undefined' ? globalThis.document : doc;
  if (board && typeof board.writeText === 'function') return Promise.resolve(board.writeText(text)).then(() => true, () => false);
  if (!page || typeof page.createElement !== 'function') return Promise.resolve(false);
  try {
    const area = page.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    page.body.append(area);
    area.select();
    const ok = typeof page.execCommand === 'function' ? page.execCommand('copy') : false;
    area.remove();
    return Promise.resolve(Boolean(ok));
  } catch {
    return Promise.resolve(false);
  }
}
