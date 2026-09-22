/* Closing out a load that was never delivered, and getting the career back.
 *
 * Reported from play: "I had an issue where I accidentally closed out and audited a load that was not
 * delivered. I need a way to reverse that and if the settlement hasn't happened pull back that
 * settlement. Can be from trips page."
 *
 * A close-out is the widest thing the app does in one press. It pays the driver and adds it to the
 * unsettled total, posts the ledger, folds the run into the learned dock times and the planning speed,
 * moves the truck to the receiver, marks the city discovered, advances the career, can take home time
 * and can run an entire settlement. Writing an inverse for all of that is a dozen chances to get the
 * arithmetic wrong, and a wrong inverse is worse than no button at all.
 *
 * So the close-out takes a backup of the instant before it, and reversing restores that. The settlement
 * comes back because everything comes back. What that costs is that anything done SINCE goes back too,
 * which is why the confirm says so with the facts in it rather than asking "are you sure".
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5997}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};

let S, odo = 100_000;

async function stand(city, state, day, hm = '07:00') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: odo, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 150_000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
}

/** Take a load and close it out, returning the trip. */
async function runOne(dest, destState, miles, day) {
  await api('/board/clear', 'POST', {});
  const added = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, receiver: 'Consignee',
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: dest, destState, loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: Math.round(miles * 2.6), deadlineHours: 60, weightLbs: 34000,
    atLocation: true, preLoaded: true,
  });
  const ev = (added.evaluations || [])[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: ev.load.id });
  const trip = auth.trip || (un(auth).trips || [])[0];
  odo += miles;
  const done = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(day, '17:00'), actualMiles: miles, endOdometer: odo,
    actualRevenue: Math.round(miles * 2.6), fuelStops: [], tolls: 0, repairCost: 0, fines: 0,
    otherExpense: 0, truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: dest, locationState: destState, locationKind: 'Receiver',
    fuelPct: 55, gameTime: iso(day, '17:00'),
  });
  S = done.snapshot;
  return { trip, done };
}

