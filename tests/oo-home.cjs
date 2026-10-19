/* Owner-Operator 0.9: home life, the US reason to go home.
 *
 *   - a career starts at home, with two dates on the calendar a week or more ahead
 *   - days out cost a little, days past the promise cost more, days home give it back
 *   - a missed date costs a lot; below 40 home calls, with a deadline
 *   - at the bottom, no broker will book you
 *   - the holidays are quiet: brokers keep more, and home counts double
 *   - a booked load can be handed back, on the record
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5993}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };
const at = (city, state, day, time = '08:00') => api('/status', 'POST', { locationCity: city, locationState: state, day, time });

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'H. Ome', homeCity: 'Kansas City', homeState: 'KS', day: 10, time: '08:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal' });

  head('1. Starting at home');
  let h = S.home;
  ok('at home, 80 of 100', h.atHome && h.score === 80, `${h.atHome} ${h.score}`);
  ok('two dates on the calendar, a week or more ahead', h.dates.length === 2 && h.dates.every((d) => d.day >= 17), h.dates.map((d) => `${d.day} ${d.title}`).join('; '));
  ok('promise defaults to every 14 days, for 3', h.everyDays === 14 && h.homeDays === 3);

  head('2. Out on the road');
  S = await at('Wichita', 'KS', 11);
  S = await at('Wichita', 'KS', 15);
  h = S.home;
  ok('days out cost a little', h.score < 80 && h.score > 65, `${h.score}`);
  ok('and say when home is due', h.daysOut > 3 && h.dueHomeInDays < 11, `${h.daysOut} out, due in ${h.dueHomeInDays}`);

  head('3. A missed date');
  const first = h.dates[0];
  const before = h.score;
  S = await at('Wichita', 'KS', first.day + 1);
  h = S.home;
  ok('costs a lot', h.recent.some((d) => d.id === first.id && d.status === 'Missed') && before - h.score > 20, `${before} -> ${h.score}`);
  ok('and a new date is put on the calendar', h.dates.length === 2);

  head('4. Home calls');
  let day = first.day + 1;
  while (!S.home.call && S.home.score > 0 && day < first.day + 40) { day += 2; S = await at('Wichita', 'KS', day); }
  h = S.home;
  ok('below 40, home calls with a deadline', h.call && h.score < 40 && h.call.beHomeByGameTime > S.status.gameTime, `${h.score} ${JSON.stringify(h.call)}`);
  const callScore = h.score;
  S = await at('Kansas City', 'KS', day + 1);
  h = S.home;
  ok('getting home answers it', !h.call && h.atHome && h.score > callScore, `${callScore} -> ${h.score}`);
  S = await at('Kansas City', 'KS', day + 5);
  ok('days home give it back, and a full home time counts more', S.home.score >= callScore + 40, `${S.home.score}`);

  head('5. Hitting bottom');
  day += 6;
  S = await at('Wichita', 'KS', day);
  for (let i = 0; i < 40 && !S.home.bottomUntil; i++) { day += 3; S = await at('Wichita', 'KS', day); }
  ok('at 0, home for a week', S.home.score === 0 && S.home.bottomUntil, `${S.home.score} ${S.home.bottomUntil}`);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  ok('and no broker will book you', /needed at home/.test(await refused(() => api('/calls', 'POST', { brokerId: starter.id }))));

  head('6. The holidays');
  const dec27 = 362;  // Day 1 is 1 January 2000; 27 December is day 362
  S = await at('Kansas City', 'KS', dec27);
  ok('Christmas is a holiday', S.home.holiday === 'Christmas', `${S.home.holiday}`);
  const hol = S.home.score;
  S = await at('Kansas City', 'KS', dec27 + 1);
  ok('and a day at home counts double', S.home.score - hol >= 19, `${hol} -> ${S.home.score}`);

  head('7. Handing a load back');
  S = await at('Kansas City', 'KS', dec27 + 12);
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Toys', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 760, deadlineHours: 30 },
  ]);
  const b = (await api('/bootstrap')).directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  if (r.call.status === 'Open') {
    r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
    S = await api('/booking/handback', 'POST', { why: 'needed at home' });
    ok('handed back: cancelled, and on the carrier', S.bookings[0].status === 'Cancelled' && S.bookings[0].onCarrier === true);
    ok('nothing booked now', !S.booking);
  } else ok('a broker had an offer', false, r.call.turns.at(-1).text);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
