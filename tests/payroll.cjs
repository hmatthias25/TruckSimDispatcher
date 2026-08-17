/* Issues #10, #12, #13, #14, #16: learned dock time, arrival brief, Friday payday, pay stubs,
   and the out-of-hours board. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5455}/api`;
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
const day = (n, hhmm = '06:00') => `2000-01-${String(n).padStart(2, '0')}T${hhmm}`;

let S;
async function status(d, extra = {}) {
  const r = await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: day(d),
    fuelPct: 90, atsOdometer: 500, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 50000, ...extra,
  });
  S = r.snapshot;
  return r;
}

/* One reefer load with a real 3.5 h load and 3.5 h unload logged. */
async function reeferLoad(d) {
  await status(d, { locationKind: 'Shipper' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Frozen Foods', trailerType: 'Reefer', originCity: 'Springfield', originState: 'MO',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 500, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 41000, atLocation: true,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  const id = auth.trip.id;
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(d, '06:00'), kind: 'BeginLoad', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(d, '09:30'), kind: 'EndLoad', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(d + 1, '10:00'), kind: 'BeginUnload', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(d + 1, '13:30'), kind: 'EndUnload', detail: '' });
  const done = await api(`/trips/${id}/complete`, 'POST', {
    deliveredGameTime: day(d + 1, '13:30'), actualMiles: 500, endOdometer: 500 + d * 10,
    actualRevenue: 2400, fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Oklahoma City', locationState: 'OK', fuelPct: 55, gameTime: day(d + 1, '13:30'),
  });
  S = done.snapshot;
  return done;
}

