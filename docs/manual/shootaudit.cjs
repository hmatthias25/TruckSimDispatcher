/* The close-out popup for the manual (section 12), shot off a throwaway career rather than the one in play:
 *   node docs/manual/shootaudit.cjs        (after a Release build)
 * Starts the app on a temp data folder and a spare port, runs one load through the API with the docks logged, and
 * shoots the popup the close-out opens. Writes docs/manual/img/audit-modal.png. Never touches a real career. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DLL = path.join(ROOT, 'bin', 'Release', 'net10.0', 'win-x64', 'TruckSimDispatcher.dll');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 5293, DEBUG = 9343;
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
const iso = (day, hm) => `2000-01-${String(day).padStart(2, '0')}T${hm}`;
const plus = (stamp, hours) => {
  const d = new Date(stamp + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + Math.round(hours * 60));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tsd-shots-'));
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tsd-chrome-'));
  const app = spawn('dotnet', [DLL, '--port', String(PORT), '--no-browser'], { env: { ...process.env, TSD_DATA_DIR: data }, stdio: 'ignore' });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { await api('/bootstrap'); break; } catch { await sleep(500); } }

    // A driver, one reefer load with both docks logged, and the clocks read at delivery.
    const who = { driverName: 'Lincoln Hawk', preferredDivision: 'Reefer', transmissionPreference: 'either', experienceYears: 8,
      homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true, homeTimePreference: 'biweekly' };
    await api('/onboarding/market', 'POST', who);
    await api('/onboarding/hire', 'POST', { application: who, force: true, gameTime: iso(1, '06:00') });
    await api('/career/clear-probation', 'POST', { force: true, note: 'manual shot' });
    const day = 4;
    const S = await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(day, '06:00'),
      fuelPct: 90, atsOdometer: 48210, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OnDuty', atsBankBalance: 60000 });
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 62 });
    await api('/board/clear', 'POST', {});
    const type = ((S.snapshot || S).trailers || [])[0]?.type || 'Reefer';
    await api('/board/add', 'POST', { cargo: 'Frozen Vegetables', trailerType: type, shipper: 'Plains Cold Storage', receiver: 'Sooner Foods',
      originCity: 'Wichita', originState: 'KS', destCity: 'Oklahoma City', destState: 'OK',
      loadedMiles: 160, deadheadMiles: 0, gameRevenue: 2100, deadlineHours: 14, weightLbs: 38000, atLocation: true, appointmentOpensHours: 5 });
    const d = await api('/board/evaluate');
    const trip = (await api('/dispatch/authorize', 'POST', { loadId: d.evaluations[0].load.id, overrideTight: true })).trip;
    const log = (kind, gt) => api(`/trips/${trip.id}/event`, 'POST', { kind, gameTime: gt });
    await api(`/trips/${trip.id}/at-shipper`, 'POST', { gameTime: iso(day, '06:00') });
    await log('BeginLoad', iso(day, '06:20')); await log('EndLoad', iso(day, '08:05'));
    await api(`/trips/${trip.id}/loaded`, 'POST', { odometer: 48210, pulledOutGameTime: iso(day, '08:15') });
    const arrive = trip.appointmentGameTime || trip.appointmentOpensGameTime;
    await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: arrive });
    await log('BeginUnload', plus(arrive, 0.25)); await log('EndUnload', plus(arrive, 2));
    const r = await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: plus(arrive, 2.1), gameTime: plus(arrive, 2.1),
      endOdometer: 48378, truckDamageAfter: 1, trailerDamageAfter: 1, fuelPct: 64, fuelStops: [{ gallons: 42, cost: 171.36, city: 'Wichita', state: 'KS' }],
      hosDriveRemaining: 7.75, hosShiftRemaining: 7.5, hosBreakRemaining: 4.5, hosCycleRemaining: 57 });

    let targets;
    for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); break; } catch { await sleep(500); } }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    await send('Page.enable'); await send('Runtime.enable');
    const W = 1500;
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: 3000, deviceScaleFactor: 2, mobile: false });
    await send('Page.navigate', { url: B + '/' });
    await sleep(2500);
    // The new-city callout is a first-visit extra with its own page in the manual; left out here.
    const shown = { ...r.audit, discovery: null, directives: r.audit.directives.filter((x) => !/garage/.test(x)) };
    await ev(`auditModal(${JSON.stringify(shown)})`);
    await sleep(700);
    const box = await ev(`(() => { const b = document.querySelector('.modal-box'); b.style.maxHeight = 'none'; b.style.overflow = 'visible';
      const r = b.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; })()`);
    const clip = { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.w + 20, height: box.h + 20, scale: 1 };
    const { data: png } = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    const out = path.join(__dirname, 'img', 'audit-modal.png');
    fs.writeFileSync(out, Buffer.from(png, 'base64'));
    console.log('  shot audit-modal', `${Math.round(clip.width)}x${Math.round(clip.height)}`);
  } finally {
    try { ws && ws.close(); } catch {}
    app.kill(); chrome.kill();
    await sleep(800);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
