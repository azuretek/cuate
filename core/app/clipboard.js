// Put text on the clipboard: the About page's bug-report block, and a message's Copy link. Kept out of core/kit/rules because it
// reaches for the page's clipboard, and the engine bundle is built from the rules and must run with no page. The
// dependencies are injected, so the path is tested without a browser.
export function copyToClipboard(text, { clipboard, document: doc } = {}) {
  const board = clipboard === undefined && typeof navigator !== 'undefined' ? navigator.clipboard : clipboard;
  const page = doc === undefined && typeof globalThis !== 'undefined' ? globalThis.document : doc;
  // The async clipboard first; a page that refuses it (an Android web view denies the permission) falls back to a copy
  // command on a hidden field, which every shell's web view still honours inside a press.
  const fallback = () => {
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
  };
  if (board && typeof board.writeText === 'function') return Promise.resolve().then(() => board.writeText(text)).then(() => true, fallback);
  return fallback();
}
