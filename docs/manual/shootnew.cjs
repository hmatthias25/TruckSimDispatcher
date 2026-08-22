/* Shoots the screens added since the last manual build, plus the ones that changed. */
const fs = require('fs');
const path = require('path');
const CDP = 'http://127.0.0.1:9222';
const OUT = path.join(__dirname, 'shots');

let ws, id = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const WIDTH = 1500;

async function shoot(name, { tab, match, selector, before, wait = 500 }) {
  try {
    if (tab) await ev(`TAB = ${JSON.stringify(tab)}; if (typeof closeModal === 'function') closeModal(); render();`);
    await sleep(wait);
    if (before) { await ev(before); await sleep(wait); }
    const h = await ev('Math.min(document.documentElement.scrollHeight + 40, 14000)');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: Math.max(700, h), deviceScaleFactor: 2, mobile: false });
    await sleep(220);

    let clip;
    if (match || selector) {
      const box = await ev(`(() => {
        let el = null;
        ${match ? `el = [...document.querySelectorAll('.panel, .modal-box')].find(p => {
          const h2 = p.querySelector('h2');
          return h2 && h2.textContent.trim().startsWith(${JSON.stringify(match)});
        }) || null;` : ''}
        ${selector ? `if (!el) el = document.querySelector(${JSON.stringify(selector)});` : ''}
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
      })()`);
      if (box && box.w > 40) clip = { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.w + 20, height: box.h + 20, scale: 1 };
      else console.log(`  ! ${name}: no match — full page`);
    }
    const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(res.data, 'base64'));
    console.log(`  ${name}.png  ${Math.round(fs.statSync(path.join(OUT, `${name}.png`)).size / 1024)} KB`);
  } catch (e) { console.log(`  FAILED ${name}: ${e.message}`); }
}

(async () => {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5311/' });
  await sleep(3000);

  console.log('=== changed screens ===');
  await shoot('payroll', { tab: 'payroll', wait: 800 });
  await shoot('payroll-next', { tab: 'payroll', match: 'Next payday' });
  await shoot('settings', { tab: 'settings', wait: 900 });

  console.log('\n=== dock time learned ===');
  await shoot('facility-times', {
    tab: 'settings',
    before: `(() => { const d = [...document.querySelectorAll('details')].find(x => /Dock time by trailer/.test(x.textContent)); if (d) d.open = true; })()`,
    selector: 'details.score',
    wait: 700,
  });

  console.log('\n=== the pay stub ===');
  await shoot('pay-stub', {
    tab: 'payroll',
    before: `handleAction('show-stub', { num: S.settlements[0].number })`,
    selector: '.modal-box',
    wait: 800,
  });
  await ev('closeModal(); render();');

  console.log('\n=== the trip audit, as it appears at delivery ===');
  await shoot('audit-modal', {
    tab: 'trips',
    before: `(() => {
      // Rebuild the audit shape from the last delivered trip so the popup can be shown as the
      // driver meets it, without closing another load out.
      const t = S.trips.find(x => x.status === 'Delivered');
      auditModal({
        trip: t, headline: t.number + ' delivered on time — ' + t.cargo + ' to ' + t.destCity + ', ' + t.destState + '. Driver pay $' + t.pay.total.toFixed(2) + '.',
        faultAttribution: 'None', faultRationale: '',
        serviceFindings: [
          'Delivered Fri Day 11 · 13:40 against a Sat Day 12 · 16:00 appointment — 26.3 h early.',
          'Loading 3.5 h from the log (Thu Day 10 · 06:30 → Thu Day 10 · 10:00).',
          'Unloading 3.67 h from the log (Fri Day 11 · 10:00 → Fri Day 11 · 13:40).',
          'Detention 3.17 h — 1.5 h at the shipper plus 1.67 h at the receiver, after 2 h free at each stop.',
          'Dock time for reefer updated: load 3.5 → 3.5 h, unload 4.63 → 4.63 h, now off 4 measured load(s). I plan every reefer run on those figures from here.',
        ],
        mileageFindings: ['Dispatched 420 mi, ran 434 mi (+14 mi, +3.3%).'],
        moneyFindings: [
          '2 fuel stops: 156.0 gal for $637.36, blended $4.086/gal.',
          'Revenue $1,720.00 less $655.36 operating and $256.94 driver pay = $807.70 contribution.',
        ],
        equipmentFindings: ['Unit 101: 6% damage, 82,155 company-service mi.'],
        directives: ['Show me the jobs available here at the receiver before I order you anywhere empty.'],
        carriedForward: ['Position: Las Vegas, NV', 'Fuel: 48%', 'Damage: tractor 6%, trailer 4%'],
        clocksReported: true, maintenanceStatus: 'Report', driverPay: t.pay.total,
        homeTimeNote: 'Home time is due in 1.9 days and you are 1,180 mi from Springfield, MO. The next load will be the one that gets you back, which is why I may pass over something that pays better.',
        gotYouHome: false, homeTimeInstructions: [], discovery: null,
      });
    })()`,
    selector: '.modal-box',
    wait: 900,
  });
  await ev('closeModal(); render();');

  console.log('\n=== arriving home ===');
  await shoot('home-brief', {
    tab: 'dispatch',
    before: `homeBriefModal({
      headline: 'Home at Springfield, MO. That is home time number 1 — you have been out 13.1 days.',
      terminal: 'Springfield, MO', daysOut: 13.1, intervalDays: 14, nothingToDo: false,
      parking: [
        'Park it at the Springfield, MO yard. Nothing is dispatched against you while you are home.',
        'Your arrangement is home every 14 days. Take the time — the clock on the next one starts when you report in here again.',
        'Cycle is down to 21.0 h. Sit a 34.0-hour restart while you are stopped and you go back out with a full 70.',
      ],
      shop: [
        'Unit 101 is at 6.0%. Worth putting through the shop while it is standing.',
        'PM due on unit 101 in 3,200 mi. Cheaper to do it here than on the road.',
        'Trailer T501 is at 4.0% — get it done at the same time.',
        'The Springfield yard has its own shop, so labour is cheaper here than anywhere on the road.',
      ],
      equipment: ['There is a better unit sitting here: 107 (2023 Peterbilt 389, 47,868 mi) against your 2022 Western Star. Ask operations to move you into it.'],
      paperwork: ['1 disciplinary action(s) waiting on your signature — Safety tab.'],
    })`,
    selector: '.modal-box',
    wait: 900,
  });
  await ev('closeModal(); render();');

  console.log('\n=== payday ===');
  await shoot('payday-modal', {
    tab: 'dispatch',
    before: `paydayModal([S.settlements[0]])`,
    selector: '.modal-box',
    wait: 900,
  });
  await ev('closeModal(); render();');

  ws.close();
  console.log('\ndone');
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
