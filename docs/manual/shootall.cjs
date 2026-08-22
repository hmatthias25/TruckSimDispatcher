/* Re-shoots every screen for the manual, in three passes:
     1. the main Prime career
     2. the same career after a driver is let go, so the fleet decisions panel has something in it
     3. a second career at a carrier that runs Dedicated, for that panel only          */
const fs = require('fs');
const path = require('path');
const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

let ws, id = 1; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = id++; pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const WIDTH = 1500;

async function shoot(name, { tab, match, selector, before, wait = 450 }) {
  try {
    if (tab) await evalJs(`TAB = ${JSON.stringify(tab)}; if (typeof closeModal === 'function') closeModal(); render();`);
    await sleep(wait);
    if (before) { await evalJs(before); await sleep(wait); }
    const h = await evalJs('Math.min(document.documentElement.scrollHeight + 40, 14000)');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.max(700, h), deviceScaleFactor: 2, mobile: false });
    await sleep(200);

    let clip;
    if (match || selector) {
      const box = await evalJs(`(() => {
        let el = null;
        ${match ? `el = [...document.querySelectorAll('.panel')].find(p => {
          const h2 = p.querySelector('h2');
          return h2 && h2.textContent.trim().startsWith(${JSON.stringify(match)});
        }) || null;` : ''}
        ${selector ? `if (!el) el = document.querySelector(${JSON.stringify(selector)});` : ''}
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      })()`);
      if (box && box.w > 40) {
        clip = { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.w + 20, height: box.h + 20, scale: 1 };
      } else { console.log(`  ! ${name}: no match — full page`); }
    }
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
    console.log(`  ${name}.png  ${Math.round(fs.statSync(path.join(OUT, `${name}.png`)).size / 1024)} KB`);
  } catch (e) { console.log(`  FAILED ${name}: ${e.message}`); }
}

async function connect(url) {
  if (!ws) {
    const targets = await (await fetch(`${CDP}/json`)).json();
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    };
    await send('Page.enable'); await send('Runtime.enable');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2800);
  if (!await evalJs("typeof S === 'object' && S && !!S.onboarded")) throw new Error('no career loaded at ' + url);
}

(async () => {
  console.log('=== pass 1: main career ===');
  await connect('http://127.0.0.1:5311/');

  await shoot('dispatch-full', { tab: 'dispatch', wait: 800 });
  await shoot('dispatch-status', { tab: 'dispatch', match: 'Report from the game' });
  await shoot('dispatch-hos', { tab: 'dispatch', match: 'Hours of service' });
  await shoot('dispatch-board-entry', { tab: 'dispatch', match: 'Jobs at this location' });
  await shoot('dispatch-decision', { tab: 'dispatch', selector: '.loadcard' });
  await shoot('hometime-panel', { tab: 'dispatch', match: 'Home time' });
  await shoot('board-city-stage', { tab: 'dispatch', before: "BOARD_STAGE='city'; render();", match: 'The city freight board' });
  await evalJs("BOARD_STAGE='local'; render();");

  await shoot('trips', { tab: 'trips', wait: 700 });
  await shoot('fleet-full', { tab: 'fleet', wait: 900 });
  await shoot('stock-yard-modal', { tab: 'fleet', before: 'stockYardModal()', selector: '.modal-box', wait: 600 });
  await evalJs('if (typeof closeModal === "function") closeModal(); render();');
  await shoot('terminals', { tab: 'terminals', wait: 700 });
  await shoot('finances', { tab: 'finance', wait: 900 });
  await shoot('finance-position', { tab: 'finance', match: 'Company position', wait: 900 });
  await shoot('payroll', { tab: 'payroll', wait: 700 });
  await shoot('maintenance', { tab: 'maint', wait: 700 });
  await shoot('safety', { tab: 'safety', wait: 700 });
  await shoot('safety-decision', { tab: 'safety', match: "Safety's decision" });
  await shoot('safety-standing', { tab: 'safety', match: 'Preventable standing' });
  await shoot('career', { tab: 'career', wait: 900 });
  await shoot('packet', { tab: 'packet', wait: 700 });
  await shoot('settings', { tab: 'settings', wait: 900 });
  await shoot('fleetops', { tab: 'fleet', match: 'Hired drivers', wait: 900 });

  console.log('\n=== pass 2: after a driver is let go ===');
  const fo = await (await fetch('http://127.0.0.1:5311/api/fleetops')).json();
  const victim = fo.drivers.find((d) => d.status === 'Active' && d.name === 'K. Amari') || fo.drivers[2];
  await fetch('http://127.0.0.1:5311/api/fleetops/terminate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ driverId: victim.id, reason: 'Damage and shop costs against the unit.' }),
  });
  await connect('http://127.0.0.1:5311/#fleet');
  await shoot('fleet-decisions', { tab: 'fleet', match: 'Decisions from the last report', wait: 900 });

  console.log('\n=== pass 3: a carrier that runs dedicated ===');
  await connect('http://127.0.0.1:5312/');
  await shoot('dedicated', { tab: 'career', match: 'Dedicated', wait: 800 });

  ws.close();
  console.log(`\n${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} images in ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error('SHOOT ERROR:', e.message); process.exit(1); });
