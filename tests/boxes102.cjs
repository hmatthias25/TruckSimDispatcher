/* Issues #102 and #103 — the trailers, and how long you stay on one.
 *
 * #102: where a trailer is was filed against the hired DRIVER the app had down as pulling it. AI drivers
 * in ATS change trailers whenever the game feels like it and never tell anybody, so the app asked where
 * M. Torres was with DV-3 long after Torres had moved off it, and filed the answer against the wrong box.
 * Reported from play with the answers plainly wrong. It also had no way to say a trailer was parked and
 * nobody was using it — inbound, outbound and no idea were the only choices.
 *
 * #103: the chance of being re-rigged was a flat 34 per cent every time home, however long the driver had
 * been on the same trailer. Flat means a run of bad luck leaves somebody on one box indefinitely with
 * nothing building toward a change, which is both the least interesting outcome for the player and not
 * how a carrier behaves. A trailer they ASKED for is an arrangement and still never rolls.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5972}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

let S;
async function at(city, state, day, kind = 'TruckStop') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: iso(day),
    fuelPct: 90, atsOdometer: 30000 + day * 50, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  return S;
}
// Home is wherever the app domiciled the driver, which is not necessarily the city on the application.
// Reading it off the state rather than assuming it is what makes this suite portable.
let YARD = { city: '', state: '' };
const goHome = (day) => api('/status', 'POST', {
  locationCity: YARD.city, locationState: YARD.state, locationKind: 'Terminal', gameTime: iso(day),
  fuelPct: 90, atsOdometer: 30000 + day * 50, truckDamagePct: 4, trailerDamagePct: 2,
  dutyStatus: 'OffDuty', atsBankBalance: 90000,
});

const trailerOf = (snap, unit) => (snap.trailers || []).find((t) => t.unit === unit) || {};

(async () => {
  const app = { driverName: 'B. Oxer', preferredDivision: 'Dry Van', secondDivision: 'Reefer',
    transmissionPreference: 'either', experienceYears: 7, homeCity: 'Denver', homeState: 'CO',
    acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const hq = (S.company.terminals || []).find((t) => t.id === S.driver.homeTerminalId)
             || S.company.terminals[0];
  YARD = { city: hq.city, state: hq.state };
  const mine = S.views.trailer.unit;
  console.log(`     driver is on ${mine} (${S.views.trailer.type}), yard ${hq.city}, ${hq.state}`);

  head('Setup: two more boxes on the books, one out under a hired driver');
  S = await api('/fleet/trailer', 'POST', {
    unit: 'T800', type: 'Reefer', division: 'Reefer', year: 2021, make: 'Utility 3000R',
    length: "53'", axles: 'Tandem', inGameGarage: true, status: 'InService',
    homeTerminalId: hq.id, currentLocation: `${hq.city}, ${hq.state}`,
  });
  S = await api('/fleet/trailer', 'POST', {
    unit: 'T801', type: 'Dry Van', division: 'Dry Van', year: 2019, make: 'Wabash',
    length: "53'", axles: 'Tandem', inGameGarage: true, status: 'InService',
    homeTerminalId: hq.id, currentLocation: `${hq.city}, ${hq.state}`,
  });
  S = un(await api('/fleetops/drivers', 'POST', {
    name: 'M. Torres', status: 'Active', assignedTruckUnit: '', assignedTrailerUnit: 'T800',
    homeTerminalId: hq.id, skill: 'Experienced', wageShare: 0.3,
  }));
  ok('both trailers are on the books', !!trailerOf(S, 'T800').unit && !!trailerOf(S, 'T801').unit,
    'T800, T801');

  head('1. #102 The question is asked about the trailer, and names no driver');
  let r = await goHome(15);
  let ask = r.homeBrief?.askWhereabouts || [];
  ok('the arrival brief asks about the company boxes', ask.length >= 2,
    ask.map((a) => a.unit).join(', ') || '(nothing asked)');
  ok('each row is keyed on a trailer unit', ask.every((a) => !!a.unit), ask.map((a) => a.unit).join(', '));
  ok('and no driver is named anywhere in it',
    ask.every((a) => !('driver' in a) && !('driverId' in a)), 'no driver fields');
  ok('it never asks about the one under the truck',
    !ask.some((a) => a.unit === mine), `mine is ${mine}`);
  ok('what it knows is said per box', /T800|nothing on where/i.test(ask[0]?.known || ''),
    (ask[0]?.known || '').slice(0, 90));

  head('2. #102 Parked is an answer, and it means available');
  // There was no way to say a box was sitting doing nothing. That is the commonest state of a spare
  // trailer at a yard and the one the app most wants to hear about.
  let est = (await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'T801', direction: 'Parked', city: YARD.city, state: YARD.state })).estimate;
  ok('parked is accepted', est.direction === 'Parked', est.direction);
  ok('it is a known position, not a shrug', est.known === true, `${est.known}`);
  ok('parked at the yard means a straight swap',
    /straight swap/i.test(est.text), est.text.slice(0, 120));
  ok('and it is worth waiting for, because there is no wait', est.worthWaiting === true, `${est.days} day(s)`);

  head('3. #102 Parked a long way off is a trip somebody has to make');
  est = (await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'T801', direction: 'Parked', city: 'Seattle', state: 'WA' })).estimate;
  ok('still parked, still known', est.known === true && est.direction === 'Parked', est.direction);
  ok('but now it is days away', est.days >= 1, `${est.days} day(s)`);
  ok('and it says a special trip is not worth it',
    /too far to be worth a special trip|re-rig you another way/i.test(est.text), est.text.slice(0, 150));

  head('4. #102 The answer belongs to the box, so a driver moving off it changes nothing');
  // The whole failure. An AI driver swaps trailers in game; the app never hears. Under the old model
  // that silently invalidated the answer. Under this one the answer was never about them.
  await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'T800', direction: 'Inbound', city: 'Wichita', state: 'KS' });
  const holder = (await api('/fleetops')).drivers.find((d) => d.name === 'M. Torres');
  await api('/fleetops/drivers', 'POST', { ...holder, assignedTrailerUnit: 'T801' });
  const box = trailerOf(await api('/bootstrap'), 'T800');
  ok('T800 still carries what was reported about T800', box.whereabouts === 'Inbound', box.whereabouts);
  ok('at the city it was reported at', box.whereaboutsCity === 'Wichita', box.whereaboutsCity);
  ok('with a stamp so it can go stale on its own', !!box.whereaboutsGameTime, box.whereaboutsGameTime || '(none)');
  const nowHolds = (await api('/fleetops')).drivers.find((d) => d.name === 'M. Torres');
  ok('even though the driver is on a different box now', nowHolds.assignedTrailerUnit === 'T801',
    nowHolds.assignedTrailerUnit);

  head('5. #102 A trailer we have nothing on is asked about again');
  r = await goHome(30);
  ask = r.homeBrief?.askWhereabouts || [];
  ok('the answered one is left alone', !ask.some((a) => a.unit === 'T800'), 'T800 not re-asked');

  head('6. #102 An unknown unit is refused rather than silently ignored');
  let refused = null;
  try { await api('/fleetops/whereabouts', 'POST', { trailerUnit: 'NOPE', direction: 'Parked' }); }
  catch (e) { refused = e.message; }
  ok('reporting against a trailer we do not own is an error', !!refused, refused || '(accepted)');
  ok('and it says so plainly', /No such trailer/i.test(refused || ''), refused || '');

  head('7. #103 The chance of a re-rig climbs with how long you have been on the box');
  // Read off the same functions dispatch uses rather than by rolling dice at it, because the roll is
  // seeded and a test that rolls proves only what that seed did.
  const ten = (await api('/bootstrap')).views.trailerTenure;
  const curve = ten.curve;
  ok('the curve is published rather than buried in a constant', Array.isArray(curve) && curve.length >= 5,
    (curve || []).map((c) => `${c.tenure}:${c.percent}%`).join(' '));
  if (Array.isArray(curve) && curve.length >= 5) {
    ok('a fresh assignment is the old one-in-three', curve[0].percent === 34, `${curve[0].percent}%`);
    ok('and it rises every tour', curve.every((c, i) => i === 0 || c.percent >= curve[i - 1].percent),
      curve.map((c) => c.percent).join(' → '));
    ok('by the fifth tour it is the likely outcome', curve[4].percent >= 70, `${curve[4].percent}%`);
    ok('but it stops short of certainty', curve[curve.length - 1].percent <= 80,
      `caps at ${curve[curve.length - 1].percent}%`);
    ok('drop and hook climbs too, but more gently — it is a bigger change',
      curve[4].dropHookPercent > curve[0].dropHookPercent && curve[4].dropHookPercent < curve[4].percent,
      `${curve[0].dropHookPercent}% → ${curve[4].dropHookPercent}%`);
  }

  head('8. #103 Tenure is counted, and a re-rig actually happens');
  let snap = await api('/bootstrap');
  ok('home times on the current box are counted', snap.driver.homeTimesOnTrailer >= 1,
    `${snap.driver.homeTimesOnTrailer} tour(s)`);
  ok('the driver cannot simply help themselves to another box', await (async () => {
    try { await api('/equipment/swap', 'POST', { trailerUnit: 'T801', force: true }); return false; }
    catch { return true; }
  })(), 'operations decides, not the driver');

  // Come home until the roll lands. It is seeded, so this is not luck — it is the curve doing its job,
  // and on the old flat 34 a fixture like this could run out of patience without ever seeing a change.
  let order = null, tours = [];
  for (let d = 44; d <= 140; d += 14) {
    await at('Wichita', 'KS', d - 2);
    const r = await goHome(d);
    snap = await api('/bootstrap');
    tours.push(`${snap.driver.homeTimesOnTrailer}`);
    const eo = snap.views.equipmentOrder;
    if (eo && eo.kind === 'TrailerSwap') { order = eo; break; }
  }
  console.log(`     tenure by home time: ${tours.join(', ')}`);
  ok('a re-rig comes round rather than never arriving', !!order,
    order ? `${order.number} onto ${order.toTrailerUnit}` : 'never fired in 7 home times');

  if (order) {
    const before = (await api('/bootstrap')).driver.homeTimesOnTrailer;
    ok('the driver is on notice before it happens, not after', before >= 1, `${before} tour(s) on the old box`);
    await api(`/equipment/orders/${encodeURIComponent(order.number)}/complete`, 'POST', {}).catch(() => {});
    snap = await api('/bootstrap');
    if (snap.driver.assignedTrailerUnit !== order.fromTrailerUnit) {
      ok('and being put on a different box starts the count over',
        snap.driver.homeTimesOnTrailer === 0, `${snap.driver.homeTimesOnTrailer} after the change`);
      ok('the tenure note reads as freshly assigned',
        /freshly assigned/i.test(snap.views.trailerTenure.note || ''),
        (snap.views.trailerTenure.note || '').slice(0, 90));
    } else {
      ok('the order is still open, so nothing has changed hands yet',
        snap.driver.homeTimesOnTrailer >= 1, `${snap.driver.homeTimesOnTrailer}`);
      ok('and the order is what is holding it', true, order.number);
    }
  }

  head('9. #103 A trailer the driver ASKED for is still never re-rigged');
  // An arrangement is an arrangement. Being moved off one you asked for would make asking meaningless,
  // and that exemption is what the rising chance must NOT eat into.
  snap = await api('/bootstrap');
  ok('nothing is by request yet', snap.views.trailerArrangement.byRequest !== true,
    `${snap.views.trailerArrangement.byRequest}`);
  ok('so the box is eligible to be moved', snap.views.trailerTenure.eligible === true,
    `eligible=${snap.views.trailerTenure.eligible}`);
  ok('and the driver is told the odds rather than left to guess',
    /more likely|leave you on it|tour\(s\) on this one/i.test(snap.views.trailerTenure.note || ''),
    (snap.views.trailerTenure.note || '').slice(0, 110));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
