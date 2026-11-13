/* A wreck graded against the truck before it, and a driver-fault write-off that becomes an incident (reported from play).
 *
 * A brand-new truck flipped on the first load, filed as Driver and preventable at 100% — and went on the record as
 * severity None, with no discipline and nothing on the probation. The incident was measured against the reading it
 * had just written onto the truck: 100 less 100. The tractor before it had been written off as driver fault from the
 * Maintenance tab, which only ever set the deductible and never became an incident at all.
 *
 *   - an incident is graded against the truck before it, even with the wreck already typed into the status report
 *   - on probation, that wreck ends it; off it, it reaches the ladder
 *   - a driver-fault write-off with no incident on file is filed as one, and decided the same way
 *   - one already on file is not filed twice
 *   - a career written before the fix is regraded when it loads, oldest first
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
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const status = (gameTime, truckDamagePct = 3) => api('/status', 'POST', { locationCity: 'Springfield', locationState: 'MO', locationKind: 'TruckStop',
  gameTime, fuelPct: 80, atsOdometer: 90000, truckDamagePct, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 150000 }).then(un);

async function hire(probation) {
  await api('/reset', 'POST', { confirm: 'RESET', resetSettings: true });
  const app = { driverName: 'W. Keane', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 9,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) });
  if (!probation) await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70, asOfGameTime: iso(10) });
  return status(iso(10));
}
async function load() {
  const S = await api('/bootstrap');
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: S.trailers.find((t) => t.unit === S.driver.assignedTrailerUnit)?.type || 'Dry Van',
    shipper: 'S', receiver: 'R', originCity: 'Springfield', originState: 'MO', destCity: 'Joplin', destState: 'MO',
    loadedMiles: 75, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 40, weightLbs: 30000, atLocation: true });
  const ev = (await api('/board/evaluate')).evaluations[0];
  return (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;
}
const collision = (trip, after, fault = 'Driver') => api('/incidents', 'POST', { kind: 'Collision', tripNumber: trip?.number || '',
  description: 'flipped truck', faultAttribution: fault, preventable: fault === 'Driver', truckDamagePctAfter: after, trailerDamagePctAfter: -1 });

(async () => {
  head('1. Reported from play: the wreck already typed into the status report, then filed — on probation');
  await hire(true);
  let trip = await load();
  ok('a load is running, dispatched with the truck at 3%', trip && trip.truckDamageBefore === 3, `${trip?.truckDamageBefore}`);
  await status(iso(10, '12:00'), 100);
  let r = await collision(trip, 100);
  ok('graded against the 3% before it, not the 100% on file', Math.abs(r.incident.damageIncurredPct - 97) < 0.01, `${r.incident.damageIncurredPct}`);
  ok('a Major wreck', r.incident.severity === 'Major', r.incident.severity);
  ok('on probation, that ends it', r.probation?.kind === 'Terminated' && un(r).driver.status === 'Terminated', `${r.probation?.kind} / ${un(r).driver.status}`);

  head('2. Off probation, filed straight away: the ladder');
  await hire(false);
  trip = await load();
  r = await collision(trip, 12);
  ok('9% against the 3% before it: moderate', r.incident.severity === 'Moderate' && Math.abs(r.incident.damageIncurredPct - 9) < 0.01,
    `${r.incident.severity} ${r.incident.damageIncurredPct}`);
  ok('and a rung on the ladder', !!r.action, r.action ? r.action.level : '(none)');

  head('3. A driver-fault write-off with nothing filed becomes an incident');
  await hire(true);
  trip = await load();
  let S = await api('/bootstrap');
  const mine = S.trucks.find((t) => t.unit === S.driver.assignedTruckUnit);
  await api('/fleet/truck', 'POST', { ...mine, damagePct: 70 });
  r = await api('/maintenance/writeoff', 'POST', { unit: mine.unit, driverFault: true, scrapRecovery: 0, notes: 'ditch' });
  ok('filed as an incident', r.filed?.incident?.faultAttribution === 'Driver' && r.filed.incident.preventable, JSON.stringify(r.filed?.incident?.number));
  ok('graded off the 70% against the 3% before it', r.filed?.incident?.severity === 'Major', r.filed?.incident?.severity);
  ok('and on probation it ends it', r.filed?.probation?.kind === 'Terminated', r.filed?.probation?.kind);
  ok('said on the write-off itself', r.writeOff.instructions.some((x) => x.includes(r.filed?.incident?.number || '???')),
    r.writeOff.instructions.join(' | ').slice(0, 200));

  head('4. A wreck already filed is not filed twice');
  await hire(true);
  trip = await load();
  r = await collision(trip, 70, 'Unavoidable');
  ok('filed as unavoidable: nothing follows', !r.probation && !r.action);
  S = un(r);
  const unit = S.trucks.find((t) => t.unit === S.driver.assignedTruckUnit)?.unit || trip.truckUnit;
  r = await api('/maintenance/writeoff', 'POST', { unit, driverFault: true, scrapRecovery: 0, notes: '' });
  ok('the write-off adds no second incident', !r.filed && un(r).incidents.length === 1, `${un(r).incidents.length}`);
  ok('and the driver is still employed', un(r).driver.status !== 'Terminated', un(r).driver.status);

  head('5. A career written before the fix is regraded when it loads');
  await hire(true);
  trip = await load();
  const exported = await api('/export');
  exported.schemaVersion = 37;
  exported.incidents = [{ number: 'PRI-INC-0099', gameTime: iso(10, '10:00'), tripNumber: trip.number, kind: 'Collision',
    description: 'flipped truck', faultAttribution: 'Driver', severity: 'None', preventable: true, cost: 0,
    truckDamagePctAfter: 100, trailerDamagePctAfter: -1, damageIncurredPct: 0, countedOnProbation: false,
    agesOffAfterLoads: 5, loadCountAtIncident: 0, forgivenGameTime: '', forgivenReason: '', notes: '' }];
  exported.ledger.unshift({ accountKey: 'operating', amount: -5000, category: 'InsuranceDeductible',
    memo: `Deductible on unit ${trip.truckUnit} — driver-fault, so the higher one applies`, tripNumber: '', gameTime: iso(10, '09:00'),
    isAdjustment: false });
  S = await (await fetch(B + '/import', { method: 'POST', body: JSON.stringify(exported) })).json();
  const regraded = S.incidents.find((i) => i.number === 'PRI-INC-0099');
  ok('the flipped truck is a Major wreck now', regraded?.severity === 'Major' && regraded.damageIncurredPct > 90,
    `${regraded?.severity} ${regraded?.damageIncurredPct}`);
  const backfilled = S.incidents.find((i) => i.number !== 'PRI-INC-0099');
  ok('the driver-fault write-off is on the record as well', backfilled?.faultAttribution === 'Driver' && backfilled.gameTime === iso(10, '09:00'),
    JSON.stringify(backfilled && { n: backfilled.number, t: backfilled.gameTime, s: backfilled.severity }));
  ok('and the earlier of the two ended the probation', S.driver.status === 'Terminated' && S.driver.terminationReason.startsWith(backfilled?.number || '???'),
    `${S.driver.status}: ${S.driver.terminationReason.slice(0, 80)}`);
  ok('said on the event log', (S.events || []).some((e) => /corrected/.test(e.message)) || (await api('/events?take=50')).some((e) => /corrected/.test(e.message)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
