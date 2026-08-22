/* Totalling a tractor: the app has to say so, and say what to do about it.
 *
 * The write-off line and the insurance settlement both existed. What never happened was anybody being
 * TOLD — the line was only quoted if you went and asked the shop for a repair estimate, which is not
 * what a driver does after putting a truck in a ditch.
 *
 * Recognised on the safety incident, because that is where the driver reports it, and regardless of
 * fault: fault decides the deductible and the record, not whether the tractor is repairable.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5900}/api`;
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
async function place(day, damage = 3) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(day, '10:00'),
    fuelPct: 70, atsOdometer: 120000, truckDamagePct: damage, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  return S;
}

(async () => {
  const app = { driverName: 'W. Reck', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  await place(2);

  const myTruck = S.driver.assignedTruckUnit;
  const writeOffAt = (await api('/bootstrap')).views.maintenance?.writeOff?.[0]?.atPct
    ?? (await api('/shop/quote').catch(() => null))?.totalLossAtPct;
  ok('the driver has a truck', !!myTruck, myTruck);

  head('1. A dent is not a write-off');
  let r = await api('/incidents', 'POST', {
    kind: 'Damage', description: 'clipped a post backing in', faultAttribution: 'Driver',
    severity: 'Minor', preventable: true, truckDamagePctAfter: 6,
  });
  ok('no write-off steps for light damage', !r.writeOff, r.writeOff ? r.writeOff[0] : 'none');
  ok('and dispatch is not held',
    !((await api('/bootstrap')).views.dispatchBlockers || []).some((b) => /write-off/i.test(b)),
    'clear');

  head('2. THE REPORTED CASE: a totalled tractor is recognised on the incident');
  // Under load when it happens, which is the awkward part nothing used to address.
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type,
    originCity: 'Amarillo', originState: 'TX', destCity: 'Denver', destState: 'CO',
    loadedMiles: 430, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 40, weightLbs: 30000,
  });
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id })).trip;

  r = await api('/incidents', 'POST', {
    kind: 'Accident', description: 'AI ran a light and hit me broadside',
    faultAttribution: 'Unavoidable', severity: 'Major', preventable: false,
    truckDamagePctAfter: 78,
  });
  const steps = (r.writeOff || []).join(' | ');
  ok('the app says the tractor is finished', (r.writeOff || []).length > 0, steps.slice(0, 130) || '(none)');
  ok('it names the damage against the write-off line',
    /past the .*% write-off line/i.test(steps), '');
  ok('and says it does not go through a shop', /does not go through a shop/i.test(steps), '');

  head('3. The load comes off first, against dispatch');
  ok('the open load is named', new RegExp(trip.number).test(steps), steps.slice(0, 200));
  ok('cancel it in the game AND here', /Cancel .* in ATS/i.test(steps) && /cancel it here/i.test(steps), '');
  ok('fault goes to dispatch, not the driver',
    /fault to \*\*Dispatcher\*\*|fault to Dispatcher/i.test(steps), '');
  ok('and it says the record is not touched', /your record does not/i.test(steps), '');

  head('4. Scrap it, and the company orders the replacement');
  ok('told to sell it for scrap', /Sell the wreck for scrap/i.test(steps), '');
  ok('the app does not guess what it fetched', /I will not guess at it/i.test(steps), '');
  const order = (await api('/equipment')).openOrder;
  ok('a replacement was ORDERED, not just suggested', !!order, order ? order.number : '(none)');
  ok('and it is a purchase, since nothing is on the property', order?.mustPurchase === true,
    `${order?.mustPurchase}`);
  ok('the steps name the order and the spec',
    new RegExp(order?.number || 'xxx').test(steps) && /Go and pick it up in ATS/i.test(steps),
    steps.slice(-220));
  ok('the spec is a real recommendation', /hp|sleeper|gal of fuel/i.test(steps), '');

  head('5. Nothing dispatches on a wreck');
  const blockers = ((await api('/bootstrap')).views.dispatchBlockers || []).join(' | ');
  ok('dispatch is held', /write-off/i.test(blockers), blockers.slice(0, 180) || '(none)');
  ok('and it names the load that needs cancelling',
    new RegExp(trip.number).test(blockers), blockers.slice(0, 200));
  let refused = null;
  try {
    await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id });
  } catch (e) { refused = e.message; }
  ok('nothing can be booked', refused !== null, (refused || '(ALLOWED!)').slice(0, 120));

  head('6. The steps stay in front of the driver, not behind a shop estimate');
  const view = (await api('/bootstrap')).views.writeOff;
  ok('they are on the snapshot', !!view, view ? `${view.unit} at ${view.damagePct}%` : '(none)');
  ok('with the unit and the damage', view?.unit === myTruck || !!view?.unit, `${view?.unit}`);
  ok('and the same ordered steps', (view?.steps || []).length >= 4, `${(view?.steps || []).length} steps`);

  head('7. Fault changes the cost, not whether it is a wreck');
  // Same damage, driver's fault this time: still a write-off, and the deductible is the heavier one.
  const wo = (await api('/maintenance/writeoff', 'POST', {
    unit: myTruck, driverFault: true, scrapRecovery: 4000, notes: '',
  })).writeOff;
  ok('the unit comes off the fleet', wo.unit === myTruck, `${wo.unit}`);
  ok('scrap is booked as reported, not guessed', wo.scrapRecovery === 4000, `$${wo.scrapRecovery}`);
  ok('the driver-fault deductible applies', wo.deductible > 0, `$${wo.deductible}`);
  ok('and the replacement spec comes with it', !!wo.replacementSpec,
    (wo.replacementSpec || '').slice(0, 90));

  head('7b. Once it is off the fleet, the wreck stops blocking');
  const after = (await api('/bootstrap')).views;
  ok('no write-off is pending any more', !after.writeOff, `${after.writeOff?.unit}`);
  ok('and the seat is empty until the new unit is reported',
    !(await api('/bootstrap')).driver.assignedTruckUnit, 'no truck assigned');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
