/* #276 - step 10 of Euro Truck Simulator 2 support (#266): the game's own words on screen.
 *
 * The app was written for ATS, and "ATS" is in hundreds of strings in the browser and in the server's
 * messages. On an ETS2 career they are put into ETS2's words as the page is drawn (gw in ui/app.js). This
 * loads the shipped ui/app.js, as uiclock does, and checks the wording both ways — and checks the server's
 * snapshot gives the browser the game to decide on.
 */
const fs = require('fs');
const path = require('path');

const B = `http://127.0.0.1:${process.env.TSD_PORT || 5903}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

function loadClient() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const el = {
    innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    focus() {}, click() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => el, querySelectorAll: () => [], closest: () => null,
  };
  const doc = {
    addEventListener() {}, removeEventListener() {}, createElement: () => el,
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    body: el, documentElement: el,
  };
  const win = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  const make = new Function('document', 'window', 'location', 'navigator', 'fetch',
    src + '\nreturn { gw, gwLabel, setS: (x) => { S = x; } };');
  return make(doc, win, { hash: '' }, {}, () => new Promise(() => {}));
}

(async () => {
  const UI = loadClient();

  head('1. On an ATS career nothing changes');
  UI.setS({ game: { id: 'ATS' } });
  const line = 'Buy it in ATS, then tell the app. HazMat class 3 needs a Class A CDL.';
  ok('ATS text stays ATS', UI.gw(line) === line, UI.gw(line));

  head('2. On an ETS2 career it is the game\'s own words');
  UI.setS({ game: { id: 'ETS2' } });
  const eu = UI.gw(line);
  ok('ATS becomes ETS2', /Buy it in ETS2/.test(eu) && !/\bATS\b/.test(eu), eu);
  ok('HazMat becomes ADR, a Class A CDL a C+E licence', /ADR class 3 needs a C\+E licence/.test(eu), eu);
  ok('the full name too', UI.gw('Documents\\American Truck Simulator\\mod') === 'Documents\\Euro Truck Simulator 2\\mod');
  ok('whole words only: STATS and BOATS are left alone', UI.gw('STATS and BOATS') === 'STATS and BOATS');
  ok('a possessive reads right', UI.gw("ATS's map") === "ETS2's map");
  ok('straight out of CDL school is driving school', /driving school/.test(UI.gw('straight out of CDL school')));
  ok('anything that is not text passes through', UI.gw(null) === null && UI.gw(42) === 42);

  head('2b. Field labels: a state is a country');
  ok('Destination state is Destination country', UI.gwLabel('Destination state') === 'Destination country', UI.gwLabel('Destination state'));
  ok('State and ST headings', UI.gwLabel('State') === 'Country' && UI.gwLabel('ST') === 'CC');
  ok('running text is left alone: a state can be a condition', UI.gw('waiting for an authoritative state') === 'waiting for an authoritative state');
  UI.setS({ game: { id: 'ATS' } });
  ok('on ATS a state is a state', UI.gwLabel('Destination state') === 'Destination state');
  UI.setS({ game: { id: 'ETS2' } });

  head('3. The server tells the browser which game');
  const S = await api('/bootstrap');
  ok('the snapshot carries the game', S.game && S.game.id === 'ATS' && S.game.shortName === 'ATS', JSON.stringify(S.game));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
