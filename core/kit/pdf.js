// The bundled pdf.js (issue 374): a PDF is drawn by the same library on every platform, from the app's own files.
// The library is loaded the first time a PDF is shown, never at start, and its worker is the bundle's own copy beside
// it, so nothing is fetched from the network. Where a web view cannot start a worker from the app's own scheme,
// pdf.js runs the same code on the page instead, which is slower but draws the same pages.
//
// pdf.js is given the bytes, never a URL, and is told not to stream or fetch: it reads no font, colour profile or
// decoder from anywhere. A font a PDF names but does not carry is drawn with the system's nearest font.
const VENDOR = './vendor/pdfjs/';
let loading = null;

export function pdfjs() {
  if (!loading) {
    loading = import(VENDOR + 'pdf.min.js').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(VENDOR + 'pdf.worker.min.js', import.meta.url).href;
      return lib;
    });
    // A failed load is not kept, so the next PDF tries again.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

// Opens a PDF's bytes and answers the document, which the caller frees with closePdf when it is done with it.
export async function openPdf(bytes) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    useWorkerFetch: false,
    enableXfa: false,
    verbosity: lib.VerbosityLevel ? lib.VerbosityLevel.ERRORS : 0,
  });
  return task.promise;
}

// Frees a document and the worker behind it. In pdf.js 6 a document has no destroy() of its own: its loading task owns
// the worker and destroys both (issue 408). Never throws, so leaving a PDF always finishes what it was doing.
export function closePdf(doc) {
  const task = doc && doc.loadingTask;
  if (!task || typeof task.destroy !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(task.destroy()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

// A page's own size in PDF points, at its own rotation.
export async function pageSize(doc, number) {
  const page = await doc.getPage(number);
  const v = page.getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}

// Draws one page into a canvas whose bitmap is already sized; answers a handle whose cancel() stops a draw that is no
// longer wanted (the page scrolled away, or the zoom changed under it).
export function drawPage(doc, number, canvas) {
  let task = null;
  let cancelled = false;
  const done = (async () => {
    const page = await doc.getPage(number);
    if (cancelled) return false;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: canvas.width / base.width });
    task = page.render({ canvas, viewport });
    try {
      await task.promise;
      return true;
    } catch (e) {
      if (cancelled || (e && e.name === 'RenderingCancelledException')) return false;
      throw e;
    }
  })();
  return { done, cancel() { cancelled = true; if (task) task.cancel(); } };
}
