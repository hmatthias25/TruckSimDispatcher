/* Loads manual.html in Chrome and measures every .page for content that overflows its fixed height.
   The layout uses overflow:hidden, so anything too tall is silently cut off in the PDF — this is the
   only way to catch it short of reading all 43 pages by eye. Also flags missing images. */
const CDP = 'http://127.0.0.1:9222';
const FILE = 'file:///' + __dirname.replace(/\\/g, '/') + '/manual.html';

let ws, id = 1; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = id++; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

(async () => {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1400, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: FILE });
  await sleep(4000);
  await ev("new Promise(r => { if (document.readyState === 'complete') r(1); else addEventListener('load', () => r(1)); })");
  await sleep(1500);

  const report = await ev(`(() => {
    const pages = [...document.querySelectorAll('.page')];
    const over = [];
    pages.forEach((p, i) => {
      // A page div is a fixed 11in box with overflow hidden. If the content is taller, it is clipped.
      const slack = p.clientHeight - p.scrollHeight;
      if (slack < 0) over.push({ page: i + 1, overflowPx: -slack, head: (p.querySelector('h2')||{}).textContent || '' });
    });
    const broken = [...document.images].filter(im => !im.complete || im.naturalWidth === 0)
      .map(im => im.getAttribute('src'));
    return { pages: pages.length, over, broken, images: document.images.length };
  })()`);

  console.log(`${report.pages} pages, ${report.images} images`);
  console.log(`\nbroken images: ${report.broken.length ? report.broken.join(', ') : 'none'}`);
  console.log(`\nclipped pages: ${report.over.length ? '' : 'none'}`);
  report.over.forEach((o) => console.log(`  page ${o.page}: ${o.overflowPx}px over — "${o.head.trim().slice(0, 60)}"`));

  ws.close();
  process.exit(report.over.length || report.broken.length ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(2); });
