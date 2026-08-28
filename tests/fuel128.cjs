/* Issue #128 — making the fuel receipts mean something.
 *
 * Every stop already carried the state, the gallons and the price per gallon, and none of it did
 * anything but get totalled. Two real skills went unrewarded: driving the truck economically, and
 * knowing where to buy. Crossing into California with full tanks is worth real money and the app knew
 * enough to say so.
 *
 * Both are paid on the settlement, beside on-time and safety, and neither can ever go negative — an
 * expensive fill has already cost the driver at the pump.
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

let S, day = 1, odo = 80000;
const views = async () => (await api('/bootstrap')).views;
const board = async () => (await views()).fuel;
const stateOn = async (st) => ((await board()).board || []).find((x) => x.state === st);

async function stand(city, state) {
  odo += 40;
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime: at(day, '09:00'),
    fuelPct: 60, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  }));
  return S;
}

/** One delivered load, with whatever fuel was bought on it. */
async function runLoad(from, fromSt, to, toSt, miles, fuelStops, gallonsHint) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const add = () => api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: from, originState: fromSt, destCity: to, destState: toSt,
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: miles * 2.6,
    deadlineHours: 200, weightLbs: 38000,
  });
  const auth = await H.authorize(api, add, (d) => { day += d; return at(day); });
  day += 1;
  odo += miles;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: miles, endOdometer: odo, actualRevenue: miles * 2.6,
    fuelStops: fuelStops || [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: to, locationState: toSt, fuelPct: 60, gameTime: at(day),
  });
  S = done.snapshot;
  return done;
}

const fuel = (city, state, gallons, price, d) => ({
  gameTime: at(d ?? day), city, state, vendor: 'Pilot',
  gallons, pricePerGal: price, cost: Math.round(gallons * price * 100) / 100,
});

/**
 * The settlement covering the work just done.
 *
 * Settlements run themselves — closing a trip can produce one on its own — so forcing another finds
 * nothing left to settle. Try to force one, and where there is nothing outstanding take the newest,
 * which is the one that swept up the loads this section just ran.
 */
async function settle() {
  try {
    const r = await api('/settlements/legacy-run', 'POST', { notes: 'fixture' });
    S = un(r);
    return r.settlement;
  } catch (e) {
    if (!/nothing to settle/i.test(e.message)) throw e;
    S = await api('/bootstrap');
    return S.settlements[0];
  }
}

