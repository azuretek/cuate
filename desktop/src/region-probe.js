// The real-input region probe (issue 251). A synthetic click and a dispatched event both skip Electron's
// -webkit-app-region check, so a menu drawn inside the drag header opens under a script but a REAL press starts a
// window drag and never reaches the page. This probe drives the pointer through webContents.sendInputEvent, reads the
// computed region back, and presses an option to see whether the press actually lands. It is the tool that found that
// class of defect: a scripted check passes while the control is dead to a person. Run it with
// desktop/scripts/probe-real-input.mjs under a display.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// The region in force at the centre of a control, walking the stack of drag/no-drag elements that cover that point and
// taking the topmost, so an inherited drag from a header is seen rather than the control's own declaration.
const REGION_AT = (sel) => `(() => {
  const t = document.querySelector(${JSON.stringify(sel)});
  if (!t) return null;
  const els = [...document.querySelectorAll('*')].filter((e) => { const m = (getComputedStyle(e).getPropertyValue('-webkit-app-region') || '').trim(); return m === 'drag' || m === 'no-drag'; });
  const r = t.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let region = 'none';
  for (const e of els) { const q = e.getBoundingClientRect(); if (q.width && q.height && x >= q.left && x < q.right && y >= q.top && y < q.bottom) region = (getComputedStyle(e).getPropertyValue('-webkit-app-region') || '').trim(); }
  return region;
})()`;

const CENTRE = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`;

export async function runRegionProbe(win, { out } = {}) {
  const wc = win.webContents;
  await new Promise((resolve) => wc.once('did-finish-load', resolve));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => wc.executeJavaScript(code, true);
  const waitFor = async (expr, ms) => { const t0 = Date.now(); for (;;) { if (await js('Boolean(' + expr + ')')) return true; if (Date.now() - t0 > ms) return false; await pause(100); } };
  const pressAt = async (p) => { if (!p) return false; wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); await pause(30); wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await pause(30); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await pause(200); return true; };
  const shut = () => js("(() => { const r = document.querySelector('app-root'); if (!r) return false; r.filterOpen = false; r.sortOpen = false; r.searchOpen = false; if (r.view === 'settings' || r.view === 'about') r.view = 'messages'; return true; })()");
  await waitFor("document.querySelector('app-root')?.dataset.state === 'ready' && document.querySelector('.sidebar-head .filter-button')", 30000);
  await pause(400);
  // The header controls that live inside the drag strip: each trigger, its menu, and one option to press.
  const targets = [
    { control: 'search mode', trigger: '.sidebar-head .search-mode-button', menu: '.search-menu', option: '.search-menu .sort-choice:nth-child(2)' },
    { control: 'filter', trigger: '.sidebar-head .filter-button', menu: '.filter-menu', option: '.filter-menu .chip' },
    { control: 'sort', trigger: '.sidebar-head .sort-button', menu: '.sort-menu', option: '.sort-menu .sort-choice:nth-child(2)' },
  ];
  const results = [];
  for (const t of targets) {
    await shut();
    await pause(150);
    const triggerRegion = await js(REGION_AT(t.trigger));
    const pressed = await pressAt(await js(CENTRE(t.trigger)));
    const opened = pressed && await waitFor('document.querySelector(' + JSON.stringify(t.menu) + ')', 3000);
    const menuRegion = opened ? await js(REGION_AT(t.menu)) : null;
    const optionRegion = opened ? await js(REGION_AT(t.option)) : null;
    const reachable = Boolean(opened) && menuRegion === 'no-drag' && optionRegion === 'no-drag';
    results.push({ control: t.control, triggerRegion, pressed, opened, menuRegion, optionRegion, reachable });
  }
  await shut();
  const clean = results.every((r) => r.pressed && r.opened && r.reachable);
  const report = { probe: 'real-input-region', clean, results };
  if (out) { try { writeFileSync(path.join(out, 'probe.json'), JSON.stringify(report, null, 1)); } catch { /* the report stands on stdout */ } }
  console.log('PROBE ' + JSON.stringify(report));
  return clean;
}
