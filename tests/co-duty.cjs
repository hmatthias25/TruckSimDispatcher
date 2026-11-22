/* Coach Driver 0.1: the board, the company's choice and a duty run stop by stop.
 *
 *   - the board is saved to the route library, every line assumed daily, times worked out where the menu gave none
 *   - the company assigns: a turnaround home beats a night away; a rookie gets the night line over a day away
 *   - the coach must be bought in the game before a contract job
 *   - per stop: arrival and departure against the timetable, passengers on and off, satisfaction as a % and four counts
 *   - an early departure is worse than a late arrival
 *   - the close-out: the grade, the pay, the record, and where the driver stands, as figures
 *   - the Routes tab: what the library knows, with the return working
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
const refused = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const dayOf = (iso) => Math.floor((Date.parse(iso + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const tod = (iso) => iso.slice(11, 16);
const plus = (iso, min) => { const d = new Date(Date.parse(iso + ':00Z') + min * 60000); return d.toISOString().slice(0, 16); };
const at = (iso, min = 0) => { const x = plus(iso, min); return { day: dayOf(x), time: tod(x) }; };
const row = (co, key, label) => (co.summary.find((s) => s.key === key)?.rows || []).find((r) => r.label === label);

const lille = { menu: 'Contract', stops: [{ city: 'Paris', cc: 'FR', time: '09:00' }, { city: 'Lille', cc: 'FR' }], passengers: 44, pay: 900 };
const back = { menu: 'Contract', stops: [{ city: 'Lille', cc: 'FR', time: '15:00' }, { city: 'Paris', cc: 'FR' }], passengers: 40 };
const night = { menu: 'Contract', stops: [{ city: 'Paris', cc: 'FR', time: '23:30' }, { city: 'Lyon', cc: 'FR' }], passengers: 50 };

async function run(d, { late = 0, early = 0, pct = 88, counts = [30, 10, 2, 0], boarded = 40 } = {}) {
  const s = d.stops;
  let r = await api('/duty/depart', 'POST', { stop: 0, ...at(s[0].scheduledDepart, -early), boarded });
  for (let i = 1; i < s.length; i++) {
    r = await api('/duty/arrive', 'POST', { stop: i, ...at(s[i].scheduledArrive, late), alighted: i === s.length - 1 ? boarded : 5,
      pct, veryHappy: counts[0], happy: counts[1], unhappy: counts[2], veryUnhappy: counts[3] });
    if (i < s.length - 1) r = await api('/duty/depart', 'POST', { stop: i, ...at(s[i].scheduledDepart, late), boarded: 5 });
  }
  return api('/duty/close', 'POST', { damage: 0, fault: 'Driver' });
}

(async () => {
  await api('/start', 'POST', { driverName: 'D. Uty', coachLevel: 1, day: 1, time: '07:00', companyId: 'blablacar', homeDepot: 'Paris|FR' });

  head('1. The board, saved to the library');
  let r = await api('/board/add', 'POST', { jobs: [lille, back, night], replace: true });
  let S = r.snapshot;
  ok('three lines in the library', S.lineCount === 3, S.lineCount);
  const lv = S.lines.find((l) => l.from === 'Paris, FR' && l.to === 'Lille, FR');
  ok('the arrival time worked out from the distance, and marked so', lv && lv.stops[1].derived && /^\d\d:\d\d$/.test(lv.arrives), lv && `${lv.departs}->${lv.arrives} ${lv.km} km`);
  const nv = S.lines.find((l) => l.to === 'Lyon, FR');
  ok('a line through the small hours is a night line', nv && nv.kind === 'Night' && nv.nextDay, nv && nv.kind);
  ok('Paris to Lille knows its return working', lv.returnWorking && lv.returnWorking.departs === '15:00', JSON.stringify(lv.returnWorking));
  r = await api('/board/add', 'POST', { jobs: [lille], replace: false });
  ok('a line seen again is confirmed, not added twice', r.snapshot.lineCount === 3 && r.snapshot.lines.find((l) => l.id === lv.id).timesSeen === 2);

  head('2. The company\'s choice');
  S = r.snapshot;
  let pick = S.board.offers.find((o) => o.assigned);
  ok('the turnaround is assigned', pick && pick.to === 'Lille, FR' && pick.ends === 'turnaround', pick && `${pick.to} ${pick.ends} ${pick.reasons.join(' | ')}`);
  const fromLille = S.board.offers.find((o) => o.from === 'Lille, FR');
  ok('a line from another city is not for here', fromLille && !fromLille.ok && /leaves from Lille/.test(fromLille.why.join(' ')));
  const nightOffer = S.board.offers.find((o) => o.to === 'Lyon, FR');
  ok('the night line leaves you away', nightOffer && nightOffer.ends === 'away', nightOffer && nightOffer.ends);

  let why = await refused(() => api('/duty/accept', 'POST', { offerId: pick.id }));
  ok('no contract job until the coach is bought', /Buy the/.test(why || ''), why);
  await api('/coach/bought', 'POST', {});
  why = await refused(() => api('/duty/accept', 'POST', { offerId: nightOffer.id }));
  ok('the driver takes what the company assigns', /has given you/.test(why || ''), why);
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  let d = r.snapshot.duty;
  ok('the duty: Paris to Lille, solo, book-on fifteen minutes before', d && d.status === 'Assigned' && d.crew === 'Solo' && tod(d.bookOn) === '08:45', d && `${d.number} ${d.bookOn}`);
  ok('the board is cleared: the game\'s menu changes once a job is taken', r.snapshot.board.offers.length === 0);

  head('3. Stop by stop');
  r = await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 44 });
  ok('departed on time', /Left Paris/.test(r.said), r.said);
  ok('running', r.snapshot.duty.status === 'Running');
  why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[0].scheduledDepart, -30) }));
  ok('an arrival before the departure is refused', !!why, why);
  r = await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive, 3), alighted: 44, pct: 91, veryHappy: 30, happy: 12, unhappy: 2, veryUnhappy: 0 });
  ok('three minutes late is on time', /on time/.test(r.said), r.said);
  ok('the coach is in Lille now', r.snapshot.place === 'Lille, FR');
  ok('Lille is a depot reached for the first time', /depots/.test(r.said) && r.snapshot.depots.find((x) => x.city === 'Lille').reached, r.said);

  head('4. The close-out');
  r = await api('/duty/close', 'POST', { damage: 0, fault: 'Driver' });
  let co = r.closeout;
  ok('graded excellent: on time, passengers at 91%, nobody very unhappy', co.grade === 'Excellent', `${co.grade}: ${co.headline}`);
  ok('the headline says it in plain words', /^Excellent: Paris 09:00 to Lille/.test(co.headline), co.headline);
  ok('timekeeping per stop', row(co, 'time', 'Lille, FR')?.value === 'On time', JSON.stringify(row(co, 'time', 'Lille, FR')));
  ok('passengers: the %, how they felt, and the four groups at the stop', row(co, 'passengers', 'Satisfaction')?.value === '91%'
    && row(co, 'passengers', 'How they felt')?.value === 'Mostly delighted'
    && /30 very happy · 12 happy · 2 unhappy · 0 very unhappy/.test(row(co, 'passengers', 'Lille')?.detail || ''),
    JSON.stringify(co.summary.find((x) => x.key === 'passengers').rows));
  ok('pay: the hours at the rate, and the bonus for an excellent duty', !!row(co, 'money', 'Hours') && !!row(co, 'money', 'Duty bonus'), JSON.stringify(co.summary.find((s) => s.key === 'money').rows.map((x) => x.label)));
  ok('where you stand: Lille, away from home, with the line back named', row(co, 'now', 'Location')?.value === 'Lille, FR'
    && co.notes.some((n) => /15:00 from Lille is the line the company expects/.test(n)), co.notes.join(' | '));
  S = r.snapshot;
  ok('the line has run once, its satisfaction kept', S.lines.find((l) => l.id === lv.id).timesRun === 1 && S.lines.find((l) => l.id === lv.id).avgSatisfaction === 91);

  head('5. Home on the return working');
  r = await api('/board/add', 'POST', { jobs: [back], replace: true });
  pick = r.snapshot.board.offers.find((o) => o.assigned);
  ok('the line home is assigned', pick && pick.to === 'Paris, FR' && pick.ends === 'home', pick && pick.reasons.join(' | '));
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  r = await run(r.snapshot.duty, { pct: 86, counts: [20, 15, 5, 0] });
  ok('home again', r.snapshot.atHome && r.closeout.grade === 'Excellent', `${r.snapshot.place} ${r.closeout.grade}`);
  ok('no night allowance: home the same day', !r.snapshot.pay.pending.some((l) => l.kind === 'Night away'));

  head('6. An early departure');
  r = await api('/board/add', 'POST', { jobs: [lille], replace: true });
  pick = r.snapshot.board.offers.find((o) => o.assigned);
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  d = r.snapshot.duty;
  r = await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart, -6), boarded: 30 });
  ok('said at the stop: passengers left behind', /early/.test(r.said) && /left behind/.test(r.said), r.said);
  r = await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive, -6), alighted: 30, pct: 90, veryHappy: 25, happy: 5, unhappy: 0, veryUnhappy: 0 });
  r = await api('/duty/close', 'POST', { damage: 0 });
  co = r.closeout;
  ok('poor, whatever the passengers thought', co.grade === 'Poor', `${co.grade}: ${co.headline}`);
  ok('the stop says it left early', /Left 6 min early/.test(row(co, 'time', 'Paris, FR (departure)')?.value || ''), JSON.stringify(row(co, 'time', 'Paris, FR (departure)')));
  ok('a strike on the record', r.snapshot.discipline.strikesSinceStep === 1 && co.notes.some((n) => /strike/.test(n)), co.notes.join(' | '));

  head('7. Satisfaction must be entered');
  r = await api('/board/add', 'POST', { jobs: [back], replace: true });
  why = await refused(async () => {
    await api('/clock', 'POST', at(r.snapshot.gameTime, 10));
  });
  ok('the clock moves on with no duty running', !why, why);

  head('8. The Routes tab');
  const routes = await api('/routes');
  ok('every line, read-only, with what it has done', routes.lines.length === 3 && routes.lines.every((l) => 'timesRun' in l && 'avgDelay' in l && 'firstSeen' in l));
  const city = await api('/routes/city?city=Paris&cc=FR');
  ok('the city view: departures and arrivals at Paris', city.departures.length === 2 && city.arrivals.length === 1, `${city.departures.length} out, ${city.arrivals.length} in`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
