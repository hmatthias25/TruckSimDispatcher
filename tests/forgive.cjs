/* Issue #2: a preventable incident must stop barring you from carriers without vanishing from the record. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5388}/api`;
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

let S, day = 1;
async function runLoad() {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper',
    gameTime: `2000-0${day < 10 ? '1-0' + day : (day < 32 ? '1-' + day : '2-0' + (day - 31))}T05:00`,
    fuelPct: 100, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 2000, deadlineHours: 60, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const r = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: `2000-01-${String(Math.min(28, day)).padStart(2, '0')}T18:00`,
    actualMiles: 400, endOdometer: 400, actualRevenue: 2000, fuelStops: [],
    tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', fuelPct: 60,
    gameTime: `2000-01-${String(Math.min(28, day)).padStart(2, '0')}T18:00`,
  });
  day = Math.min(27, day + 1);
  S = r.snapshot;
  return r;
}

(async () => {
  const app = { driverName: 'Forgive Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T05:00' }));

  head('A preventable on load one');
  let r = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    cost: 500, tripNumber: '', description: 'Backed into a post at the dock',
  });
  const num = r.incident.number;
  S = r.snapshot;
  ok('it counts', S.views.countingFaults === 1, `${S.views.countingFaults}`);
  ok('ages off after 20 for a Minor', r.incident.agesOffAfterLoads === 20, `${r.incident.agesOffAfterLoads}`);

  head('Carriers demanding a spotless record now refuse');
  let mk = (await api('/onboarding/market', 'POST', app)).market;
  const strict = mk.filter((c) => c.maxDriverFaultIncidents === 0);
  ok('some carriers demand zero', strict.length > 0, `${strict.length}: ${strict.map((c) => c.name).join(', ')}`);
  ok('and they will not take us', strict.every((c) => !c.wouldHire));
  const oneFault = mk.filter((c) => c.maxDriverFaultIncidents === 1);
  ok('carriers allowing one do not cite the incident',
    oneFault.every((c) => !(c.screening.reasons || []).some((r) => /incident/i.test(r))),
    `${oneFault.length} carrier(s) checked`);
  ok('and at least one of them clears every bar', oneFault.some((c) => c.standing !== 'Short'),
    oneFault.filter((c) => c.standing !== 'Short').map((c) => c.code).join(', ') || 'all short on something');

  head('Early review is refused without clean work behind it');
  let refused = null;
  try { await api(`/incidents/${encodeURIComponent(num)}/forgive`, 'POST', { reason: 'please', force: false }); }
  catch (e) { refused = e.message; }
  ok('refused', refused !== null, refused || '(allowed!)');
  ok('and says what is needed', /clean loads before Safety/.test(refused || ''), refused);

  head('Run 10 clean loads, then ask again');
  for (let i = 0; i < 10; i++) await runLoad();
  ok('still counting at 10 loads', S.views.countingFaults === 1, `${S.views.countingFaults}`);
  const standing = S.views.faultStanding[0];
  ok('progress is visible', standing.loadsToClear === 10, `${standing.loadsToClear} of ${standing.agesOffAfterLoads} to go`);

  S = await api(`/incidents/${encodeURIComponent(num)}/forgive`, 'POST',
    { reason: 'Completed defensive-driving refresher; ten clean loads since.', force: false });
  ok('Safety clears it at the halfway mark', S.views.countingFaults === 0, `${S.views.countingFaults}`);
  ok('still on the record', S.incidents.length === 1, `${S.incidents.length} incident(s) on file`);
  ok('marked as cleared, with the reason', !!S.views.faultStanding[0].forgiven &&
    /defensive-driving/.test(S.views.faultStanding[0].forgivenReason), S.views.faultStanding[0].forgivenReason);

  head('Strict carriers open back up');
  mk = (await api('/onboarding/market', 'POST', app)).market;
  const strictNow = mk.filter((c) => c.maxDriverFaultIncidents === 0);
  // They may still refuse on experience or load count — those are separate gates. What must be gone
  // is the incident being held against us.
  const stillFaulted = strictNow.filter((c) => (c.screening?.reasons || []).some((x) => /driver-fault incident/.test(x)));
  ok('the incident is no longer a reason to refuse', stillFaulted.length === 0,
    stillFaulted.map((c) => `${c.name}: ${(c.screening.reasons || []).find((x) => /driver-fault/.test(x))}`).join(' | ') || 'none cite it');
  strictNow.forEach((c) => console.log(`     ${c.name}: ${(c.screening?.reasons || []).join(' / ') || 'would hire'}`));

  head('Clearing twice is refused');
  let twice = null;
  try { await api(`/incidents/${encodeURIComponent(num)}/forgive`, 'POST', { reason: 'again', force: false }); }
  catch (e) { twice = e.message; }
  ok('refused', /already been cleared/.test(twice || ''), twice);

  head('Ageing off happens on its own');
  r = await api('/incidents', 'POST', {
    kind: 'Damage', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    cost: 200, tripNumber: '', description: 'Curbed a trailer tyre',
  });
  S = r.snapshot;
  ok('counts again', S.views.countingFaults === 1);
  for (let i = 0; i < 20; i++) await runLoad();
  ok('aged off after 20 clean loads, no action needed', S.views.countingFaults === 0,
    `${S.views.countingFaults} counting`);
  const aged = S.views.faultStanding.find((x) => x.number === r.incident.number);
  ok('shown as aged off, not cleared', aged && !aged.forgiven && !aged.counting,
    `forgiven=${aged?.forgiven} counting=${aged?.counting}`);
  ok('and both are still in the log', S.incidents.length === 2, `${S.incidents.length}`);

  head('Non-preventable incidents never counted anyway');
  let nope = null;
  r = await api('/incidents', 'POST', {
    kind: 'Damage', severity: 'Serious', faultAttribution: 'Mechanical', preventable: false,
    cost: 3000, tripNumber: '', description: 'Turbo let go',
  });
  try { await api(`/incidents/${encodeURIComponent(r.incident.number)}/forgive`, 'POST', { reason: 'x', force: false }); }
  catch (e) { nope = e.message; }
  ok('refused with the reason why', /never counted against you/.test(nope || ''), nope);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
