/* Issue #125 — scheduled maintenance on tractors the player cannot drive to a shop.
 *
 * A hired driver's truck raised the same "PM overdue by 11,400 mi" alert the player's own truck raises,
 * and ATS gives no way to act on it. An alert nobody can carry out is worse than none: it teaches the
 * player to skip the panel where the alerts that matter live.
 *
 * It is a bill they authorise now. The company's own shop does the work, the ledger takes it, and the
 * app never claims the truck was off the road — that is the one thing the game would contradict.
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
const at = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const views = async () => (await api('/bootstrap')).views;
const pmFor = async (unit) => ((await views()).fleetPm || []).find((x) => x.unit === unit);
const cash = async () => (await api('/bootstrap')).ledger?.operatingBalance
  ?? (await api('/bootstrap')).company?.cashOnHand ?? 0;

/** Put a hired driver on a unit and run its odometer well past the service interval. */
async function unitPastDue(unit, odo, serviceMiles, damage = 4) {
  await api('/fleet/truck', 'POST', {
    unit, make: 'Freightliner', model: 'Cascadia', year: 2019,
    atsOdometer: odo, serviceMiles, lastServiceMiles: 0, serviceIntervalMiles: 25000,
    damagePct: damage, inGameGarage: true, homeTerminalId: S.company.terminals[0].id,
  });
  return unit;
}

