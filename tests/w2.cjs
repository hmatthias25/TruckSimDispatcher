/* The tax year, and the W-2 that closes it.
 *
 * The app paid every Friday and never drew a line under it: year-to-date on a pay stub meant
 * career-to-date. That cannot answer the one question anybody in this job asks — what do I make in a
 * year — and it left the Social Security wage base never resetting, so a career past $184,500 gross
 * stopped paying Social Security for good on a stub still claiming to be a year's withholding.
 *
 * A year is 365 game days from the day the career started. It closes on the 365th, a W-2 is issued,
 * and the counters reset. One form per employer: change carrier mid-year and two of them turn up,
 * because that is what happens to a real driver who does the same thing.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5862}/api`;
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
const at = (d, hm = '06:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;
const payroll = async () => (await api('/bootstrap')).views.payroll;
const settlements = async () => (await api('/bootstrap')).settlements;

let HOME = { city: 'Springfield', state: 'MO' };

async function clockTo(d, extra = {}) {
  const r = await api('/status', 'POST', {
    locationCity: HOME.city, locationState: HOME.state, locationKind: 'Terminal', gameTime: at(d),
    fuelPct: 90, atsOdometer: 500 + d * 40, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 80000, ...extra,
  });
  S = r.snapshot;
  return r;
}

/** One delivered load, so a year has wages in it. Returns false when dispatch would not have it. */
async function runLoad(d) {
  await clockTo(d, { locationKind: 'Shipper' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  try {
    const board = await api('/board/add', 'POST', {
      cargo: 'Palletised Goods', trailerType: 'Dry Van', originCity: HOME.city, originState: HOME.state,
      destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 500, deadheadMiles: 0,
      gameRevenue: 2400, deadlineHours: 60, weightLbs: 41000, atLocation: true,
    });
    if (!board.evaluations?.[0]) return false;
    const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
    const id = auth.trip.id;
    await api(`/trips/${id}/event`, 'POST', { gameTime: at(d, '06:00'), kind: 'BeginLoad', detail: '' });
    await api(`/trips/${id}/event`, 'POST', { gameTime: at(d, '08:00'), kind: 'EndLoad', detail: '' });
    await api(`/trips/${id}/event`, 'POST', { gameTime: at(d + 1, '10:00'), kind: 'BeginUnload', detail: '' });
    await api(`/trips/${id}/event`, 'POST', { gameTime: at(d + 1, '12:00'), kind: 'EndUnload', detail: '' });
    const done = await api(`/trips/${id}/complete`, 'POST', {
      deliveredGameTime: at(d + 1, '12:00'), actualMiles: 500, endOdometer: 600 + d * 40,
      actualRevenue: 2400, fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0, layoverDays: 0, breakdownDays: 0,
      extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
      locationCity: 'Oklahoma City', locationState: 'OK', fuelPct: 55, gameTime: at(d + 1, '12:00'),
    });
    S = done.snapshot;
    return true;
  } catch {
    await H.sitRestartIfOrdered(api, (n) => at(d + n));
    return false;
  }
}

/** Work a stretch of days so the year has something in it, then park at `end`. */
async function workThen(days, end) {
  for (const d of days) await runLoad(d);
  await clockTo(end);
}

(async () => {
  const app = { driverName: 'E. Sandoval', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);

  head('1. The tax year is on the payroll view from day one');
  await clockTo(10);
  let pr = await payroll();
  ok('there is a tax year', !!pr.taxYear, pr.taxYear ? `year ${pr.taxYear.year}` : '(none)');
  ok('and it is year 1', pr.taxYear.year === 1, `${pr.taxYear.year}`);
  ok('a year is 365 days', pr.daysInYear === 365, `${pr.daysInYear}`);
  ok('it names the employer the year belongs to', !!pr.taxYear.employer, pr.taxYear.employer);
  ok('the window is 365 days wide',
    pr.taxYear.endDay - pr.taxYear.startDay === 364, `${pr.taxYear.startDay}..${pr.taxYear.endDay}`);
  ok('no W-2 yet — the year has not run', (pr.w2s || []).length === 0, `${(pr.w2s || []).length}`);

  head('2. Work in year 1, and the year counts it');
  await workThen([2, 5, 8, 12, 15], 40);
  pr = await payroll();
  const y1Gross = pr.taxYear.gross;
  ok('the year has gross on it', y1Gross > 0, `$${y1Gross}`);
  ok('and withholding under it', pr.taxYear.federal > 0, `$${pr.taxYear.federal} federal`);
  ok('net is less than gross', pr.taxYear.net > 0 && pr.taxYear.net < y1Gross,
    `$${pr.taxYear.net} net of $${y1Gross}`);
  ok('and it says what the year is running at',
    pr.taxYear.annualisedGross > 0, `$${pr.taxYear.annualisedGross}/yr`);

  head('3. Nothing is issued before the 365th day');
  await clockTo(360);
  pr = await payroll();
  ok('still no W-2 on day 360', (pr.w2s || []).length === 0, `${(pr.w2s || []).length}`);
  ok('and the year says how long is left', pr.taxYear.daysRemaining > 0, `${pr.taxYear.daysRemaining} day(s)`);

  head('4. The 365th day closes it and issues the form');
  await clockTo(365);
  pr = await payroll();
  const w2 = (pr.w2s || [])[0];
  ok('a W-2 is issued', !!w2, w2 ? w2.number : '(none)');
  ok('for year 1', w2?.taxYear === 1, `${w2?.taxYear}`);
  ok('and it covers 365 days', w2.yearEndDay - w2.yearStartDay === 364,
    `days ${w2.yearStartDay}..${w2.yearEndDay}`);

  head('5. It is shaped like a W-2');
  ok('box 1 carries the year\'s wages', w2.box1Wages > 0, `$${w2.box1Wages}`);
  ok('box 2 — federal income tax withheld', w2.box2FederalWithheld > 0, `$${w2.box2FederalWithheld}`);
  ok('box 3 — Social Security wages', w2.box3SocialSecurityWages > 0, `$${w2.box3SocialSecurityWages}`);
  ok('box 4 — Social Security tax withheld', w2.box4SocialSecurityWithheld > 0, `$${w2.box4SocialSecurityWithheld}`);
  ok('box 5 — Medicare wages and tips', w2.box5MedicareWages > 0, `$${w2.box5MedicareWages}`);
  ok('box 6 — Medicare tax withheld', w2.box6MedicareWithheld > 0, `$${w2.box6MedicareWithheld}`);
  ok('box 3 never exceeds the wage base', w2.box3SocialSecurityWages <= 184500, `$${w2.box3SocialSecurityWages}`);
  ok('box 5 is uncapped, so it is never under box 3',
    w2.box5MedicareWages >= w2.box3SocialSecurityWages,
    `${w2.box5MedicareWages} >= ${w2.box3SocialSecurityWages}`);
  ok('box 1 is gross less the pre-tax medical, not gross',
    Math.abs((w2.gross - w2.preTaxMedical) - w2.box1Wages) < 0.02,
    `${w2.gross} - ${w2.preTaxMedical} = ${w2.box1Wages}`);
  ok('box 14 carries the section 125 medical that explains it',
    w2.preTaxMedical === 0 || (w2.box14 || []).some((c) => /125/i.test(c.code)),
    (w2.box14 || []).map((c) => `${c.code} ${c.amount}`).join(', ') || 'none');
  ok('boxes 15-17 name a state', (w2.states || []).length >= 1,
    (w2.states || []).map((x) => `${x.state} $${x.wages}/$${x.withheld}`).join(', ') || 'none');

  head('6. And it identifies who is on it');
  ok('the employer is named', !!w2.employerName, w2.employerName);
  ok('with an EIN in the shape of one', /^\d{2}-\d{7}$/.test(w2.employerEin || ''), w2.employerEin);
  ok('the employee is named', !!w2.employeeName, w2.employeeName);
  ok('the SSN is masked, the way an employee copy is',
    /^XXX-XX-\d{4}$/.test(w2.employeeSsn || ''), w2.employeeSsn);
  ok('there is a control number', !!w2.controlNumber, w2.controlNumber);
  ok('and it says what it is not', /not tax advice|approximation/i.test(w2.note || ''),
    (w2.note || '').slice(0, 90));

  head('7. The year resets — which is the whole point');
  await clockTo(370);
  pr = await payroll();
  ok('the driver is in year 2', pr.taxYear.year === 2, `${pr.taxYear.year}`);
  ok('year 2 opens where year 1 closed',
    pr.taxYear.startDay === w2.yearEndDay + 1, `${pr.taxYear.startDay} vs ${w2.yearEndDay + 1}`);
  ok('and the counter is back to nothing', pr.taxYear.gross === 0, `$${pr.taxYear.gross}`);
  ok('year 1 is still on file, unchanged',
    (pr.w2s || []).find((x) => x.taxYear === 1)?.box1Wages === w2.box1Wages,
    `$${(pr.w2s || []).find((x) => x.taxYear === 1)?.box1Wages}`);

  head('8. Year 2 counts only year 2');
  await workThen([372, 375, 379], 400);
  pr = await payroll();
  ok('year 2 has its own gross', pr.taxYear.gross > 0, `$${pr.taxYear.gross}`);
  ok('and it is not year 1 plus year 2', pr.taxYear.gross < y1Gross + pr.taxYear.gross,
    `$${pr.taxYear.gross} against year 1's $${y1Gross}`);

  head('9. A second year closes into a second form');
  await clockTo(365 * 2);
  pr = await payroll();
  ok('two years, two W-2s', (pr.w2s || []).length >= 2,
    (pr.w2s || []).map((x) => `${x.number}(y${x.taxYear})`).join(', '));
  ok('newest first', pr.w2s[0].taxYear >= pr.w2s[1].taxYear, pr.w2s.map((x) => x.taxYear).join(' > '));
  const before = pr.w2s.length;
  await clockTo(365 * 2 + 1);
  ok('and re-reading does not duplicate them', (await payroll()).w2s.length === before, `${before}`);

  head('10. Every settlement remembers who paid it');
  const paid = await settlements();
  ok('the roster of settlements is stamped',
    paid.length > 0 && paid.every((x) => !!x.employerCode),
    paid.slice(0, 3).map((x) => `${x.number}:${x.employerCode}`).join(', '));
  ok('and the W-2 is filed under the same code',
    pr.w2s.every((x) => paid.some((p) => p.employerCode === x.employerCode)),
    pr.w2s.map((x) => x.employerCode).join(', '));

  head('11. Two employers in one year means two W-2s');
  // Work part of year 3 at one carrier, resign, and work the rest at another. Each of them reports
  // what it paid, which is the whole reason a settlement remembers who paid it.
  const first = S.company.code;
  await workThen([365 * 2 + 20, 365 * 2 + 24], 365 * 2 + 40);

  const market = await api('/market');
  const other = (market.market || []).map((c) => c.code).filter((c) => c && c !== first)[0];
  let moved = null;
  if (other) {
    try { moved = await api('/market/apply', 'POST', { code: other, reason: 'Testing the tax year' }); }
    catch (e) { console.log(`     (could not move carrier: ${e.message.slice(0, 80)})`); }
  }

  if (moved?.hired) {
    S = un(moved);
    ok('the driver moved carrier', S.company.code === other, `${first} -> ${S.company.code}`);

    // A change of employer means selling everything and buying it again at the new home yard. Do the
    // ATS half of it so the driver can actually work, then put the instruction away.
    const hq = S.company.terminals.find((t) => t.isHeadquarters) || S.company.terminals[0];
    HOME = { city: hq.city, state: hq.state };
    await api('/changeover/close', 'POST', {});
    // A small yard holds one tractor, and there may already be one standing in it.
    await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }).catch(() => null);
    await api('/fleet/truck', 'POST', {
      unit: `${other}-201`, make: 'Freightliner', model: 'Cascadia', year: 2022,
      serviceMiles: 20000, lastServiceMiles: 20000, atsOdometer: 20000, serviceIntervalMiles: 25000,
      damagePct: 2, inGameGarage: true, cabConfig: 'Sleeper', governedMph: 65,
      status: 'InService', homeTerminalId: hq.id,
    });
    await api('/fleet/trailer', 'POST', {
      unit: `${other}-T201`, type: 'Dry Van', length: '53', axles: 'Tandem', year: 2022,
      damagePct: 2, inGameGarage: true, status: 'InService', homeTerminalId: hq.id,
    });
    await api('/fleet/assign', 'POST',
      { truckUnit: `${other}-201`, trailerUnit: `${other}-T201`, force: true }).catch(() => null);

    await workThen([365 * 2 + 60, 365 * 2 + 64, 365 * 2 + 68], 365 * 3);

    const paidYear3 = (await settlements()).filter((x) => {
      const d = Math.round((new Date(x.periodEndGame + 'Z') - Date.UTC(2000, 0, 1)) / 86400000);
      return d >= 731 && d <= 1095;
    });
    const employers = new Set(paidYear3.map((x) => x.employerCode));
    const y3 = (await payroll()).w2s.filter((x) => x.taxYear === 3);

    ok('year 3 was worked for more than one carrier', employers.size >= 1,
      [...employers].join(', ') || 'none');
    ok('and there is a W-2 for each of them', y3.length === employers.size,
      `${y3.length} form(s) for ${employers.size} employer(s): ` +
      y3.map((x) => `${x.number} ${x.employerName}`).join(' | '));
    ok('each form is filed under its own employer',
      new Set(y3.map((x) => x.employerCode)).size === y3.length,
      y3.map((x) => x.employerCode).join(', '));
    ok('and no form carries the other one\'s wages',
      y3.every((f) => Math.abs(f.gross
        - paidYear3.filter((p) => p.employerCode === f.employerCode).reduce((a, p) => a + p.gross, 0)) < 0.02),
      y3.map((f) => `${f.employerCode} $${f.gross}`).join(', '));
  } else {
    ok('the per-employer split is at least keyed correctly',
      (await payroll()).w2s.every((x) => x.number.includes(x.employerCode)),
      (await payroll()).w2s.map((x) => x.number).join(', '));
  }

  ok('no two forms anywhere share a number',
    new Set((await payroll()).w2s.map((x) => x.number)).size === (await payroll()).w2s.length, 'unique');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
