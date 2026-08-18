/* Issue #32: the ID ATS shows is what the app calls a unit, but the assigned number stays the key. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5660}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

let S;

(async () => {
  head('1. Hire, and note the assigned numbers');
  const app = { driverName: 'ID Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T08:00' }));
  const truck = S.trucks[0];
  const trailer = S.trailers[0];
  ok('a truck with an assigned number', !!truck.unit, truck.unit);
  ok('no game ID until one is entered', !truck.gameId, `"${truck.gameId}"`);

  head('2. Entering the ID ATS shows');
  S = un(await api('/fleet/truck', 'POST', { ...truck, gameId: 'KW-4471' }));
  let tk = S.trucks.find((x) => x.unit === truck.unit);
  ok('the game ID is stored', tk.gameId === 'KW-4471', tk.gameId);
  ok('the assigned number is untouched', tk.unit === truck.unit, tk.unit);

  S = un(await api('/fleet/trailer', 'POST', { ...trailer, gameId: 'VAN-8802' }));
  let tl = S.trailers.find((x) => x.unit === trailer.unit);
  ok('trailers take one too', tl.gameId === 'VAN-8802', tl.gameId);

  head('3. It is what the app calls the unit');
  // Damage past the review line raises a directive, which is a driver-facing string.
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: '2000-01-02T08:00',
    fuelPct: 80, atsOdometer: 9000, truckDamagePct: 22, trailerDamagePct: 4,
    dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  const alerts = (S.views.maintenanceAlerts || []).join(' | ');
  ok('a shop directive uses the game ID', /KW-4471/.test(alerts), alerts || '(none)');
  ok('and does not fall back to the number', !new RegExp(`Unit ${truck.unit}\\b`).test(alerts), alerts);

  const blockers = (S.views.dispatchBlockers || []).join(' | ');
  if (blockers) {
    ok('dispatch blockers use it as well', !new RegExp(`Unit ${truck.unit}\\b`).test(blockers), blockers);
  } else {
    ok('no blockers at this damage level, nothing to check', true);
  }

  head('4. Work orders still key on the assigned number');
  const wo = await api('/maintenance/workorder', 'POST', {
    unit: truck.unit, unitKind: 'Truck', kind: 'Damage', description: 'Front end',
    damageBefore: 22, damageAfter: 0, cost: 900, status: 'Open', locationCity: 'Denver', locationState: 'CO',
  });
  S = un(wo);
  const order = S.workOrders[0];
  ok('the work order is filed against the assigned number', order.unit === truck.unit, order.unit);
  ok('so the unit can still be found from it',
    !!S.trucks.find((x) => x.unit === order.unit), order.unit);

  head('5. A duplicate game ID is refused');
  // Put a second tractor on the books to clash with.
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Medium' }));
  const stock = await api('/fleet/stock', 'POST', {
    terminalId: S.company.terminals[0].id, count: 1, alreadyBought: true,
    transmissionPreference: 'either', addTrailers: false,
  });
  S = stock.snapshot;
  const second = S.trucks.find((x) => x.unit !== truck.unit);
  ok('a second tractor is on the books', !!second, second?.unit);

  let refused = false, msg = '';
  try {
    await api('/fleet/truck', 'POST', { ...second, gameId: 'KW-4471' });
  } catch (e) { refused = true; msg = e.message; }
  ok('the clash is refused', refused, msg);
  ok('and the message names the unit already holding it', /KW-4471/.test(msg) && new RegExp(truck.unit).test(msg), msg);

  head('6. Clearing it falls back to the assigned number');
  S = un(await api('/fleet/truck', 'POST', { ...tk, gameId: '' }));
  tk = S.trucks.find((x) => x.unit === truck.unit);
  ok('game ID cleared', !tk.gameId, `"${tk.gameId}"`);
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: '2000-01-03T08:00',
    fuelPct: 80, atsOdometer: 9200, truckDamagePct: 22, trailerDamagePct: 4,
    dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  const after = (S.views.maintenanceAlerts || []).join(' | ');
  ok('the assigned number is used again', new RegExp(`Unit ${truck.unit}\\b`).test(after), after || '(none)');
  ok('and the old ID is gone from the copy', !/KW-4471/.test(after), after);

  head('7. Whitespace is not a game ID');
  // Read the unit fresh — posting a stale copy writes its old damage back and there would be
  // nothing left to raise a directive about.
  tk = S.trucks.find((x) => x.unit === truck.unit);
  S = un(await api('/fleet/truck', 'POST', { ...tk, gameId: '   ' }));
  tk = S.trucks.find((x) => x.unit === truck.unit);
  const alerts2 = (S.views.maintenanceAlerts || []).join(' | ');
  ok('blank-ish input does not blank the label',
    new RegExp(`Unit ${truck.unit}\\b`).test(alerts2), alerts2 || '(none)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
