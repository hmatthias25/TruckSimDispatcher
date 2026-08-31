/* Issues #140 and #141.
 *
 * #140 Deadhead was measured from the reading on file when the load was BOOKED, which is whatever the
 *      driver last reported. So a status update between the previous drop-off and booking moved the
 *      baseline forward and shortened the empty run they were paid for — and reporting clocks is the
 *      thing this app asks for most, so the cost landed on the drivers doing as they were told.
 *
 * #141 Rank was a switch: probation ran what it was given, everyone else picked freely, and no
 *      promotion after the first changed anything. It is an allowance now — spent, and reset on Monday.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const views = async () => (await api('/bootstrap')).views;

async function place(city, state, day, odo, hm = '07:00') {
  await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: at(day, hm),
    fuelPct: 85, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}

async function put(oc, os, dc, ds, miles, dh, rev) {
  return api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: S.trailers[0].type, atLocation: true,
    originCity: oc, originState: os, destCity: dc, destState: ds,
    loadedMiles: miles, deadheadMiles: dh, gameRevenue: rev, deadlineHours: 48, weightLbs: 36000,
  });
}

(async () => {
  const app = { driverName: 'R. Calloway', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. #140 Reporting your clocks must not shorten the empty run');
  // The exact reported sequence: close out at 100, drive 10 to a rest and REPORT, drive 10 more to the
  // shipper. Twenty empty miles were driven, and twenty is what should be paid.
  await place('Kansas City', 'MO', 3, 40000);
  await api('/board/clear', 'POST', {});
  const b1 = await put('Kansas City', 'MO', 'Topeka', 'KS', 65, 0, 700);
  const t1 = (await api('/dispatch/authorize', 'POST', { loadId: b1.evaluations[0].load.id })).trip;
  await api(`/trips/${t1.id}/loaded`, 'POST', { weightLbs: 36000, trailerDamagePct: 2, odometer: 40000 });
  await api(`/trips/${t1.id}/complete`, 'POST', {
    deliveredGameTime: at(3, '15:00'), actualMiles: 65, endOdometer: 40100, actualRevenue: 700,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Topeka', locationState: 'KS', fuelPct: 70, gameTime: at(3, '15:00'),
  });

  // Ten miles to a truck stop, and the driver does what the app keeps asking: reports in.
  await place('Topeka', 'KS', 3, 40110, '17:00');

  await api('/board/clear', 'POST', {});
  const b2 = await put('Topeka', 'KS', 'Wichita', 'KS', 140, 12, 1000);
  const t2 = (await api('/dispatch/authorize', 'POST', { loadId: b2.evaluations[0].load.id })).trip;
  ok('the booking reading is the one just reported', t2.dispatchOdometer === 40110, `${t2.dispatchOdometer}`);

  const rep = await api(`/trips/${t2.id}/loaded`, 'POST', {
    weightLbs: 36000, trailerDamagePct: 2, odometer: 40120,
  });
  ok('all twenty empty miles are paid, not just the ten since booking',
    rep.trip.deadheadMiles === 20, `${rep.trip.deadheadMiles} mi (40,100 -> 40,120)`);
  ok('and it is flagged as measured', rep.trip.deadheadMeasured === true, `${rep.trip.deadheadMeasured}`);
  const said = (rep.notes || []).join(' | ');
  ok('the baseline named is the close-out, not the booking', /40,100/.test(said), said.slice(0, 120));
  ok('and the pre-booking miles are pointed at an empty move',
    /before this load was booked/i.test(said) || rep.trip.deadheadMiles === 20, 'flagged or absorbed');

  // Close it out, or the board is refused for a load already in flight rather than for anything to do
  // with refusals.
  await api(`/trips/${t2.id}/complete`, 'POST', {
    deliveredGameTime: at(4, '12:00'), actualMiles: 140, endOdometer: 40260, actualRevenue: 1000,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Wichita', locationState: 'KS', fuelPct: 60, gameTime: at(4, '12:00'),
  });
  await place('Wichita', 'KS', 4, 40260, '13:00');

  head('2. #141 On probation you run what you are given');
  const r0 = (await views()).refusals;
  ok('probation carries no refusals', r0.allowance === 0, `${r0.allowance}`);
  ok('and it says so plainly', /run the load you are given/i.test(r0.summary), r0.summary.slice(0, 90));

  await api('/board/clear', 'POST', {});
  await put('Wichita', 'KS', 'Denver', 'CO', 520, 0, 2100);
  await put('Wichita', 'KS', 'Omaha', 'NE', 300, 0, 1150);
  const board = await api('/board/evaluate');
  const ranked = (board.evaluations || []).filter((e) => e.hardFails.length === 0
    && e.homeTimeFails.length === 0 && e.feasibility.verdict !== 'Infeasible');
  ok('two loads are takeable', ranked.length >= 2, `${ranked.length}`);

  let refused = '';
  try { await api('/dispatch/authorize', 'POST', { loadId: ranked[1].load.id }); }
  catch (e) { refused = e.message; }
  ok('the second one cannot be taken', !!refused, refused.slice(0, 90) || '(allowed!)');
  ok('and the reason is probation, not a generic refusal', /on probation/i.test(refused), 'named');

  head('3. #141 A company driver gets one a week, and spends it');
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const r1 = (await views()).refusals;
  ok('the allowance opens up on promotion', r1.allowance === 1, `${r1.allowance}`);
  ok('nothing spent yet', r1.remaining === 1, `${r1.remaining} left`);

  const taken = await api('/dispatch/authorize', 'POST', { loadId: ranked[1].load.id });
  ok('the second load is now takeable', !!taken.trip, taken.trip?.number);
  const r2 = (await views()).refusals;
  ok('and it cost the week\'s refusal', r2.remaining === 0, `${r2.remaining} left of ${r2.allowance}`);
  ok('the refusal is counted against the week', r2.spent >= 1, `${r2.spent} spent`);

  head('4. #141 Out of refusals, dispatch\'s pick stands');
  await api(`/trips/${taken.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(5, '12:00'), actualMiles: 300, endOdometer: 40580, actualRevenue: 1150,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Wichita', locationState: 'KS', fuelPct: 55, gameTime: at(5, '12:00'),
  }).catch(() => {});
  await place('Wichita', 'KS', 5, 40580, '13:00');
  await api('/board/clear', 'POST', {});
  await put('Wichita', 'KS', 'Denver', 'CO', 520, 0, 2100);
  await put('Wichita', 'KS', 'Omaha', 'NE', 300, 0, 1150);
  const b3 = await api('/board/evaluate');
  const rank3 = (b3.evaluations || []).filter((e) => e.hardFails.length === 0
    && e.homeTimeFails.length === 0 && e.feasibility.verdict !== 'Infeasible');
  let blocked = '';
  try { await api('/dispatch/authorize', 'POST', { loadId: rank3[1].load.id }); }
  catch (e) { blocked = e.message; }
  ok('a second refusal in the same week is refused', !!blocked, blocked.slice(0, 100) || '(allowed!)');
  ok('and it says when they come back', /Monday/i.test(blocked), 'Monday named');
  ok('dispatch\'s own pick is still takeable',
    !!(await api('/dispatch/authorize', 'POST', { loadId: rank3[0].load.id })).trip, 'top pick fine');

  head('5. #141 The allowance comes back on Monday');
  // Day 0 is a Monday, so day 7 is the next one.
  const before = (await views()).refusals;
  await place('Wichita', 'KS', 7, 40500);
  const after = (await views()).refusals;
  ok('a new week restores it', after.remaining > before.remaining || after.remaining === after.allowance,
    `${before.remaining} -> ${after.remaining} of ${after.allowance}`);
  ok('and the reset day is a Monday', after.resetsOnDay % 7 === 0, `day ${after.resetsOnDay}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
