/* Issue #142 — the GDC service interval guide as an alternative schedule.
 *
 * Stock ATS tracks one condition figure and nothing underneath it, so one PM interval is the right
 * model there. A career on the GDC economy mod is asked to manage separate checkpoints — engine, tyres
 * and suspension, driveline, chassis, and long-term major reviews — each on its own mileage, and
 * holding a truck to one blended number throws most of that away.
 *
 * Three things the guide is explicit about and the app has to respect:
 *   - Standard vs Severe is a DUTY CYCLE, not a season.
 *   - Mileage is not damage. They are separate signals.
 *   - A used truck purchase carries the dealer baseline as complete.
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
const at = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, period = 0;
const views = async () => (await api('/bootstrap')).views;
const settings = async () => (await api('/bootstrap')).settings;

async function saveSettings(patch) {
  const cur = await settings();
  const next = { ...cur, maintenance: { ...cur.maintenance, ...patch } };
  return api('/settings', 'POST', next);
}

async function place(day, odo) {
  await api('/status', 'POST', {
    locationCity: 'Kansas City', locationState: 'MO', locationKind: 'Terminal', gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 200000,
  });
}

async function truck(u, odo, baseline) {
  await api('/fleet/truck', 'POST', {
    unit: u, make: 'Freightliner', model: 'Cascadia', year: 2021,
    atsOdometer: odo, serviceMiles: odo, lastServiceMiles: odo, serviceIntervalMiles: 25000,
    baselineOdometer: baseline ?? 0, damagePct: 4, inGameGarage: true,
    homeTerminalId: S.company.terminals[0].id,
  });
}

async function fileReport(driverIds) {
  period += 15;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: at(period - 15 + 5), periodEndGame: at(period + 5),
    lines: driverIds.map((id) => ({ driverId: id, truckStars: 4, trailerStars: 4 })),
  })).report;
}

const find = (list, key) => (list || []).find((x) => x.key === key);

(async () => {
  const app = { driverName: 'R. Calloway', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));

  head('1. #142 Off by default, and nothing changes');
  ok('the GDC schedule is off on a fresh career', (await settings()).maintenance.useGdcSchedule === false,
    `${(await settings()).maintenance.useGdcSchedule}`);
  ok('and no schedule panel is shown', !(await views()).serviceSchedule, 'no panel');

  head('2. #142 Turning it on is staged until the next fleet report');
  // Switching mid-period would re-date every unit against different intervals while trucks are out
  // working to the old ones.
  await saveSettings({ pendingGdcSchedule: true });
  ok('the change is recorded as pending', (await views()).pendingScheduleChange === true, 'staged');
  ok('but it is not in force yet', (await settings()).maintenance.useGdcSchedule === false, 'not applied');
  ok('and still no schedule panel', !(await views()).serviceSchedule, 'not yet');

  await truck('T500', 120000);
  const d1 = (await api('/fleetops/drivers', 'POST', {
    name: 'M. Reyes', status: 'Active', assignedTruckUnit: 'T500', skill: 'Experienced',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;

  const rep = await fileReport([d1.id]);
  ok('filing the report applies it',
    (await settings()).maintenance.useGdcSchedule === true, 'in force');
  ok('and the report says so',
    (rep.findings || []).some((f) => /GDC service schedule/i.test(f)),
    (rep.findings || []).find((f) => /GDC/i.test(f))?.slice(0, 100) || '(not said)');
  ok('nothing is backdated into being overdue',
    (rep.findings || []).some((f) => /nothing is backdated/i.test(f)), 'said');

  head('3. #142 The driver\'s own tractor shows every checkpoint');
  await place(25, 150000);
  const sc = (await views()).serviceSchedule;
  ok('the panel appears once GDC is in force', !!sc, sc ? `${sc.checkpoints.length} checkpoints` : '(none)');
  ok('standard duty by default', sc.severe === false, `severe=${sc.severe}`);
  ok('the engine service is on the guide\'s standard interval',
    find(sc.checkpoints, 'engine')?.intervalMiles === 45000,
    `${find(sc.checkpoints, 'engine')?.intervalMiles}`);
  ok('the tyre/suspension service too', find(sc.checkpoints, 'tires')?.intervalMiles === 60000,
    `${find(sc.checkpoints, 'tires')?.intervalMiles}`);
  ok('and the driveline', find(sc.checkpoints, 'driveline')?.intervalMiles === 150000,
    `${find(sc.checkpoints, 'driveline')?.intervalMiles}`);

  head('4. #142 Severe duty uses the other column');
  await saveSettings({ severeDuty: true });
  const sev = (await views()).serviceSchedule;
  ok('engine service tightens to 35,000', find(sev.checkpoints, 'engine')?.intervalMiles === 35000,
    `${find(sev.checkpoints, 'engine')?.intervalMiles}`);
  ok('tyres to 45,000', find(sev.checkpoints, 'tires')?.intervalMiles === 45000,
    `${find(sev.checkpoints, 'tires')?.intervalMiles}`);
  ok('driveline to 125,000', find(sev.checkpoints, 'driveline')?.intervalMiles === 125000,
    `${find(sev.checkpoints, 'driveline')?.intervalMiles}`);
  await saveSettings({ severeDuty: false });

  head('5. #142 A range means due at the low end, overrun past the high end');
  const tc = find((await views()).serviceSchedule.checkpoints, 'tirecheck');
  ok('the early tyre check comes due at 15,000', tc.intervalMiles === 15000, `${tc.intervalMiles}`);
  ok('and is not overrun until 30,000', tc.limitMiles === 30000, `${tc.limitMiles}`);

  head('6. #142 The majors are one-off milestones, not repeats');
  const pt = find((await views()).serviceSchedule.checkpoints, 'powertrain');
  ok('the powertrain inspection is marked one-off', pt.milestone === true, `${pt.milestone}`);
  ok('and the engine service is not', find((await views()).serviceSchedule.checkpoints, 'engine').milestone !== true,
    'recurring');

  head('7. #142 A used truck carries the dealer baseline as complete');
  // The guide's own rule. Without it, buying a 600,000-mile tractor would owe every review ever
  // published the moment it joined the fleet.
  await truck('T900', 620000, 620000);
  await api('/fleetops/drivers', 'POST', {
    name: 'Old Hand', status: 'Active', assignedTruckUnit: 'T900', skill: 'Veteran',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  });
  const bought = (await api('/bootstrap')).trucks.find((x) => x.unit === 'T900');
  ok('the baseline is where it joined us', bought.baselineOdometer === 620000, `${bought.baselineOdometer}`);

  head('8. #142 A fleet unit is serviced as a set, and the report says what');
  await truck('T600', 400000);
  const d2 = (await api('/fleetops/drivers', 'POST', {
    name: 'J. Okafor', status: 'Active', assignedTruckUnit: 'T600', skill: 'Competent',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
  // Run it far enough that several checkpoints fall due at once.
  await api('/fleet/truck', 'POST', {
    unit: 'T600', make: 'Freightliner', model: 'Cascadia', year: 2021,
    atsOdometer: 560000, serviceMiles: 560000, lastServiceMiles: 400000,
    serviceIntervalMiles: 25000, baselineOdometer: 400000, damagePct: 5, inGameGarage: true,
    homeTerminalId: S.company.terminals[0].id,
  });
  const rep2 = await fileReport([d2.id]);
  const line = (rep2.findings || []).find((f) => /T600/.test(f) && /shop/i.test(f)) || '';
  ok('the unit went through the shop', !!line, line.slice(0, 130) || '(nothing)');
  ok('and the checkpoints covered are named',
    /engine service|tyre|driveline|chassis/i.test(line), 'named');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
