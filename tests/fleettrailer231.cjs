/* #231 — replacing a trailer off the fleet report was broken end to end.
 *
 * Reported from play, after being correctly told to get rid of an unused chemical tank: told to buy a
 * flatbed in one part of the popup and a reefer in another part and on the fleet page; the trade button
 * never worked and kept saying it could not find the trailer; and a manually added replacement came out
 * with no yard and nothing in the UI could give it one.
 *
 * Four faults on one path:
 *   1. the replacement type was re-decided every report while the order carrying it was raised once
 *   2. RetireUnit searched s.Trucks only, so a trailer could never be found
 *   3. the trailer form had no yard field at all, and an orphan is invisible to the changeover planner
 *   4. the player was asked to invent fleet numbers the app already knows how to assign
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5913}/api`;
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
const iso = (d, hm = '06:00') => `2000-01-${String(d).padStart(2, '0')}T${hm}`;

let S;
const trailers = (st) => (st.trailers || []).filter((t) => !t.retired);
const byUnit = (st, u) => (st.trailers || []).find((t) => t.unit === u);

(async () => {
  const app = { driverName: 'V. Duarte', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];

  head('1. A trailer added with nothing filled in still gets a number and a yard');
  // Both used to be the player's problem: the form asked them to invent a fleet number, and had no
  // yard field at all, so a manually added box landed unreachable.
  const before = trailers(S).length;
  S = un(await api('/fleet/trailer', 'POST', {
    type: 'Reefer', division: 'Reefer', year: 2022, make: 'Utility', length: "53'",
    inGameGarage: true, status: 'InService',
  }));
  const added = trailers(S).find((t) => !t.unit.startsWith('DH'));
  const fresh = trailers(S).filter((t) => t.type === 'Reefer').pop();
  console.log(`  ..    added ${fresh?.unit} at yard ${fresh?.homeTerminalId || '(none)'}`);
  ok('one more trailer on the books', trailers(S).length === before + 1, `${trailers(S).length}`);
  ok('it was given a fleet number', !!fresh?.unit && fresh.unit.length > 0, fresh?.unit || '(blank)');
  ok('and it is based somewhere', !!fresh?.homeTerminalId, fresh?.homeTerminalId || '(orphaned)');
  ok('specifically the headquarters yard', fresh?.homeTerminalId === yard.id, `${fresh?.homeTerminalId} vs ${yard.id}`);

  head('2. A fleet number the player does choose is still theirs');
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'MINE-1', type: 'Flatbed', division: 'Flatbed', year: 2021, make: 'Reitnouer',
    length: "48'", inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
  }));
  ok('the number they typed is kept', !!byUnit(S, 'MINE-1'), 'MINE-1');

  head('3. Two blank adds do not collide');
  const n1 = trailers(S).length;
  S = un(await api('/fleet/trailer', 'POST', { type: 'Dry Van', division: 'Dry Van', year: 2022, status: 'InService', inGameGarage: true }));
  S = un(await api('/fleet/trailer', 'POST', { type: 'Dry Van', division: 'Dry Van', year: 2022, status: 'InService', inGameGarage: true }));
  ok('both landed as separate units', trailers(S).length === n1 + 2, `${trailers(S).length} vs ${n1 + 2}`);
  const units = trailers(S).map((t) => t.unit);
  ok('and every unit number is distinct', new Set(units).size === units.length, units.join(' '));

  head('4. A truck added blank gets a number and a yard too');
  // Room first. A Small yard holds one tractor and the hire already put one there, so defaulting the
  // new unit to HQ runs into the capacity guard — which is the right answer and says so plainly, but
  // it is not what this section is measuring.
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));
  const t0 = (S.trucks || []).length;
  S = un(await api('/fleet/truck', 'POST', {
    make: 'Kenworth', model: 'T680', year: 2022, cabConfig: 'Sleeper', status: 'InService',
    avgMpg: 7, governedMph: 65, inGameGarage: true,
  }));
  const newTruck = (S.trucks || [])[S.trucks.length - 1];
  console.log(`  ..    added unit ${newTruck?.unit} at ${newTruck?.homeTerminalId || '(none)'}`);
  ok('a truck came back with a unit number', (S.trucks || []).length === t0 + 1 && !!newTruck?.unit,
    newTruck?.unit || '(blank)');
  ok('and it is based somewhere', !!newTruck?.homeTerminalId, newTruck?.homeTerminalId || '(orphaned)');

  head('5. Retiring a trailer works, and says so about the trailer');
  // This is the whole of fault 2: the endpoint looked in s.Trucks, so the button in the fleet report
  // threw "not in the fleet" about a box the report had just named.
  const doomed = byUnit(S, 'MINE-1');
  ok('the box to retire is on the books', !!doomed, doomed?.unit);
  let r = await api('/fleetops/retire', 'POST', { unit: 'MINE-1', replacementUnit: '' });
  S = un(r);
  console.log(`  ..    ${r.message}`);
  ok('it did not claim the trailer was missing', !/not in the fleet/i.test(r.message || ''), r.message);
  ok('the message is about a trailer', /trailer/i.test(r.message || ''), r.message);
  ok('and the box is off the active fleet', !trailers(S).some((t) => t.unit === 'MINE-1'),
    trailers(S).map((t) => t.unit).join(' '));
  ok('but still on file, so history resolves', !!byUnit(S, 'MINE-1')?.retired, 'retired, not deleted');

  head('6. Naming a replacement that is not on the book is refused, not half-done');
  const victim = trailers(S).find((t) => t.type === 'Dry Van' && !t.unit.startsWith('DH'));
  let refused = '';
  try {
    await api('/fleetops/retire', 'POST', { unit: victim.unit, replacementUnit: 'NOPE-9' });
  } catch (e) { refused = e.message; }
  console.log(`  ..    ${refused || '(it went through, which it should not have)'}`);
  ok('it refuses a replacement nobody has added', /not on the book/i.test(refused), refused.slice(0, 110));
  ok('and the trailer is untouched', !byUnit(S, victim.unit)?.retired, `${victim.unit} still active`);

  head('7. Retiring onto a real replacement moves the driver across');
  const keep = trailers(S).find((t) => t.type === 'Reefer' && !t.unit.startsWith('DH'));
  S = un(await api('/fleet/assign', 'POST', { truckUnit: null, trailerUnit: victim.unit, force: true }));
  ok('the driver is on the doomed box', S.driver.assignedTrailerUnit === victim.unit,
    S.driver.assignedTrailerUnit);
  r = await api('/fleetops/retire', 'POST', { unit: victim.unit, replacementUnit: keep.unit });
  S = un(r);
  console.log(`  ..    ${r.message}`);
  ok('the driver is moved onto the replacement', S.driver.assignedTrailerUnit === keep.unit,
    `${S.driver.assignedTrailerUnit} (wanted ${keep.unit})`);
  ok('and is never left hooked to a retired box',
    !byUnit(S, S.driver.assignedTrailerUnit)?.retired, 'active trailer');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
