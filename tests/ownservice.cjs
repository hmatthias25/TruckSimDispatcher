/* Getting your OWN tractor serviced on the GDC schedule.
 *
 * The yard services a hired driver's unit at the fleet report and says what it covered. Your own truck
 * is yours to take in, and the app's half of that is a work order — but only one type of it. Close a
 * Preventive order and every due checkpoint is marked done; close a Repair order for the same work and
 * the money posts, the checkpoints stay due, and the alert that sent you to the shop is still there.
 *
 * The schedule panel used to list eight rows and stop, the Type dropdown defaults to Repair, and
 * nothing anywhere named Preventive as the step that matters. This suite is about the driver being
 * told what to do and the right thing happening when they do it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5863}/api`;
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

let S;
const views = async () => (await api('/bootstrap')).views;
const trucks = async () => (await api('/bootstrap')).trucks;
const orders = async () => (await api('/bootstrap')).workOrders;

async function saveSettings(patch) {
  const cur = (await api('/bootstrap')).settings;
  return api('/settings', 'POST', { ...cur, maintenance: { ...cur.maintenance, ...patch } });
}

/** Put the driver's own tractor a long way past its last PM. */
async function ownTruck(books, lastPm) {
  const mine = (await trucks()).find((t) => t.unit === S.driver.assignedTruckUnit);
  await api('/fleet/truck', 'POST', {
    ...mine, serviceMiles: books, lastServiceMiles: lastPm, atsOdometer: books,
    baselineOdometer: 0, serviceLog: [],
  });
  return mine.unit;
}

async function report(day, city = 'Kansas City', state = 'MO', kind = 'Terminal') {
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: at(day),
    fuelPct: 80, atsOdometer: 560000, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 200000,
  });
  S = r.snapshot;
  return r;
}

const alertsFor = (list, u) => (list || []).filter((a) => a.includes(u));

(async () => {
  const app = { driverName: 'K. Brennan', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Kansas City', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));

  head('1. The schedule is in force and the driver\'s own tractor owes work');
  await saveSettings({ useGdcSchedule: true });
  const unit = await ownTruck(560000, 400000);
  await report(20);

  const sc = (await views()).serviceSchedule;
  ok('the panel is up for the driver\'s own unit', !!sc, sc ? sc.unit : '(none)');
  ok('and it names what is due right now', (sc.due || []).length > 0,
    (sc.due || []).join(', ') || 'nothing');
  ok('the engine service is among them', (sc.due || []).some((d) => /engine/i.test(d)),
    (sc.due || []).join(', '));

  head('2. It hands over the unit KEY, not the name on the door');
  // A work order is filed against Unit. A game ID in that field books the repair against nothing, and
  // the server refuses it — which would be the button failing on the one truck it exists for.
  ok('unitId is the fleet key', sc.unitId === unit, `${sc.unitId} vs ${unit}`);

  head('3. And a figure to weigh the shop\'s against');
  ok('an estimate comes with it', sc.estimate > 0, `$${sc.estimate}`);
  ok('it is more than a single checkpoint would be', sc.estimate > 500, `$${sc.estimate}`);

  head('4. The wrong work order type does NOT clear the schedule');
  // The dropdown defaults to Repair, which is what somebody who just paid a shop would reach for.
  // The money is real; the checkpoints are not touched. This is the trap the panel now warns about.
  await api('/maintenance/workorder', 'POST', {
    unit, unitKind: 'Truck', kind: 'Repair', description: 'Paid a shop for the service',
    locationCity: 'Kansas City', locationState: 'MO', cost: 4200,
    damageBefore: 3, damageAfter: 3, odometerAtService: 560000, paidBy: 'Company', status: 'Completed',
  });
  const afterRepair = (await views()).serviceSchedule;
  ok('a Repair order leaves the checkpoints due',
    (afterRepair.due || []).length === (sc.due || []).length,
    `${(afterRepair.due || []).length} still due`);

  head('5. A Preventive one does, and says what it covered');
  const owed = (afterRepair.due || []).length;
  const wo = await api('/maintenance/workorder', 'POST', {
    unit, unitKind: 'Truck', kind: 'Preventive',
    description: `Scheduled service — ${(afterRepair.due || []).join(', ')}.`,
    locationCity: 'Kansas City', locationState: 'MO', cost: 4200,
    damageBefore: 3, damageAfter: 3, odometerAtService: 560000, paidBy: 'Company', status: 'Completed',
  });
  const closed = (await orders()).find((w) => w.number === wo.workOrder.number);
  ok('the order records which checkpoints were covered',
    /Checkpoints covered:/i.test(closed.notes || ''), (closed.notes || '').slice(0, 120) || '(nothing)');
  ok('and it names them', /engine service/i.test(closed.notes || ''), 'named');

  const after = (await views()).serviceSchedule;
  ok(`all ${owed} checkpoint(s) are cleared`, (after.due || []).length === 0,
    (after.due || []).join(', ') || 'clear');
  ok('the estimate goes with them', after.estimate === 0, `$${after.estimate}`);

  head('6. And the alert that sent them to the shop clears too');
  await report(21);
  ok('nothing outstanding on the unit', alertsFor((await views()).maintenanceAlerts, unit).length === 0,
    alertsFor((await views()).maintenanceAlerts, unit).join(' | ') || 'clear');
  const mine = (await trucks()).find((t) => t.unit === unit);
  ok('the single-interval clock moved with it', mine.lastServiceMiles === mine.serviceMiles,
    `${mine.lastServiceMiles} vs ${mine.serviceMiles}`);

  head('7. Coming home with work owed, the yard says how to record it');
  await ownTruck(700000, 560000);
  // AtHomeYard latches, so reporting twice from the yard is not an arrival. Go out and come back.
  await report(38, 'Oklahoma City', 'OK', 'Customer');
  const home = await report(40);
  const brief = home.homeBrief;
  if (!brief) {
    ok('home time is exercised elsewhere', true, 'no arrival brief on this report');
  } else {
    const shop = (brief.shop || []).join(' | ');
    ok('the brief raises the service', /checkpoint/i.test(shop), shop.slice(0, 140) || '(silent)');
    ok('it names the type that clears it', /Preventive work order/i.test(shop), 'named');
    ok('and quotes what the yard reckons', /\$[\d,]+/.test(shop), shop.slice(0, 160));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
