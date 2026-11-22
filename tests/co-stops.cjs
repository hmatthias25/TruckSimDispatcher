/* Coach Driver 0.1: lines whose stops the menu counts but does not name, and tourist trips on the same board.
 *
 *   - "4 stops" is the two ends and two cities between; the menu names only the ends
 *   - such a line is saved with its ends, its times and its count; the cities between are asked for when it is assigned
 *   - once given, the library keeps them, and reading the same menu again does not lose them
 *   - times the menu showed are kept; the stops between are timed in proportion to the distance
 *   - tourist trips are out-and-back, can come off the same screenshots, and go to experienced drivers far more than to
 *     probationers
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5997}/api`;
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
const ms = (iso) => Date.parse(iso + ':00Z');

const munich = { menu: 'Contract', stopCount: 4, stops: [{ city: 'Frankfurt am Main', cc: 'DE', time: '08:00' }, { city: 'München', cc: 'DE', time: '13:30' }], passengers: 50 };
const back = { menu: 'Contract', stopCount: 2, stops: [{ city: 'München', cc: 'DE', time: '15:00' }, { city: 'Frankfurt am Main', cc: 'DE', time: '19:00' }] };
const night = { menu: 'Contract', stopCount: 3, stops: [{ city: 'Frankfurt am Main', cc: 'DE', time: '22:00' }, { city: 'Berlin', cc: 'DE', time: '06:30' }] };

(async () => {
  await api('/start', 'POST', { driverName: 'S. Tops', coachLevel: 5, skills: { demandingTimetables: 2, longerDuties: 1 }, day: 1, time: '06:30',
    companyId: 'flixbus', homeDepot: 'Frankfurt am Main|DE' });
  await api('/coach/bought', 'POST', {});
  await api('/test/rank', 'POST', { rank: 2, probation: false });

  head('1. Four stops, two named');
  let r = await api('/board/add', 'POST', { jobs: [munich, back, night], replace: true });
  let S = r.snapshot;
  let line = S.lines.find((l) => l.from === 'Frankfurt am Main, DE' && l.to === 'Munich, DE');
  ok('saved with its ends and its count', line && line.stopCount === 4 && line.stops.length === 2 && line.unknownStops === 2,
    line && `${line.stopCount} stops, ${line.stops.length} known`);
  ok('the arrival the menu showed is kept', line.arrives === '13:30' && !line.stops[1].derived);
  const n = S.lines.find((l) => l.to === 'Berlin, DE');
  ok('a night line\'s shown arrival lands the next morning', n && n.kind === 'Night' && n.arrives === '06:30' && n.nextDay, n && `${n.arrives} next day ${n.nextDay}`);
  let offer = S.board.offers.find((o) => o.lineId === line.id);
  ok('on the board: 4 stops, 2 not named', offer && offer.stops === 4 && offer.unknownStops === 2);
  ok('assigned: a turnaround home the same day', offer.assigned && offer.ends === 'turnaround', `${offer.ends}: ${offer.reasons.join(' | ')}`);
  r = await api('/board/add', 'POST', { jobs: [munich], replace: false });
  ok('read again, the same line', r.snapshot.lineCount === 3 && r.snapshot.lines.find((l) => l.id === line.id).timesSeen === 2);

  head('2. Asked for when assigned');
  let why = await refused(() => api('/duty/accept', 'POST', { offerId: offer.id }));
  ok('not taken without the cities between', /calls at 2 cities before Munich/.test(why || ''), why);
  why = await refused(() => api('/duty/accept', 'POST', { offerId: offer.id, between: [{ city: 'Mannheim', cc: 'DE' }] }));
  ok('nor with one of two', !!why, why);
  r = await api('/duty/accept', 'POST', { offerId: offer.id, between: [{ city: 'Mannheim', cc: 'DE' }, { city: 'Stuttgart', cc: '' }] });
  const d = r.snapshot.duty;
  ok('the duty calls at all four', d.stops.map((s) => s.city).join(' > ') === 'Frankfurt am Main > Mannheim > Stuttgart > Munich',
    d.stops.map((s) => s.city).join(' > '));
  const times = d.stops.map((s, i) => (i === 0 ? s.scheduledDepart : s.scheduledArrive));
  ok('the times between lie between the two the menu showed', times.every((t, i) => i === 0 || ms(t) > ms(times[i - 1])) && times[3].endsWith('13:30'),
    times.map((t) => t.slice(11)).join(' > '));
  line = r.snapshot.lines.find((l) => l.id === line.id);
  ok('the library keeps them', line.stopCount === 4 && line.unknownStops === 0 && line.stops.length === 4);
  ok('the country of a stop given without one is the line\'s', line.stops[2].place === 'Stuttgart, DE', line.stops[2].place);
  r = await api('/duty/handback', 'POST', { why: 'test' });
  r = await api('/board/add', 'POST', { jobs: [munich], replace: true });
  line = r.snapshot.lines.find((l) => l.id === line.id);
  ok('the menu read again does not lose them', line.stops.length === 4 && line.unknownStops === 0, line.stops.map((s) => s.city).join(' > '));
  offer = r.snapshot.board.offers.find((o) => o.lineId === line.id);
  ok('and it is not asked again', offer.unknownStops === 0 && offer.between.join(',') === 'Mannheim,Stuttgart', offer.between.join(','));

  head('3. Every stop judged as an end');
  const at = (iso, min = 0) => { const x = new Date(ms(iso) + min * 60000).toISOString().slice(0, 16);
    return { day: Math.floor((ms(x) - Date.UTC(2000, 0, 1)) / 86400000) + 1, time: x.slice(11, 16) }; };
  r = await api('/duty/accept', 'POST', { offerId: offer.id });
  let dd = r.snapshot.duty;
  why = await refused(() => api('/duty/depart', 'POST', { stop: 0, ...at(dd.stops[0].scheduledDepart) }));
  ok('a departure needs how many boarded', /How many passengers boarded at Frankfurt/.test(why || ''), why);
  await api('/duty/depart', 'POST', { stop: 0, ...at(dd.stops[0].scheduledDepart), boarded: 50 });
  why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(dd.stops[1].scheduledArrive), pct: 90, veryHappy: 30, happy: 15, unhappy: 5, veryUnhappy: 0 }));
  ok('an arrival needs how many got off', /How many passengers got off at Mannheim/.test(why || ''), why);
  why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(dd.stops[1].scheduledArrive), alighted: 60, pct: 90, veryHappy: 30, happy: 15, unhappy: 5, veryUnhappy: 0 }));
  ok('and no more than were aboard', /only 50 were aboard/.test(why || ''), why);
  why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(dd.stops[1].scheduledArrive), alighted: 5 }));
  ok('an arrival on the way needs the passenger satisfaction', /enter what the game shows/.test(why || ''), why);
  why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(dd.stops[1].scheduledArrive), alighted: 5, pct: 90 }));
  ok('and all four counts, not just the %', /all four counts/.test(why || ''), why);
  const stopsSaid = [[90, 30, 15, 5, 0], [40, 2, 10, 20, 3], [95, 35, 5, 0, 0]];
  for (let i = 1; i < dd.stops.length; i++) {
    const [pct, vh, h, u, vu] = stopsSaid[i - 1];
    await api('/duty/arrive', 'POST', { stop: i, ...at(dd.stops[i].scheduledArrive), alighted: i === 3 ? 40 : 5, pct, veryHappy: vh, happy: h, unhappy: u, veryUnhappy: vu });
    if (i < dd.stops.length - 1) await api('/duty/depart', 'POST', { stop: i, ...at(dd.stops[i].scheduledDepart), boarded: 2 });
  }
  r = await api('/duty/close', 'POST', { damage: 0 });
  const pax = r.closeout.summary.find((x) => x.key === 'passengers').rows;
  const sat = pax.find((x) => x.label === 'Satisfaction');
  ok('every stop counts the same: 90, 40 and 95 average 75', sat.value === '75%', sat.value);
  ok('the angry stop is named', pax.some((x) => x.label === 'Worst stop' && /40% at Stuttgart/.test(x.value)), JSON.stringify(pax.find((x) => x.label === 'Worst stop')));
  ok('a happy finish does not undo it: poor', r.closeout.grade === 'Poor', `${r.closeout.grade}: ${r.closeout.headline}`);
  ok('each stop listed as its own end', ['Mannheim', 'Stuttgart', 'Munich'].every((c) => pax.some((x) => x.label === c)), pax.map((x) => x.label).join(','));
  ok('three very unhappy at Stuttgart are complaints', pax.some((x) => x.label === 'Complaints' && x.value === '3'));

  head('4. Tourist trips, by experience');
  // Home first: positioned back to Frankfurt after the day off.
  const g = r.snapshot.gameTime;
  const dep = at(g, 12 * 60), arr = at(g, 17 * 60);
  await api('/position', 'POST', { damage: 0, city: 'Frankfurt am Main', cc: 'DE', departDay: dep.day, departTime: dep.time, arriveDay: arr.day, arriveTime: arr.time });
  await api('/clock', 'POST', at(g, 28 * 60));
  const tour = { menu: 'Tourist', stops: [{ city: 'Frankfurt am Main', cc: 'DE', time: '09:30' }], landmark: 'Römerberg', landmarkScope: 'Local', passengers: 40 };
  const mannheim = { menu: 'Contract', stopCount: 2, stops: [{ city: 'Frankfurt am Main', cc: 'DE', time: '10:00' }, { city: 'Mannheim', cc: 'DE' }] };
  const mBack = { menu: 'Contract', stopCount: 2, stops: [{ city: 'Mannheim', cc: 'DE', time: '13:00' }, { city: 'Frankfurt am Main', cc: 'DE' }] };
  const pickAt = async (rank, probation) => {
    await api('/test/rank', 'POST', { rank, probation });
    const b = await api('/board/add', 'POST', { jobs: [tour, mannheim, mBack], replace: true });
    return b.snapshot.board.offers;
  };
  let offers = await pickAt(1, true);
  let t = offers.find((o) => o.kind === 'Tourist');
  ok('a line company may give a probationer a tourist trip', t && t.ok, t && t.why.join(' | '));
  ok('but gives the line first', offers.find((o) => o.assigned)?.kind === 'Line' && t.score < offers.find((o) => o.assigned).score,
    `tourist ${t.score} vs line ${offers.find((o) => o.assigned)?.score}`);
  ok('and says why', t.reasons.some((x) => /seldom go to probationary/.test(x)), t.reasons.join(' | '));
  offers = await pickAt(5, false);
  t = offers.find((o) => o.kind === 'Tourist');
  ok('an experienced driver gets the tourist trip', t.assigned, `tourist ${t.score} vs ${offers.filter((o) => !o.assigned).map((o) => o.score).join(',')}`);
  ok('out and back: it starts and ends at home', t.from === 'Frankfurt am Main, DE' && t.to === 'Frankfurt am Main, DE' && t.ends === 'home');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