(async () => {
  const app = { driverName: 'Pay Tester', preferredDivision: 'Reefer', transmissionPreference: 'manual',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1), code: 'PRI' }));

  head('#13 Day 1 is Monday, so Fridays are 5, 12, 19');
  ok('next payday from day 1 is day 5', S.views.payroll.nextPaydayDay === 5, `${S.views.payroll.nextPaydayDay}`);

  head('#10 Dock time starts at a reefer-shaped estimate, not 1 hour');
  let ft = S.views.facilityTimes.find((f) => f.trailerType === 'Reefer');
  ok('reefer seeded at 3 h, not 1', ft.loadingHours === 3, `${ft.loadingHours} h`);
  ok('no samples yet', ft.samples === 0);
  const van = S.views.facilityTimes.find((f) => f.trailerType === 'Dry Van');
  ok('a flatbed is not the same as a reefer',
    S.views.facilityTimes.find((f) => f.trailerType === 'Flatbed').loadingHours < ft.loadingHours,
    `flatbed ${S.views.facilityTimes.find((f) => f.trailerType === 'Flatbed').loadingHours} h vs reefer ${ft.loadingHours} h`);

  head('#10 It learns from real dock times');
  let done = await reeferLoad(1);
  ft = S.views.facilityTimes.find((f) => f.trailerType === 'Reefer');
  ok('sample recorded', ft.samples === 1, `${ft.samples}`);
  ok('moved toward the measured 3.5 h', ft.loadingHours > 3, `${ft.loadingHours} h`);
  ok('audit says the figure moved', done.audit.serviceFindings.some((x) => /Dock time for reefer updated/.test(x)),
    done.audit.serviceFindings.find((x) => /Dock time/.test(x)) || '(none)');

  for (const d of [3, 5, 7, 9]) await reeferLoad(d);
  ft = S.views.facilityTimes.find((f) => f.trailerType === 'Reefer');
  ok('converges on the truth after a few loads', Math.abs(ft.loadingHours - 3.5) < 0.2,
    `${ft.loadingHours} h after ${ft.samples} loads (actual 3.5)`);
  ok('flatbed untouched by reefer loads',
    S.views.facilityTimes.find((f) => f.trailerType === 'Flatbed').samples === 0);

  head('#13 Crossing into Friday paid, without anyone asking');
  // Day 5 was crossed while running the loads above — which is the point: nobody pressed anything.
  ok('a settlement exists already', S.settlements.length >= 1, `${S.settlements.length}`);
  const st = S.settlements[S.settlements.length - 1];
  ok('marked as a payday', st.trigger === 'Payday', st.trigger);
  ok('notes name the day', /Friday, Day 5/.test(st.notes), st.notes);

  head('#14 The stub takes tax out');
  const stub = st.stub;
  ok('a stub exists', !!stub);
  console.log(`     gross ${stub.gross}  medical -${stub.medical}  taxable ${stub.taxableWages}`);
  console.log(`     fed -${stub.federal}  SS -${stub.socialSecurity}  medicare -${stub.medicare}  ${stub.stateCode} -${stub.stateTax}`);
  console.log(`     NET ${stub.net}`);
  ok('medical is pre-tax', Math.abs(stub.taxableWages - (stub.gross - stub.medical)) < 0.01);
  ok('medical defaults to 60', stub.medical === 60, `${stub.medical}`);
  ok('social security is 6.2% of taxable',
    Math.abs(stub.socialSecurity - stub.taxableWages * 0.062) < 0.02, `${stub.socialSecurity}`);
  ok('medicare is 1.45% of taxable',
    Math.abs(stub.medicare - stub.taxableWages * 0.0145) < 0.02, `${stub.medicare}`);
  ok('state is Missouri, the home terminal', stub.stateCode === 'MO', stub.stateCode);
  ok('Missouri does tax wages', stub.stateHasTax === true && stub.stateTax > 0, `${stub.stateTax}`);
  ok('federal was withheld', stub.federal > 0, `${stub.federal}`);
  ok('net is gross less medical and taxes',
    Math.abs(stub.net - (stub.gross - stub.medical - stub.totalTaxes)) < 0.01, `${stub.net}`);
  ok('net is less than gross', stub.net < stub.gross);
  ok('ytd carried', stub.ytdGross >= stub.gross, `${stub.ytdGross}`);

  head('#13 A Friday is never paid twice');
  const again = await status(5, { locationKind: 'Terminal' });
  ok('no second settlement', (again.paid || []).length === 0);

  head('#13 Jumping the clock walks the Fridays in order');
  await reeferLoad(6);
  await reeferLoad(8);
  const jump = await status(20);
  // Two Fridays (12 and 19) are crossed, but there is only one period of unsettled pay — a quiet
  // week produces no stub rather than an empty one.
  ok('paid once, for the first Friday owed', (jump.paid || []).length === 1,
    `${(jump.paid || []).length}: ${(jump.paid || []).map((p) => p.notes).join(' | ')}`);
  ok('and it was Day 12, not Day 19', /Day 12/.test((jump.paid || [])[0]?.notes || ''),
    (jump.paid || [])[0]?.notes);
  const after = await status(21);
  ok('no phantom settlement for the quiet week', (after.paid || []).length === 0);

  head('#13 The manual button is gone');
  let refused = null;
  try { await api('/settlements/run', 'POST', { notes: 'give me money' }); } catch (e) { refused = e.message; }
  ok('refused with an explanation', /run themselves/.test(refused || ''), refused);

  head('#16 Out of hours is not a bad board');
  await api('/board/clear', 'POST', {});
  await status(22, { locationKind: 'TruckStop' });
  await api('/hos', 'POST', { driveRemaining: 0.5, shiftRemaining: 0.5, breakRemaining: 0.5, cycleRemaining: 40 });
  let dec = await api('/board/add', 'POST', {
    cargo: 'Frozen Foods', trailerType: 'Reefer', originCity: 'Springfield', originState: 'MO',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 500, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 20, weightLbs: 41000, atLocation: true,
  });
  ok('flagged as out of hours', dec.outOfHours === true, dec.headline);
  ok('not a restart, just a rest', dec.needsRestart === false);
  ok('tells them to take the 10-hour reset', /10\.?0? ?-?hour reset|take the 10/.test(dec.rationale) || /reset/.test(dec.rationale), dec.rationale);
  ok('warns the cycle is not restored', /not the cycle/.test(dec.rationale), dec.rationale);
  ok('board was cleared', (await api('/bootstrap')).board.length === 0);

  head('#16 Out of cycle needs the 34');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 1 });
  dec = await api('/board/add', 'POST', {
    cargo: 'Frozen Foods', trailerType: 'Reefer', originCity: 'Springfield', originState: 'MO',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 500, deadheadMiles: 0,
    gameRevenue: 2400, deadlineHours: 60, weightLbs: 41000, atLocation: true,
  });
  ok('flagged out of hours', dec.outOfHours === true, dec.headline);
  ok('restart required', dec.needsRestart === true);
  ok('says a normal rest will not fix it', /will not fix this/.test(dec.rationale), dec.rationale);
  ok('board cleared again', (await api('/bootstrap')).board.length === 0);

  head('#16 A merely bad board is still a normal rejection');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  // Plenty of hours, but the freight loses money on any cost model.
  dec = await api('/board/add', 'POST', {
    cargo: 'Scrap', trailerType: 'Reefer', originCity: 'Springfield', originState: 'MO',
    destCity: 'Joplin', destState: 'MO', loadedMiles: 400, deadheadMiles: 0,
    gameRevenue: 25, deadlineHours: 40, weightLbs: 10000, atLocation: true,
  });
  ok('rejected but NOT as out of hours', dec.rejectAll === true && !dec.outOfHours,
    `rejectAll=${dec.rejectAll} outOfHours=${dec.outOfHours} — ${dec.headline}`);
  ok('board kept for a normal rejection', (await api('/bootstrap')).board.length === 1);

  head('#14 A no-tax state shows a zero line, not a missing one');
  // Fresh career domiciled in Texas — Trimac is headquartered in Houston.
  await api('/reset', 'POST', { confirm: 'RESET', resetSettings: false });
  const tx = { driverName: 'TX Tester', preferredDivision: 'Tanker', transmissionPreference: 'automatic',
    experienceYears: 8, homeCity: 'Houston', homeState: 'TX', acceptsProbation: true,
    homeTimePreference: 'biweekly', hasTanker: true, hasHazmat: true };
  await api('/onboarding/market', 'POST', tx);
  S = un(await api('/onboarding/hire', 'POST', { application: tx, force: true, gameTime: day(1), code: 'TRI' }));
  ok('domiciled in Texas', S.views.payroll.stateCode === 'TX',
    `${S.views.payroll.stateCode} (${S.company.terminals[0].city})`);
  ok('Texas withholds no wage tax', S.views.payroll.stateRate === 0, `${S.views.payroll.stateRate}`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(2); });
