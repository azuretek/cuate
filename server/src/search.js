// Message search, read through the engine's own chat list and history so no copy of the Messages database lives
// here. A query is matched against message text, newest first, and narrowed to one chat when asked.
const PAGES = 20;

export function createSearch({ engine, paging }) {
  return async function search(query, { limit, chatId = null } = {}) {
    const q = query.trim().toLowerCase();
    const wanted = chatId === null || chatId === undefined ? null : String(chatId);
    const chats = await engine.chats({ limit: paging.chats.max });
    const inScope = wanted === null ? chats : chats.filter((c) => String(c.id) === wanted);
    const results = [];
    for (const chat of inScope) {
      let before = null;
      for (let page = 0; page < PAGES; page += 1) {
        const { messages, hasMore } = await engine.messages(chat.id, { limit: paging.messages.max, before });
        for (const message of messages) if (message.text.toLowerCase().includes(q)) results.push({ chatId: String(chat.id), chatName: chat.name, message });
        if (!hasMore || messages.length === 0) break;
        before = messages[0].sentAt;
      }
    }
    results.sort((a, b) => b.message.sentAt.localeCompare(a.message.sentAt));
    return { query, results: results.slice(0, limit) };
  };
}
