import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { isMediaAttachment, mediaKind, isLivePhoto } from '../rules/media.js';
import { previewKind, filePress } from '../rules/documents.js';
import { playsInPlace } from '../rules/audio.js';
import './app-audio.js';

const needsJpeg = (a) => /heic|heif/i.test(a.mime);

// The pictures and videos already fetched, held in memory for the life of the page by attachment id (and the form it
// was asked for), most recently used last. A conversation's rows are reused as it re-renders (a refetch, a switch to
// another conversation and back, older messages landing above), so a row's attachment changes under it; drawing the
// held bytes at once, rather than a placeholder until the server answers again, is what keeps every row the height it
// was and the conversation where the person left it. Bounded, and the oldest is let go when it is full.
export const HELD_MEDIA_MAX = 400;
const held = new Map();
const heldKey = (a) => String(a.id) + (needsJpeg(a) ? ':jpeg' : '');
export function heldMedia(a) {
  if (!a || !isMediaAttachment(a)) return '';
  const key = heldKey(a);
  const url = held.get(key);
  if (!url) return '';
  held.delete(key);
  held.set(key, url);
  return url;
}
export function holdMedia(a, url, key = heldKey(a)) {
  held.set(key, url);
  while (held.size > HELD_MEDIA_MAX) {
    const [key, old] = held.entries().next().value;
    held.delete(key);
    URL.revokeObjectURL(old);
  }
}
// A video's poster (issue 415), the still the server makes from it, held beside the video by the same rule.
const posterKey = (a) => String(a.id) + ':poster';
export function heldPoster(a) {
  if (!a || mediaKind(a) !== 'video') return '';
  const url = held.get(posterKey(a));
  if (!url) return '';
  held.delete(posterKey(a));
  held.set(posterKey(a), url);
  return url;
}
const holdPoster = (a, url) => holdMedia(a, url, posterKey(a));
// The device's store (issue 441), which keeps the pictures tiles draw across launches under its own byte cap, or null.
// A picture it holds is drawn from it with no server read; one it lacks is fetched and offered to it.
let mediaStore = null;
export function useMediaStore(store) { mediaStore = store || null; }
async function fetchTile(client, a, options, signal) {
  const kept = mediaStore ? await mediaStore.media(a, options).catch(() => null) : null;
  if (kept) return kept;
  if (!client) throw Object.assign(new Error('No server yet.'), { code: 'no_client' });
  const blob = await client.attachment(a.id, { ...options, signal });
  if (mediaStore) mediaStore.keepMedia(a, blob, options).catch(() => {});
  return blob;
}
// A conversation's own picture (its avatar or group photo, a person's face, its backdrop) by the same rule: drawn from
// the device's store when it holds it, with no server needed yet, else fetched and offered to it.
export const canFetchPicture = (client) => Boolean(client || mediaStore);
export async function fetchPicture(client, a) {
  const kept = mediaStore ? await mediaStore.media(a, { kind: 'picture' }).catch(() => null) : null;
  if (kept) return kept;
  if (!client) throw Object.assign(new Error('No server yet.'), { code: 'no_client' });
  const blob = await client.attachment(a.id);
  if (mediaStore) mediaStore.keepMedia(a, blob, { kind: 'picture' }).catch(() => {});
  return blob;
}
// Where the server has no poster, the video is drawn a tenth of a second in: a media fragment makes the web view seek
// and paint that frame, where a video that read only its metadata paints nothing at all on iPhone (issue 415).
export const FIRST_FRAME = '#t=0.1';
const mediaLabel = (kind) => (kind === 'video' ? 'video' : 'image');

// A file in a conversation is kept with Save and handed to the device's own apps with Open in (issues 219 and 374):
// the page hands the shell the file's bytes under its real name and type. Save offers to keep it, a save dialog on the
// desktop and the share or save sheet on a phone; Open in opens it in the system's default app for its type on the
// desktop, Quick Look on an iPhone and the Open with chooser on Android. A page with no shell (a plain browser)
// downloads it under that name for either, which is how a browser hands a file to the system.
export function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function handFile(command, a, { client, bridge = globalThis.window?.bridge, doc = globalThis.document } = {}) {
  if (!a || a.local || a.missing || !client) return false;
  const blob = await client.attachment(a.id);
  const name = String(a.name || 'Attachment');
  const mime = String(a.mime || blob.type || 'application/octet-stream');
  if (bridge && typeof bridge.call === 'function') {
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    return bridge.call(command, { name, mime, data });
  }
  const href = URL.createObjectURL(blob);
  try {
    const link = doc.createElement('a');
    link.href = href;
    link.download = name;
    link.click();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }
}

export const saveAttachment = (a, options) => handFile('file.save', a, options);
export const openAttachment = (a, options) => handFile('file.open', a, options);

