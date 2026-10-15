/* Getting to the shipper, learned (asked for from play, v0.86): a city-board load an hour and forty minutes across
 * town was planned as no time at all, because the listing gave no distance, and the driver was late. And a listed
 * pickup leg ran at highway speed in the plan, where the driver's own pickup legs made about 30 mph.
 *
 *   - no distance listed: the time pickups take, per city once it has three, overall otherwise — the cautious figure
 *   - a distance listed: the speed the driver's own pickup legs make, where it is slower than the highway
 *   - a load at the dock the truck is standing on: no pickup at all
 *   - on an ATS career and an ETS2 one
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const plus = (at, h) => { const d = new Date(Date.parse(at + ':00Z') + h * 3600000); return d.toISOString().slice(0, 16); };

let clock = 2;
async function at(city, state, gameTime, eu) {
  await api('/status', 'POST', { locationCity: city, locationState: state, locationKind: 'TruckStop', gameTime,
    fuelPct: 100, atsOdometer: 1000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', eu
    ? { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: gameTime, euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 20, spreadEstimated: false }
    : { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
}

/** One pickup: authorised in `city`, at the shipper `hours` later, then cancelled — the leg is what is learned. */
async function pickup(here, dest, hours, eu, dhMiles = 0) {
  const t0 = iso(clock++, '08:00');
  await at(here.city, here.state, t0, eu);
  await api('/board/clear', 'POST', {});
  const b = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: here.city, originState: here.state, destCity: dest.city, destState: dest.state,
    loadedMiles: 120, deadheadMiles: dhMiles, gameRevenue: 900, weightLbs: 30000, atLocation: false, deadlineHours: 48 });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: b.evaluations[0].load.id, overrideTight: true });
  await api(`/trips/${auth.trip.id}/at-shipper`, 'POST', { gameTime: plus(t0, hours) });
  await api(`/trips/${auth.trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'GameLimitation' });
}

/** A fresh load out of `here`, evaluated: its pickup step and the note. */
async function planFor(here, dest, eu, extra = {}) {
  await at(here.city, here.state, iso(clock++, '08:00'), eu);
  await api('/board/clear', 'POST', {});
  const b = await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: here.city, originState: here.state, destCity: dest.city, destState: dest.state,
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 900, weightLbs: 30000, atLocation: false, deadlineHours: 48, ...extra });
  const f = b.evaluations[0].feasibility;
  const step = (f.timeline || []).find((x) => /^Deadhead/.test(x.label));
  return { f, step, note: (f.warnings || []).find((w) => /No distance to the shipper/.test(w)) || '' };
}

async function story(name, eu, A, Bc, C, dest) {
  // Was "nothing is invented" until v0.86: a fresh career at a rest stop in Phoenix had a FedEx load across town
  // planned as no time at all. Nothing is loaded at a truck stop, so the shipper is somewhere else — an hour, said.
  head(`${name}: 1. Before any pickups are on file, an hour from a truck stop, and said to be a default`);
  let p = await planFor(A, dest, eu);
  ok('an hour to the shipper', p.step && Math.abs(p.step.hours - 1) < 0.02, p.step ? `${p.step.hours}h` : 'none');
  ok('  worded as a default', /the default until there are enough/.test(p.note), p.note);

  head(`${name}: 2. Three slow pickups in one town, three quick ones in another`);
  for (let i = 0; i < 3; i++) await pickup(A, dest, 1.5, eu);
  for (let i = 0; i < 3; i++) await pickup(Bc, dest, 0.25, eu);
  const v = (await api('/bootstrap')).views.pickupLearning;
  ok('six pickups learned', v.samples === 6 && v.unlistedCount === 6, JSON.stringify(v).slice(0, 160));

  p = await planFor(A, dest, eu);
  ok(`${A.city} plans its own 1:30`, p.step && Math.abs(p.step.hours - 1.5) < 0.02, `${p.step?.label} ${p.step?.hours}`);
  ok('and says where the figure came from', new RegExp(`pickups in ${A.city}`).test(p.note), p.note);
  p = await planFor(Bc, dest, eu);
  ok(`${Bc.city} plans its own 0:15`, p.step && Math.abs(p.step.hours - 0.25) < 0.02, `${p.step?.hours}`);
  p = await planFor(C, dest, eu);
  ok('a town with no history gets the cautious overall figure, 1:30', p.step && Math.abs(p.step.hours - 1.5) < 0.02, `${p.step?.hours}`);
  ok('worded as overall', /3 in 4 of your last 6 pickups took/.test(p.note), p.note);

  head(`${name}: 3. A load at the dock the truck is on: no pickup`);
  p = await planFor(A, dest, eu, { atLocation: true });
  ok('no pickup step', !p.step, p.step?.label || 'none');

  head(`${name}: 4. A listed distance runs at the speed pickup legs make`);
  for (let i = 0; i < 3; i++) await pickup(C, dest, 1.0, eu, 30);
  p = await planFor(C, dest, eu, { deadheadMiles: 60 });
  ok('60 miles at the learned 30 mph: about two hours, not highway time', p.step && Math.abs(p.step.hours - 2) < 0.1, `${p.step?.label} ${p.step?.hours}`);
  ok('and no "no distance" note on a listed leg', !p.note, p.note || 'none');
}

(async () => {
  // ---- ATS
  const us = { driverName: 'P. Ickup', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', us);
  await api('/onboarding/hire', 'POST', { application: us, force: true, gameTime: iso(1, '06:00') });
  await story('ATS', false, { city: 'Denver', state: 'CO' }, { city: 'Pueblo', state: 'CO' }, { city: 'Cheyenne', state: 'WY' },
    { city: 'Colorado Springs', state: 'CO' });

  // ---- ETS2
  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: false });
  clock = 2;
  const eu = { driverName: 'P. Abholung', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', eu);
  await api('/onboarding/hire', 'POST', { application: eu, force: true, gameTime: iso(1, '06:00') });
  await story('ETS2', true, { city: 'Frankfurt am Main', state: 'DE' }, { city: 'Mannheim', state: 'DE' }, { city: 'Stuttgart', state: 'DE' },
    { city: 'Karlsruhe', state: 'DE' });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
