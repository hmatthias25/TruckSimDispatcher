/* Screenshots the running app for the user manual, driving Chrome over the DevTools Protocol.
   No dependencies — Node 22+ has a native WebSocket. */
const fs = require('fs');
const path = require('path');

const APP = 'http://127.0.0.1:5311/';
const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

/* Every image the manual needs. `selector` clips to one element; otherwise the whole page is taken.
   `before` is JS run after the tab renders — used to open modals or scroll to a section. */
const SHOTS = [
  { name: 'dispatch-full', tab: 'dispatch', wait: 700 },
  { name: 'dispatch-status', tab: 'dispatch', selector: '.cols > div:first-child > .panel:first-child' },
  { name: 'dispatch-hos', tab: 'dispatch', selector: '.cols > div:first-child > .panel:nth-child(2)' },
  { name: 'dispatch-board-entry', tab: 'dispatch', selector: '.cols > div:last-child > .panel:first-child' },
  { name: 'dispatch-decision', tab: 'dispatch', selector: '#decision-panel', fallback: '.loadcard' },
  { name: 'hometime-panel', tab: 'dispatch', selector: '.panel:has(h2)', match: 'Home time' },
  { name: 'active-full', tab: 'active', wait: 700 },
  { name: 'trips', tab: 'trips' },
  { name: 'fleet-full', tab: 'fleet', wait: 700 },
  { name: 'terminals', tab: 'terminals' },
  { name: 'finances', tab: 'finance', wait: 700 },
  { name: 'payroll', tab: 'payroll' },
  { name: 'maintenance', tab: 'maint' },
  { name: 'safety', tab: 'safety' },
  { name: 'career', tab: 'career', wait: 700 },
  { name: 'packet', tab: 'packet' },
  { name: 'settings', tab: 'settings', wait: 700 },
  { name: 'stock-yard-modal', tab: 'fleet', before: "stockYardModal()", selector: '.modal-box', wait: 500 },
];

let ws, nextId = 1;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

async function connect(wsUrl) {
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
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
  // Find the page target.
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No page target — is Chrome running with --remote-debugging-port=9222?');
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');

  const WIDTH = 1500;
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 1000, deviceScaleFactor: 2, mobile: false,
  });

  await send('Page.navigate', { url: APP });
  await sleep(2500);

  const ready = await evaluate("typeof S === 'object' && S !== null && !!S.onboarded");
  if (!ready) throw new Error('App did not boot with a career loaded.');
  console.log('app booted with a career');

  for (const shot of SHOTS) {
    try {
      await evaluate(`TAB = ${JSON.stringify(shot.tab)}; closeModal && closeModal(); render();`);
      await sleep(shot.wait || 350);
      if (shot.before) { await evaluate(shot.before); await sleep(shot.wait || 350); }

      // Grow the viewport to the full document so nothing is cut off.
      const h = await evaluate('Math.min(document.documentElement.scrollHeight + 40, 12000)');
      await send('Emulation.setDeviceMetricsOverride', {
        width: WIDTH, height: Math.max(700, h), deviceScaleFactor: 2, mobile: false,
      });
      await sleep(220);

      let clip;
      if (shot.selector) {
        const box = await evaluate(`(() => {
          let el = null;
          ${shot.match ? `
          el = [...document.querySelectorAll('.panel')].find(p => {
            const h2 = p.querySelector('h2');
            return h2 && h2.textContent.trim() === ${JSON.stringify(shot.match)};
          }) || null;` : ''}
          if (!el) el = document.querySelector(${JSON.stringify(shot.selector)});
          ${shot.fallback ? `if (!el) el = document.querySelector(${JSON.stringify(shot.fallback)});` : ''}
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
        })()`);
        if (box && box.w > 40 && box.h > 40) {
          const pad = 10;
          clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2, scale: 1 };
        } else {
          console.log(`  ! ${shot.name}: selector missed, taking the full page instead`);
        }
      }

      const res = await send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}),
      });
      const file = path.join(OUT, `${shot.name}.png`);
      fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
      const kb = Math.round(fs.statSync(file).size / 1024);
      console.log(`  ${shot.name}.png  ${kb} KB${clip ? ` (clipped ${Math.round(clip.width)}x${Math.round(clip.height)})` : ''}`);
    } catch (e) {
      console.log(`  FAILED ${shot.name}: ${e.message}`);
    }
  }

  ws.close();
  console.log(`\nwrote ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} images to ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error('SHOOT ERROR:', e.message); process.exit(1); });
