/* Owner-Operator 0.9: getting home. Asked about from play: "if my home life value is getting low what do I do to get back
 * home?", and what the dates at home are for.
 *
 *   - a date at home is made by being home across its day, whether or not the app was told anything on the day itself
 *   - with home pulling (low home life, a call from home, a date or the promise close), a broker offers the job that ends
 *     near home first, and says why
 *   - a lane offered then goes home: it fits only jobs that end near home
 *   - the run home empty is planned, and "I'm home" puts the truck there
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5992}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const said = (r) => r.call.turns.at(-1).text;
const job = (cargo, dest, st, miles, pay) => ({ cargo, destCity: dest, destState: st, loadedMiles: miles, gameRevenue: pay, deadlineHours: 30 });
const FULL = { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'H. Omeward', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '08:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });

  head('1. A date made by being home across its day');
  const date = S.home.dates[0];
  await api('/status', 'POST', { day: date.day - 1, time: '20:00' });
  S = await api('/status', 'POST', { day: date.day + 1, time: '09:00' });
  const made = S.home.recent.find((d) => d.id === date.id);
  ok('home the day before and the day after, nothing said on the day: made', made && made.status === 'Made', JSON.stringify(made));

  head('2. Home pulling: the broker offers the job that gets you home');
  let day = date.day + 2;
  S = await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', day, time: '08:00' });
  await api('/test/home', 'POST', { score: 20 });
  await api('/hos', 'POST', FULL);
  // A starter offers the bottom half by what a job leaves per day: the Kansas City job is among the cheap ones.
  await api('/board/add-many', 'POST', [
    job('Paper', 'Kansas City', 'KS', 200, 560), job('Corn', 'Dodge City', 'KS', 150, 500),
    job('Lumber', 'Oklahoma City', 'OK', 160, 900), job('Steel', 'Tulsa', 'OK', 180, 950),
  ]);
  S = await api('/bootstrap');
  ok('home is pulling', !!S.homePull, JSON.stringify(S.homePull));
  const b = S.directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  ok('the job home, and the broker says why', r.call.load.destCity === 'Kansas City' && /gets you home/.test(said(r)), said(r));
  await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'decline' });

  head('3. A lane home');
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job('Grain', 'Salina', 'KS', 95, 420)]);
  r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day, time: '08:30' });
  S = (await api('/run/loaded', 'POST', { day, time: '09:00', odometer: 1000 })).snapshot;
  const lane = S.call && S.call.lane;
  ok('a broker rings with a lane home', lane && lane.homeCity === 'Kansas City, KS' && lane.homeFor, JSON.stringify(lane && { h: lane.homeCity, why: lane.homeFor }));
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: FULL });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/deliver', 'POST', { day, time: '11:00', odometer: 1095 });
  r = await api('/board/add-many', 'POST', [job('Hay', 'Kansas City', 'KS', 180, 600), job('Hay', 'Amarillo', 'TX', 400, 1300)]);
  const fits = r.snapshot.board.filter((v) => r.snapshot.laneFits.includes(v.load.id)).map((v) => v.load.destCity);
  ok('at the pickup, only the job ending near home fits', fits.length === 1 && fits[0] === 'Kansas City', fits.join(','));
  await api('/lane/cancel', 'POST', { why: 'test' });

  head('4. Or run home empty');
  S = await api('/bootstrap');
  ok('the run home is planned', S.homeRoute && S.homeRoute.miles > 100 && S.homeRoute.arrival > S.status.gameTime,
    JSON.stringify(S.homeRoute && { mi: S.homeRoute.miles, at: S.homeRoute.arrival }));
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '16:00' });
  ok('and "I\'m home" puts the truck there', S.home.atHome && !S.homeRoute && !S.homePull);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
