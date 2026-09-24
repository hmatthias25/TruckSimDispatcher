/* What a rung costs, and what carries across a job change.
 *
 *   "I don't want it too easy to get to 'master driver'. Company driver should be most common and last
 *    for a bit as that is what most drivers are."
 *
 *   "There should be some consideration here — if you go to a different job you shouldn't start from
 *    0 miles/loads again."
 *
 * Two separate things, and the second is why the first was safe to do.
 *
 * The ladder gated on loads AND miles, but the mileage figures were low enough that loads always ran
 * out first — thirty-five loads and thirty thousand miles for Senior, when a load on this map averages
 * five or six hundred. Meeting the loads meant the miles were long since behind you, so every promotion
 * was really a load count and the whole ladder fitted inside a few hundred deliveries. Miles now bite:
 * a hundred and ten thousand for Senior, three hundred and forty for Master.
 *
 * Which would have been cruel on its own, because taking a job somewhere else clears the trip list and
 * the ladder read nothing but the trip list. Every job change put a veteran back on ten loads and six
 * thousand miles. The totals were already kept on the driver's file for the hiring screens, which have
 * always read them. The promotion ladder did not.
 *
 * And the hired-driver ladder re-derived its grade from scratch every report, so raising the standard
 * would have demoted half a fleet — a Senior told they were a Company Driver again for doing nothing
 * but keep driving. Settle has always DOCUMENTED that a grade is never taken away by time and that
 * preventables are the only gate that runs backwards. It did not do it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

// Requirement rows carry formatted strings, not numbers.
const row = (list, label) => (list || []).find((r) => new RegExp(label, 'i').test(r.label));
const num = (s) => Number(String(s ?? '').replace(/[^0-9.\-]/g, ''));
const doss = (fo, name) => {
  const d = (fo.drivers || []).find((x) => x.name === name);
  return { d, z: (fo.dossiers || []).find((x) => x.id === d?.id) };
};

let S, yardId;

(async () => {
  const app = { driverName: 'R. Okonjo', preferredDivision: 'Dry Van', experienceYears: 6,
    homeCity: 'Dallas', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;

  head('1. The miles are the gate that bites');
  // The point of the change. Under the old figures, a driver with enough loads for a rung had
  // comfortably more miles than it asked for, so the mileage column never refused anybody anything.
  let st = await api('/export');
  st.driver.rank = 'company';
  st.driver.rankTitle = 'Company Driver';
  st.driver.priorLoads = 40;       // more loads than Senior asks for...
  st.driver.priorMiles = 24_000;   // ...and nowhere near the miles
  st.driver.probation = { ...st.driver.probation, active: false };
  await api('/import', 'POST', st);

  let rev = await api('/career');
  const loads = () => row(rev.nextRankProgress, 'loads');
  const miles = () => row(rev.nextRankProgress, 'mile');
  ok('the next rung up is Senior', rev.nextRank === 'senior', rev.nextRankTitle || rev.nextRank);
  ok('the loads are met', loads()?.met === true, `${loads()?.current} / ${loads()?.required}`);
  ok('and the miles are what is holding them', miles()?.met === false,
    `${miles()?.current} / ${miles()?.required}`);
  ok('Senior asks six figures of miles', num(miles()?.required) >= 100_000, miles()?.required);
  ok('so the promotion has not landed', rev.nextRankMet === false, String(rev.nextRankMet));

  head('2. A job change does not put the promotion clock back to nought');
  // The bug. The ladder read the trip list and nothing else, and a job change clears the trip list.
  // Below is a driver with 210 loads and 130,000 miles behind them and an empty one in front.
  st = await api('/export');
  st.trips = [];
  st.driver.priorLoads = 210;
  st.driver.priorMiles = 130_000;
  await api('/import', 'POST', st);

  rev = await api('/career');
  ok('the trip list is genuinely empty', (await api('/export')).trips.length === 0, 'no trips here');
  ok('the loads still count', num(loads()?.current) >= 210, loads()?.current);
  ok('the miles still count', num(miles()?.current) >= 130_000, miles()?.current);
  ok('and the rung is earned on the whole record', rev.nextRankMet === true,
    (rev.nextRankProgress || []).filter((r) => !r.met).map((r) => r.label).join(', ') || 'all met');
  ok('the line is labelled career miles rather than company miles',
    /career mile/i.test(miles()?.label || ''), miles()?.label);

  head('3. Probation is still served here, not carried in');
  // Deliberately the other way round. A rung is what somebody has made of a career; probation is a
  // trial with THIS carrier, and previous miles are not a reason to skip it.
  st = await api('/export');
  st.trips = [];
  st.driver.priorLoads = 600;
  st.driver.priorMiles = 400_000;
  st.driver.probation = { ...st.driver.probation, active: true, requiredLoads: 8, requiredMiles: 4_000 };
  await api('/import', 'POST', st);
  rev = await api('/career');
  const pLoads = row(rev.probationProgress, 'loads');
  ok('probation counts only what they have done here', num(pLoads?.current) === 0,
    `${pLoads?.current} load(s)`);
  ok('so it is not served on arrival', rev.probationMet === false, String(rev.probationMet));

  head('4. Raising the standard does not demote a hired driver who already earned the rung');
  // Days and miles only ever go up, so nothing a driver DOES can cost them a rung on those gates. The
  // only way to fail one you have passed is for the gate to move, and that is the company's doing.
  st = await api('/export');
  st.driver.probation = { ...st.driver.probation, active: false };
  st.status.gameTime = iso(700);   // well past the 540 days Senior asks for
  await api('/import', 'POST', st);
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));
  await api('/fleet/truck', 'POST', {
    unit: 'P-1', make: 'Kenworth', model: 'W900', year: 2021, atsOdometer: 300_000,
    serviceMiles: 300_000, lastServiceMiles: 295_000, serviceIntervalMiles: 25_000,
    damagePct: 2, inGameGarage: true, homeTerminalId: yardId,
  });
  const created = (await api('/fleetops/drivers', 'POST', {
    name: 'T. Vargas', status: 'Active', assignedTruckUnit: 'P-1', skill: 'Experienced',
    homeTerminalId: yardId, hiredGameDate: iso(2), level: 12, lifetimeMiles: 45_000,
  })).driver.id;

  // A fixed id, because a driver can QUIT on the report this suite depends on.
  //
  // Resignation is rolled per driver per report as Hash("<id>|quit|<report number>") % 1000 against a
  // chance that is clamped to at most 200 — never certain, never impossible. The id is a fresh GUID at
  // hire, so that roll came out differently every run: roughly one run in six, T. Vargas handed their
  // notice in on the second report, SettleGrades skips anybody who is not Active, and the grade this
  // suite is about was simply never recalculated. It read as "conduct does not pull the grade down",
  // which is not what had happened at all.
  //
  // This id rolls 876 and 733 for the two reports the suite files, both far above the 200 ceiling, so
  // the roll cannot fire whatever the chance is tuned to. Section 5 also asserts they are still on the
  // books, so if that ever stops holding the failure says so instead of blaming the ladder.
  const vid = 'vargas-fixture-0007';
  // Settled as a Senior under the old numbers — the tenure is there, the mileage no longer is. Set on
  // the record rather than at hire, because every hire starts probationary whatever they walked in as.
  st = await api('/export');
  const vargas = st.hiredDrivers.find((x) => x.id === created);
  vargas.id = vid;
  vargas.grade = 2;
  vargas.wageShare = 0.31;
  await api('/import', 'POST', st);

  let fo = await api('/fleetops');
  let v = doss(fo, 'T. Vargas');
  ok('they are short of the new mileage standard', v.d.lifetimeMiles < 110_000,
    `${v.d.lifetimeMiles} mi`);
  ok('nothing is pending against them', !v.z.duePromotion, v.z.dueRank || 'nothing due');

  // Settling is what a report does, so filing one is the moment a demotion would land.
  await api('/fleetops/report', 'POST', {
    periodStartGame: iso(686), periodEndGame: iso(700),
    lines: [{ driverId: vid, level: 12, perMile: 1.90, perDay: 620,
              truckStars: 5, truckOdometer: 302_000 }],
  });
  fo = await api('/fleetops');
  v = doss(fo, 'T. Vargas');
  ok('after a report they are still a Senior', v.d.grade === 2, `grade ${v.d.grade} — ${v.z.rank}`);
  ok('and still on the Senior share', Math.abs(v.d.wageShare - 0.31) < 0.001, `${v.d.wageShare}`);

  head('5. A preventable still costs the rung, which is the one drop the ladder makes');
  // The exception the guard is built around: it holds a grade against a gate that moved, not against a
  // driver whose driving has gone off. Senior carries three preventables; this is four.
  st = await api('/export');
  const rep = st.fleetReports[0];
  rep.conduct = [1, 2, 3, 4].map((n) => ({
    driverId: vid, driverName: 'T. Vargas', severity: 'Serious',
    outcome: 'At fault', truckUnit: 'P-1', damagePct: 20,
    reportNumber: rep.number, gameTime: iso(690 + n),
  }));
  await api('/import', 'POST', st);
  fo = await api('/fleetops');
  v = doss(fo, 'T. Vargas');
  ok('the recent preventables are on the file', v.z.recentPreventables >= 4,
    `${v.z.recentPreventables} in the window`);

  await api('/fleetops/report', 'POST', {
    periodStartGame: iso(700), periodEndGame: iso(714),
    lines: [{ driverId: vid, level: 12, perMile: 1.90, perDay: 620,
              truckStars: 5, truckOdometer: 304_000 }],
  });
  fo = await api('/fleetops');
  v = doss(fo, 'T. Vargas');
  // Before the grade: a driver who has quit is not settled at all, so a resignation here would fail the
  // next assertion for a reason that has nothing to do with conduct. Named, so it cannot be mistaken.
  ok('they are still on the books to be graded', v.d.status === 'Active',
    `status ${v.d.status}`);
  ok('conduct does pull the grade back down', v.d.grade < 2, `grade ${v.d.grade} — ${v.z.rank}`);

  head('6. The two ladders ask the same mileage of both sides of the desk');
  // Stated in the manual and worth holding to: a company demanding more of its hired drivers than of
  // the player would be telling two stories about one job.
  st = await api('/export');
  st.trips = [];
  st.driver.rank = 'company';
  st.driver.priorLoads = 40;
  st.driver.priorMiles = 0;
  st.driver.probation = { ...st.driver.probation, active: false };
  await api('/import', 'POST', st);
  rev = await api('/career');
  ok('the player needs 110,000 for Senior too', num(miles()?.required) === 110_000, miles()?.required);

  head('7. A preventable ages off, which only shows past the twelfth report');
  // The window is "the last twelve reports". FleetReports is newest-first, so that is the FIRST twelve
  // of the list — and this read `.Reverse().Take(12)`, which is the twelve OLDEST reports in the career.
  // On a fleet that had filed more than twelve, a preventable from the first fortnight counted against a
  // driver for ever while last month's did not count at all. Settle promises the rung "comes back the
  // moment the preventables age off", and nothing ever aged off.
  //
  // Invisible below thirteen reports, because there the two sets are the same — which is why the rest of
  // this suite never saw it.
  st = await api('/export');
  const old = { id: 'w1', number: 'SFL-FR-9001', periodStartGame: iso(10), periodEndGame: iso(24),
    lines: [], findings: [], instructions: [], personnel: [],
    conduct: [{ driverId: 'ages-off', driverName: 'A. Ager', severity: 'Serious',
                outcome: 'At fault', truckUnit: 'P-9', damagePct: 20,
                reportNumber: 'SFL-FR-9001', gameTime: iso(12) }] };
  // Newest first, so the offending report goes on the END: it is the oldest thing on the books.
  const filler = [];
  for (let i = 0; i < 14; i++) {
    filler.push({ id: `w${i + 2}`, number: `SFL-FR-95${String(i).padStart(2, '0')}`,
      periodStartGame: iso(100 + i * 14), periodEndGame: iso(114 + i * 14),
      lines: [], findings: [], instructions: [], personnel: [], conduct: [] });
  }
  st.fleetReports = [...filler.reverse(), old];
  st.hiredDrivers = [{
    id: 'ages-off', name: 'A. Ager', status: 'Active', assignedTruckUnit: 'P-9',
    homeTerminalId: st.company.terminals[0].id, hiredGameDate: iso(2),
    level: 12, lifetimeMiles: 300_000, grade: 2, wageShare: 0.31, reportsFiled: 15,
  }];
  await api('/import', 'POST', st);
  const ager = doss(await api('/fleetops'), 'A. Ager');
  console.log(`  ..    ${st.fleetReports.length} reports on file, offence in the oldest one` +
              ` — recent ${ager.z?.recentPreventables}, lifetime ${ager.z?.preventables}`);
  ok('the fleet has filed more than the window holds', st.fleetReports.length > 12,
    `${st.fleetReports.length} reports`);
  ok('the offence is still on their record for ever', (ager.z?.preventables ?? 0) >= 1,
    `${ager.z?.preventables} lifetime`);
  ok('but one older than the window no longer counts against the rung',
    ager.z?.recentPreventables === 0, `${ager.z?.recentPreventables} in the window`);

  head('8. A cancelled load is not a delivered one, and does not quietly cost miles');
  // Asked from play: "you are counting only delivered loads right? I have lots of cancelled loads on
  // this profile." Yes — the ladder reads delivered freight and nothing else. What is worth pinning is
  // the other half: a load cancelled at dispatch has no miles on it, so nothing a driver actually drove
  // is being dropped on the floor; and the cancellation COUNT shown on their own career tab is about
  // loads, not about the empty moves the app cancels on its own behalf.
  //
  // That count used to sweep in every cancelled trip, so a superseded reposition — bookkeeping the
  // driver had no part in — put another mark on a figure displayed in warning colour beside their
  // record. Nothing gates a promotion on it, which is exactly why it has to be a figure they recognise.
  st = await api('/export');
  const before = await api('/career');
  const loadsBefore = num(row(before.nextRankProgress, 'loads')?.current);
  const milesBefore = num(row(before.nextRankProgress, 'mile')?.current);

  st.trips.unshift(
    { id: 'cx-freight', number: 'PRI-CX-900', kind: 'Freight', status: 'Cancelled',
      cargo: 'Never ran', faultAttribution: 'Dispatcher', dispatchedMiles: 900, actualMiles: 0,
      startOdometer: 0, endOdometer: 0, events: [] },
    { id: 'cx-empty', number: 'PRI-CX-901', kind: 'EmptyMove', status: 'Cancelled',
      cargo: 'Empty repositioning', faultAttribution: 'None', dispatchedMiles: 0, actualMiles: 0,
      startOdometer: 0, endOdometer: 0, events: [] });
  await api('/import', 'POST', st);

  rev = await api('/career');
  ok('a cancelled load does not count as delivered',
    num(row(rev.nextRankProgress, 'loads')?.current) === loadsBefore,
    loadsBefore + ' -> ' + num(row(rev.nextRankProgress, 'loads')?.current));
  ok('and the miles it was planned for are not credited either',
    num(row(rev.nextRankProgress, 'mile')?.current) === milesBefore,
    milesBefore + ' -> ' + num(row(rev.nextRankProgress, 'mile')?.current));
  ok('the cancellation count is loads, not the empty moves the app cancels itself',
    rev.stats.cancellations === 1,
    rev.stats.cancellations + ' counted of 2 cancelled trips');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
