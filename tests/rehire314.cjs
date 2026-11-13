/* Fired, and hired again by a second-chance carrier (reported from play, v0.88).
 *
 * Let go on probation for a wreck. The banner said the career was closed and to start a new one from Settings, when the
 * second-chance carriers would still have them. Applying to one then asked for a reason for leaving, as though they had
 * resigned. And the old company's garages have to go.
 *
 *   - a driver let go, with somewhere to go, is told who will take them — by name — and pointed at the Job Market
 *   - the application records the firing, not a resignation, with the reason on the file
 *   - the changeover tells them to sell the old company's garage
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

(async () => {
  const app = { driverName: 'Chaz', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 0, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const hq = S.company.terminals.find((t) => t.isHeadquarters);
  await api('/status', 'POST', { locationCity: hq.city, locationState: hq.state, locationKind: 'Terminal', gameTime: '2000-01-02T08:00',
    fuelPct: 80, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 50000 });

  // The old company's own fleet, with drivers in it.
  await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' });
  const stock = await api('/fleet/stock', 'POST', { terminalId: hq.id, count: 2, alreadyBought: true, transmissionPreference: 'automatic', addTrailers: true });
  for (const [i, unit] of stock.result.trucks.entries())
    await api('/fleetops/drivers', 'POST', { name: `Driver ${i + 1}`, assignedTruckUnit: unit, skill: 'Competent', status: 'Active', wageShare: 0.3 });
  let full = await api('/export');
  ok('the old company has hired drivers and a fleet', full.hiredDrivers.length === 2 && full.trucks.length >= 3, `${full.hiredDrivers.length} drivers, ${full.trucks.length} trucks`);
  S = await api('/bootstrap');

  head('1. Let go on probation for a wreck');
  const r = await api('/incidents', 'POST', { kind: 'Collision', description: 'flipped truck', faultAttribution: 'Driver', preventable: true,
    truckDamagePctAfter: 100, trailerDamagePctAfter: -1 });
  S = un(r);
  ok('terminated', S.driver.status === 'Terminated', S.driver.status);
  ok('not the end of the career', !S.driver.careerOver);

  head('2. Told who will still take them');
  const who = S.views.rehire || [];
  ok('the second-chance carriers that would hire them, by name', who.length > 0, who.join(', '));
  const blockers = (S.views.dispatchBlockers || []).join(' ');
  ok('dispatch points at the Job Market rather than a new career', /second-chance carrier/i.test(blockers) && /Job Market/.test(blockers), blockers.slice(0, 200));

  head('3. Applying records the firing, not a resignation');
  const market = (await api('/market')).market.filter((c) => c.wouldHire);
  ok('the market offers them', market.length > 0 && market.every((c) => who.includes(c.name)), market.map((c) => c.name).join(', '));
  const reason = S.driver.terminationReason;
  const hired = await api('/market/apply', 'POST', { code: market[0].code, reason: '' });
  S = un(hired);
  ok('hired', hired.hired === true && S.company.code === market[0].code, S.company.name);
  const last = S.driver.employmentHistory[0];
  ok('on the file as terminated', last?.separation === 'Terminated', last?.separation);
  ok('with the reason they were let go', last?.reason === reason, (last?.reason || '').slice(0, 80));
  ok('said that way on the log', (await api('/events?take=20')).some((e) => /^Let go by /.test(e.message)));

  head('4. The old company\'s garage is to be sold');
  const steps = S.changeover?.steps || hired.changeover?.steps || [];
  const sell = steps.find((x) => x.kind === 'Sell' && x.city === hq.city);
  ok(`the changeover says to sell the garage in ${hq.city}`, !!sell, steps.map((x) => x.title).join(' | '));

  ok('and to let the old drivers go in the game', steps.some((x) => x.id === 'release-drivers' && /Driver 1/.test(x.detail)),
    steps.map((x) => x.id).join(', '));

  head('5. A new job starts from nothing');
  full = await api('/export');
  ok('no hired drivers carried over', full.hiredDrivers.length === 0, `${full.hiredDrivers.length}`);
  ok('no fleet reports', full.fleetReports.length === 0, `${full.fleetReports.length}`);
  ok('no equipment orders, trailer or yard requests', full.equipmentOrders.length === 0 && full.trailerRequests.length === 0 && full.yardRequests.length === 0,
    `${full.equipmentOrders.length}/${full.trailerRequests.length}/${full.yardRequests.length}`);
  ok('no reviews from the old job', full.probationReviews.length === 0 && full.periodicReviews.length === 0);
  ok('one starter tractor, nothing of the old fleet', full.trucks.length === 1 && full.trucks[0].unit === full.driver.assignedTruckUnit,
    full.trucks.map((t) => t.unit).join(', '));
  ok('only the new company\'s yard on the books', full.company.terminals.length === 1 && full.company.terminals[0].city !== hq.city,
    full.company.terminals.map((t) => t.city).join(', '));
  ok('the old yard still on the map', full.discovered.some((c) => c.city === hq.city));
  ok('the employment history kept', full.driver.employmentHistory.length === 1);
  ok('and the set-up guide is on hand while the move is open', (S.views.setup || []).length > 0, `${(S.views.setup || []).length} step(s)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
