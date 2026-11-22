/* Coach Driver 0.1: two drivers on long day lines, and handing over on the road.
 *
 *   - a line with more driving than one driver's day runs with a co-driver, day or night
 *   - so a line too long for one driver can be assigned: only the driver's own share counts against their hours
 *   - a leg too long for one driver is handed over at a rest area half way, planned, and logged where it happened
 *   - each driver's side of a handover counts as theirs; riding is a break
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
const refused = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const ms = (iso) => Date.parse(iso + ':00Z');
const at = (iso, min = 0) => { const x = new Date(ms(iso) + min * 60000).toISOString().slice(0, 16);
  return { day: Math.floor((ms(x) - Date.UTC(2000, 0, 1)) / 86400000) + 1, time: x.slice(11, 16) }; };

(async () => {
  await api('/start', 'POST', { driverName: 'C. Rew', coachLevel: 10, skills: { demandingTimetables: 2, longerDuties: 3 }, day: 1, time: '05:00',
    companyId: 'flixbus', homeDepot: 'Berlin|DE' });
  await api('/coach/bought', 'POST', {});
  await api('/test/rank', 'POST', { rank: 3, probation: false });

  head('1. A day line too long for one driver');
  const milan = { menu: 'Contract', stopCount: 3, stops: [{ city: 'Berlin', cc: 'DE', time: '06:00' }, { city: 'München', cc: 'DE' }, { city: 'Milano', cc: 'IT' }], passengers: 55 };
  const short = { menu: 'Contract', stopCount: 2, stops: [{ city: 'Berlin', cc: 'DE', time: '07:00' }, { city: 'Leipzig', cc: 'DE' }] };
  let r = await api('/board/add', 'POST', { jobs: [milan, short], replace: true });
  const o = r.snapshot.board.offers.find((x) => x.to === 'Milan, IT');
  const s = r.snapshot.board.offers.find((x) => x.to === 'Leipzig, DE');
  ok('a short day line is solo', s && s.crew === 'Solo', s && s.crew);
  ok('a day line with more than a day\'s driving gets a co-driver', o && o.kind === 'Line' && o.crew === 'Double', o && `${o.kind} ${o.crew}`);
  ok('and can be assigned: only your share counts against your hours', o.ok && o.myDriving <= 10, `${o.myDriving} h of yours; why: ${o.why.join(' | ')}`);

  head('2. Handovers planned at rest areas');
  await api('/test/rank', 'POST', { rank: 3, probation: false });
  r = await api('/board/add', 'POST', { jobs: [milan], replace: true });
  r = await api('/duty/accept', 'POST', { offerId: r.snapshot.board.offers.find((x) => x.assigned).id });
  const d = r.snapshot.duty;
  const legs = d.stops.slice(0, -1);
  ok('two drivers on the duty', d.crew === 'Double');
  ok('each long leg has a handover half way', legs.every((x) => x.handoverAfterMinutes > 0), legs.map((x) => `${x.city}: ${x.legDriver} ${x.handoverAfterMinutes} min`).join(' | '));

  head('3. On the road');
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 55 });
  const before = (await api('/bootstrap')).hours.driveLeft;
  const swap1 = at(d.stops[0].scheduledDepart, legs[0].handoverAfterMinutes);
  let why = await refused(() => api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), alighted: 10, pct: 90, veryHappy: 30, happy: 15, unhappy: 5, veryUnhappy: 0,
    handoverDay: swap1.day, handoverTime: '01:00' }));
  ok('a handover outside the leg is refused', /handover has to be/.test(why || ''), why);
  r = await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), alighted: 10, pct: 90, veryHappy: 30, happy: 15, unhappy: 5, veryUnhappy: 0,
    handoverDay: swap1.day, handoverTime: swap1.time });
  const first = legs[0].handoverAfterMinutes / 60;
  const usedLeg1 = before - r.snapshot.hours.driveLeft;
  ok('only your side of the handover is your driving', Math.abs(usedLeg1 - (legs[0].legDriver === 'You' ? first : (ms(d.stops[1].scheduledArrive) - ms(d.stops[0].scheduledDepart)) / 3600000 - first)) < 0.05,
    `${usedLeg1.toFixed(2)} h used, said ${r.said}`);
  ok('the handover is logged', !!r.snapshot.duty.stops[0].handoverAt && /over/.test(r.said), r.said);
  await api('/duty/depart', 'POST', { stop: 1, ...at(d.stops[1].scheduledDepart), boarded: 8 });
  const swap2 = at(d.stops[1].scheduledDepart, legs[1].handoverAfterMinutes);
  r = await api('/duty/arrive', 'POST', { stop: 2, ...at(d.stops[2].scheduledArrive), alighted: 53, pct: 92, veryHappy: 35, happy: 15, unhappy: 3, veryUnhappy: 0,
    handoverDay: swap2.day, handoverTime: swap2.time });
  r = await api('/duty/close', 'POST', { damage: 0 });
  const crew = r.closeout.summary.find((x) => x.key === 'duty').rows.find((x) => x.label === 'Crew');
  ok('the close-out says who drove what', crew.value === 'Two drivers' && /You drove/.test(crew.detail), crew.detail);
  ok('within the hours', r.closeout.grade !== 'Bad' && !r.closeout.notes.some((n) => /^Hours:/.test(n)), r.closeout.notes.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
