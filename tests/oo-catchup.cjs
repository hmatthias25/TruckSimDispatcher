/* Owner-Operator 0.92: whatever moves the clock or the truck counts, for home life and the brokers' Friday.
 *
 *   - leaving home through "I am at the shipper", pulling out and "arrived" counts as leaving: days away go up
 *   - arriving past Friday evening brings the brokers' week, not only a status report
 *   - a career from before: away, with no departure on file, gets it back off its runs
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5998}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const snap = (r) => r.snapshot || r;

async function book(S, cargo, dest, miles) {
  await api('/board/add-many', 'POST', [{ cargo, destCity: dest[0], destState: dest[1], loadedMiles: miles, gameRevenue: miles * 3, deadlineHours: 40 }]);
  S = await api('/bootstrap');
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  return r.snapshot;
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'C. Atchup', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  ok('home, at the start', S.home.atHome && S.home.daysOut === 0);

  head('1. Leaving home through the run, not a status report');
  S = await book(S, 'Paper', ['Topeka', 'KS'], 70);
  await api('/run/at-shipper', 'POST', { day: 1, time: '07:00' });
  S = snap(await api('/run/loaded', 'POST', { day: 1, time: '07:40', odometer: 5000 }));
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  S = snap(await api('/run/arrived', 'POST', { day: 2, time: '07:40' }));
  ok('arrived at Topeka: away from home', !S.home.atHome, `${S.status.city}`);
  ok('a day away, counted from when the truck left', S.home.daysOut >= 0.9 && S.home.daysOut <= 1.1, `${S.home.daysOut}`);
  S = snap(await api('/deliver', 'POST', { day: 2, time: '08:00', odometer: 5070 }));
  ok('still counting after the close-out', S.home.daysOut >= 1, `${S.home.daysOut}`);

  head('2. Friday evening, reached by arriving');
  S = await api('/status', 'POST', { day: 5, time: '08:00' });
  ok('Friday morning: no week yet', S.market.lastFriday < 5, `${S.market.lastFriday}`);
  S = await book(S, 'Corn', ['Wichita', 'KS'], 140);
  await api('/run/at-shipper', 'POST', { day: 5, time: '09:00' });
  S = snap(await api('/run/loaded', 'POST', { day: 5, time: '09:30', odometer: 5070 }));
  if (S.call) await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  S = snap(await api('/run/arrived', 'POST', { day: 5, time: '20:00' }));
  ok('arrived after 6 PM on Friday: the week is in', S.market.lastFriday === 5, `${S.market.lastFriday}`);
  ok('and the popup has it, quiet or not', S.market.unseen.some((x) => x.day === 5), JSON.stringify(S.market.unseen.map((x) => x.day)));

  head('3. A career from before: the departure put back off its runs');
  const r = await api('/test/home-departure', 'POST');
  ok('repaired', r.repaired === true, r.leftHome);
  ok('off the first run out: pulled out Day 1, 07:40', r.leftHome === '2000-01-01T07:40', r.leftHome);
  ok('days away from then', r.snapshot.home.daysOut >= 4.4 && r.snapshot.home.daysOut <= 4.6, `${r.snapshot.home.daysOut}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