(async () => {
  const app = {
    driverName: 'U. Turner', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'otr',
  };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await stand('Springfield', 'MO', 10);

  head('1. Close one out, and the career moves under you');
  const settlements = async () => ((await api('/export')).settlements || []).length;
  const before = {
    unsettled: S.driver.unsettledPay,
    city: S.status.locationCity,
    speedSamples: S.settings.speedFactorSamples,
    ledger: ((await api('/export')).ledger || []).length,
    settlements: await settlements(),
  };
  const { trip } = await runOne('Tulsa', 'OK', 260, 11);
  const after = {
    unsettled: S.driver.unsettledPay,
    city: S.status.locationCity,
    speedSamples: S.settings.speedFactorSamples,
    ledger: ((await api('/export')).ledger || []).length,
    settlements: await settlements(),
  };
  const closedTrip = (S.trips || []).find((t) => t.id === trip.id);
  console.log(`  ..    ${trip.number}: pay ${closedTrip?.pay?.total}, truck ${before.city} → ${after.city}, ` +
              `ledger ${before.ledger} → ${after.ledger}, settlements ${before.settlements} → ${after.settlements}`);
  ok('the load closed out', closedTrip?.status === 'Delivered', closedTrip?.status);
  ok('the driver was paid for it', (closedTrip?.pay?.total ?? 0) > 0, `${closedTrip?.pay?.total}`);
  ok('the books moved', after.ledger > before.ledger, `${before.ledger} → ${after.ledger}`);
  ok('and the truck was moved to the receiver', after.city === 'Tulsa', after.city);

  head('2. A reversal point was kept, and the preview says what it would cost');
  const closed = (S.trips || []).find((t) => t.id === trip.id);
  ok('the close-out left a way back', !!closed.reversalSnapshot, closed.reversalSnapshot || '(none)');
  const preview = await api(`/trips/${trip.id}/reverse-closeout/preview`);
  console.log(`  ..    pay ${preview.driverPay}, paid already ${preview.alreadyPaid}, ` +
              `closed since ${preview.closedSince.length}`);
  ok('it can be reversed', preview.canReverse === true, preview.why || 'yes');
  ok('the preview names the pay that would come back', preview.driverPay > 0, `${preview.driverPay}`);
  // This fixture happens to cross a payday on the close-out, which is the HARDER case and the one the
  // report is really about: the settlement already ran. The preview has to tell the truth about which
  // case the driver is in either way, because one of them means undoing a payslip they have seen.
  ok('it tells the truth about whether this load has been settled',
    preview.alreadyPaid === (after.settlements > before.settlements),
    `alreadyPaid=${preview.alreadyPaid}, settlements ${before.settlements} → ${after.settlements}`);
  if (preview.alreadyPaid) {
    ok('and names the settlement it would take back', preview.settledOn.length > 0,
      preview.settledOn.join(', '));
  } else {
    ok('and there is no settlement to take back', preview.settledOn.length === 0, 'none');
  }
  ok('and that nothing has been closed out since', preview.closedSince.length === 0,
    `${preview.closedSince.length}`);

  head('3. Reversing puts every one of those back');
  S = un(await api(`/trips/${trip.id}/reverse-closeout`, 'POST', {}));
  const back = (S.trips || []).find((t) => t.id === trip.id);
  console.log(`  ..    ${trip.number} is ${back?.status}, unsettled ${S.driver.unsettledPay}, ` +
              `truck ${S.status.locationCity}, ${S.settings.speedFactorSamples} speed sample(s)`);
  ok('the load is no longer delivered', back && back.status !== 'Delivered', back?.status);
  ok('the pay came back off the unsettled total',
    Math.abs(S.driver.unsettledPay - before.unsettled) < 0.001,
    `${after.unsettled} → ${S.driver.unsettledPay}, was ${before.unsettled}`);
  // The point of the report, and the reason this restores rather than computing an inverse: a
  // settlement that ran on the close-out is pulled back with everything else, without anyone having to
  // work out how to un-issue a payslip.
  const raw = await api('/export');
  const settlementsNow = (raw.settlements || []).length;
  // Counted against the trip rather than against a total: authorizing a load posts to the books too, so
  // a raw count before the whole run is not the baseline for what the CLOSE-OUT put there.
  const postedForTrip = (raw.ledger || [])
    .filter((e) => (e.tripNumber || '').toLowerCase() === trip.number.toLowerCase()).length;
  ok('a settlement that ran on the close-out is pulled back too',
    settlementsNow === before.settlements, `${after.settlements} → ${settlementsNow}`);
  ok('and the close-out is off the books', postedForTrip === 0, `${postedForTrip} entr(ies) left`);
  ok('the truck is back where it started', S.status.locationCity === before.city,
    `${after.city} → ${S.status.locationCity}`);
  ok('and the run no longer teaches the planner anything',
    S.settings.speedFactorSamples === before.speedSamples,
    `${after.speedSamples} → ${S.settings.speedFactorSamples}`);
  ok('the driver is told it happened',
    (S.events || []).some((e) => /close-out reversed/i.test(e.message || '')), 'logged');

  head('4. It says why when there is nothing to reverse');
  // A load in transit has not been closed out, and one closed before this existed has no point to
  // return to. Both get a reason rather than a button that half works.
  let threw = '';
  try { await api(`/trips/${trip.id}/reverse-closeout`, 'POST', {}); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 120)}`);
  ok('an open load cannot be reversed', /not closed out/i.test(threw), threw.slice(0, 70));

  const older = await api('/export');
  const victim = (older.trips || []).find((t) => t.id === trip.id);
  victim.status = 'Delivered';
  victim.reversalSnapshot = '';
  await api('/import', 'POST', older);
  threw = '';
  try { await api(`/trips/${trip.id}/reverse-closeout`, 'POST', {}); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 140)}`);
  ok('and one closed before reversal points existed says so',
    /before the app started keeping a reversal point/i.test(threw), threw.slice(0, 70));
  ok('pointing at the backups instead of leaving them stuck', /backups/i.test(threw), 'named');

  head('5. The buttons that fire all this ask first');
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  // Reported from play: "can we put a confirmation box on the audit so that this can be caught if the
  // close and audit button is accidentally pressed?"
  const closeCase = js.slice(js.indexOf("case 'complete-trip':"), js.indexOf("case 'complete-trip':") + 900);
  ok('closing a load out asks before it does it', /confirm\(/.test(closeCase), 'confirmed');
  ok('and says what closing out actually claims', /DELIVERED/.test(closeCase), 'states it');
  const revCase = js.slice(js.indexOf("case 'reverse-closeout':"), js.indexOf("case 'reverse-closeout':") + 1600);
  ok('reversing asks too', /confirm\(/.test(revCase), 'confirmed');
  ok('with the facts rather than a bare are-you-sure',
    /alreadyPaid/.test(revCase) && /closedSince/.test(revCase), 'facts');
  ok('and the way back out is offered on the trip record',
    /data-act="reverse-closeout"/.test(js), 'on the trip detail');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
