/* Issue #126 — being told your OWN truck is finished, without a fleet report.
 *
 * The judgement already existed and was already right. It just only ever ran inside FileReport, which
 * needs hired drivers — so a driver with nobody under them could run a tractor to a million miles and
 * nothing would ever mention it. The one unit where it matters most, since they are sitting in it.
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

let S, day = 1, odo = 90000;
const views = async () => (await api('/bootstrap')).views;
const trade = async () => (await views()).ownTruckTrade;

/** Set the player's own tractor to a given wear state. */
async function myTruck({ serviceMiles, repairs = 0, damage = 3, odometer }) {
  const unit = (await api('/bootstrap')).driver.assignedTruckUnit;
  await api('/fleet/truck', 'POST', {
    unit, make: 'Peterbilt', model: '579', year: 2016,
    atsOdometer: odometer ?? serviceMiles, serviceMiles,
    lastServiceMiles: serviceMiles, serviceIntervalMiles: 25000,
    lifetimeRepairCost: repairs, damagePct: damage, inGameGarage: true,
  });
  return unit;
}

async function stand(city, st, kind = 'TruckStop', dmg = 3) {
  odo += 60;
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(day, '09:00'),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: dmg, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 120000,
  }));
  return S;
}

(async () => {
  const app = { driverName: 'T. Rade', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 14, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. #126 There are no hired drivers, and it is still answered');
  // The whole point. This career will never file a fleet report.
  ok('no hired drivers on the roster', ((await api('/fleetops')).drivers || []).length === 0,
    `${((await api('/fleetops')).drivers || []).length}`);
  ok('and no fleet report has ever been filed',
    ((await api('/fleetops')).reports || []).length === 0, 'none');

  head('2. #126 A well-used truck is not a finished one');
  // Mileage alone is a truck that has worked, not a truck that is done. Two reasons are needed.
  await myTruck({ serviceMiles: 740000, repairs: 0, damage: 3 });
  ok('high miles on their own say nothing', !(await trade()),
    (await trade())?.headline || '(nothing said)');

  await myTruck({ serviceMiles: 120000, repairs: 15000, damage: 3 });
  ok('nor does a big repair bill on its own', !(await trade()),
    (await trade())?.headline || '(nothing said)');

  head('3. #126 Two reasons and the company says so');
  await myTruck({ serviceMiles: 780000, repairs: 16000, damage: 4 });
  const t = await trade();
  ok('the recommendation comes back', !!t, t ? t.headline : '(none)');
  ok('it knows it is the player\'s own truck', t?.isPlayerUnit === true, `${t?.isPlayerUnit}`);
  ok('and says so in the headline rather than as a fleet note',
    /your own truck/i.test(t?.headline || ''), t?.headline?.slice(0, 90));
  ok('the mileage is in the evidence',
    (t?.evidence || []).some((e) => /company-service miles/i.test(e)),
    (t?.evidence || []).find((e) => /miles/i.test(e)) || '');
  ok('so is the repair spend',
    (t?.evidence || []).some((e) => /in repairs against it/i.test(e)),
    (t?.evidence || []).find((e) => /repairs/i.test(e)) || '');
  ok('and it says what to do about it',
    (t?.evidence || []).some((e) => /Buy the replacement|spare on the property/i.test(e)),
    (t?.evidence || []).find((e) => /replacement|spare/i.test(e))?.slice(0, 90) || '');

  head('4. #126 It reaches the driver, not just the snapshot');
  const alerts = (await views()).maintenanceAlerts || [];
  ok('the maintenance alerts carry one line about it',
    alerts.some((a) => /due for trade/i.test(a)),
    alerts.find((a) => /due for trade/i.test(a))?.slice(0, 95) || '(none)');
  ok('and it points at the yard, where a swap actually happens',
    alerts.some((a) => /due for trade/i.test(a) && /Report to the yard/i.test(a)), 'said');

  head('5. #126 The yard brief makes the case while they are standing there');
  day = 20;
  await stand('Joplin', 'MO');
  day = 21;
  const home = await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal',
    gameTime: at(day, '09:00'), fuelPct: 80, atsOdometer: odo + 200,
    truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 120000,
  });
  const shop = home.homeBrief?.shop || [];
  ok('a yard brief was raised', !!home.homeBrief, home.homeBrief ? 'yes' : '(none)');
  ok('and it says the truck is due for trade',
    shop.some((x) => /due for trade/i.test(x)), shop.find((x) => /trade/i.test(x))?.slice(0, 95) || shop.join(' | ').slice(0, 95));
  ok('with the evidence beside it, not just the verdict',
    shop.some((x) => /company-service miles|in repairs against it/i.test(x)),
    shop.find((x) => /miles|repairs/i.test(x))?.slice(0, 90) || '');

  head('6. #126 Nothing stops. It is a recommendation, not a wall.');
  // A high-mileage truck still runs. The point is that a trade gets planned rather than forced by a
  // breakdown on the shoulder.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: 'Springfield', originState: 'MO', destCity: 'Tulsa', destState: 'OK',
    loadedMiles: 220, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 60, weightLbs: 38000,
  });
  ok('freight is still authorized on a truck due for trade', board.rejectAll !== true,
    board.headline?.slice(0, 90) || '');
  ok('and the recommendation is still standing', !!(await trade()), 'still recommended');

  head('7. #126 A unit with no spec typed in still reads properly');
  // Year, make and model are optional. A blank one used to print "Unit 101 (0  ) — your own truck".
  const bare = (await api('/bootstrap')).driver.assignedTruckUnit;
  await api('/fleet/truck', 'POST', {
    unit: bare, make: '', model: '', year: 0,
    atsOdometer: 810000, serviceMiles: 810000, lastServiceMiles: 810000,
    serviceIntervalMiles: 25000, lifetimeRepairCost: 18000, damagePct: 4, inGameGarage: true,
  });
  const nospec = await trade();
  ok('it is still recommended', !!nospec, nospec?.headline || '(none)');
  ok('and the headline has no empty brackets in it',
    !/\(\s*0?\s*\)/.test(nospec?.headline || ''), nospec?.headline?.slice(0, 80));

  head('8. #126 Put it right and it stops saying it');
  await myTruck({ serviceMiles: 4000, repairs: 0, damage: 2, odometer: 4000 });
  ok('a fresh tractor is not due for trade', !(await trade()),
    (await trade())?.headline || '(nothing said)');
  ok('and the alert goes with it',
    !((await views()).maintenanceAlerts || []).some((a) => /due for trade/i.test(a)), 'gone');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
