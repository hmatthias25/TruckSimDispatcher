/* Issues #64 and #68 (part one) — reviews the driver actually hears about.
 *
 * A probation review was being written to the file and nowhere else, so a driver could report in, be
 * reviewed, and drive away not knowing. And clearing probation ended the reviewing entirely, which is
 * not how a company works: it stops looking closely, it does not stop looking.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
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
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 70000;

/** Report in somewhere. Returns the whole status response, which carries the arrival brief. */
async function report(city, st, day, kind = 'TruckStop') {
  odo += 120;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day, '09:00'),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  S = un(r);
  return r;
}

/** Out on the road, then back at the yard — home time only counts on arriving. */
async function goHome(day) {
  await report('Amarillo', 'TX', day - 1);
  return report('Denver', 'CO', day, 'Terminal');
}

(async () => {
  const app = { driverName: 'R. View', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));

  head('64. A probation review is put in front of the driver');
  let r = await goHome(20);
  ok('going home produced a brief', !!r.homeBrief, `wentHome=${r.wentHome}`);
  const pr = r.homeBrief?.review;
  ok('and the brief carries the review that was just filed', !!pr,
    pr ? `${pr.number} ${pr.verdict ?? pr.clearedProbation}` : '(none)');
  if (pr) {
    ok('it has a verdict', !!(pr.verdict || 'clearedProbation' in pr), `${pr.verdict}`);
    ok('it says what the period was', pr.daysCovered > 0, `${pr.daysCovered} days`);
    ok('and it is on file as well as in the brief',
      ((await api('/bootstrap')).views.probation?.reviews || []).some((x) => x.number === pr.number),
      'stored');
  }

  head('64b. No review filed means nothing claimed');
  // Straight back out and in again: too soon for another, so the brief must not show a stale one.
  r = await goHome(22);
  ok('a second arrival days later files nothing', !r.homeBrief?.review,
    r.homeBrief?.review ? `showed ${r.homeBrief.review.number}` : 'nothing shown');

  head('68. Off probation, the reviewing carries on');
  await api('/career/clear-probation', 'POST', { force: true, note: 'test fixture' });
  S = un(await api('/bootstrap'));
  ok('probation is behind them', S.driver.rank !== 'probationary', S.driver.rank);

  // Nothing due yet.
  r = await goHome(30);
  ok('no periodic review this soon', !r.homeBrief?.review,
    r.homeBrief?.review ? r.homeBrief.review.number : 'none');

  head('68b. Notice comes before the review');
  await report('Amarillo', 'TX', 85);
  let v = (await api('/bootstrap')).views;
  ok('the driver is told one is waiting', !!v.reviewNotice, v.reviewNotice || '(none)');
  ok('and it says where', /Denver|the yard/i.test(v.reviewNotice || ''), v.reviewNotice);

  head('68c. It happens at the yard, not on the road');
  r = await report('Amarillo', 'TX', 86);
  ok('reporting from the road files nothing', !r.homeBrief, 'no brief away from the yard');
  r = await goHome(88);
  const per = r.homeBrief?.review;
  ok('reporting in at the yard files it', !!per, per ? per.number : '(none)');
  if (per) {
    ok('it covers the period since probation cleared', per.daysCovered >= 55, `${per.daysCovered} days`);
    ok('it has a verdict', ['Pass', 'Fail', 'Terminated'].includes(per.verdict), per.verdict);
    ok('and always says what happens now', !!per.whatNext, per.whatNext);
    ok('a thin period is not a pass', per.verdict !== 'Pass' || per.loadsDelivered >= 8,
      `${per.verdict} on ${per.loadsDelivered} load(s)`);
  }

  head('68d. A bad review warns before it bites');
  ok('the first bad one carries no termination', r.homeBrief?.terminated !== true,
    `terminated=${r.homeBrief?.terminated}`);
  if (per && per.verdict === 'Fail') {
    ok('it either warns or says put it right', !!per.warningIssued || /next one/i.test(per.whatNext),
      `${per.warningIssued || per.whatNext}`);
  } else {
    ok('the period passed, so nothing to warn about', true, per?.verdict);
  }

  head('68e. Two bad ones in a row end it');
  r = await goHome(150);
  const per2 = r.homeBrief?.review;
  ok('a second periodic review is filed', !!per2, per2 ? `${per2.number} ${per2.verdict}` : '(none)');
  if (per2 && per2.verdict === 'Terminated') {
    ok('it ends the job', r.homeBrief.terminated === true, `${r.homeBrief.terminated}`);
    ok('and says the last one was the warning', /told last time/i.test(per2.whatNext), per2.whatNext);
  } else {
    ok('not terminated, and it says why it stands where it does', !!per2?.whatNext,
      `${per2?.verdict}: ${per2?.whatNext}`);
  }

  head('68f. Reviews are kept, not just announced');
  const kept = (await api('/bootstrap')).views.periodicReviews || [];
  ok('every periodic review is on file', kept.length >= 2, `${kept.length}`);
  ok('newest first', kept.length < 2 || kept[0].reviewNumber > kept[1].reviewNumber,
    kept.map((x) => x.reviewNumber).join(', '));

  head('68g. A termination lands the driver at a second-chance carrier');
  S = un(await api('/bootstrap'));
  ok('the driver was let go for the work', S.driver.terminatedForCause === true,
    `${S.driver.terminatedForCause}`);
  ok('and it says why', !!S.driver.terminationReason, (S.driver.terminationReason || '').slice(0, 110));
  ok('rank reflects it', S.driver.rank === 'terminated', S.driver.rank);

  const mkt = (await api('/market')).market;
  ok('there is somewhere to go', mkt.length > 0, `${mkt.length} listing(s)`);
  ok('and every carrier on offer is a second-chance outfit',
    mkt.every((c) => /Rampart|Crossroads/.test(c.name)), mkt.map((c) => c.name).join(', '));
  ok('none of them is a real company', mkt.every((c) => c.isRealCompany === false),
    mkt.map((c) => `${c.name}:${c.isRealCompany}`).join(' '));
  ok('the pay is visibly worse', mkt.every((c) => c.loadedCpm < 0.40),
    mkt.map((c) => `${c.code} $${c.loadedCpm}`).join(', '));
  ok('and they will take anyone', mkt.every((c) => c.takesRookies === true), 'takes rookies');

  head('68h. The way back is stated, and not yet earned');
  const sc = (await api('/bootstrap')).views.secondChance;
  ok('the app knows this applies', sc.applies === true, `${sc.applies}`);
  ok('it is not earned on day one', sc.progress.earned === false, `${sc.progress.earned}`);
  ok('and it says what is still needed', !!sc.progress.summary, sc.progress.summary.slice(0, 160));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
