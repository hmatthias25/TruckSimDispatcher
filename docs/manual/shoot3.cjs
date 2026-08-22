/* Recaptures the Dispatch status panel now that it is genuinely in the carried-forward state. */
const fs = require('fs');
const path = require('path');
const APP = 'http://127.0.0.1:5311/';
const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'shots');

let ws, nextId = 1;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

(async () => {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1400, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: APP });
  await sleep(3000);

  const state = await evaluate("S.status.carriedForwardFrom + '|' + S.status.confirmed");
  console.log(`carriedForwardFrom|confirmed = ${state}`);
  if (!state.split('|')[0]) throw new Error('the app is not in a carried-forward state');

  await evaluate("TAB = 'dispatch'; render();");
  await sleep(700);

  const h = await evaluate('Math.min(document.documentElement.scrollHeight + 40, 12000)');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: Math.max(800, h), deviceScaleFactor: 2, mobile: false });
  await sleep(300);

  const box = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.panel')].find(p => {
      const h2 = p.querySelector('h2');
      return h2 && h2.textContent.trim().startsWith('Report from the game');
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  })()`);
  if (!box) throw new Error('status panel not found');

  const pad = 10;
  const res = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: box.x - pad, y: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 },
  });
  const file = path.join(OUT, 'dispatch-carryforward.png');
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`dispatch-carryforward.png rewritten — ${Math.round(fs.statSync(file).size / 1024)} KB, ${Math.round(box.w)}x${Math.round(box.h)}`);

  // Also grab the home-time panel again; it now reads 1.5 days rather than 1.9.
  const hb = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.panel')].find(p => {
      const h2 = p.querySelector('h2');
      return h2 && h2.textContent.trim() === 'Home time';
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  })()`);
  if (hb) {
    const r2 = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: hb.x - pad, y: hb.y - pad, width: hb.w + pad * 2, height: hb.h + pad * 2, scale: 1 },
    });
    fs.writeFileSync(path.join(OUT, 'hometime-panel.png'), Buffer.from(r2.data, 'base64'));
    console.log('hometime-panel.png refreshed');
  }

  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
