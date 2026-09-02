/* #165/#166 — trailers that move with the work rather than only at home time.
 *
 *   165  re-rigs only ever happened at home, so a yard 80 miles away holding the right box was never
 *        used. Decided at close-out, gated on the driver holding the hazmat class the box needs, and
 *        the app cannot see whether an AI driver still has it — so "it is not here, back in N hours"
 *        is a first-class answer that turns into a 34 decision.
 *   166  yards capped trailers at a limit ATS does not have, and bought them on headcount rather than
 *        on how hard the boxes were working.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5868}/api`;
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

let S, odo = 50000;
const views = async () => (await api('/bootstrap')).views;
const boot = async () => api('/bootstrap');

async function report(city, st, day, kind = 'TruckStop', cycle = 60) {
  odo += 120;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 120000, hosCycleRemaining: cycle,
  });
  S = un(r);
  return r;
}

async function addTrailer(unit, terminalId, o = {}) {
  return api('/fleet/trailer', 'POST', {
    unit, type: 'Reefer', division: 'Reefer', year: 2021, make: 'Utility', length: "53'",
    inGameGarage: true, status: 'InService', homeTerminalId: terminalId, ...o,
  });
}

(async () => {
  const app = { driverName: 'C. Nakamura', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  await api('/career/clear-probation', 'POST', { force: true, note: 'so re-rigs can happen' });
  const home = S.company.terminals[0];
  S = un(await api(`/terminals/${home.id}/level`, 'POST', { level: 'Large' }));

  head('1. #166 A yard is never full of trailers, because ATS has no such limit');
  // Well past the old Large cap of 12.
  for (let i = 0; i < 15; i++) await addTrailer(`CAP${i}`, home.id);
  const held = (await boot()).trailers.filter((t) => t.homeTerminalId === home.id).length;
  ok('fifteen boxes go on one yard without complaint', held >= 15, `${held} based there`);

  head('2. #165 A box only counts if it was bought in the game');
  const far = un(await api('/terminals', 'POST', { city: 'Springfield', state: 'MO', level: 'Medium' }));
  const near = (far.company.terminals || []).find((t) => t.city === 'Springfield');
  ok('a second yard is on the books', !!near, near ? near.city : '(none)');

  // Backdrop only: the player has not bought this garage, so there is nothing standing in it.
  await addTrailer('GHOST1', near.id, { inGameGarage: false });
  const ghosts = (await boot()).trailers.filter((t) => t.homeTerminalId === near.id && !t.inGameGarage);
  ok('a backdrop box is on its books', ghosts.length === 1, `${ghosts.length}`);

  head('3. #165 An unqualified driver is never sent for a placarded box');
  // A fuel tanker is hazmat class 3 in ATS. No class, no re-rig — there is no "tanker endorsement".
  await addTrailer('FUEL1', near.id, { type: 'Tanker', subtype: 'Fuel', division: 'Tanker' });
  const holds = ((await boot()).driver.endorsements || []).length;
  ok('the driver holds no hazmat classes to start', holds === 0, `${holds} held`);

  head('4. #166 Buying is driven by how hard the boxes work, not by headcount');
  const st = (await boot()).settings.maintenance;
  ok('there is a busy threshold to buy against', st.trailerBusyPct > 0, `${st.trailerBusyPct}%`);
  ok('and a surplus one to sell against', st.trailerSurplusPct > 0, `${st.trailerSurplusPct}%`);
  ok('the old trailer cap is no longer consulted',
    !JSON.stringify(await views()).includes('full at'), 'no capacity refusal');

  head('5. #165 A re-rig is ordered at close-out, at a yard being passed');
  // A reefer they ARE qualified for, at the Springfield yard, bought in the game.
  await addTrailer('SWAP1', near.id, { type: 'Reefer', subtype: '', division: 'Reefer' });
  const mine = (await boot()).driver.assignedTrailerUnit;
  ok('the driver starts on their own box', !!mine, mine || '(none)');

  // Seeded per trip, so close out empty moves at the yard until it fires. Low cycle puts it on the
  // near-restart odds, where waiting and a 34 pay for each other.
  let order = null, tries = 0;
  for (; tries < 20 && !order; tries++) {
    await report('Springfield', 'MO', 30 + tries, 'TruckStop', 9);
    const mv = await api('/moves', 'POST', {
      kind: 'EmptyMove', destCity: 'Springfield', destState: 'MO', miles: 10, reason: 'positioning',
    });
    const trip = (un(mv).trips || []).find((x) => x.status !== 'Delivered');
    odo += 10;
    const done = await api(`/trips/${trip.id}/complete`, 'POST', {
      deliveredGameTime: at(30 + tries, '17:00'), actualMiles: 10, endOdometer: odo,
      locationKind: 'TruckStop', gameTime: at(30 + tries, '17:00'), fuelPct: 60,
      truckDamageAfter: 3, trailerDamageAfter: 2, hosCycleRemaining: 9,
    });
    order = done.rerig || (await views()).rerig;
  }
  ok(`a re-rig was ordered within ${tries} close-out(s)`, !!order, order ? order.number : '(never fired)');
  if (!order) { console.log(`
${pass} passed, ${fail} failed`); process.exit(1); }

  ok('it names the box to take', order.takeUnit === 'SWAP1', order.takeUnit);
  ok('and the one to drop', order.dropUnit === mine, `${order.dropUnit} vs ${mine}`);
  ok('it never picks the placarded box the driver cannot pull', order.takeUnit !== 'FUEL1', order.takeUnit);
  ok('nor the backdrop one that is not in the game', order.takeUnit !== 'GHOST1', order.takeUnit);
  ok('and says where each box ends up', /based at|comes onto/i.test(order.bookkeeping || ''),
    (order.bookkeeping || '').slice(0, 110));

  head('6. #165 Nothing goes out while the swap is half done');
  const blocked = (await views()).dispatchBlockers || [];
  ok('dispatch is blocked, and says why', blocked.some((b) => b.includes(order.number)),
    blocked.find((b) => b.includes(order.number))?.slice(0, 110) || blocked.join(' | ').slice(0, 110));

  head('7. #165 "It is not there" is a real answer, and becomes a 34 decision');
  const missing = await api('/rerig/missing', 'POST', { hoursUntilBack: 40, note: 'AI driver has it' });
  ok('the wait is recorded rather than the order cancelled', missing.order.status === 'Waiting',
    missing.order.status);
  ok('and a 40-hour wait says take the restart', /restart|34/i.test(missing.order.waitAdvice || ''),
    (missing.order.waitAdvice || '').slice(0, 120));

  head('8. #165 Swapping moves the trailers on the app too');
  const swapped = await api('/rerig/done', 'POST', { number: order.number });
  const after = await boot();
  ok('the driver is on the box they took', after.driver.assignedTrailerUnit === 'SWAP1',
    after.driver.assignedTrailerUnit);
  const dropped = after.trailers.find((x) => x.unit === order.dropUnit);
  const taken = after.trailers.find((x) => x.unit === 'SWAP1');
  ok('the box dropped is based at the yard it was left at', dropped.homeTerminalId === near.id,
    `${dropped.unit} -> ${dropped.homeTerminalId === near.id ? 'Springfield' : 'elsewhere'}`);
  ok('and the one taken comes onto the home yard', taken.homeTerminalId === home.id,
    `${taken.unit} -> ${taken.homeTerminalId === home.id ? 'home' : 'elsewhere'}`);
  ok('the swap is closed', swapped.order.status === 'Done', swapped.order.status);
  ok('and freight moves again', !((await views()).dispatchBlockers || []).some((b) => b.includes(order.number)),
    'unblocked');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
