/* The wider search, for a town with no freight for the trailer (asked for from play, v0.89).
 *
 * An economy mod often leaves the delivery town with nothing for the trailer. The driver says so, and dispatch names
 * the towns to look at, ring by ring (100, 250, 400, 800 miles), each ring only the towns the last did not cover.
 *
 *   - only towns the driver has reached are named; a ring with none is skipped and said
 *   - a load off another town's board is judged on its loaded miles, and is free to turn down, even on probation
 *   - nothing works, or all turned down: dispatch picks the town (nearest with freight) and books the empty run
 *   - past 800 miles: home, to swap the trailer
 *   - home time pressing: only towns nearer home, and a town nearer home is where the run goes
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5983}/api`;
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
const notes = (d) => [d.headline, d.rationale, ...(d.dispatchNotes || [])].join(' | ');

async function career(gameTime, probation) {
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  const app = { driverName: 'W. Ider', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T07:00', code: 'PRI' });
  if (!probation) await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', { locationCity: 'Abilene', locationState: 'TX', locationKind: 'Receiver', gameTime,
    fuelPct: 100, atsOdometer: 9000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}
const discover = async (...towns) => { for (const [city, state] of towns) await api('/discovery/note', 'POST', { city, state }); };
const load = (o) => ({ cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R', deadheadMiles: 0, weightLbs: 30000,
  atLocation: false, deadlineHours: 60, ...o });

(async () => {
  // ---- Abilene, home time a long way off, on probation.
  await career('2000-01-03T07:00', true);
  await discover(['Dallas', 'TX'], ['Amarillo', 'TX'], ['Houston', 'TX'], ['Texarkana', 'AR']);

  head('1. Nothing in Abilene for the trailer');
  let r = await api('/search/start', 'POST', {});
  let d = r.decision;
  const x = r.snapshot.search;
  ok('the search starts, and names towns to look at', !!x && x.cities.length > 0, x && `${x.words}: ${x.cities.map((c) => `${c.place} ${c.miles}`).join(', ')}`);
  ok('only towns reached', x.cities.every((c) => ['Dallas', 'Amarillo', 'Houston', 'Texarkana'].includes(c.city)));
  ok('a ring with no town reached is skipped, and said', x.innerMiles > 0 && /No town you have reached lies within 100/.test(notes(d)), notes(d).slice(0, 220));
  const ringOf = x.cities.map((c) => c.city);
  r = await api('/search/widen', 'POST', {});
  const y = r.snapshot.search;
  ok('further out: only the towns the last ring did not cover', !!y && y.cities.every((c) => !ringOf.includes(c.city)) && y.innerMiles >= x.outerMiles,
    y && `${y.words}: ${y.cities.map((c) => `${c.place} ${c.miles}`).join(', ')}`);
  const seen = [...x.cities, ...y.cities];
  let z = y;
  while (z && !z.cities.some((c) => c.city === 'Houston')) { z = (await api('/search/widen', 'POST', {})).snapshot.search; if (z) seen.push(...z.cities); }
  ok('Amarillo and Houston come up by the time the search reaches Houston', z && ['Amarillo', 'Houston'].every((t) => seen.some((c) => c.city === t)),
    seen.map((c) => `${c.place} ${c.miles}`).join(', '));
  ok('Texarkana, AR is further out than that', !seen.some((c) => c.city === 'Texarkana'), `ring ${z && z.words}`);

  head('2. Their boards');
  d = await api('/board/add-many', 'POST', [
    load({ originCity: 'Houston', originState: 'TX', destCity: 'Phoenix', destState: 'AZ', loadedMiles: 1150, gameRevenue: 3400, cargo: 'Paper' }),
    load({ originCity: 'Amarillo', originState: 'TX', destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 260, gameRevenue: 850, cargo: 'Glass' }),
  ]).then((x) => x.decision);
  const pick = d.evaluations.find((e) => e.load.id === d.authorizedLoadId);
  ok('a load that works is assigned', !!pick, d.headline);
  ok('found by the search', pick && pick.fromSearch, '');
  ok('judged on its loaded miles, not on the run to it', pick && pick.pros.some((p) => /Judged on its loaded miles/.test(p)) && !pick.hardFails.some((h) => /break-even/.test(h)),
    pick && pick.pros.join(' | ').slice(0, 200));
  ok('no city-board hold on another town\'s board', !d.wantCityBoard);
  ok('free to turn down, on probation', pick && pick.mayPass && pick.passIsFree, pick && pick.passNote);

  head('3. Turned down: dispatch picks the town');
  r = await api(`/board/${pick.load.id}/pass`, 'POST', { reason: '' });
  d = r;
  let next = d.evaluations.find((e) => e.load.id === d.authorizedLoadId);
  if (next) d = await api(`/board/${next.load.id}/pass`, 'POST', { reason: '' });
  const bs = await api('/bootstrap');
  ok('nothing spent from the weekly refusals', (bs.loadRefusals || []).length === 0, `${(bs.loadRefusals || []).length} on file`);
  ok('dispatch names the town to run empty to', d.reposition && ['Houston', 'Amarillo'].includes(d.reposition.city) && !d.authorizedLoadId, d.headline);
  const nearest = seen.filter((c) => ['Houston', 'Amarillo'].includes(c.city)).sort((a, b) => a.miles - b.miles)[0];
  ok('the nearest with freight', d.reposition.city === nearest.city, `${d.reposition.place} ${d.reposition.miles} mi; nearest ${nearest.place} ${nearest.miles}`);
  ok('and no menu of runs to choose from', !(d.dispatchNotes || []).some((n) => /choose/i.test(n)));
  r = await api('/search/reposition', 'POST', {});
  ok('booked as an empty move to that town', r.trip.kind === 'EmptyMove' && r.trip.destCity === nearest.city, `${r.trip.number} to ${r.trip.destCity}`);
  ok('and the search is over', !r.snapshot.search && r.snapshot.board.length === 0);
  ok('a second search waits for the run to close', /still open/.test(await refused(() => api('/search/start', 'POST', {})) || ''));

  head('4. Nothing within 800 miles: home, to swap the trailer');
  await career('2000-01-03T07:00', false);
  r = await api('/search/start', 'POST', {});
  for (let i = 0; i < 5 && r.snapshot.search; i++) r = await api('/search/widen', 'POST', {});
  d = r.decision;
  ok('the run home is booked', r.snapshot.search == null && d.reposition && d.reposition.home && /Springfield/.test(d.reposition.place), d.headline);
  ok('to swap the trailer', /Swap the trailer/.test(notes(d)), notes(d).slice(0, 240));

  head('5. Nothing in the city either: the search, from the old button');
  await career('2000-01-03T07:00', false);
  await discover(['Dallas', 'TX']);
  r = await api('/dispatch/reject-all', 'POST', { reason: 'fixture', cityChecked: true });
  ok('it starts the search', !!r.next.search && !!r.snapshot.search, r.next.headline);

  head('6. Home time pressing: only towns nearer home');
  await career('2000-01-13T07:00', false);
  await discover(['Dallas', 'TX'], ['San Angelo', 'TX'], ['Lubbock', 'TX']);
  const hs = (await api('/bootstrap')).views.homeTime;
  ok('home time is due', hs.dueSoon || hs.overdue || hs.tight, `${hs.daysUntilDue?.toFixed?.(1)} days, ${Math.round(hs.milesFromHome)} mi`);
  r = await api('/search/start', 'POST', {});
  let w = r.snapshot.search;
  for (let i = 0; i < 4 && w && !w.cities.some((c) => c.city === 'Dallas'); i++) { r = await api('/search/widen', 'POST', {}); w = r.snapshot.search; }
  ok('on the way home', w && w.homeBound, w && w.words);
  ok('Dallas, toward Springfield, is named; San Angelo, away, is not', w && w.cities.some((c) => c.city === 'Dallas') && !w.cities.some((c) => c.city === 'San Angelo'),
    w && w.cities.map((c) => `${c.place} (${c.homeMiles} from home)`).join(', '));
  d = (await api('/board/add-many', 'POST', [
    load({ originCity: 'Dallas', originState: 'TX', destCity: 'El Paso', destState: 'TX', loadedMiles: 630, gameRevenue: 2000 }),
  ])).decision;
  ok('a load away from home is not taken', !d.authorizedLoadId, d.headline);
  ok('dispatch sends the truck to the town nearer home instead', d.reposition && d.reposition.city === 'Dallas', notes(d).slice(0, 260));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
