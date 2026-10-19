/* Screenshots for the Owner-Operator manual: a fresh career on a throwaway data folder, driven through the API,
 * shot in headless Chrome over the DevTools protocol. Run from the repo root after a Release build:
 *   node docs/owner-operator/shoot.cjs
 * Writes docs/owner-operator/img/*.png. Never touches a real career: the data folder is a temp one. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'img');
const DLL = path.join(ROOT, 'OwnerOperator', 'bin', 'Release', 'net10.0', 'win-x64', 'TruckSimOwnerOperator.dll');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5291, DEBUG = 9341;
const B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, m = 'GET', b) {
  const r = await fetch(B + '/api' + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`${p}: ${j?.error || t.slice(0, 200)}`);
  return j;
}

let ws, id = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + e);
  return r.result.value;
};

const W = 1280;
async function load() {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: B + '/' });
  await sleep(1800);
}
async function tab(t) { await ev(`(async () => { S = await api('/bootstrap'); tab = '${t}'; render(); })()`); await sleep(500); }

// The whole page, or the part of it from one element's top to another's bottom.
async function shot(name, sel) {
  const h = await ev('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.max(900, h), deviceScaleFactor: 2, mobile: false });
  await sleep(350);
  let clip = { x: 0, y: 0, width: W, height: h, scale: 1 };
  if (sel) {
    const r = await ev(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(sel)})]; const els = ${sel.includes(',') ? 'all' : 'all.slice(0, 1)'}; if (!els.length) return null;
      const a = els[0].getBoundingClientRect(), z = els[els.length - 1].getBoundingClientRect();
      return { x: Math.max(0, Math.min(a.left, z.left) - 8), y: Math.max(0, a.top + scrollY - 8), w: Math.max(a.right, z.right) - Math.min(a.left, z.left) + 16, b: z.bottom + scrollY + 8 }; })()`);
    if (!r) throw new Error(`${name}: nothing matches ${sel}`);
    clip = { x: r.x, y: r.y, width: Math.min(W - r.x, r.w), height: r.b - r.y, scale: 1 };
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  console.log('  shot', name, `${Math.round(clip.width)}x${Math.round(clip.height)}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'oo-shots-'));
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'oo-chrome-'));
  const app = spawn('dotnet', [DLL, '--port', String(PORT), '--no-browser'], {
    env: { ...process.env, TSO_DATA_DIR: data, TSO_GAME_RUNNING: '0', TSO_RING_CHANCE: '100', TSO_TEST: '1' }, stdio: 'ignore' });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await api('/bootstrap'); break; } catch { await sleep(500); } }
    let targets;
    for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); break; } catch { await sleep(500); } }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    await send('Page.enable'); await send('Runtime.enable');

    // 1. The first screen, filled in.
    await load();
    await ev(`(() => { document.getElementById('st-name').value = 'Lincoln Hawk'; document.getElementById('st-home').value = 'Kansas City, KS';
      document.getElementById('st-day').value = 3; document.getElementById('st-odo').value = 1250; document.getElementById('st-ld').value = 1; })()`);
    await shot('start', '#start .hero, #start .panel');

    // 2. A career, a pasted board, and the walkthrough.
    let S = await api('/start', 'POST', { game: 'ATS', driverName: 'Lincoln Hawk', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '08:00',
      level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1250, preset: 'Normal' });
    await api('/home/promise', 'POST', { everyDays: 14, homeDays: 3 });
    await api('/board/add-many', 'POST', [
      { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 410, deadlineHours: 20 },
      { cargo: 'Canned Beans', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 980, deadlineHours: 26 },
      { cargo: 'Lumber', destCity: 'Omaha', destState: 'NE', loadedMiles: 190, gameRevenue: 1040, deadlineHours: 30 },
      { cargo: 'Furniture', destCity: 'Salina', destState: 'KS', loadedMiles: 175, gameRevenue: 1010, deadlineHours: 9 },
      { cargo: 'Fertilizer', destCity: 'Tulsa', destState: 'OK', loadedMiles: 250, gameRevenue: 1180, deadlineHours: 30 },
    ]);
    await load(); await tab('board');
    await shot('board', 'nav.tabs, #view');
    await shot('walkthrough', '#view .panel:first-child');
    await shot('loadcard', '#view .loadcard');
    await shot('topbar', 'header.topbar');

    // Screenshots staged, then a read waiting to be checked. The read itself needs an API key, so its result is put in
    // by hand: what is checked here is the page around it.
    await ev(`(async () => {
      const page = (label, n) => new Promise((res) => { const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
        const g = c.getContext('2d'); g.fillStyle = '#1d2733'; g.fillRect(0, 0, 1600, 900); g.fillStyle = '#e8eef4'; g.font = '48px sans-serif';
        for (let i = 0; i < 9; i++) g.fillText(label + ' job ' + (n + i), 60, 90 + i * 90);
        c.toBlob((b) => res(new File([b], '', { type: 'image/png' }))); });
      stageImage(await page('Freight Market', 1)); stageImage(await page('Freight Market', 10));
    })()`);
    await sleep(800);
    const staged = await ev(`[document.querySelectorAll('#shotzone .shot').length, document.getElementById('sh-read').textContent.trim()]`);
    console.log('  staged', JSON.stringify(staged));
    await shot('shots', '#shotzone');
    await ev(`(() => { preview = { ok: true, notes: '', loads: [
      { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 410, windowText: 'Sat 5:48 am - Sat 12:28 pm CDT', deadlineHours: 20 },
      { cargo: 'Cement', destCity: 'Emporia', destState: 'KS', loadedMiles: 110, gameRevenue: 560, windowText: 'Sat 9:00 am - Sat 6:00 pm CDT', deadlineHours: 24 },
    ] }; renderShots(); })()`);
    await sleep(400);
    const rows = await ev(`[...document.querySelectorAll('#shotzone tbody tr')].map((r) => r.querySelector('input[type=checkbox]').checked + ':' + r.textContent.includes('on the board'))`);
    console.log('  preview rows (ticked:on board)', JSON.stringify(rows));
    await shot('shots-check', '#shotzone');
    const before = (await api('/bootstrap')).board.length;
    await ev(`document.getElementById('pv-add').click()`);
    await sleep(1500);
    const after = (await api('/bootstrap')).board.length;
    console.log('  board', before, '->', after, '; strip left:', await ev(`document.querySelectorAll('#shotzone .shot').length`));
    // The test job goes again: its window is two days out, and a broker who books it has nothing to ring about yet.
    for (const v of (await api('/bootstrap')).board.filter((x) => x.load.cargo === 'Cement')) await api(`/board/${v.load.id}`, 'DELETE');

    // 3. The directory, and a call.
    await tab('brokers');
    await shot('directory', '#view .panel');
    S = await api('/bootstrap');
    const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
    let r = await api('/calls', 'POST', { brokerId: starter.id });
    await tab('brokers');
    await shot('phone-open', '#view .phone');
    r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'counter', amount: Math.round(r.call.offer * 1.12 / 5) * 5, arguments: ['record'] });
    if (r.call.status === 'Open') r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'terms', term: 'detention' });
    await tab('brokers');
    await shot('phone-counter', '#view .phone');
    if (r.call.status === 'Open') r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
    if (r.call.status !== 'Booked') {   // Hung up: a friendlier call so the rest has a booking to show.
      r = await api('/calls', 'POST', { brokerId: starter.id });
      r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
    }

    // 4. Booked: the short line on the Board, and the run on Active Load.
    await tab('board');
    await shot('booked', '#view > .callout.ok');
    S = r.snapshot;
    await tab('active');
    await shot('active', '#view > .panel:first-child');
    // Power-only, so drop and hook: at the shipper, hooked and away. No dock pairs to log.
    await api('/run/at-shipper', 'POST', { day: 3, time: '08:40' });
    r = await api('/run/loaded', 'POST', { day: 3, time: '09:05', odometer: 1250 });
    await tab('active');
    await shot('ringing', '#view > .callout.ring');
    await shot('topbar-ringing', 'header.topbar');
    console.log('  title while ringing:', await ev('document.title'));
    await ev(`document.querySelectorAll('#view details').forEach((d) => d.open = true)`);
    await shot('active-run', '#fromhere');
    await shot('triplog', '#view .cols');

    // 5. A lane: answering means telling the broker your clocks.
    S = await api('/bootstrap');
    if (S.call && S.call.status === 'Ringing') {
      await ev(`document.getElementById('ring-answer').click()`);
      await sleep(400);
      await shot('clocks-prompt', '#modal .modal-box');
      await ev(`(() => { const v = { drive: '9:15', shift: '12:10', brk: '6:40', cycle: '58:30' };
        for (const k in v) document.getElementById('pc-' + k).value = v[k]; document.getElementById('pc-go').click(); })()`);
      await sleep(1200);
      await tab('brokers');
      await shot('phone-lane', '#view .phone');
      S = await api('/bootstrap');
      r = await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'accept' });
    }

    // 6. At the receiver, and the close-out through the page: the read-back, then the summary.
    await api('/run/event', 'POST', { kind: 'Break', day: 3, time: '11:00', hours: 0.5 });
    await api('/run/arrived', 'POST', { day: 3, time: '13:00' });
    await tab('active');
    await shot('closeout', '#view .cols > div:last-child > .panel:last-child');
    const miles = (S.booking?.load?.loadedMiles || 200);
    await ev(`(() => { document.getElementById('c-odo').value = ${1250 + miles};
      const v = { drive: '7:05', shift: '8:20', brk: '4:30', cycle: '55:10' };
      for (const k in v) document.getElementById('c-' + k).value = v[k];
      document.getElementById('c-go').click(); })()`);
    await sleep(500);
    await shot('closeout-confirm', '#modal .modal-box');
    await ev(`document.getElementById('c-confirm').click()`);
    await sleep(1500);
    await shot('closeout-summary', '#modal .modal-box');
    await ev(`closeModal()`);
    await api('/bank', 'POST', { balance: 30000 });
    await tab('board');
    await shot('lane', '#view > .callout.info');
    await tab('money');
    await shot('money', '#view');

    // 7. The rest of the tabs.
    await tab('home');
    await shot('home', '#view');
    await tab('truck');
    await shot('truck', '#view');
    await tab('settings');
    await shot('settings', '#view');
    await tab('log');
    await shot('log', '#view');
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill(); app.kill();
    await sleep(800);
    fs.rmSync(data, { recursive: true, force: true });
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  }
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