(async () => {
  const app = { driverName: 'D. Iesel', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Phoenix', homeState: 'AZ', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  await api('/settings', 'POST', { ...S.settings, fuelPricePerGal: 4.00 });
  await stand('Phoenix', 'AZ');

  head('1. #128 The board knows what fuel costs before you have bought any');
  const b0 = await board();
  ok('there is a price board on a brand new career', (b0.board || []).length > 10,
    `${(b0.board || []).length} states`);
  ok('California is on it as the dear one',
    (b0.dearest || []).some((x) => x.state === 'CA'),
    (b0.dearest || []).map((x) => x.state).join(', '));
  ok('and Oklahoma as a cheap one',
    (b0.cheapest || []).some((x) => x.state === 'OK'),
    (b0.cheapest || []).map((x) => x.state).join(', '));
  const ca0 = await stateOn('CA');
  const ok0 = await stateOn('OK');
  ok('CA is quoted well over OK', ca0.perGallon > ok0.perGallon * 1.3,
    `CA $${ca0.perGallon} vs OK $${ok0.perGallon}`);
  ok('and it says the figure is only a starting guess', ca0.source === 'typical', ca0.source);

  head('2. #128 Your own receipts replace the guess');
  // Three stops in a state is enough to stop guessing about it.
  await runLoad('Phoenix', 'AZ', 'Barstow', 'CA', 380,
    [fuel('Barstow', 'CA', 100, 5.20), fuel('Kingman', 'AZ', 90, 3.55)]);
  await runLoad('Barstow', 'CA', 'Las Vegas', 'NV', 160,
    [fuel('Barstow', 'CA', 110, 5.40)]);
  await runLoad('Las Vegas', 'NV', 'Bakersfield', 'CA', 280,
    [fuel('Bakersfield', 'CA', 120, 5.30)]);
  const ca1 = await stateOn('CA');
  ok('CA now comes off your receipts', ca1.source === 'your receipts', `${ca1.source}, ${ca1.stops} stops`);
  ok('and the price is what you actually paid', Math.abs(ca1.perGallon - 5.30) < 0.15,
    `$${ca1.perGallon} against the $5.20/5.40/5.30 paid`);
  const az1 = await stateOn('AZ');
  ok('one stop in AZ is not enough to learn from', az1.source === 'typical',
    `${az1.source}, ${az1.stops} stop(s)`);

  head('3. #128 You are told before you cross, not after');
  await stand('Kingman', 'AZ');
  await api('/board/clear', 'POST', {});
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: 'Kingman', originState: 'AZ', destCity: 'Barstow', destState: 'CA',
    loadedMiles: 200, deadheadMiles: 0, gameRevenue: 640, deadlineHours: 120, weightLbs: 38000,
  });
  if (bd.evaluations?.[0]) await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id });
  const warn = (await views()).fuelCrossing;
  ok('a run into California warns before the line', !!warn, warn?.slice(0, 100) || '(nothing said)');
  ok('it says how much more, in money', /a gallon/.test(warn || ''), 'priced');
  ok('and tells you what to do about it', /fill before you cross/i.test(warn || ''), 'said');

  // That load is standing authorized, so run it in rather than leaving it across the next section.
  const open = (await api('/bootstrap')).trips.find((x) => x.status === 'Authorized' || x.status === 'InTransit');
  if (open) {
    day += 1;
    odo += 200;
    S = un(await api(`/trips/${open.id}/complete`, 'POST', {
      deliveredGameTime: at(day), actualMiles: 200, endOdometer: odo, actualRevenue: 640,
      fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 1, detentionHours: 0,
      layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
      delayReason: '', damageCause: '', notes: '',
      locationCity: 'Barstow', locationState: 'CA', fuelPct: 60, gameTime: at(day),
    }));
  }
  // Clear the decks so the economy figures below are this section's, not the whole career's.
  await settle();

  head('4. #128 Economy against what the truck is rated for');
  // 6.5 rated. 1,000 miles on 125 gallons is 8.0 mpg — comfortably over.
  await stand('Kingman', 'AZ');
  await runLoad('Kingman', 'AZ', 'Tucson', 'AZ', 500, [fuel('Kingman', 'AZ', 62, 3.40)]);
  await runLoad('Tucson', 'AZ', 'El Paso', 'TX', 500, [fuel('Tucson', 'AZ', 63, 3.45)]);
  const st1 = await settle();
  ok('the settlement records the mpg achieved', st1.mpg > 0, `${st1.mpg} mpg`);
  ok('and what the truck is rated for', st1.ratedMpg > 0, `${st1.ratedMpg} rated`);
  ok('beating the rating earns an economy bonus', st1.fuelEfficiencyBonus > 0,
    `$${st1.fuelEfficiencyBonus} on ${st1.mpg} vs ${st1.ratedMpg}`);
  ok('and the stub says so in those terms',
    (st1.lines || []).some((l) => /Fuel economy/i.test(l) && /rated/i.test(l)),
    (st1.lines || []).find((l) => /Fuel economy/i.test(l))?.slice(0, 95) || '');

  head('5. #128 Buying under the reference pays a share');
  ok('the saving is recorded', st1.fuelSaved > 0, `$${st1.fuelSaved} under $4.00/gal`);
  ok('and a share of it is paid', st1.fuelBuyingBonus > 0, `$${st1.fuelBuyingBonus}`);
  ok('a share, not the lot', Number(st1.fuelBuyingBonus) < Number(st1.fuelSaved),
    `$${st1.fuelBuyingBonus} of $${st1.fuelSaved}`);
  ok('both land in the gross',
    Number(st1.gross) > Number(st1.linehaulPay) + Number(st1.deadheadPay), `$${st1.gross}`);

  head('6. #128 An expensive fill is named, never charged for');
  await stand('Barstow', 'CA');
  await runLoad('Barstow', 'CA', 'Los Angeles', 'CA', 130, [fuel('Barstow', 'CA', 150, 5.60)]);
  const st2 = await settle();
  // This run never leaves California, so under #129 it is NOT scolded — there was nowhere cheaper to
  // buy. The naming of a genuinely poor choice is section 10, where Arizona was on the run.
  ok('a fill with no cheaper option on the run is not called over the odds',
    !(st2.lines || []).some((l) => /over the odds/i.test(l)),
    (st2.lines || []).find((l) => /over the odds/i.test(l))?.slice(0, 100) || 'not scolded');
  ok('the buying bonus floors at zero rather than going negative',
    Number(st2.fuelBuyingBonus) >= 0, `$${st2.fuelBuyingBonus}`);
  ok('and nothing is deducted for it', Number(st2.chargebacks || 0) === 0, `$${st2.chargebacks || 0}`);

  head('7. #128 No fuel logged is not a failing grade');
  await stand('Los Angeles', 'CA');
  await runLoad('Los Angeles', 'CA', 'Phoenix', 'AZ', 380, []);
  const st3 = await settle();
  ok('no bonus is invented from nothing', Number(st3.fuelEfficiencyBonus) === 0,
    `$${st3.fuelEfficiencyBonus}`);
  ok('and it says why rather than staying silent',
    (st3.lines || []).some((l) => /No fuel logged/i.test(l)),
    (st3.lines || []).find((l) => /No fuel logged/i.test(l))?.slice(0, 90) || '');

  head('8. #129 A run that never leaves California is not a bad decision');
  // San Diego to Redding. There is nowhere cheaper to buy, so measuring that fill against Oklahoma
  // prices would mark the driver down for a lane dispatch chose.
  await stand('San Diego', 'CA');
  await runLoad('San Diego', 'CA', 'Redding', 'CA', 640, [fuel('Bakersfield', 'CA', 150, 5.25)]);
  const st4 = await settle();
  ok('the stub says the lane offered nothing cheaper',
    (st4.lines || []).some((l) => /never left an expensive state/i.test(l)),
    (st4.lines || []).find((l) => /never left an expensive state/i.test(l))?.slice(0, 105) || '(not said)');
  ok('and it is not called buying over the odds',
    !(st4.lines || []).some((l) => /over the odds/i.test(l)),
    (st4.lines || []).find((l) => /over the odds/i.test(l))?.slice(0, 90) || 'not scolded');
  ok('nothing is deducted for it', Number(st4.chargebacks || 0) === 0, `$${st4.chargebacks || 0}`);

  head('9. #129 Finding a good pump in a dear state still earns');
  // The only skill that lane leaves, so it is the one being judged. CA reads about $5.30 from the
  // receipts above; buying well under that is worth something.
  await stand('Redding', 'CA');
  await runLoad('Redding', 'CA', 'Los Angeles', 'CA', 560, [fuel('Sacramento', 'CA', 140, 4.70)]);
  const st5 = await settle();
  ok('buying under what that state costs is still a saving', Number(st5.fuelSaved) > 0,
    `$${st5.fuelSaved} saved`);
  ok('and it is paid', Number(st5.fuelBuyingBonus) > 0, `$${st5.fuelBuyingBonus}`);
  ok('the line says what it was measured against',
    (st5.lines || []).some((l) => /cheapest state each run passed through/i.test(l)),
    (st5.lines || []).find((l) => /Fuel buying/i.test(l))?.slice(0, 105) || '');

  head('10. #129 But crossing a cheap state and buying dear anyway still counts');
  // Arizona was right there. This one IS a decision, and it is named — still never charged for.
  await stand('Kingman', 'AZ');
  await runLoad('Kingman', 'AZ', 'Barstow', 'CA', 240, [fuel('Barstow', 'CA', 160, 5.45)]);
  const st6 = await settle();
  ok('a dear fill with a cheaper state on the run is named',
    (st6.lines || []).some((l) => /over the odds/i.test(l)),
    (st6.lines || []).find((l) => /over the odds/i.test(l))?.slice(0, 110) || '(not named)');
  ok('and it points at the run it happened on',
    (st6.lines || []).some((l) => /over the odds/i.test(l) && /on [A-Z]{2,4}-/.test(l)), 'trip named');
  ok('still not charged for', Number(st6.chargebacks || 0) === 0, `$${st6.chargebacks || 0}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
