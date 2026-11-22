/* Coach Driver 0.1: night lines, assignment rules, depots.
 *
 *   - a long night line runs with two drivers: the probationary driver takes the night legs, the co-driver the rest
 *   - only the driver's own legs count as driving; the co-driver's legs are a break for them; the spread is 21 hours
 *   - a swap can be logged at a stop
 *   - the rules of assignment: day lines too long for a rookie, stops needing Demanding Timetables, a rookie gets nights
 *   - depots: reached on arrival, opened once the garage is bought, and a transfer moves home
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5995}/api`;
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

(async () => {
  // FlixBus wants coach level 4 and a point in Demanding Timetables; Longer Duties for a line over 500 km.
  let S = (await api('/start', 'POST', { driverName: 'N. Ight', coachLevel: 5, skills: { demandingTimetables: 1, longerDuties: 1 },
    day: 1, time: '12:00', companyId: 'flixbus', homeDepot: 'Berlin|DE' })).snapshot;
  await api('/coach/bought', 'POST', {});

  head('1. What a rookie may run');
  const dayLong = { menu: 'Contract', stops: [{ city: 'Berlin', cc: 'DE', time: '14:00' }, { city: 'Hamburg', cc: 'DE' }] };
  const manyStops = { menu: 'Contract', stops: [{ city: 'Berlin', cc: 'DE', time: '15:00' }, { city: 'Magdeburg', cc: 'DE' }, { city: 'Hannover', cc: 'DE' },
    { city: 'Bremen', cc: 'DE' }, { city: 'Hamburg', cc: 'DE' }, { city: 'Kiel', cc: 'DE' }] };
  const nightLine = { menu: 'Contract', stops: [{ city: 'Berlin', cc: 'DE', time: '22:00' }, { city: 'Leipzig', cc: 'DE' }, { city: 'Nürnberg', cc: 'DE' },
    { city: 'München', cc: 'DE' }], passengers: 60 };
  let r = await api('/board/add', 'POST', { jobs: [dayLong, manyStops, nightLine], replace: true });
  const offers = r.snapshot.board.offers;
  const hh = offers.find((o) => o.to === 'Hamburg, DE');
  ok('a 290 km day line is too long on probation', hh && !hh.ok && /250 km/.test(hh.why.join(' ')), hh && hh.why.join(' | '));
  const kiel = offers.find((o) => o.to === 'Kiel, DE');
  ok('four stops between needs Demanding Timetables 2', kiel && /Demanding Timetables/.test(kiel.why.join(' ')), kiel && kiel.why.join(' | '));
  const nl = offers.find((o) => o.to === 'Munich, DE');
  ok('the night line is assigned to the rookie', nl && nl.assigned && nl.kind === 'Night', nl && `${nl.kind} ${nl.reasons.join(' | ')}`);
  ok('with two drivers', nl.crew === 'Double', nl.crew);

  head('2. Two drivers');
  r = await api('/duty/accept', 'POST', { offerId: nl.id });
  let d = r.snapshot.duty;
  const legs = d.stops.slice(0, -1).map((s) => `${s.city}:${s.legDriver}`);
  // The rookie takes every leg that touches 00:00 to 05:00, and the co-driver takes over before 4:30 runs out.
  ok('the legs are shared between the two drivers', d.stops.slice(0, -1).some((s) => s.legDriver === 'You')
    && d.stops.slice(0, -1).some((s) => s.legDriver === 'Co-driver'), legs.join(' '));
  r = await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 60 });
  ok('the spread is the two-driver one', r.snapshot.hours.multiManned === true);
  let checked = false;
  for (let i = 1; i < d.stops.length; i++) {
    const before = (await api('/bootstrap')).hours.driveLeft;
    await api('/duty/arrive', 'POST', { stop: i, ...at(d.stops[i].scheduledArrive), alighted: 4, pct: 88, veryHappy: 25, happy: 30, unhappy: 5, veryUnhappy: 0 });
    const after = (await api('/bootstrap')).hours.driveLeft;
    if (d.stops[i - 1].legDriver === 'Co-driver' && !checked) {
      ok('riding as co-driver is not driving', Math.abs(after - before) < 0.01, `${d.stops[i - 1].city}: ${before} -> ${after}`);
      checked = true;
    }
    if (i < d.stops.length - 1) {
      if (i === d.stops.length - 2) {
        const was = (await api('/bootstrap')).duty.stops[i].legDriver;
        r = await api('/duty/swap', 'POST', { stop: i });
        ok('a swap logged at a stop: the last leg changes hands', r.snapshot.duty.stops[i].legDriver !== was, r.said);
        r = await api('/duty/swap', 'POST', { stop: i });
      }
      await api('/duty/depart', 'POST', { stop: i, ...at(d.stops[i].scheduledDepart), boarded: 4 });
    }
  }
  ok('a co-driver leg was checked', checked);
  r = await api('/duty/close', 'POST', { damage: 0 });
  const crew = r.closeout.summary.find((s) => s.key === 'duty').rows.find((x) => x.label === 'Crew');
  ok('the close-out says who drove what', crew && crew.value === 'Two drivers' && /You drove/.test(crew.detail), crew && crew.detail);
  ok('night hours paid', r.closeout.summary.find((s) => s.key === 'money').rows.some((x) => x.label === 'Night'));
  ok('in Munich, a depot reached for the first time', r.snapshot.depots.find((x) => x.city === 'Munich').reached && r.snapshot.place === 'Munich, DE');

  head('3. Depots');
  let why = await refused(() => api('/depots/open', 'POST', { city: 'Vienna', cc: 'AT' }));
  ok('a depot not reached cannot be opened', /not been to/.test(why || ''), why);
  why = await refused(() => api('/depots/transfer', 'POST', { city: 'Munich', cc: 'DE' }));
  ok('nor a depot not yet opened be transferred to', /not open yet/.test(why || ''), why);
  r = await api('/depots/open', 'POST', { city: 'München', cc: 'DE' });
  ok('München opened: the garage bought', r.snapshot.depots.find((x) => x.city === 'Munich').opened, r.said);
  r = await api('/clock', 'POST', at(r.snapshot.gameTime, 10 * 60));
  ok('a night there is in the depot rest room, with the allowance', r.snapshot.pay.pending.some((l) => l.kind === 'Night away' && /rest room/.test(l.text)));
  r = await api('/depots/transfer', 'POST', { city: 'Munich', cc: 'DE' });
  ok('transferred: München is home', r.snapshot.job.home === 'Munich, DE' && r.snapshot.atHome, r.said);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
