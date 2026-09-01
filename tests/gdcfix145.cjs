/* Issue #145 — switching onto the GDC schedule used to wipe every unit's clocks.
 *
 * Turning the setting on marked every recurring checkpoint done at the unit's current odometer, on the
 * argument that nothing should be backdated into instant overdue. What it did was write a service on
 * every tractor that nobody had performed: the first fleet report found nothing due, serviced nothing,
 * and left the old PM alerts standing over units it had just declined to touch.
 *
 * Three faults, and they covered for each other:
 *   - the switch threw away LastServiceMiles, which is when each unit was actually last serviced;
 *   - ServicePlan counted against AtsOdometer, which is optional and often zero on a hired unit;
 *   - FleetAlerts quoted the single PM interval whichever schedule was in force, so the alert counted
 *     a clock nothing under GDC ever resets and survived the service meant to clear it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5861}/api`;
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
const trucks = async () => (await api('/bootstrap')).trucks;

async function saveSettings(patch) {
  const cur = await settings();
  return api('/settings', 'POST', { ...cur, maintenance: { ...cur.maintenance, ...patch } });
}

/** A unit on the books, with a real last-service reading behind it. */
async function unit(u, books, lastPm, ats) {
  await api('/fleet/truck', 'POST', {
    unit: u, make: 'Freightliner', model: 'Cascadia', year: 2019,
    serviceMiles: books, lastServiceMiles: lastPm, atsOdometer: ats ?? 0,
    serviceIntervalMiles: 25000, damagePct: 4, inGameGarage: true,
    homeTerminalId: S.company.terminals[0].id,
  });
}

async function hire(name, u) {
  return (await api('/fleetops/drivers', 'POST', {
    name, status: 'Active', assignedTruckUnit: u, skill: 'Experienced',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
}

/** Money in operating, so a thin balance is never what decides whether the yard does the work. */
async function setCash(target) {
  const now = (await api('/bootstrap')).views.finance.accounts.find((a) => a.key === 'operating').balance;
  await api('/finance/entry', 'POST', {
    accountKey: 'operating', amount: Math.round(target - now),
    category: 'Other', memo: 'fixture — balance set',
  });
}

async function fileReport(ids) {
  await setCash(400000);
  period += 15;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: at(period - 15 + 5), periodEndGame: at(period + 5),
    lines: ids.map((id) => ({ driverId: id, truckStars: 4, trailerStars: 4 })),
  })).report;
}

const alertsFor = (list, u) => (list || []).filter((a) => a.includes(u));
const finding = (rep, re) => (rep.findings || []).find((f) => re.test(f)) || '';

(async () => {
  const app = { driverName: 'D. Halloran', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));

  head('1. #145 A unit long past its last PM, on a career still using one interval');
  // 560,000 on the books, last serviced at 400,000. Under GDC that owes the engine service, the
  // tyre/suspension service, the chassis inspection and the driveline service, all at once.
  await unit('T600', 560000, 400000);
  const d1 = await hire('M. Reyes', 'T600');
  let v = await views();
  ok('the single-interval alert is raised', alertsFor(v.maintenanceAlerts, 'T600').length === 1,
    alertsFor(v.maintenanceAlerts, 'T600')[0] || '(none)');
  ok('and it speaks the PM interval', /PM overdue by/i.test(alertsFor(v.maintenanceAlerts, 'T600')[0] || ''),
    'legacy wording');

  head('2. #145 Switching onto GDC starts the clocks at the last real service');
  await saveSettings({ pendingGdcSchedule: true });
  const rep = await fileReport([d1.id]);
  ok('the schedule is in force', (await settings()).maintenance.useGdcSchedule === true);
  ok('the report says the clocks came off real history',
    /last service each (unit|one) actually had/i.test(finding(rep, /GDC service schedule/i)),
    finding(rep, /GDC service schedule/i).slice(0, 130) || '(not said)');
  ok('and it says work was already owed',
    /already owe work/i.test(finding(rep, /GDC service schedule/i)),
    'owed');

  head('3. #145 The same report services the unit rather than finding nothing');
  const line = finding(rep, /T600/);
  ok('T600 went through the shop', /went through the shop|not coming out|needed more than a service/i.test(line),
    line.slice(0, 140) || '(nothing said about T600)');
  ok('and the checkpoints covered are named',
    /engine service|tyre|driveline|chassis/i.test(line) || /not coming out|needed more/i.test(line),
    line.slice(0, 140));

  head('4. #145 And the alert clears, because it now speaks the schedule in force');
  v = await views();
  ok('nothing outstanding on T600', alertsFor(v.maintenanceAlerts, 'T600').length === 0,
    alertsFor(v.maintenanceAlerts, 'T600').join(' | ') || 'clear');
  const t600 = (await trucks()).find((t) => t.unit === 'T600');
  ok('the single-interval clock was reset with it', t600.lastServiceMiles === t600.serviceMiles,
    `${t600.lastServiceMiles} vs ${t600.serviceMiles}`);

  head('5. #145 A hired unit with no game reading at all is still counted');
  // atsOdometer stays 0: the player never entered one. Counting checkpoints against it read every such
  // unit as nought miles since service, so nothing was ever due on any of them.
  await unit('T700', 480000, 300000, 0);
  const d2 = await hire('J. Okafor', 'T700');
  v = await views();
  const a700 = alertsFor(v.maintenanceAlerts, 'T700')[0] || '';
  ok('the unit is due work despite no ATS odometer', !!a700, a700.slice(0, 130) || '(silent)');
  ok('and the alert names checkpoints, not a PM interval',
    /checkpoint/i.test(a700) && !/PM overdue/i.test(a700), a700.slice(0, 130));

  const rep2 = await fileReport([d2.id]);
  ok('and the yard actually does it', /went through the shop|not coming out|needed more than a service/i.test(finding(rep2, /T700/)),
    finding(rep2, /T700/).slice(0, 130) || '(nothing)');
  v = await views();
  ok('after which it is clear', alertsFor(v.maintenanceAlerts, 'T700').length === 0,
    alertsFor(v.maintenanceAlerts, 'T700').join(' | ') || 'clear');

  head('6. #145 The service tag speaks the schedule in force');
  const lines = (await views()).serviceLines || [];
  ok('every unit carries a standing line', lines.length >= 2, `${lines.length} line(s)`);
  const l600 = lines.find((x) => x.unit === 'T600');
  ok('and it is written in checkpoints, not in one PM interval',
    !/every 25,000 mi/i.test(l600.line), l600.line);

  head('7. #145 Off the schedule the old wording comes back, unchanged');
  await saveSettings({ pendingGdcSchedule: false });
  await fileReport([d1.id]);
  ok('back on the single interval', (await settings()).maintenance.useGdcSchedule === false);
  const back = (await views()).serviceLines.find((x) => x.unit === 'T600');
  ok('and the tag says so', /every 25,000 mi/i.test(back.line), back.line);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
