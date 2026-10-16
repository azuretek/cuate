// Bounded metadata pages for a conversation's viewer. The server scans one history page at a
// time; an empty media page is not the end. Bytes remain owned by the viewer's neighbour cache.
import { mediaOccurrence } from './rules/media.js';

export class MediaPages {
  constructor({ client, chatId, items, beforeCursor, afterCursor }) {
    this.client = client;
    this.chatId = chatId;
    this.pages = [{ items: items.map(mediaOccurrence), beforeCursor, afterCursor }];
    this.more = { prev: Boolean(beforeCursor), next: Boolean(afterCursor) };
    this.cursors = { prev: beforeCursor, next: afterCursor };
    this.pending = {};
    this.controllers = {};
    this.closed = false;
  }

  get items() { return this.pages.flatMap((page) => page.items); }

  close() {
    this.closed = true; this.pages = [];
    for (const controller of Object.values(this.controllers)) controller.abort();
  }

  async extend(dir, currentId) {
    if (this.pending[dir]) return this.pending[dir];
    const controller = new AbortController();
    this.controllers[dir] = controller;
    const work = async () => {
      const opposite = dir === 'prev' ? this.pages.at(-1) : this.pages[0];
      if (this.pages.length >= 5 && opposite.items.some((item) => item.id === currentId)) return;
      const deadline = Date.now() + 15000;
      let found = false;
      while (!this.closed && this.more[dir] && !found) {
        if (Date.now() > deadline) throw new Error('Media paging took too long. Try again.');
        const cursor = this.cursors[dir];
        const result = await this.client.media(this.chatId, { limit: 50, signal: controller.signal, [dir === 'prev' ? 'beforeCursor' : 'afterCursor']: cursor });
        if (this.closed) return;
        if (result.hasMore && (!result.nextCursor || result.nextCursor === cursor)) throw new Error('Media cursor did not advance.');
        this.more[dir] = result.hasMore;
        this.cursors[dir] = result.nextCursor;
        const held = new Set(this.items.map((item) => item.id));
        const items = result.items.toReversed().map(mediaOccurrence).filter((item) => !held.has(item.id));
        if (!items.length) continue;
        found = true;
        const page = { items, beforeCursor: items[0].historyCursor, afterCursor: items.at(-1).historyCursor };
        if (dir === 'prev') this.pages.unshift(page); else this.pages.push(page);
        // Keep the selected page and up to two sparse neighbour pages on each side.
        while (this.pages.length > 5) {
          const end = dir === 'prev' ? this.pages.at(-1) : this.pages[0];
          if (end.items.some((item) => item.id === currentId)) break;
          if (dir === 'prev') {
            this.pages.pop();
            this.more.next = true;
            this.cursors.next = this.pages.at(-1).afterCursor;
          } else {
            this.pages.shift();
            this.more.prev = true;
            this.cursors.prev = this.pages[0].beforeCursor;
          }
        }
      }
    };
    const promise = work();
    this.pending[dir] = promise;
    try { return await promise; } finally { delete this.pending[dir]; delete this.controllers[dir]; }
  }
}
