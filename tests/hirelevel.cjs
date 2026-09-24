/* What calibre of driver to go and hire, and how long they stand on probation once you have.
 *
 *   "The beginning/2nd chance companies will always expect the player to hire drivers at level 0 or 1.
 *    However we should tell the player to hire more experienced drivers for the better companies, when
 *    adding/replacing drivers."
 *
 *   "The more experienced drivers should not be on probation as long (like the player when they change
 *    companies)."
 *
 * Two rules, and they are the same observation from opposite ends: a company and the people in its
 * seats are the same thing.
 *
 * THE BAND used to be read off the money alone, so a way-in fleet having a good quarter told the player
 * to go and find a level 9 veteran -- somebody who was never applying there -- and a five-star outfit
 * having a bad one told them to fill a specialised seat with the cheapest hand who would take it. The
 * carrier now sets the range and the money moves inside it: a fleet people BEGIN at caps at 0-1, and a
 * good seat floors well above green and says to leave the truck standing rather than fill it cheap.
 *
 * Note what a way-in fleet is NOT: every large carrier with a training programme. Prime, Schneider and
 * Knight-Swift all take new CDL holders and none of them is a bottom-rung seat. The open door and the
 * one-or-two-star wage TOGETHER are what make the bottom of the market.
 *
 * THE PROBATION was ninety days for everybody, which said a level 8 driver with a career behind them
 * has proven exactly as much as somebody who passed their test last week. The app already refuses that
 * argument for the player -- their own period shortens when their record clears a new carrier's bar --
 * and a hired driver is owed the same reading. Level is the only record the app has of a hire's
 * experience, and it is the number the player typed in off the ATS hiring screen.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5894}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

/** Puts the career at a named carrier without going through the job market, and returns the band. */
async function atCarrier(code, name, payStars) {
  const st = await api('/export');
  st.company.code = code;
  st.company.name = name;
  st.company.payStars = payStars;
  await api('/import', 'POST', st);
  return (await api('/fleetops')).summary.hireBand;
}

const dossier = (fo, id) => (fo.dossiers || []).find((x) => x.id === id);

let yardId, hireId;

