import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, openSocket, waitFor } from './helpers.js';

test('Apple Contacts alone supplies direct-chat names and removal propagates live', async (t) => {
  let name = 'Quinn Avery';
  let changed;
  const contacts = {
    forHandles: async ([handle]) => handle === '+15555550100' && name ? {name, record:{}} : null,
    photo: async () => null,
    watchStore: (fn) => { changed = fn; return () => {}; },
  };
  const s = await boot({contacts}); t.after(() => s.close());
  const originalChats = s.engine.chats.bind(s.engine);
  s.engine.chats = async (args) => (await originalChats(args)).map(c => ({...c, photo: c.isGroup ? c.photo : {id:'stale-engine-photo',name:'Old photo',mime:'image/png',bytes:1}}));
  const list = async () => (await (await s.get('/api/v1/chats', s.tokens.device)).json()).chats;
  let rows = await list();
  assert.equal(rows.find(c => String(c.id) === '1').name, name);
  assert.equal(rows.find(c => String(c.id) === '1').photo, null);
  assert.equal(rows.find(c => String(c.id) === '3').name, '+15555550142');
  const {ws, frames} = await openSocket(s.base); t.after(() => ws.close());
  ws.send(JSON.stringify({type:'auth', token:s.tokens.device}));
  await waitFor(() => frames.some(f => f.type === 'hello'));
  name = null; changed();
  await waitFor(() => frames.some(f => JSON.stringify(f).includes('chat.changed')));
  rows = await list();
  assert.equal(rows.find(c => String(c.id) === '1').name, '+15555550100');
  assert.equal(rows.find(c => String(c.id) === '1').photo, null);
});
