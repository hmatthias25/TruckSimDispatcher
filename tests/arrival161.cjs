/* #161-#164 — a messed-up return to the yard, reported from play.
 *
 *   161  the empty run home is unpaid: repositioning is only measured when the NEXT load is
 *        dispatched, and going home has no next load
 *   162  reporting in at one yard asks where every trailer in the company is, Denver included
 *   163  closing a trip out at the home yard is not "arriving", so the review and the trailer
 *        instruction are never assembled — while maintenance directives come through on the audit,
 *        which is why it looked half-broken
 *   164  "no change to your trailer" is a decision and was never said, so silence and a bug looked
 *        the same from the driver's seat
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5867}/api`;
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
const at = (d, hm = '09:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 90000;
const views = async () => (await api('/bootstrap')).views;

async function report(city, st, day, kind = 'TruckStop', moved = 0) {
  odo += moved;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  S = un(r);
  return r;
}

(async () => {
  const app = { driverName: 'P. Rourke', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  const yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  head('1. #162 A driver is only asked about boxes they can see');
  // Two trailers here, one three states away. The far one is not this driver's to account for.
  for (const [unit, city, st] of [['H1', yard.city, yard.state], ['H2', yard.city, yard.state]]) {
    await api('/fleet/trailer', 'POST', {
      unit, type: 'Dry Van', division: 'Dry Van', year: 2020, make: 'Wabash', length: "53'",
      inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
    });
  }
  const far = un(await api('/terminals', 'POST', { city: 'Denver', state: 'CO', level: 'Small' }));
  const denver = (far.company.terminals || []).find((t) => t.city === 'Denver');
  if (denver) {
    await api('/fleet/trailer', 'POST', {
      unit: 'FAR1', type: 'Dry Van', division: 'Dry Van', year: 2020, make: 'Wabash', length: "53'",
      inGameGarage: true, status: 'InService', homeTerminalId: denver.id,
    });
  }

  await report('Amarillo', 'TX', 12, 'TruckStop', 400);
  const home = await report(yard.city, yard.state, 14, 'Terminal', 300);
  const brief = home.homeBrief;
  ok('arriving at the yard produced a brief', !!brief, `wentHome=${home.wentHome}`);

  const asked = (brief?.askWhereabouts || []).map((x) => x.unit);
  ok('it asks about boxes on this yard', asked.length > 0, asked.join(', ') || '(none)');
  ok('and not about one in Denver', !asked.includes('FAR1'), asked.join(', '));

  head('2. #164 The trailer decision is stated either way');
  const equip = (brief?.equipment || []).join(' | ');
  ok('the brief says what happened to the trailer',
    /Staying on|Re-rigged|no trailer issued/i.test(equip), equip.slice(0, 140) || '(silent)');

  head('3. #163 The brief survives the response that carried it');
  const v = await views();
  ok('it is on the snapshot, readable again', !!v.lastArrival, v.lastArrival ? 'kept' : '(gone)');
  ok('stamped with when it happened', (v.lastArrivalGameTime || '').length > 0, v.lastArrivalGameTime);
  ok('and it is the same arrival', v.lastArrival?.headline === brief?.headline, 'same brief');

  await api('/career/arrival-read', 'POST', {});
  ok('marking it read puts it away', !(await views()).lastArrival, 'cleared');

  head('4. #163 Arriving twice does not count twice');
  // Touch latches on AtHomeYard. That matters beyond tidiness: it bumps HomeTimesTaken and re-rolls
  // the trailer decision, which is seeded on it.
  const taken = S.driver.homeTimesTaken;
  const again = await report(yard.city, yard.state, 15, 'Terminal', 5);
  ok('a second report at the yard is not a new arrival', !again.wentHome, `wentHome=${again.wentHome}`);
  ok('and the home-time count did not move', un(again).driver.homeTimesTaken === taken,
    `${taken} -> ${un(again).driver.homeTimesTaken}`);

  head('5. #163 Closing a trip out AT the yard is arriving home');
  // The reported case: drove home on a reposition, closed it out there, and got maintenance
  // directives off the audit while the review and the trailer instruction were never assembled.
  await report('Joplin', 'MO', 20, 'TruckStop', 250);
  const mv = await api('/moves', 'POST', {
    kind: 'EmptyMove', destCity: yard.city, destState: yard.state, miles: 75,
    reason: 'Told to deadhead home',
  });
  const moveTrip = (un(mv).trips || []).find((x) => x.status !== 'Delivered');
  ok('an empty move is on the books', !!moveTrip, moveTrip?.number || '(none)');

  odo += 75;
  const closed = await api(`/trips/${moveTrip.id}/complete`, 'POST', {
    deliveredGameTime: at(21), actualMiles: 75, endOdometer: odo,
    locationKind: 'Terminal', gameTime: at(21), fuelPct: 70,
    truckDamageAfter: 3, trailerDamageAfter: 2,
  });
  ok('closing it out at the yard counts as arriving', closed.wentHome === true,
    `wentHome=${closed.wentHome}`);
  ok('and the brief comes with it', !!closed.homeBrief,
    closed.homeBrief ? closed.homeBrief.headline.slice(0, 70) : '(none)');
  ok('carrying the trailer decision, either way',
    /Staying on|Re-rigged|no trailer issued/i.test((closed.homeBrief?.equipment || []).join(' | ')),
    (closed.homeBrief?.equipment || []).join(' | ').slice(0, 110) || '(silent)');

  head('6. #161 Empty miles with nothing to attach them to are surfaced');
  // Deliver, then drive home empty with nothing dispatched against it — the leg Measure can never see,
  // because it only ever runs when the NEXT load is authorised.
  await report('Tulsa', 'OK', 24, 'TruckStop', 200);
  await report(yard.city, yard.state, 26, 'Terminal', 180);
  const owed = (await views()).unbookedEmpty;
  ok('the unbooked leg is measured', !!owed && owed.miles > 0, owed ? `${owed.miles} mi` : '(none)');
  ok('from two readings, not an estimate', owed && owed.toOdometer > owed.fromOdometer,
    owed ? `${owed.fromOdometer} -> ${owed.toOdometer}` : '');

  head('7. #161 And one press books it, at the figure it quoted');
  const before = (await api('/bootstrap')).trips.length;
  const booked = await api('/moves/book-empty', 'POST', {});
  ok('a trip is raised for it', (await api('/bootstrap')).trips.length === before + 1,
    booked.trip?.number || '(none)');
  ok('for the miles that were quoted, not a retyped number', booked.miles === owed.miles,
    `${booked.miles} vs ${owed.miles}`);
  ok('already closed, because it has been driven', booked.trip.status === 'Delivered', booked.trip.status);
  ok('it runs from where the last load closed', (booked.trip.originCity || '').length > 0,
    `${booked.trip.originCity}, ${booked.trip.originState} -> ${booked.trip.destCity}`);

  // Settlement reads the pay stored ON the trip. A delivered trip with no Pay block pays nothing,
  // which would have made the button worse than the manual route it replaces.
  ok('and it carries pay, at the empty rate', (booked.trip.pay?.deadheadPay || 0) > 0,
    `$${booked.trip.pay?.deadheadPay} on ${booked.trip.pay?.deadheadMiles} mi`);

  ok('nothing is owed once it is booked', !(await views()).unbookedEmpty,
    JSON.stringify((await views()).unbookedEmpty || null));

  let second = '';
  try { await api('/moves/book-empty', 'POST', {}); } catch (e) { second = e.message; }
  ok('and it cannot be booked twice', second.length > 0, second.slice(0, 80) || '(booked again!)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