(async () => {
  const app = { driverName: 'L. Mbeki', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Dallas', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;

  head('1. A fleet people begin at hires people beginning');
  // Crossroads is the second-chance outfit: one star across the board, and the door open because
  // nobody else's is. Level 0-1 is not a judgement about the player, it is who applies.
  let hb = await atCarrier('CRC', 'Crossroads Carriers', 1);
  ok('a second-chance fleet says level 0-1', hb.min === 0 && hb.max === 1, `${hb.min}-${hb.max}`);
  ok('and it knows it is a way-in fleet', hb.wayIn === true, String(hb.wayIn));
  ok('the reason says so in words', /begin at/i.test(hb.how), hb.how);

  head('2. No quarter is good enough to change that');
  // The cap is the whole point. A good fortnight at the bottom of the market does not put a veteran in
  // the seat, because the veteran was never applying here.
  let st = await api('/export');
  st.fleetReports = [1, 2, 3, 4].map((n) => ({
    number: `FR-${n}`, periodStartGame: iso(30 * n), periodEndGame: iso(30 * n + 14),
    totalContribution: 40000, netAfterCosts: 32000,
    lines: [], conduct: [], retirements: [], watching: [], personnel: [],
  }));
  await api('/import', 'POST', st);
  hb = (await api('/fleetops')).summary.hireBand;
  ok('a thriving way-in fleet still says level 0-1', hb.min === 0 && hb.max === 1, `${hb.min}-${hb.max}`);

  head('3. A better seat floors the band well above green');
  // Prime takes new CDL holders and is still a four-star seat. That combination is exactly what a rule
  // reading the open door alone gets wrong.
  hb = await atCarrier('PRI', 'Prime Inc.', 4);
  ok('a four-star carrier floors at level 4', hb.min >= 4, `${hb.min}-${hb.max}`);
  ok('and it is not treated as a way-in fleet', hb.wayIn === false, String(hb.wayIn));
  ok('it says to leave the seat empty rather than fill it cheap',
    /leave the seat standing/i.test(hb.how), hb.how);

  head('4. Specialised freight does not go to somebody learning on it');
  hb = await atCarrier('MEL', 'Melton Truck Lines', 4);
  ok('a specialised carrier floors at level 6', hb.min >= 6, `${hb.min}-${hb.max}`);
  ok('and says why', /specialised freight/i.test(hb.how), hb.how);

  head('5. The empty seat itself says the band, not just the fortnightly report');
  // The player is one click from the ATS hiring screen on the Fleet tab, which is the moment the
  // advice is worth anything. A band remembered from a report two weeks ago is one nobody acts on.
  await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' });
  await api('/fleet/truck', 'POST', {
    unit: 'E-1', make: 'Peterbilt', model: '579', year: 2022, atsOdometer: 80000,
    serviceMiles: 80000, lastServiceMiles: 78000, serviceIntervalMiles: 25000,
    damagePct: 3, inGameGarage: true, homeTerminalId: yardId,
  });
  const seat = ((await api('/fleetops')).openUnits || []).find((u) => u.unit === 'E-1');
  ok('the seat is offered as a decision', !!seat, seat ? seat.unit : 'not listed');
  ok('and it carries the level band', seat && seat.hireLevelMin >= 6,
    seat ? `${seat.hireLevelMin}-${seat.hireLevelMax}` : '');
  ok('the note names it too', seat && /level 6/i.test(seat.hireNote || ''), seat && seat.hireNote);

  head('6. A green hire serves the full ninety days');
  await atCarrier('PRI', 'Prime Inc.', 4);
  hireId = (await api('/fleetops/drivers', 'POST', {
    name: 'A. Green', status: 'Active', assignedTruckUnit: 'E-1',
    homeTerminalId: yardId, hiredGameDate: iso(2), level: 0, lifetimeMiles: 0,
  })).driver.id;
  let z = dossier(await api('/fleetops'), hireId);
  ok('level 0 serves 90 days', z.probationDays === 90, `${z.probationDays} days`);
  ok('and the file says why', /nothing on their record/i.test(z.probationBasis || ''), z.probationBasis);

  head('7. A developed hire serves less, the way the player does');
  const setLevel = async (level, extra = {}) => {
    const x = await api('/export');
    Object.assign(x.hiredDrivers.find((d) => d.id === hireId), { level }, extra);
    await api('/import', 'POST', x);
    return dossier(await api('/fleetops'), hireId);
  };
  z = await setLevel(4);
  ok('level 4 serves 60 days', z.probationDays === 60, `${z.probationDays} days`);

  head('8. An experienced hire serves the shortest period the company runs');
  z = await setLevel(8);
  ok('level 8 serves 45 days', z.probationDays === 45, `${z.probationDays} days`);
  ok('the file credits the level, not the tenure',
    /done this before/i.test(z.probationBasis || ''), z.probationBasis);

  head('9. And they actually come OFF it at that point, grade and all');
  // The trap the rung gate would otherwise walk into: probation served at 45 days while rung 1 still
  // asks for 90, leaving a driver off probation and still called Probationary for another six weeks.
  st = await api('/export');
  st.status.gameTime = iso(62);          // 60 days in: past 45, well short of 90
  Object.assign(st.hiredDrivers.find((d) => d.id === hireId), { level: 8, lifetimeMiles: 40000 });
  await api('/import', 'POST', st);
  z = dossier(await api('/fleetops'), hireId);
  ok('at 60 days the period is served', z.servingProbation === false,
    `${z.tenureDays} day(s) of ${z.probationDays}`);
  ok('and the rung above probationary is open to them',
    /company driver/i.test(z.dueRank || z.rank || ''), z.dueRank || z.rank);

  head('10. A specialised carrier still holds everybody to its orientation');
  await atCarrier('MEL', 'Melton Truck Lines', 4);
  z = await setLevel(9);
  ok('even a level 9 hire does 60 days on specialised freight', z.probationDays === 60,
    `${z.probationDays} days`);
  ok('and the file says it is the orientation', /orientation/i.test(z.probationBasis || ''),
    z.probationBasis);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