class AppAttachment extends KitElement {
  static properties = { attachment: { attribute: false }, client: { attribute: false }, mine: { attribute: false }, src: { state: true }, poster: { state: true }, failed: { state: true }, linkUrl: { attribute: false } };

  constructor() {
    super();
    this.src = '';
    this.poster = '';
    this.failed = false;
    // A link whose video the server resolves (issue 243): the still previews it, and a press plays the video rather
    // than the still. Empty for an ordinary attachment.
    this.linkUrl = '';
    // Whether the message is one we sent, so a recording of ours is never marked as not played (issue 432).
    this.mine = false;
  }

  // The bytes belong to the held set above, which lets them go, so an element leaving the page keeps nothing to free.
  // An attachment already held is drawn in the same render that brings it, never a placeholder first.
  willUpdate(changed) {
    if (changed.has('attachment') && changed.get('attachment')?.id !== this.attachment?.id) {
      this.failed = false;
      this.src = heldMedia(this.attachment);
      this.poster = heldPoster(this.attachment);
    }
  }

  // Only what is seen is fetched: a picture is asked for when its row comes within a screen of the view, so a long
  // conversation does not pull every picture it holds the moment it opens, and one scrolled toward is there before it
  // is reached. Where there is no observer (a test, an old engine) it is fetched at once, as before.
  // A row reused for another message re-arms the watch, so its new picture waits to be seen as a fresh one does.
  fetchWhenSeen() {
    if (typeof IntersectionObserver !== 'function' || !this.isConnected) {
      this.load();
      return;
    }
    if (!this.watch) {
      this.watch = new IntersectionObserver((entries) => {
        if (!entries.some((x) => x.isIntersecting)) return;
        this.watch.disconnect();
        if (!this.src && !this.failed) this.load();
      }, { rootMargin: '100% 0px' });
    }
    this.watch.disconnect();
    this.watch.observe(this);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated && !this.src && !this.failed) this.fetchWhenSeen();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.loadRequest?.abort();
    this.loadRequest = null;
    if (this.watch) this.watch.disconnect();
    this.posterRequest?.abort();
    this.posterRequest = null;
  }

  updated(changed) {
    // A tile drawn from the device's store before the server was reached asks again once it is (issue 441).
    if (changed.has('client') && this.client && !changed.get('client') && !changed.has('attachment')) {
      if (!this.src && !this.failed) this.fetchWhenSeen();
      else if (this.src && !this.poster) this.loadPoster();
    }
    if (changed.has('attachment') && changed.get('attachment')?.id !== this.attachment?.id) {
      this.loadRequest?.abort();
      this.loadRequest = null;
      this.posterRequest?.abort();
      this.posterRequest = null;
      this.failed = false;
      this.src = heldMedia(this.attachment);
      this.poster = heldPoster(this.attachment);
      if (!this.src) this.fetchWhenSeen();
      else if (!this.poster) this.loadPoster();
    }
  }

  // A load lands while the element still shows the attachment it asked for, matched by id as updated() matches it: a
  // resync refetches the open conversation in place, so the same attachment arrives as a new object mid-load, and an
  // identity check dropped the blob with no second load to replace it, leaving the placeholder up for good.
  async load() {
    const a = this.attachment;
    if (!isMediaAttachment(a) || (!this.client && !mediaStore)) return;
    const request = new AbortController();
    this.loadRequest?.abort();
    this.loadRequest = request;
    if (!this.poster) this.loadPoster();
    try {
      const blob = await fetchTile(this.client, a, needsJpeg(a) ? { format: 'jpeg' } : {}, request.signal);
      if (request.signal.aborted || !this.isConnected || this.attachment?.id !== a.id) return;
      const url = heldMedia(a) || URL.createObjectURL(blob);
      holdMedia(a, url);
      if (this.attachment?.id === a.id) this.src = url;
    } catch (e) {
      if (!request.signal.aborted && this.attachment?.id === a.id && e?.code !== 'no_client') this.failed = true;
    } finally { if (this.loadRequest === request) this.loadRequest = null; }
  }

  // A video's poster is asked for beside the video itself (issue 415). A server with none (one not on a Mac, or a still
  // it could not make) answers 404, and the tile then draws the video's own first frame, so a missing poster is never
  // a failed video. It lands under the same id match as the video.
  async loadPoster() {
    const a = this.attachment;
    if (!a || mediaKind(a) !== 'video' || a.sticker || (!this.client && !mediaStore)) return;
    const request = new AbortController();
    this.posterRequest?.abort();
    this.posterRequest = request;
    try {
      const blob = await fetchTile(this.client, a, { part: 'poster' }, request.signal);
      if (request.signal.aborted || !this.isConnected || this.attachment?.id !== a.id) return;
      const url = heldPoster(a) || URL.createObjectURL(blob);
      holdPoster(a, url);
      this.poster = url;
    } catch {
      // No poster: the first frame is drawn from the video.
    } finally { if (this.posterRequest === request) this.posterRequest = null; }
  }

  // Pressing a preview opens it in the viewer, which the page draws over everything (app-image-viewer). The detail names
  // the attachment and its kind so the viewer can step to the conversation's other media (issue 181).
  open() {
    if (!this.src) return;
    // The preview itself goes with the press, so the viewer grows out of it and shrinks back into it (issue 316).
    const from = this.querySelector('img, video') || this;
    // A still that previews a linked video hands the viewer the link, not an attachment of ours, so the viewer plays
    // the video the server holds (issue 243). Otherwise the attachment opens as itself, exactly as before.
    if (this.linkUrl) {
      this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { src: this.src, alt: this.attachment?.name || 'Video', linkUrl: this.linkUrl, kind: 'video', from } }));
      return;
    }
    this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { from, src: this.src, alt: this.attachment?.name || '', attachmentId: this.attachment?.id || '', kind: isLivePhoto(this.attachment) ? 'video' : mediaKind(this.attachment) || 'image' } }));
  }

  // Pressing a document (issue 374): a kind the app shows itself (a PDF or text) opens in the
  // media viewer, which offers Open in and Save beside it; any other kind goes straight to Open in. The press stops
  // here, so the message it sits in never takes it as a press of its own (a thread reply's text opens its thread; an
  // attachment never does).
  pressDocument(e) {
    e?.stopPropagation?.();
    const a = this.attachment;
    if (filePress(a) === 'view') {
      this.dispatchEvent(new CustomEvent('view-image', { bubbles: true, composed: true, detail: { from: this, document: true, attachmentId: a.id, kind: previewKind(a), alt: a.name || '', name: a.name || '', mime: a.mime || '' } }));
      return undefined;
    }
    return openAttachment(a, { client: this.client });
  }

  render() {
    const a = this.attachment;
    if (!a) return nothing;
    if (isMediaAttachment(a) && !this.failed) {
      const kind = mediaKind(a);
      // A sticker is drawn as it is, on the bubble's background; a picture is a preview at its own aspect ratio, sized
      // to fit, dressed with a shadow, a rounded edge and a hairline border; a video is drawn the same way, its poster
      // or else its first frame in place of the picture (issue 415). Pressing either opens the media viewer (issues 126 and 181).
      if (this.src && a.sticker) return html`<img class="attachment-image sticker" src=${this.src} alt=${a.name}>`;
      if (!this.src) return html`<div class="attachment-image placeholder" role="img" aria-label=${'Loading ' + mediaLabel(kind)}></div>`;
      const media = kind === 'video'
        ? html`<video class="attachment-image" src=${this.src + FIRST_FRAME} poster=${this.poster || nothing} muted playsinline preload="metadata" aria-label=${a.name}></video>`
        : html`<img class="attachment-image" src=${this.src} alt=${a.name}>`;
      // Anything that moves, a video or a Live Photo, is drawn as its picture with a small play mark in its corner, so it
      // reads as something that plays before it is pressed; pressing it plays it in the viewer.
      const moves = kind === 'video' || isLivePhoto(a);
      const label = (moves ? 'Play ' : 'Open ') + a.name;
      return html`<button type="button" class="attachment-preview" aria-label=${label} data-moves=${moves ? 'true' : nothing} @click=${press(() => this.open())}>${media}${moves ? html`<span class="media-play" aria-hidden="true"><span class="icon" data-icon="play"></span></span>` : nothing}</button>`;
    }
    // A recording plays where it was sent (issue 432), in a player of its own. One the web view cannot fetch or play
    // is drawn as the file card below, which opens it in the device's own apps.
    if (playsInPlace(a) && this.client && !this.failed) return html`<app-audio .attachment=${a} .client=${this.client} .mine=${Boolean(this.mine)} @audio-failed=${() => { this.failed = true; }}></app-audio>`;
    if (a.missing || a.local || !this.client) return html`<div class="attachment-file"><span class="attachment-name">${a.name}</span>${a.missing ? html`<span class="muted small"> Not on the Mac</span>` : nothing}</div>`;
    // A document the viewer shows reads as a document; one that goes straight to the device's own apps says so.
    const view = filePress(a) === 'view';
    const label = view ? 'Open ' + a.name : 'Open ' + a.name + ' in another app';
    return html`<button type="button" class="attachment-file" data-opens=${view ? 'viewer' : 'app'} aria-label=${label} title=${label} @click=${press((e) => this.pressDocument(e))}><span class="icon" data-icon=${view ? 'file-text' : 'external-link'} aria-hidden="true"></span><span class="attachment-name">${a.name}</span></button>`;
  }
}

customElements.define('app-attachment', AppAttachment);
