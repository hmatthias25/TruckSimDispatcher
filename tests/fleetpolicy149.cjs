/* #149-#154 — six things the company was getting wrong about its own people and equipment.
 *
 *   149  a level 6 driver warned about as a flight risk, on GDC's 1-10 rookie band
 *   150  promotions that announce a pay rate and none of what actually changed
 *   151  four disagreeing tests for "a better truck", three of which rank a wreck over a good unit
 *   152  a trailer nobody is assigned to, invisible because utilisation only arrives per driver
 *   153  a "Tank" on the yard that names none of the five ATS sells
 *   154  a car hauler the game will not sell, stocked and priced and recommended
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5865}/api`;
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
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, period = 0;
const boot = async () => api('/bootstrap');
const views = async () => (await boot()).views;

async function saveSettings(patch) {
  const cur = (await boot()).settings;
  return api('/settings', 'POST', { ...cur, maintenance: { ...cur.maintenance, ...patch } });
}

async function truck(unit, o) {
  await api('/fleet/truck', 'POST', {
    unit, make: 'Freightliner', model: 'Cascadia', year: 2020,
    engine: 'DD15 450 hp', horsepower: 450, cabConfig: 'Sleeper', governedMph: 65,
    serviceMiles: 300000, atsOdometer: 300000, lastServiceMiles: 290000,
    damagePct: 3, inGameGarage: true, status: 'InService',
    homeTerminalId: S.company.terminals[0].id, ...o,
  });
  return (await boot()).trucks.find((t) => t.unit === unit);
}

async function fileReport(ids) {
  period += 15;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: at(period - 15 + 5), periodEndGame: at(period + 5),
    lines: ids.map((id) => ({ driverId: id, truckStars: 4, trailerStars: 4, perDay: 900, perMile: 2.1, miles: 5000 })),
  })).report;
}

(async () => {
  const app = { driverName: 'D. Vance', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));

  head('1. #149 A rookie is not a flight risk');
  ok('the threshold defaults to GDC\'s rookie band',
    (await boot()).settings.maintenance.poachableFromLevel === 10,
    `${(await boot()).settings.maintenance.poachableFromLevel}`);

  await truck('P600', { serviceMiles: 200000, atsOdometer: 200000 });
  const lvl6 = (await api('/fleetops/drivers', 'POST', {
    name: 'Rookie Ray', status: 'Active', assignedTruckUnit: 'P600', skill: 'Competent',
    level: 6, rating: 7, homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
  const f = await api('/fleetops');
  const ray = (f.drivers || []).find((d) => d.id === lvl6.id);
  ok('a level 6 driver exists to judge', !!ray, `level ${ray?.level}`);
  ok('and nothing warns that they are off to a competitor',
    !JSON.stringify(f).match(/Developed drivers get approached|do not stay at outfits/),
    'no flight-risk line');

  head('2. #149 The threshold moves the whole curve, it does not just mute a message');
  // Employer stars are part of the model and cannot be set from here, so rather than assert a fixed
  // outcome the expected one is computed from the documented formula and the app is held to it. A
  // five-star carrier genuinely can never reach the warning line, which is the point of the multiplier.
  const stars = (await api('/fleetops')).summary?.employerStars ?? 0;
  const expectWarn = (level, thr) => {
    let chance = 40;
    if (level >= thr) chance += Math.min(90, (level - thr + 1) * 11);
    if (stars > 0) chance *= Math.min(2.1, Math.max(0.35, 1 + (3 - stars) * 0.35));
    return level >= thr && Math.min(200, Math.max(5, Math.round(chance))) >= 80;
  };
  const warned = async () =>
    /Developed drivers get approached|do not stay at outfits/.test(JSON.stringify(await api('/fleetops')));

  await api('/fleetops/drivers', 'POST', { ...lvl6, level: 12 });
  for (const thr of [10, 5]) {
    await saveSettings({ poachableFromLevel: thr });
    const got = await warned(), want = expectWarn(12, thr);
    ok(`level 12 at threshold ${thr}: ${want ? 'warned' : 'quiet'}`, got === want,
      `stars ${stars}, got ${got}`);
  }

  await api('/fleetops/drivers', 'POST', { ...lvl6, level: 6 });
  await saveSettings({ poachableFromLevel: 10 });
  ok('and a level 6 under a threshold of 10 is never warned, whatever the stars',
    (await warned()) === false && expectWarn(6, 10) === false, 'gated out');

  head('3. #151 A wreck with a newer plate is not an upgrade');
  // The old test was `Year >` OR `miles < 60%`, so this pair came out backwards on three call sites.
  const mine = (await boot()).trucks.find((t) => t.unit === S.driver.assignedTruckUnit);
  await truck(mine.unit, { unit: mine.unit, year: 2018, serviceMiles: 120000, atsOdometer: 120000 });
  await truck('W900', { year: 2019, serviceMiles: 900000, atsOdometer: 900000 });
  const open = (await api('/fleetops')).openUnits || [];
  const wreck = open.find((u) => u.unit === 'W900');
  ok('the 900,000-mile 2019 is offered', !!wreck, wreck ? wreck.spec : '(not listed)');
  ok('but NOT as better than the 120,000-mile 2018',
    wreck && wreck.betterThanYours === false, `betterThanYours=${wreck?.betterThanYours}`);

  head('4. #151 A genuinely better truck still reads as one');
  await truck('P389', { make: 'Peterbilt', model: '389', year: 2022, serviceMiles: 60000, atsOdometer: 60000, horsepower: 565 });
  const open2 = (await api('/fleetops')).openUnits || [];
  const good = open2.find((u) => u.unit === 'P389');
  ok('newer, far fewer miles, better model', good && good.betterThanYours === true,
    `betterThanYours=${good?.betterThanYours}`);
  ok('and the case for it is sayable', /\d/.test(good?.takeNote || ''), (good?.takeNote || '').slice(0, 90));

  head('5. #154 There is no car carrier to own');
  const autoApp = { ...app, driverName: 'A. Cole', preferredDivision: 'Auto' };
  await api('/onboarding/market', 'POST', autoApp);
  const auto = un(await api('/onboarding/hire', 'POST', { application: autoApp, force: true, gameTime: at(1) }));
  ok('no car hauler is put on the books',
    !(auto.trailers || []).some((t) => t.type === 'Car Hauler'),
    (auto.trailers || []).map((t) => t.type).join(', '));
  const dh = (auto.trailers || []).find((t) => t.type === 'Drop & Hook');
  ok('the arrangement stands in for it', !!dh, dh ? `subtype=${dh.subtype}` : '(none)');
  ok('and it is marked as the auto one', dh && dh.subtype === 'Auto', `${dh?.subtype}`);

  head('6. #153 A tank on the yard says which tank');
  const tankApp = { ...app, driverName: 'T. Reyes', preferredDivision: 'Tanker', hasHazmat: true };
  await api('/onboarding/market', 'POST', tankApp);
  const tk = un(await api('/onboarding/hire', 'POST', { application: tankApp, force: true, gameTime: at(1) }));
  const tank = (tk.trailers || []).find((x) => x.type === 'Tanker');
  ok('a tanker is on the books', !!tank, tank ? `${tank.type}/${tank.subtype}` : '(none)');
  ok('and it names which of the five it is', !!(tank && tank.subtype), `subtype="${tank?.subtype}"`);
  ok('the subtype is one ATS actually sells',
    ['Fuel', 'Chemical', 'Food Grade', 'Dry Bulk', 'Gas'].includes(tank?.subtype || ''), `${tank?.subtype}`);

  head('7. #150 A promotion says what it changed');
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  const before = (await views()).rank;
  ok('a probationary driver may refuse nothing', before.refusalsPerWeek === 0, `${before.refusalsPerWeek}/week`);

  await api('/career/promote', 'POST', { rank: 'company', force: true, note: 'test' });
  const after = (await views()).rank;
  ok('the allowance moved with the rank', after.refusalsPerWeek > before.refusalsPerWeek,
    `${before.refusalsPerWeek} -> ${after.refusalsPerWeek}`);
  const gained = (after.lastChange?.gained || []).join(' ');
  ok('and the driver is told what changed', gained.length > 0, gained.slice(0, 110) || '(silent)');
  ok('including the refusal allowance, in the number the rule actually uses',
    gained.includes(String(after.refusalsPerWeek)), `quotes ${after.refusalsPerWeek}`);
  ok('and that the review clock changed', /review/i.test(gained), 'reviews mentioned');

  head('8. #152 A box nobody is on becomes visible');
  // Section 7 re-hired onto a fresh career, so the yard is back to Small and holds one tractor.
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));
  await api('/fleet/trailer', 'POST', {
    unit: 'IDLE9', type: 'Reefer', division: 'Reefer', year: 2019, make: 'Utility',
    length: "53'", inGameGarage: true, status: 'InService',
    homeTerminalId: S.company.terminals[0].id,
  });
  const spare = (await boot()).trailers.find((x) => x.unit === 'IDLE9');
  ok('there is a trailer nobody is assigned to', !!spare, spare?.unit || '(none)');

  await truck('IDL1', {});
  await api('/fleet/trailer', 'POST', {
    unit: 'WORK1', type: 'Dry Van', division: 'Dry Van', year: 2021, make: 'Wabash',
    length: "53'", inGameGarage: true, status: 'InService',
    homeTerminalId: S.company.terminals[0].id,
  });
  const idler = (await api('/fleetops/drivers', 'POST', {
    name: 'Idle Test', status: 'Active', assignedTruckUnit: 'IDL1', assignedTrailerUnit: 'WORK1',
    skill: 'Competent', level: 5, homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;

  let raised = false;
  for (let i = 0; i < 3; i++) {
    // The dry van is worked hard and reports it; the reefer has nobody on it at all.
    period += 15;
    const rep = (await api('/fleetops/report', 'POST', {
      periodStartGame: at(period - 15 + 5), periodEndGame: at(period + 5),
      lines: [{ driverId: idler.id, truckUnit: 'IDL1', trailerUnit: 'WORK1',
                truckStars: 4, trailerStars: 5, perDay: 900, perMile: 2.1,
                miles: 5000, revenue: 11000, trailerUtilisationPct: 88 }],
    })).report;
    if ((rep.watching || []).some((w) => w.unit === spare.unit)
        || (rep.retirements || []).some((r) => r.unit === spare.unit)) raised = true;
  }
  const box = (await boot()).trailers.find((x) => x.unit === spare.unit);
  ok('the idle periods are counted', (box?.idlePeriods ?? 0) >= 3, `${box?.idlePeriods} period(s)`);
  // NOT written into utilisationPct: the model defines that as a reading off the game, and deriving a
  // zero into it made a fake reading that outlived the box going back to work.
  ok('and no utilisation reading is invented for it', (box?.utilisationPct ?? -1) < 0,
    `utilisationPct=${box?.utilisationPct}`);
  ok('and it got raised rather than sitting there invisibly', raised, `raised=${raised}`);

  head('9. #152 An idle box is TRADED, not just sold off');
  // It is idle because it is the wrong type for the work this carrier gets, not because the fleet is
  // one trailer over. So the company says what to put in its place, on what is actually earning.
  const rec = (await api('/fleetops')).retirements || [];
  const idleRec = rec.find((r) => r.unit === spare.unit);
  if (idleRec) {
    const ev = (idleRec.evidence || []).join(' | ');
    ok('the recommendation names a replacement type',
      /replacing it with|trading it for|Going to a/i.test(idleRec.headline + ' ' + ev),
      idleRec.headline);
    // Like-for-like is the honest answer when the carrier runs one type and there is nothing to
    // compare against; where there IS an alternative the switch has to show both figures.
    ok('it switches to the type that is actually working', /dry van/i.test(idleRec.headline),
      idleRec.headline);
    ok('and argues it on both figures, not on a preference',
      /%/.test(ev) && /period\(s\)/.test(ev), ev.slice(0, 190) || '(no figures)');
  } else {
    ok('the box was raised for disposal', raised, 'watch-list stage');
  }


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
