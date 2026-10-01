/* #274 - step 8 of Euro Truck Simulator 2 support (#266): pay and tax.
 *
 *   - an ETS2 career is salaried: a monthly salary, paid every fourth Friday whether or not a load closed,
 *     pro-rated for a part month, never paid twice for the same day
 *   - a tax-free daily allowance for each day on the road, larger from an eastern carrier
 *   - the bonuses carry over: on-time and safety as monthly amounts, fuel as ever
 *   - one flat deduction for tax and social contributions, on everything but the allowance; no W-2
 *   - an ATS career is untouched
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
let odo = 100000;

async function at(day, hm = '06:00', city = 'Frankfurt am Main', cc = 'DE') {
  await api('/status', 'POST', { locationCity: city, locationState: cc, locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 100, atsOdometer: odo, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
}

/** One load, Frankfurt to Köln, delivered the same day. */
async function deliver(day) {
  await at(day);
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(day),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });
  const state = await api('/export');
  if ((state.restartOrders || []).some((o) => o.status !== 'Completed')) { state.restartOrders = []; await api('/import', 'POST', state); }
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'Shipper', receiver: 'Receiver',
    originCity: 'Frankfurt am Main', originState: 'DE', destCity: 'Köln', destState: 'DE', loadedMiles: 120, deadheadMiles: 0,
    gameRevenue: 2500, deadlineHours: 40, weightLbs: 30000, atLocation: true });
  const e = (await api('/board/evaluate')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: e.load.id, overrideTight: true })).trip;
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: iso(day, '07:00') });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'EndLoad', gameTime: iso(day, '08:00') });
  odo += 120;
  await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: iso(day, '12:00'), endOdometer: odo, actualMiles: 120,
    truckDamageAfter: 1, trailerDamageAfter: 1 });
  return { e, trip: ((await api('/export')).trips || []).find((t) => t.id === trip.id) };
}
const settlements = async () => (await api('/export')).settlements || [];

(async () => {
  const app = { driverName: 'K. Nowak', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(8) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('0. ATS is paid by the mile, as ever');
  ok('no salary on an ATS career', (await api('/bootstrap')).views.payroll.salary == null);

  const st = await api('/export');
  st.game = 'ETS2';
  st.settings.runnableStates = [];
  st.settlements = [];
  Object.assign(st.company.terminals[0], { city: 'Frankfurt am Main', state: 'DE', isHeadquarters: true });
  st.company.terminalState = 'DE';
  await api('/import', 'POST', st);

  head('1. An ETS2 career is salaried');
  let S = await api('/bootstrap');
  const sal = S.views.payroll.salary;
  const rate = S.driver.pay.loadedCpm;
  const monthly = Math.round(rate * 5000 / 10) * 10;
  ok('a monthly salary, from the career\'s rate', sal && sal.monthly === monthly, `${rate}/mi -> ${sal?.monthly}`);
  ok('a daily allowance from a western carrier', sal.dailyAllowance === 30, `${sal.dailyAllowance}`);
  ok('paid every fourth Friday: the first is day 26', S.views.payroll.nextPaydayDay === 26, `day ${S.views.payroll.nextPaydayDay}`);
  ok('detention is covered by the salary unless switched on', sal.detentionPaid === false);

  head('2. A load earns nothing by the mile');
  const a = await deliver(10);
  ok('the load\'s pay is nil: it is covered by the month', a.trip.pay.total === 0 && a.trip.pay.linehaulPay === 0, `${a.trip.pay.total}`);
  ok('and it says so', /Salaried: this load is covered by your monthly salary/.test(a.trip.pay.lines.join(' ')), a.trip.pay.lines[0]);
  ok('on the board it costs its wages: a day of salary and allowance', near(a.e.estimatedDriverPay, Math.round((monthly / 21.7 + 30) * 100) / 100, 0.05),
    `${a.e.estimatedDriverPay}`);
  await deliver(11);

  await at(12, '18:00');
  ok('a Friday that is not the fourth pays nothing', (await settlements()).length === 0);

  head('3. Payday: the salary for the part month, the allowance, the bonuses, one flat deduction');
  await at(26, '18:00');
  let all = await settlements();
  ok('the fourth Friday pays', all.length === 1, `${all.length}`);
  let p = all[0];
  const part = Math.round(monthly * 19 / 28 * 100) / 100;
  ok('salary for the 19 days since the hire on day 8', near(p.salary, part), `${p.salary} of ${monthly}`);
  ok('two days on the road, at the allowance', p.allowanceDays === 2 && p.allowances === 60, `${p.allowanceDays} days, ${p.allowances}`);
  const otc = S.driver.pay.onTimeBonusCpm;
  ok('the on-time bonus carries over, as a monthly amount', otc > 0 && p.onTimePct === 100
    && near(p.onTimeBonus, Math.round(Math.round(otc * 5000 / 10) * 10 * 19 / 28 * 100) / 100), `${p.onTimeBonus} at ${p.onTimePct}% on time`);
  ok('and the safety bonus, four weeks of it pro-rated', p.safetyBonus > 0, `${p.safetyBonus}`);
  ok('the fuel bonuses are assessed as ever', p.lines.some((l) => /fuel/i.test(l)), p.lines.find((l) => /fuel/i.test(l)));
  const b = p.stub;
  ok('one flat deduction, not US withholding', b.taxModel === 'Flat' && b.federal === 0 && b.socialSecurity === 0 && b.stateTax === 0, b.taxModel);
  ok('the allowance is tax-free', b.taxFree === 60 && near(b.taxableWages, p.gross - 60), `${b.taxFree} free, ${b.taxableWages} taxable`);
  ok('20% of the rest', near(b.flatTax, Math.round((p.gross - 60) * 0.2 * 100) / 100) && near(b.net, p.gross - b.flatTax), `${b.flatTax} off, ${b.net} net`);

  head('4. A salary is paid whether or not a load closed');
  await at(54, '18:00');
  all = await settlements();
  p = all[0];
  ok('a quiet month still pays: the whole salary', all.length === 2 && near(p.salary, monthly) && p.allowanceDays === 0, `${p.salary}`);

  head('5. No day is paid twice');
  await at(54, '21:00');
  await at(55, '09:00');
  ok('reporting the clock again on payday, and the day after, pays nothing more', (await settlements()).length === 2);
  await at(82, '18:00');
  all = await settlements();
  ok('the next payday pays its own four weeks, days 55 to 82', all.length === 3 && near(all[0].salary, monthly), `${all[0].salary}`);

  head('6. The allowance from an eastern carrier');
  const st2 = await api('/export');
  st2.company.terminalState = 'PL';
  Object.assign(st2.company.terminals[0], { city: 'Poznań', state: 'PL' });
  await api('/import', 'POST', st2);
  S = await api('/bootstrap');
  ok('a Polish carrier pays a larger allowance', S.views.payroll.salary.dailyAllowance === 50, `${S.views.payroll.salary.dailyAllowance}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
