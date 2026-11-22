/* Coach Driver 0.1: tours and the top of the ladder.
 *
 *   - tours are for tour drivers at a company that runs them, starting from home
 *   - a tour: a city a day, each a day's drive from the last, ending at home
 *   - on a tour the weekly rest may wait twelve days; a tour that used it leaves two weekly rests owed
 *   - each day's stage is driven with the group, nights away paid, and a tour bonus at the end
 *   - promotion is reviewed fortnightly after probation, on the record and the skills
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const dayOf = (iso) => Math.floor((Date.parse(iso + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const plus = (iso, min) => new Date(Date.parse(iso + ':00Z') + min * 60000).toISOString().slice(0, 16);
const at = (iso, min = 0) => { const x = plus(iso, min); return { day: dayOf(x), time: x.slice(11, 16) }; };
/** A leg over 4h30 has its 45-minute break on the way. */
const brk = (d) => ((Date.parse(d.stops[1].scheduledArrive + ':00Z') - Date.parse(d.stops[0].scheduledDepart + ':00Z')) / 3600000 > 4.5 ? 45 : 0);

(async () => {
  // A premium tour house, joined directly for the test (a rookie would be refused).
  let r = await api('/start', 'POST', { driverName: 'T. Our', coachLevel: 16, skills: { cushionedJourney: 3, premiumService: 2, longerDuties: 3, passengerFavourite: 2 },
    day: 1, time: '08:00', companyId: 'trafalgar', homeDepot: 'Wien|AT', force: true });
  await api('/coach/bought', 'POST', {});

  head('1. Not before the top rank');
  let why = await refused(() => api('/tour/start', 'POST', { days: 5 }));
  ok('a probationary driver gets no tour', /tour drivers/.test(why || ''), why);
  ok('the ladder at a tour house: probation, excursions, tours', r.snapshot.job.ladder.map((x) => x.name).join(',') === 'Probationary driver,Excursion driver,Tour driver');

  await api('/test/rank', 'POST', { rank: 5, probation: false });
  head('2. A tour planned from home');
  r = await api('/tour/start', 'POST', { days: 4 });
  let S = r.snapshot;
  const t = S.tour;
  ok('a tour, running', t && t.status === 'Running', r.said);
  ok('a city a day, ending at home', t.itinerary.length === t.days && t.itinerary[t.itinerary.length - 1].city === 'Vienna', t.itinerary.map((x) => x.city).join(' > '));
  ok('on a tour the weekly rest waits up to twelve days', S.hours.onTour && S.hours.hoursToWeeklyRest > 200, `${S.hours.hoursToWeeklyRest} h`);

  head('3. The stages');
  let nights = 0;
  for (let n = 0; n < t.days; n++) {
    S = (await api('/bootstrap'));
    const day = S.tour.today;
    // Each morning: rest overnight first, then the stage.
    const start = at(S.gameTime, n === 0 ? 30 : 11 * 60);
    if (n > 0) await api('/clock', 'POST', start);
    r = await api('/tour/leg', 'POST', at((await api('/bootstrap')).gameTime, 30));
    const d = r.snapshot.duty;
    ok(`day ${n + 1}: the stage to ${day.city}`, d.kind === 'TourLeg' && d.stops[d.stops.length - 1].city === day.city, d.title);
    await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: S.tour.passengers });
    await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), breakMinutes: brk(d), pct: 92, veryHappy: 25, happy: 10, unhappy: 1, veryUnhappy: 0 });
    r = await api('/duty/close', 'POST', { damage: 0 });
    if (n < t.days - 1) nights++;
  }
  S = r.snapshot;
  ok('the tour is done, the group home', S.tour.status === 'Done' && S.atHome, r.closeout.notes.join(' | '));
  ok('no hours broken: long stages had their break on the way', S.discipline.level === 0, S.discipline.entries.map((e) => e.text).join(' | '));
  ok('nights away paid', S.pay.pending.filter((l) => l.kind === 'Night away').length === nights, `${S.pay.pending.filter((l) => l.kind === 'Night away').length} of ${nights}`);
  ok('tips every day', S.pay.pending.filter((l) => l.kind === 'Tips').length === t.days);
  ok('a tour bonus', S.pay.pending.some((l) => l.kind === 'Tour bonus'));

  head('4. A long tour leaves two weekly rests owed');
  await api('/clock', 'POST', at(S.gameTime, 10 * 60));
  r = await api('/tour/start', 'POST', { days: 8 });
  const t2 = r.snapshot.tour;
  const stages = [];
  for (let n = 0; n < t2.days; n++) {
    await api('/clock', 'POST', at((await api('/bootstrap')).gameTime, n === 0 ? 0 : 11 * 60));
    r = await api('/tour/leg', 'POST', at((await api('/bootstrap')).gameTime, 30));
    const d = r.snapshot.duty;
    await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart) });
    await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), breakMinutes: brk(d), pct: 90, veryHappy: 20, happy: 10, unhappy: 2, veryUnhappy: 0 });
    r = await api('/duty/close', 'POST', { damage: 0 });
    stages.push(d.km);
  }
  S = r.snapshot;
  ok('every stage is a day of driving, the last one home included', stages.every((k) => k <= 560), stages.join(', '));
  ok(`a ${t2.days}-day tour done`, S.tour.status === 'Done', S.tour.name);
  ok('two weekly rests owed', S.hours.owesDoubleRest === true, r.closeout.notes.join(' | '));
  r = await api('/clock', 'POST', at(S.gameTime, 70 * 60));
  ok('69 hours off clears them', r.snapshot.hours.owesDoubleRest === false, r.said);
  const places = r.snapshot.tour.itinerary.map((x) => x.city);
  ok('one spelling per city: no Praha and Prague both', new Set(places).size === places.length && !places.includes('Praha'), places.join(' > '));

  head('5. Breaks, when they are switched on');
  ok('off by default: the game lines leave no room for them', r.snapshot.settings.breaks === false && r.snapshot.hours.breaks === false);
  r = { snapshot: await api('/settings', 'POST', { breaks: true }) };
  ok('switched on in Settings', r.snapshot.settings.breaks === true);
  r = await api('/tour/start', 'POST', { days: 3 });
  r = await api('/tour/leg', 'POST', at(r.snapshot.gameTime, 30));
  let d = r.snapshot.duty;
  const hours = (Date.parse(d.stops[1].scheduledArrive + ':00Z') - Date.parse(d.stops[0].scheduledDepart + ':00Z')) / 3600000;
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart) });
  await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), pct: 90, veryHappy: 20, happy: 10, unhappy: 2, veryUnhappy: 0 });
  r = await api('/duty/close', 'POST', { damage: 0 });
  if (hours > 5.25)
    ok('a long stage with no break logged breaks the 4:30 rule', r.closeout.notes.some((n) => /without a 45-minute break/.test(n)), `${hours.toFixed(2)} h: ${r.closeout.notes.join(' | ')}`);
  else ok('a short stage needs no break', !r.closeout.notes.some((n) => /45-minute break/.test(n)), `${hours.toFixed(2)} h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
