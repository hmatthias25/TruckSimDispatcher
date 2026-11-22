/* Screenshots for the Coach Driver manual: a fresh career on a throwaway data folder, driven through the API and shot
 * in headless Chrome over the DevTools protocol. Run from the repo root after a Release build:
 *   node docs/coach/shoot.cjs
 * Writes docs/coach/img/*.png. Never touches a real career: the data folder is a temp one. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'img');
const DLL = path.join(ROOT, 'Coach', 'bin', 'Release', 'net10.0', 'win-x64', 'TruckSimCoach.dll');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5391, DEBUG = 9351;
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
  await sleep(1500);
}
async function tab(t) { await ev(`(async () => { S = await api('/bootstrap'); TAB = '${t}'; render(); })()`); await sleep(500); }
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
const dayOf = (iso) => Math.floor((Date.parse(iso + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const plus = (iso, min) => new Date(Date.parse(iso + ':00Z') + min * 60000).toISOString().slice(0, 16);
const at = (iso, min = 0) => { const x = plus(iso, min); return { day: dayOf(x), time: x.slice(11, 16) }; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-shots-'));
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-chrome-'));
  const app = spawn('dotnet', [DLL, '--port', String(PORT), '--no-browser'], { env: { ...process.env, TSC_DATA_DIR: data, TSC_TEST: '1' }, stdio: 'ignore' });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await api('/bootstrap'); break; } catch { await sleep(500); } }
    let targets;
    for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); break; } catch { await sleep(500); } }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    await send('Page.enable'); await send('Runtime.enable');

    // 1. The first screen, filled in, with a company chosen.
    await load();
    await ev(`(() => { document.getElementById('st-name').value = 'Jana Novak'; document.getElementById('st-level').value = 5;
      document.getElementById('sk-demandingTimetables').value = 2; document.getElementById('sk-longerDuties').value = 1; refreshEligibility();
      document.querySelector('[data-co="flixbus"]').click(); })()`);
    await sleep(300);
    await shot('start');
    await shot('companies', '#st-companies');

    // 2. A career: FlixBus, based in Berlin. Line driver for the screenshots, so a line with stops between can be shown.
    await api('/start', 'POST', { driverName: 'Jana Novak', coachLevel: 5, skills: { demandingTimetables: 2, longerDuties: 1, passengerFavourite: 1 },
      day: 1, time: '06:30', companyId: 'flixbus', homeDepot: 'Berlin|DE' });
    await load(); await tab('today');
    await shot('buy-coach', '#view .callout.warn');
    await api('/coach/bought', 'POST', {});
    await api('/depots/open', 'POST', { city: 'Berlin', cc: 'DE' });
    await api('/test/rank', 'POST', { rank: 2, probation: false });

    // As the menu shows it: three stops, only the two ends named.
    const out = { menu: 'Contract', stopCount: 3, stops: [{ city: 'Berlin', cc: 'DE', station: 'ZOB', time: '08:00' }, { city: 'Hannover', cc: 'DE', time: '12:30' }], passengers: 52, pay: 1180 };
    const back = { menu: 'Contract', stops: [{ city: 'Hannover', cc: 'DE', time: '15:30' }, { city: 'Magdeburg', cc: 'DE' }, { city: 'Berlin', cc: 'DE' }], passengers: 48 };
    const dresden = { menu: 'Contract', stops: [{ city: 'Berlin', cc: 'DE', time: '09:15' }, { city: 'Dresden', cc: 'DE' }], passengers: 40 };
    const night = { menu: 'Contract', stops: [{ city: 'Berlin', cc: 'DE', time: '22:00' }, { city: 'Leipzig', cc: 'DE' }, { city: 'Nürnberg', cc: 'DE' }, { city: 'München', cc: 'DE' }], passengers: 61 };
    const hamburg = { menu: 'Contract', stops: [{ city: 'Hamburg', cc: 'DE', time: '07:00' }, { city: 'Berlin', cc: 'DE' }] };
    await api('/board/add', 'POST', { jobs: [out, back, dresden, night, hamburg], replace: true });
    await load(); await tab('today');
    await shot('today');
    await shot('board', '#view .cols > div:first-child > .panel:last-child');
    await shot('clocks', '#view .cols > div:last-child > .panel:first-child');
    await ev(`document.querySelector('#view details').open = true`);
    await shot('jobform', '#view details');

    await ev(`document.querySelector('.offer.assigned .bt-city').value = 'Magdeburg'`);
    await shot('between', '.offer.assigned');
    let r = await api('/bootstrap');
    const pick = r.board.offers.find((o) => o.assigned);
    r = await api('/duty/accept', 'POST', { offerId: pick.id, between: [{ city: 'Magdeburg', cc: 'DE' }] });
    await load(); await tab('today');
    await shot('duty', '#view .cols > div:first-child > .panel:first-child');

    // 3. Under way: departed Berlin, at Magdeburg, the next step is the arrival at Hannover.
    let d = r.snapshot.duty;
    await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart, 1), boarded: 52 });
    await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive, 4), alighted: 9, pct: 88, veryHappy: 24, happy: 20, unhappy: 6, veryUnhappy: 2 });
    await api('/duty/depart', 'POST', { stop: 1, ...at(d.stops[1].scheduledDepart, 4), boarded: 7 });
    await tab('run');
    await shot('run', '#view > .panel:first-child');
    await api('/duty/arrive', 'POST', { stop: 2, ...at(d.stops[2].scheduledArrive, 2), alighted: 50, pct: 91, veryHappy: 30, happy: 17, unhappy: 3, veryUnhappy: 0 });
    await tab('run');
    await shot('close-form', '#view > .panel:first-child .callout');
    r = await api('/duty/close', 'POST', { damage: 1.6, fault: 'Driver' });
    await ev(`(async () => { S = await api('/bootstrap'); TAB = 'today'; render(); closeoutModal(${JSON.stringify(r.closeout)}); })()`);
    await sleep(500);
    await shot('closeout', '#modal-box');
    await ev('closeModal()');

    // 4. Home on the return working, then a night line with two drivers.
    r = await api('/board/add', 'POST', { jobs: [back], replace: true });
    r = await api('/duty/accept', 'POST', { offerId: r.snapshot.board.offers.find((o) => o.assigned).id });
    d = r.snapshot.duty;
    await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 48 });
    await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive, 7), alighted: 5, pct: 84, veryHappy: 18, happy: 22, unhappy: 6, veryUnhappy: 1 });
    await api('/duty/depart', 'POST', { stop: 1, ...at(d.stops[1].scheduledDepart, 7), boarded: 6 });
    await api('/duty/arrive', 'POST', { stop: 2, ...at(d.stops[2].scheduledArrive, 9), alighted: 48, pct: 82, veryHappy: 15, happy: 25, unhappy: 7, veryUnhappy: 1 });
    await api('/duty/close', 'POST', { damage: 6.8, damageCause: 'Other', fault: 'Road', delayReason: 'roadworks on the A2' });
    r = await api('/clock', 'POST', at((await api('/bootstrap')).gameTime, 26 * 60));
    r = await api('/board/add', 'POST', { jobs: [night], replace: true });
    r = await api('/duty/accept', 'POST', { offerId: r.snapshot.board.offers.find((o) => o.assigned).id });
    await tab('run');
    await shot('night', '#view > .panel:first-child');
    await api('/duty/handback', 'POST', { why: 'gone from the menu' });

    // 5. The other tabs.
    await tab('routes');
    await ev(`(() => { OPEN_LINE = S.lines.find((l) => l.from === 'Berlin, DE' && l.to === 'Hanover, DE').id; ROUTE_FILTER.city = 'Berlin, DE'; render(); })()`);
    await sleep(800);
    await shot('routes', '#view > .panel');
    await tab('career');
    await shot('career', '#view .cols > div:first-child > .panel:first-child, #view .cols > div:first-child > .panel:last-child');
    await shot('depots', '#view .cols > div:last-child > .panel:first-child');
    const fri = (() => { let x = dayOf((r.snapshot || r).gameTime); while (x % 7 !== 5) x++; return x; })();
    await api('/clock', 'POST', { day: fri, time: '19:00' });
    await tab('pay');
    await shot('pay', '#view > .panel:first-child, #view > .panel:last-child');
    await tab('coach');
    await shot('coach', '#view .cols > div:first-child');
    await ev(`document.getElementById('mx-repair').checked = true; document.getElementById('mx-service').checked = true;`);
    await shot('coach-shop', '#view .cols > div:last-child > .panel:first-child');
    await tab('settings');
    await shot('settings', '#view > .panel:first-child');
  } finally {
    try { ws && ws.close(); } catch {}
    app.kill(); chrome.kill();
    await sleep(800);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
