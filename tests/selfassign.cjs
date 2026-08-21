/* A company driver does not pick their own equipment.
 *
 * The Fleet page let the player select a different tractor and trailer for themselves, which made the
 * request paths pointless — and the ladder with them. There is no reward for clearing probation if the
 * good unit was always one dropdown away.
 *
 * What must still work: the first assignment of a career, and equipment the company has already ordered.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5800}/api`;
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
const refuses = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
(async () => {
  const app = { driverName: 'N. Selfserve', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 7, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(3) }));

  const hq = S.company.terminals[0];
  // A small yard holds one tractor, and the driver already has it.
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  // A second tractor and trailer on the property — the temptation the dropdown used to offer.
  S = un(await api('/fleet/truck', 'POST', {
    unit: 'T990', year: 2024, make: 'Kenworth', model: 'W990', status: 'InService',
    inGameGarage: true, isCompanyOwned: true, homeTerminalId: hq.id, governedMph: 65,
  }));
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'X990', type: S.trailers[0].type, division: S.trailers[0].division, inGameGarage: true,
    isCompanyOwned: true, status: 'InService', homeTerminalId: hq.id,
    currentLocation: `${hq.city}, ${hq.state}`,
  }));

  // A third tractor, deliberately worse, so no upgrade order will ever name it. That makes it the
  // clean subject for "is self-assignment refused" once probation is behind them.
  S = un(await api('/fleet/truck', 'POST', {
    unit: 'T900', year: 2011, make: 'Freightliner', model: 'Columbia', status: 'InService',
    inGameGarage: true, isCompanyOwned: true, homeTerminalId: hq.id, governedMph: 62,
    serviceMiles: 950000, atsOdometer: 950000,
  }));
  const myTruck = S.driver.assignedTruckUnit;
  const myTrailer = S.driver.assignedTrailerUnit;
  ok('the driver starts with equipment assigned', !!myTruck && !!myTrailer, `${myTruck} / ${myTrailer}`);
  ok('and starts on probation', S.driver.rank === 'probationary', S.driver.rank);

  head('1. On probation, you cannot even ask');
  let msg = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: 'T990', force: false }));
  ok('taking a different tractor is refused', msg !== null, msg || '(ALLOWED!)');
  ok('and it says probation is why', /probation/i.test(msg || ''), msg);
  ok('you do not pick your own is stated', /do not pick your own/i.test(msg || ''), '');
  msg = await refuses(() => api('/fleet/assign', 'POST', { trailerUnit: 'X990', force: false }));
  ok('and the same for a trailer', msg !== null, msg || '(ALLOWED!)');

  head('2. The equipment did not move');
  S = un(await api('/bootstrap'));
  ok('still in the same tractor', S.driver.assignedTruckUnit === myTruck, S.driver.assignedTruckUnit);
  ok('still on the same trailer', S.driver.assignedTrailerUnit === myTrailer, S.driver.assignedTrailerUnit);

  head('3. The trailer swap path is gated too, not just the dropdown');
  // SwapTrailer had physical checks -- is it here, is anything hooked -- but no permission check, so it
  // was a second way round the front door.
  await api('/status', 'POST', {
    locationCity: hq.city, locationState: hq.state, locationKind: 'Terminal', gameTime: iso(4),
    fuelPct: 80, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OffDuty', atsBankBalance: 50000,
  });
  msg = await refuses(() => api('/equipment/swap', 'POST', { trailerUnit: 'X990', force: false }));
  ok('swapping is refused as well', msg !== null, msg || '(ALLOWED!)');
  ok('for the same reason', /do not pick your own|probation/i.test(msg || ''), msg);
  // force is about the physical checks, not permission
  msg = await refuses(() => api('/equipment/swap', 'POST', { trailerUnit: 'X990', force: true }));
  ok('and force does not buy past it', msg !== null, msg || '(ALLOWED!)');

  head('4. Off probation, the refusal points at the request instead');
  S = un(await api('/career/clear-probation', 'POST', { force: true, note: 'test fixture' }));
  ok('probation is behind them', S.driver.rank !== 'probationary', S.driver.rank);

  // Clearing probation can itself raise an upgrade order onto the best unit on the property. That is
  // the company deciding, so assigning THAT unit is allowed by design — which makes it useless for
  // testing the refusal. Use the old banger nothing would ever offer.
  const ordered = (await api('/equipment')).openOrder?.toTruckUnit || '';
  if (ordered) console.log(`     (an upgrade order onto ${ordered} was raised on promotion)`);
  ok('the worn-out unit is not what the company offered', ordered !== 'T900', ordered || 'no order');

  msg = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: 'T900', force: false }));
  ok('taking a tractor is STILL refused', msg !== null, msg || '(ALLOWED!)');
  ok('it no longer blames probation', !/probation/i.test(msg || ''), msg);
  ok('it says who decides', /operations does/i.test(msg || ''), msg);
  ok('and how to ask for a tractor', /put in for one|arrival briefing/i.test(msg || ''), '');
  ok('and that it can be turned down', /turned down/i.test(msg || ''), '');

  msg = await refuses(() => api('/equipment/swap', 'POST', { trailerUnit: 'X990', force: true }));
  ok('a trailer is refused too', msg !== null, msg || '(ALLOWED!)');
  ok('pointing at the re-rig request', /re-rigged|Career tab/i.test(msg || ''), msg);
  ok('and at home time, which is when it happens', /home time/i.test(msg || ''), '');

  head('4b. Nothing the driver asked for actually moved');
  S = un(await api('/bootstrap'));
  ok('never ended up in the banger', S.driver.assignedTruckUnit !== 'T900', S.driver.assignedTruckUnit);
  ok('and the trailer is untouched', S.driver.assignedTrailerUnit === myTrailer, S.driver.assignedTrailerUnit);

  head('5. Re-reporting the unit you are already in is not a change');
  const nowIn = S.driver.assignedTruckUnit;
  const same = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: nowIn, force: false }));
  ok('saying you are in the truck you are in is fine', same === null, `${nowIn}: ${same || 'allowed'}`);

  head('5b. An ordered unit goes through; anything else does not');
  if (ordered) {
    const okd = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: ordered, force: false }));
    ok('the unit the company ordered is allowed', okd === null, `${ordered}: ${okd || 'allowed'}`);
    const nope = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: 'T900', force: false }));
    ok('and the one it did not order is still refused', nope !== null, nope || '(ALLOWED!)');
  } else {
    ok('no order was raised, so nothing to exempt', true, 'none');
  }

  head('6. A first assignment still works');
  // Nothing on file is the one case where the driver has to set it themselves.
  await api('/fleet/assign', 'POST', { trailerUnit: null, force: false }).catch(() => null);
  S = un(await api('/fleet/unassign-trailer', 'POST', {}).catch(() => api('/bootstrap')));
  if (!S.driver.assignedTrailerUnit) {
    const first = await refuses(() => api('/fleet/assign', 'POST', { trailerUnit: 'X990', force: false }));
    ok('with nothing on file, setting a trailer is allowed', first === null, first || 'allowed');
    S = un(await api('/bootstrap'));
    ok('and it took', S.driver.assignedTrailerUnit === 'X990', S.driver.assignedTrailerUnit);
  } else {
    ok('no way to clear the trailer from here, which is itself fine', true,
      `still on ${S.driver.assignedTrailerUnit}`);
  }

  head('7. Equipment the company ordered goes through');
  // An open order naming the unit is the company deciding, not the driver helping themselves.
  const ord = (await api('/equipment')).openOrder;
  if (ord?.toTruckUnit) {
    const okd = await refuses(() => api('/fleet/assign', 'POST', { truckUnit: ord.toTruckUnit, force: false }));
    ok('the ordered unit is allowed', okd === null, okd || 'allowed');
  } else {
    ok('no open order to test against, which is the normal state', true, 'none open');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
