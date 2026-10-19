/* Owner-Operator 0.9: who is at home. Asked for from play: "Am I married? If so how many kids? If I am single then not as
 * many obligations, but married with 2 kids then many more."
 *
 *   - single: one date at a time, home every 21 days suggested, home calls below 30
 *   - a partner and two kids: four dates, named where names were given; every 10 days; home calls below 45
 *   - days away cost a family more than a single driver
 *   - a change of family replaces the dates still to come
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5991}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const titles = (h) => h.dates.map((d) => d.title).join('; ');

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'F. Amily', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '08:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal' });

  head('1. Single');
  let h = S.home;
  ok('single unless said otherwise', h.family.partner === false && h.family.kids.length === 0);
  ok('one date at a time, none about a partner or kids', h.dates.length === 1 && !/daughter|son's|anniversary|partner/.test(titles(h)), titles(h));
  ok('home every 21 days suggested, and set', h.everyDays === 21 && h.suggestedEveryDays === 21);
  ok('home calls below 30', h.callBelow === 30);

  head('2. A partner and two kids');
  S = await api('/home/family', 'POST', { partner: true, partnerName: 'Sam', kids: [{ name: 'Emma', kind: 'Daughter' }, { name: '', kind: 'Son' }] });
  h = S.home;
  ok('four dates on the calendar', h.dates.length === 4, titles(h));
  ok('every one a week or more ahead', h.dates.every((d) => d.day >= 10), h.dates.map((d) => d.day).join(','));
  ok('home calls below 45, every 10 days suggested', h.callBelow === 45 && h.suggestedEveryDays === 10);
  ok('the promise is not changed for you', h.everyDays === 21);
  // Names reach the dates: over enough of them, Emma, Sam and "your son" all turn up.
  let seen = titles(h);
  for (let i = 0; i < 6 && !(/Emma's/.test(seen) && /Sam's/.test(seen) && /your son's/.test(seen)); i++) {
    S = await api('/home/family', 'POST', { partner: true, partnerName: 'Sam', kids: [{ name: 'Emma', kind: 'Daughter' }, { name: '', kind: 'Son' }] });
    seen += '; ' + titles(S.home);
  }
  ok('named where names were given, "your son" where not', /Emma's/.test(seen) && /Sam's/.test(seen) && /your son's/.test(seen), seen.slice(0, 300));

  head('3. Days away cost a family more');
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 3 });
  const away = async (day) => {
    await api('/test/home', 'POST', { score: 90 });
    await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', day, time: '08:00' });
    return (await api('/status', 'POST', { day: day + 5, time: '08:00' })).home.score;
  };
  const family = 90 - await away(4);
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 10, time: '08:00' });
  await api('/home/family', 'POST', { partner: false, kids: [] });
  const single = 90 - await away(11);
  ok('five days out: a family loses more than twice what a single driver does', family > single * 2 && single > 0, `family ${family}, single ${single}`);

  head('4. Back to single');
  h = (await api('/bootstrap')).home;
  ok('the dates to come are a single driver\'s', h.dates.length === 1 && !/Emma|Sam|son's|anniversary/.test(titles(h)), titles(h));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
