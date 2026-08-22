/* Re-shoots the fleet decisions panel, waiting for the roster fetch to land first. */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
let ws, id = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1200, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5311/#fleet' });
  await sleep(3500);

  // Force the roster in rather than racing the tab's own fetch.
  await ev("(async () => { FLEETOPS = await api('/fleetops'); TAB='fleet'; render(); })()");
  await sleep(1500);
  const ok = await ev("!!(FLEETOPS && FLEETOPS.openUnits && FLEETOPS.openUnits.length)");
  console.log('roster loaded with open units:', ok);

  const h = await ev('Math.min(document.documentElement.scrollHeight + 40, 14000)');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: Math.max(800, h), deviceScaleFactor: 2, mobile: false });
  await sleep(400);

  const box = await ev(`(() => {
    const el = [...document.querySelectorAll('.panel')].find(p => {
      const h2 = p.querySelector('h2');
      return h2 && h2.textContent.trim().startsWith('Decisions from the last report');
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  })()`);
  if (!box) throw new Error('decisions panel still not rendered');

  const res = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: box.x - 10, y: box.y - 10, width: box.w + 20, height: box.h + 20, scale: 1 },
  });
  fs.writeFileSync(path.join(OUT, 'fleet-decisions.png'), Buffer.from(res.data, 'base64'));
  console.log(`fleet-decisions.png ${Math.round(fs.statSync(path.join(OUT, 'fleet-decisions.png')).size / 1024)} KB, ${Math.round(box.w)}x${Math.round(box.h)}`);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
