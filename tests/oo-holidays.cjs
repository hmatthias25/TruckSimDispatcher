/* Owner-Operator 0.9: the holidays, with a family, on a calendar that starts where the player says. Asked for from play:
 * warn when one is coming so the player can get home; out during one with a family is bad, single does not matter; and
 * let the player pick the month a new career starts in (old careers stay as they were).
 *
 *   - a career started in December: Day 1 is 1 December, shown; Christmas is Day 25 and New Year's Day Day 32
 *   - with a family they are on the calendar, warned about within a week, and missing one costs more (40 with kids)
 *   - a single driver has no holiday dates
 *   - a career started in November has Thanksgiving on the app's own Thursday
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5989}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const start = (startMonth, family) => api('/start', 'POST', { game: 'ATS', driverName: 'H. Oliday', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '08:00',
  level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal', startMonth, family });
const FAMILY = { partner: true, kids: [{ name: 'Emma', kind: 'Daughter' }] };

(async () => {
  head('1. A December start, with a family');
  let S = await start(12, FAMILY);
  ok('Day 1 is 1 December', S.status.monthDay === 'Dec 1', S.status.monthDay);
  const xmas = S.home.dates.find((d) => d.title === 'Christmas');
  const ny = S.home.dates.find((d) => d.title === "New Year's Day");
  ok('Christmas on Day 25, New Year\'s Day on Day 32, as holidays', xmas && xmas.day === 25 && xmas.holiday && ny && ny.day === 32,
    JSON.stringify(S.home.dates.map((d) => [d.day, d.title])));
  ok('missing one with kids costs 40', xmas.missCost === 40);

  head('2. Warned, and pulled home');
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 3 });
  // At home until the day before, then out: a day away, not nineteen, so home has not called and Christmas is the reason.
  await api('/status', 'POST', { day: 19, time: '08:00' });
  S = await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', day: 20, time: '08:00' });
  ok('within a week, away: the warning', S.home.holidayComing && S.home.holidayComing.title === 'Christmas', JSON.stringify(S.home.holidayComing));
  ok('and home pulls for it', S.homePull && /Christmas on Day 25/.test(S.homePull.why), JSON.stringify(S.homePull));

  head('3. Missed');
  await api('/test/home', 'POST', { score: 95 });
  S = await api('/status', 'POST', { day: 24, time: '08:00' });
  const before = S.home.score;
  S = await api('/status', 'POST', { day: 26, time: '08:00' });
  const missed = S.home.recent.find((d) => d.title === 'Christmas');
  ok('away through Christmas: missed', missed && missed.status === 'Missed', JSON.stringify(missed));
  ok('and it cost 40 on top of the days out', before - S.home.score >= 40, `${before} -> ${S.home.score}`);

  head('4. Single');
  S = await api('/home/family', 'POST', { partner: false, kids: [] });
  ok('no holiday dates for a single driver', !S.home.dates.some((d) => d.holiday), JSON.stringify(S.home.dates.map((d) => d.title)));

  head('5. A November start: Thanksgiving on a Thursday');
  await api('/reset', 'POST', { confirm: 'RESET' });
  S = await start(11, FAMILY);
  const tg = S.home.dates.find((d) => d.title === 'Thanksgiving');
  // The fourth Thursday of November: Day 1 is a Monday in the app's weeks, so Thursdays are the days where day % 7 is 4.
  ok('Thanksgiving is the fourth Thursday', tg && tg.day % 7 === 4 && tg.day >= 22 && tg.day <= 28, JSON.stringify(tg));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
