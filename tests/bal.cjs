/* Issue #1: reporting status without touching the bank box must not create a phantom $0 mismatch. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5344}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 200));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const app = { driverName: 'Bal Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));

  head('Fresh career: nothing reported');
  ok('hasReportedBalance false', S.views.position.hasReportedBalance === false);
  ok('inSync true (nothing to compare)', S.views.position.inSync === true);
  ok('note asks for it', /No ATS balance reported yet/.test(S.views.position.note), S.views.position.note);

  head('Report status WITHOUT the bank field, the way an untouched box now sends it');
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal',
    gameTime: '2000-01-01T06:00', fuelPct: 100, atsOdometer: 0,
    truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty',
    atsBankBalance: null,
  }));
  ok('STILL unreported (the bug)', S.views.position.hasReportedBalance === false,
    `reported=${S.views.position.hasReportedBalance} balance=${S.views.position.atsBankBalance}`);
  ok('no phantom mismatch warning', S.views.position.inSync === true, S.views.position.note);

  head('Run a load so the books hold real money');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 500, deadheadMiles: 0,
    gameRevenue: 2200, deadlineHours: 40, weightLbs: 40000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: '2000-01-02T10:00', actualMiles: 505, endOdometer: 505, actualRevenue: 2200,
    fuelStops: [{ gallons: 80, pricePerGal: 4.0, city: 'Grand Junction', state: 'CO' }],
    tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 1, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Salt Lake City', locationState: 'UT', fuelPct: 60, gameTime: '2000-01-02T10:00',
  });
  S = done.snapshot;
  const cash = S.views.position.ledgerCash;
  ok('books now hold money', cash !== 0, `ledger cash ${cash}`);
  ok('still no mismatch warning while unreported', S.views.position.inSync === true, S.views.position.note);

  head('Report the balance from the Finances tab');
  S = await api('/finance/balance', 'POST', { balance: 25000, gameTime: null });
  ok('now reported', S.views.position.hasReportedBalance === true);
  ok('balance stored', S.views.position.atsBankBalance === 25000, `${S.views.position.atsBankBalance}`);
  ok('timestamp stamped', !!S.views.position.balanceReportedAt, S.views.position.balanceReportedAt);
  ok('variance computed against the books', Math.abs(S.views.position.variance - (25000 - cash)) < 0.01,
    `variance ${S.views.position.variance}`);

  head('A genuine zero IS a real reading');
  S = await api('/finance/balance', 'POST', { balance: 0, gameTime: null });
  ok('reported zero counts as reported', S.views.position.hasReportedBalance === true,
    `reported=${S.views.position.hasReportedBalance}`);
  ok('and it does flag a mismatch', S.views.position.inSync === false, S.views.position.note);

  head('Clearing goes back to unreported');
  S = await api('/finance/balance', 'POST', { balance: null, gameTime: null });
  ok('unreported again', S.views.position.hasReportedBalance === false);
  ok('warning gone', S.views.position.inSync === true, S.views.position.note);

  head('Migration: a career carrying the phantom stamp is healed on load');
  console.log('  (checked separately against the live career file)');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(2); });