(async () => {
  const app = { driverName: 'P. Emm', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  // A default career is a one-slot yard, and this suite stands up a dozen tractors.
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));

  head('1. #125 A unit nobody drives for the company raises nothing');
  // The rule is about hired drivers' trucks. A unit with no driver on it is not the fleet's problem to
  // authorise, and the player's own truck they can take to a shop themselves.
  await unitPastDue('T900', 310000, 44000);
  ok('an unmanned unit past due raises no offer', !(await pmFor('T900')), 'nothing offered');

  head('2. #125 A hired driver\'s unit past due becomes a decision with a price');
  const hired = (await api('/fleetops/drivers', 'POST', {
    name: 'M. Reyes', status: 'Active', assignedTruckUnit: 'T900', skill: 'Experienced',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
  const offer = await pmFor('T900');
  ok('the offer appears once somebody is running it', !!offer, offer ? offer.headline : '(none)');
  ok('it names the driver, so it is clear whose truck it is', offer?.driver === 'M. Reyes', offer?.driver);
  ok('it says how far past due', offer?.milesPastDue === 19000, `${offer?.milesPastDue} mi`);
  ok('and puts a price on it rather than an instruction', offer?.cost > 0, `$${offer?.cost}`);
  ok('it says plainly the truck is not being parked',
    /not parking the truck/i.test(offer?.detail || ''), offer?.detail?.slice(0, 90));
  ok('the alert points at where the decision is made',
    ((await views()).maintenanceAlerts || []).some((a) => /T900/.test(a) && /Fleet tab/i.test(a)),
    ((await views()).maintenanceAlerts || []).find((a) => /T900/.test(a))?.slice(0, 90) || '(none)');

  head('3. #125 Deferring is allowed, remembered, and said out loud');
  const before = offer.findChancePct;
  const d1 = await api('/fleetops/pm/defer', 'POST', { unit: 'T900' });
  const afterDefer = await pmFor('T900');
  ok('the deferral is counted', afterDefer?.deferrals === 1, `${afterDefer?.deferrals}`);
  ok('and it raises what the shop is likely to find', afterDefer.findChancePct > before,
    `${before}% -> ${afterDefer.findChancePct}%`);
  ok('the player is told that when they defer, not afterwards',
    /deferral|find something/i.test(d1.message || ''), (d1.message || '').slice(0, 100));
  ok('and the offer still stands', !!afterDefer, 'still offered');

  head('4. #125 Scheduling charges the company and resets the clock');
  const spend = await api('/fleetops/pm/schedule', 'POST', { unit: 'T900', gameTime: at(6) });
  const r = spend.result;
  ok('it came back with an outcome', ['Routine', 'MajorRepair', 'Condemned'].includes(r?.outcome), r?.outcome);
  ok('the service clock is reset', !(await pmFor('T900')), 'no longer due');
  ok('the deferral count is cleared with it',
    un(spend).trucks.find((t) => t.unit === 'T900').pmDeferrals === 0, 'zeroed');
  ok('it cost real money', r.cost > 0, `$${r.cost}`);
  // The ledger is its own endpoint rather than part of the snapshot.
  const posted = (await api('/ledger?take=40')).find((e) => /PM . unit/i.test(e.memo || ''));
  ok('and it went through the books', !!posted && posted.amount < 0,
    posted ? `${posted.memo} ${posted.amount}` : '(nothing posted)');

  head('5. #125 No downtime is ever claimed');
  // The one thing the app must not do. ATS keeps the driver rolling, so an app that says otherwise is
  // visibly wrong about the world and stops being worth reading.
  const stillOn = (await api('/fleetops')).drivers.find((x) => x.id === hired.id);
  ok('the driver is still active', stillOn?.status === 'Active', stillOn?.status);
  ok('and still on the unit', stillOn?.assignedTruckUnit === 'T900', stillOn?.assignedTruckUnit);
  ok('nothing in the message claims the truck sat',
    !/days? (out of service|down|in the (bay|shop))/i.test(r.message), r.message.slice(0, 100));

  head('6. #125 The same service twice cannot re-roll the outcome');
  // Seeded on the unit and the mileage it went in at, like every other chance in the app.
  await unitPastDue('T901', 320000, 60000);
  await api('/fleetops/drivers', 'POST', {
    name: 'J. Okafor', status: 'Active', assignedTruckUnit: 'T901', skill: 'Competent',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  });
  const first = (await api('/fleetops/pm/schedule', 'POST', { unit: 'T901', gameTime: at(7) })).result;
  // Put it back exactly where it was and ask again.
  await unitPastDue('T901', 320000, 60000);
  const again = (await api('/fleetops/pm/schedule', 'POST', { unit: 'T901', gameTime: at(7) })).result;
  ok('the same unit at the same mileage answers the same way', first.outcome === again.outcome,
    `${first.outcome} then ${again.outcome}`);

  head('7. #125 A worn-out unit that is condemned tells the player what to do about it');
  // Deep into a second life and long past due: the shop stops rather than rebuilding, and the player
  // has to go and trade it in ATS. This one the game WILL agree with, which is why downtime is honest
  // here and dishonest for a routine service.
  // One unit, walked through mileages, rather than fourteen tractors on a five-slot yard. The seed is
  // the unit and the mileage it went in at, so varying the mileage is what varies the roll.
  await unitPastDue('T950', 900000, 90000, 26);
  await api('/fleetops/drivers', 'POST', {
    name: 'Old Hand', status: 'Active', assignedTruckUnit: 'T950', skill: 'Veteran',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  });
  let condemned = null;
  for (let i = 0; i < 20 && !condemned; i++) {
    await unitPastDue('T950', 900000 + i * 15000, 90000 + i * 3000, 26);
    const res = (await api('/fleetops/pm/schedule', 'POST', { unit: 'T950', gameTime: at(8) })).result;
    if (res.outcome === 'Condemned') condemned = res;
  }
  ok('a high-mileage unit does eventually get condemned', !!condemned,
    condemned ? condemned.unitRef : 'none in 14 tries');
  if (condemned) {
    ok('it says why, in miles', /mi the shop will not put it back/i.test(condemned.message),
      condemned.message.slice(0, 110));
    ok('it tells them to sell it and what to buy',
      condemned.instructions.some((x) => /^Sell unit/i.test(x))
      && condemned.instructions.some((x) => /Buy the replacement/i.test(x)),
      condemned.instructions.join(' | ').slice(0, 130));
    ok('and that the driver is waiting on them',
      condemned.instructions.some((x) => /no tractor until you do/i.test(x)), 'said');
    ok('the unit stops raising a service offer', !(await pmFor(condemned.unit)), 'off the list');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
