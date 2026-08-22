/* Second pass: the Active Load screens, now that a load is in flight. */
const fs = require('fs');
const path = require('path');
const APP = 'http://127.0.0.1:5311/';
const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'shots');

const SHOTS = [
  { name: 'active-full', tab: 'active', wait: 800 },
  { name: 'active-triplog', tab: 'active', match: 'Trip log' },
  { name: 'active-closeout', tab: 'active', match: 'Close the load out' },
  { name: 'active-header', tab: 'active', selector: '.panel:first-child' },
  { name: 'dispatch-carryforward', tab: 'dispatch', match: 'Report from the game' },
];

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect(url) {
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    }
  };
}
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  const WIDTH = 1500;
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: APP });
  await sleep(2500);

  for (const shot of SHOTS) {
    try {
      await evaluate(`TAB = ${JSON.stringify(shot.tab)}; render();`);
      await sleep(shot.wait || 400);
      const h = await evaluate('Math.min(document.documentElement.scrollHeight + 40, 12000)');
      await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.max(700, h), deviceScaleFactor: 2, mobile: false });
      await sleep(220);

      let clip;
      if (shot.match || shot.selector) {
        const box = await evaluate(`(() => {
          let el = null;
          ${shot.match ? `el = [...document.querySelectorAll('.panel')].find(p => {
            const h2 = p.querySelector('h2');
            return h2 && h2.textContent.trim().startsWith(${JSON.stringify(shot.match)});
          }) || null;` : ''}
          if (!el && ${JSON.stringify(!!shot.selector)}) el = document.querySelector(${JSON.stringify(shot.selector || '')});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        })()`);
        if (box && box.w > 40) {
          const pad = 10;
          clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 };
        } else console.log(`  ! ${shot.name}: no match, full page`);
      }
      const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(OUT, `${shot.name}.png`), Buffer.from(res.data, 'base64'));
      console.log(`  ${shot.name}.png ${Math.round(fs.statSync(path.join(OUT, `${shot.name}.png`)).size / 1024)} KB`);
    } catch (e) { console.log(`  FAILED ${shot.name}: ${e.message}`); }
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
