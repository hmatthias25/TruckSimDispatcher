/* A write-off, a trailer order pointing at another state, and a career with nowhere to go.
 *
 * All reported from one session in play:
 *
 *   1. Totalled a truck, bought the replacement, and the app refused to add it — the RETIRED wreck still
 *      carried the in-game name. The only way through was to delete the wreck and type the whole
 *      replacement in again.
 *   2. Reported in at Springfield and was told to fetch a trailer from SALT LAKE CITY. Said no, quite
 *      reasonably, and the career was then stuck with no trailer at all and no way to say otherwise.
 *
 * A driver must never be able to get the app into a state they cannot get it out of.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5953}/api`;
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
const at = (city, st, day, kind = 'Terminal') => api('/status', 'POST', {
  locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day),
  fuelPct: 80, atsOdometer: 90000, truckDamagePct: 3, trailerDamagePct: 2,
  dutyStatus: 'OnDuty', atsBankBalance: 150000,
}).then((r) => { S = un(r); return r; });

(async () => {
  const app = { driverName: 'W. Keane', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));
  await at('Springfield', 'MO', 10);

  head('1. A retired tractor does not keep its game name');
  // Anybody who names their trucks consistently gives the replacement the name the wreck had. That has
  // to work, because the wreck is off the fleet and nobody can read that name off it any more.
  const mine = (S.trucks || []).find((x) => x.unit === S.driver.assignedTruckUnit);
  ok('the driver has a tractor', !!mine, mine ? mine.unit : '(none)');

  await api('/fleet/truck', 'POST', { ...mine, gameId: 'BLACKDOG' });
  S = un(await api('/bootstrap'));
  ok('it carries an in-game name', (S.trucks.find((x) => x.unit === mine.unit) || {}).gameId === 'BLACKDOG',
    'BLACKDOG');

  // Total it and write it off, exactly as the Maintenance steps say.
  await api('/fleet/truck', 'POST', { ...mine, gameId: 'BLACKDOG', damagePct: 96 });
  const wrecked = await api('/maintenance/writeoff', 'POST', {
    unit: mine.unit, driverFault: false, scrapRecovery: 9000, notes: 'rolled it',
  });
  S = un(wrecked);
  const old = (S.trucks || []).find((x) => x.unit === mine.unit);
  ok('the wreck is retired', !!old && (old.retired || old.status === 'Retired'),
    old ? old.status : '(gone)');

  // The replacement, named the same thing in game.
  let addErr = null;
  try {
    S = un(await api('/fleet/truck', 'POST', {
      unit: 'T900', gameId: 'BLACKDOG', year: 2024, make: 'Peterbilt', model: '579',
      engine: 'Cummins X15', transmission: 'Automatic', governedMph: 68, atsOdometer: 1200,
      damagePct: 0, status: 'InService', inGameGarage: true, homeTerminalId: yard.id,
    }));
  } catch (e) { addErr = e.message; }
  ok('the replacement can reuse the name without deleting the wreck first', !addErr,
    addErr || 'added');
  ok('and the driver is put straight into it', S.driver.assignedTruckUnit === 'T900',
    `${S.driver.assignedTruckUnit}`);

  head('2. A trailer comes from where the driver is standing');
  // The reported case: reporting in at Springfield and being sent to Salt Lake City for a box.
  const far = un(await api('/terminals', 'POST', { city: 'Salt Lake City', state: 'UT', level: 'Large' }));
  const slc = (far.company.terminals || []).find((x) => x.city === 'Salt Lake City');
  await api('/fleet/trailer', 'POST', {
    unit: 'SLC-1', type: 'Reefer', division: 'Reefer', year: 2021, make: 'Utility', length: "53'",
    inGameGarage: true, status: 'InService', homeTerminalId: slc.id,
  });
  await api('/fleet/trailer', 'POST', {
    unit: 'SPR-1', type: 'Reefer', division: 'Reefer', year: 2021, make: 'Utility', length: "53'",
    inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
  });
  await at('Springfield', 'MO', 12);

  const order = await api('/equipment/order-trailer', 'POST', { requiredType: 'Reefer' })
    .catch(() => null);
  if (order && order.order) {
    ok('the box offered is the one at the yard the driver is on',
      order.order.toTrailerUnit === 'SPR-1', `${order.order.toTrailerUnit}`);
  } else {
    console.log('  ..    no direct order endpoint; checked through the swap planner instead');
    const plan = await api('/equipment/swap-options?trailerType=Reefer');
    const first = (plan.options || [])[0];
    ok('the nearest option is the one at the yard the driver is on',
      !!first && first.trailerUnit === 'SPR-1', first ? first.trailerUnit : '(none)');
  }

  head('3. There is always a way to say what is actually hooked up');
  // Strip the driver of a trailer the way the reported sequence did, then get out of it.
  const box = (S.trailers || []).find((x) => x.unit === S.driver.assignedTrailerUnit);
  if (box) await api('/fleet/trailer', 'POST', { ...box, assignedTruckUnit: '' });
  S = un(await api('/equipment/report-trailer', 'POST', { trailerUnit: 'SPR-1' }));
  ok('reporting a box on the fleet puts the driver on it', S.driver.assignedTrailerUnit === 'SPR-1',
    S.driver.assignedTrailerUnit);

  head('4. Including one the company has never heard of');
  // What actually happened: "I picked up a food grade trailer that wasn't being used in the game."
  const before = (S.trailers || []).length;
  const rep = await api('/equipment/report-trailer', 'POST', {
    type: 'Tanker', subtype: 'Food Grade', gameId: 'MILK-2', length: "48'",
  });
  S = un(rep);
  ok('it goes on the books rather than being argued with', (S.trailers || []).length === before + 1,
    `${before} -> ${(S.trailers || []).length}`);
  const now = (S.trailers || []).find((x) => x.unit === S.driver.assignedTrailerUnit);
  ok('and the driver is on it', !!now && now.type === 'Tanker' && now.subtype === 'Food Grade',
    now ? `${now.unit} ${now.type}/${now.subtype}` : '(none)');
  ok('it is standing where the driver is', !!now && /Springfield/i.test(now.currentLocation || ''),
    now ? now.currentLocation : '(nowhere)');
  ok('and dispatch says so back', /Food Grade|MILK-2/i.test(rep.message || ''),
    (rep.message || '').slice(0, 100));

  head('5. Reporting one settles an order that was still open');
  await api('/fleet/trailer', 'POST', {
    unit: 'SPR-2', type: 'Dry Van', division: 'Dry Van', year: 2021, make: 'Wabash', length: "53'",
    inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
  });
  S = un(await api('/bootstrap'));
  const openBefore = S.views?.equipmentOrder;
  S = un(await api('/equipment/report-trailer', 'POST', { trailerUnit: 'SPR-2' }));
  const openAfter = S.views?.equipmentOrder;
  ok('no trailer order is left hanging once the driver has said what they are on',
    !openAfter || openAfter.kind !== 'TrailerSwap',
    `${openBefore?.number || '(none before)'} -> ${openAfter?.kind || '(none)'}`);
  ok('the driver is on the box they reported', S.driver.assignedTrailerUnit === 'SPR-2',
    S.driver.assignedTrailerUnit);

  head('6. Taking a box the books had a hired driver on');
  // The ordinary case, as reported: "the tanker IS in the fleet, I just need to tell the app I am using
  // it." If the company had somebody else down for it, the record was simply wrong — the player is
  // looking at it hooked to their own truck — and two drivers on one trailer breaks every assignment
  // decision that reads it.
  await api('/fleet/trailer', 'POST', {
    unit: 'SPR-3', type: 'Tanker', subtype: 'Food Grade', division: 'Tanker', year: 2021,
    make: 'Polar', length: "48'", inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
  });
  const hires = (await api('/bootstrap')).hiredDrivers || [];
  if (hires.length) {
    const h = hires[0];
    await api(`/fleet/drivers/${encodeURIComponent(h.id || h.name)}`, 'POST',
      { ...h, assignedTrailerUnit: 'SPR-3' }).catch(() => {});
  }
  const rep6 = await api('/equipment/report-trailer', 'POST', { trailerUnit: 'SPR-3' });
  S = un(rep6);
  ok('the driver is on the tanker they said they hooked',
    S.driver.assignedTrailerUnit === 'SPR-3', S.driver.assignedTrailerUnit);
  ok('and nobody else is still down for it',
    !(S.hiredDrivers || []).some((x) => x.assignedTrailerUnit === 'SPR-3'),
    (S.hiredDrivers || []).map((x) => `${x.name}:${x.assignedTrailerUnit || '-'}`).join(', ') || '(no hires)');
  ok('the type and subtype come through',
    // TrailerSpec.Describe renders it as "food-grade tanker", so match the sense not the casing.
    /food.?grade/i.test(rep6.message || ''), (rep6.message || '').slice(0, 90));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
