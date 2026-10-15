/* The run home comes straight after the load that was run to get you home (reported from play, v0.86): a home-run
 * load closed out at Grand Rapids, "you will deadhead home after this load", and then the Dispatch tab asked for a
 * board — the empty-run button and the trailer and days-off question only came up once a board had been rejected.
 *
 *   - a load flagged as the ride home closes out with the run home in the response: the decision, the empty run
 *     to the yard on offer, and the days-off question
 *   - an ordinary load does not
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
async function place(city, state, day, odo) {
  S = un(await api('/status', 'POST', { locationCity: city, locationState: state, locationKind: 'Receiver', gameTime: iso(day, '06:00'),
    fuelPct: 85, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 80000 }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}
async function runLoad(day, from, to, miles, odo) {
  await place(from[0], from[1], day, odo);
  await api('/board/clear', 'POST', {});
  const d = await api('/board/add', 'POST', { cargo: 'Machinery', trailerType: S.trailers[0].type, shipper: 'S', receiver: 'R',
    originCity: from[0], originState: from[1], destCity: to[0], destState: to[1], atLocation: true,
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: miles * 4, deadlineHours: 30, weightLbs: 30000 });
  const trip = (un(await api('/dispatch/authorize', 'POST', { loadId: d.authorizedLoadId || d.evaluations[0].load.id })).trips || [])[0];
  const done = await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: iso(day, '16:00'), endOdometer: odo + miles,
    actualMiles: miles, truckDamageAfter: 3, trailerDamageAfter: 2, gameTime: iso(day, '16:00') });
  return { trip, done };
}

(async () => {
  const app = { driverName: 'R. Home', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals.find((t) => t.isHeadquarters) || S.company.terminals[0];
  console.log(`     home yard: ${yard.city}, ${yard.state}`);

  head('1. An ordinary load, home time a long way off');
  let r = await runLoad(3, ['Dallas', 'TX'], ['Houston', 'TX'], 240, 10000);
  ok('no run home after it', !r.done.runHome, r.done.runHome?.headline || 'none');

  head('2. Home time due, and a load that ends near the yard');
  r = await runLoad(14, ['Kansas City', 'MO'], ['Joplin', 'MO'], 160, 20000);
  ok('the load was booked as the ride home', r.trip.isHomeRun === true, String(r.trip.isHomeRun));
  const d = r.done.runHome;
  ok('the close-out hands back the run home, not a request for a board', !!d && /run home/i.test(d.headline || ''), d?.headline || 'none');
  ok('  with the empty run to the yard on offer', (un(r.done).views?.repositionOffers || []).some((o) => o.isHomeRun),
    JSON.stringify((un(r.done).views?.repositionOffers || []).map((o) => o.city)));
  ok('  and the days-off question asked now', d?.askHomeDays === true, String(d?.askHomeDays));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
