/* Drop and hook is an arrangement, not a trailer — and a probation extension has to reach the driver.
 *
 * Four things reported from one session of play.
 *
 *   "Every load says something like 'this is dry van but you are running DH1, make sure this is right'.
 *    Drop and hook is an arrangement not a trailer so this message is not correct."
 *
 * Right. The driver has no box of their own; they pull whatever the job comes with, so the listed type
 * IS what ends up hooked and there is nothing for it to disagree with. TrailerMatches has known that for
 * a long time — the fit check went through EquipmentService.TypeCovers instead, which does not, so the
 * con fired on every single load.
 *
 *   "This says I have to do all 120 days, I think I just have to do 30 more."
 *
 * The arithmetic was right and the sentence was not. "12.4 of 120 day(s) left" reads as a hundred and
 * twenty days to serve. What a driver who started on ninety and picked up an extension wants to know is
 * that the original period still stands and something was added to it — so it is said that way now, and
 * ExtendedDays was already on the record to say it with.
 *
 *   "Nothing told me my probation would be extended before I took home time. The preventable happened
 *    days ago, would have thought I'd be told then."
 *
 * They were told. ProbationConduct.Assess judges the incident as it is filed and writes the outcome to
 * the event feed and the incident's notes — neither of which anybody reads while driving. The endpoint
 * that files the incident returned the discipline action, the write-off steps and the shop consequences,
 * and dropped the one about their career on the floor. It returns it now.
 *
 *   "We do however need the odometer at pickup like we do on trailer loads."
 *
 * Yes, and that panel was gated on an EndLoad event that never happens on drop and hook.
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

const views = async () => (await api('/bootstrap')).views;
let S, day = 3;

/** Put the driver on the standing drop-and-hook slot, the way the app models it: as a trailer type. */
async function ontoDropHook() {
  const st = await api('/export');
  st.trailers.push({
    unit: 'DH-1', type: 'Drop & Hook', subtype: '', division: 'Dry Van', year: 2022,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'DH-1';
  return un(await api('/import', 'POST', st));
}

(async () => {
  const app = { driverName: 'V. Moreau', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));

  head('1. Drop and hook does not argue with the trailer type on every load');
  S = await ontoDropHook();
  ok('the driver is on the drop-and-hook slot', S.driver.assignedTrailerUnit === 'DH-1',
    S.driver.assignedTrailerUnit);

  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Packaged Food', trailerType: 'Dry Van',
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 520, deadheadMiles: 0,
    gameRevenue: 1850, deadlineHours: 48, weightLbs: 38000,
  });
  const ev = (board.evaluations || [])[0];
  const cons = (ev?.cons || []).join(' | ');
  console.log(`  ..    ${cons || 'no cons'}`);
  ok('an evaluation came back', !!ev, ev?.load?.cargo || '(none)');
  ok('nothing complains that a dry van is not a Drop & Hook',
    !/you are on DH-1|Drop & Hook\)/i.test(cons),
    (cons.match(/[^|]*you are on[^|]*/i) || ['not said'])[0].slice(0, 95));
  ok('and it is not a hard fail either', (ev?.hardFails || []).length === 0,
    (ev?.hardFails || []).join(' | ') || 'none');

  head('2. A real mismatch on a real trailer is still worth saying');
  // The check is not deleted. A driver on a flatbed being handed a reefer load should hear about it.
  let st = await api('/export');
  st.trailers.push({
    unit: 'F-1', type: 'Flatbed', subtype: '', division: 'Flatbed', year: 2020,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'F-1';
  st.company.divisions = ['Dry Van', 'Reefer', 'Flatbed'];
  S = un(await api('/import', 'POST', st));
  await api('/board/clear', 'POST', {});
  const board2 = await api('/board/add', 'POST', {
    cargo: 'Ice Cream', trailerType: 'Reefer',
    originCity: S.status.locationCity, originState: S.status.locationState,
    destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 520, deadheadMiles: 0,
    gameRevenue: 2100, deadlineHours: 48, weightLbs: 38000,
  });
  const cons2 = ((board2.evaluations || [])[0]?.cons || []).join(' | ');
  ok('a flatbed handed a reefer load is told',
    /you are on F-1/i.test(cons2), (cons2.match(/[^|]*you are on[^|]*/i) || ['(not said)'])[0].slice(0, 95));

  head('3. An extended probation reads as the period plus what was added');
  S = await ontoDropHook();
  st = await api('/export');
  st.driver.probation = { ...st.driver.probation, active: true, durationDays: 90, extendedDays: 0 };
  st.driver.rank = 'probationary';
  st.status.gameTime = iso(40);
  await api('/import', 'POST', st);
  let v = await views();
  ok('a plain period says one number', /90-day period/.test(v.probation?.standing || ''),
    v.probation?.standing?.slice(0, 80));

  st = await api('/export');
  st.driver.probation = { ...st.driver.probation, durationDays: 120, extendedDays: 30 };
  await api('/import', 'POST', st);
  v = await views();
  console.log(`  ..    ${v.probation?.standing}`);
  ok('an extended one names the original period', /90-day period/.test(v.probation?.standing || ''),
    v.probation?.standing?.slice(0, 100));
  ok('and the days added to it', /30 day\(s\) added/.test(v.probation?.standing || ''),
    v.probation?.standing?.slice(0, 110));
  ok('rather than presenting 120 as the period', !/120-day period/.test(v.probation?.standing || ''),
    'not said as a bare total');
  ok('and the screen is given the two figures apart', v.probation?.extendedDays === 30,
    `durationDays=${v.probation?.durationDays}, extendedDays=${v.probation?.extendedDays}`);

  head('4. Filing a preventable tells the driver then and there what it cost');
  // The whole complaint. Moderate always costs days — there is no roll at that level — so this is
  // deterministic rather than a seeded maybe.
  st = await api('/export');
  st.driver.probation = { ...st.driver.probation, durationDays: 90, extendedDays: 0, startedGameDate: iso(2) };
  st.incidents = [];
  await api('/import', 'POST', st);

  const filed = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Moderate', faultAttribution: 'Driver', preventable: true,
    damageIncurredPct: 14, truckDamagePctAfter: 14, trailerDamagePctAfter: -1,
    description: 'Clipped a post backing into the shipper.',
    locationCity: 'Denver', locationState: 'CO',
  });
  console.log(`  ..    ${filed.probation?.kind}: ${(filed.probation?.message || '').slice(0, 120)}`);
  ok('the response carries the probation outcome', !!filed.probation, filed.probation?.kind || '(absent)');
  ok('it says the period was extended', filed.probation?.kind === 'Extended', filed.probation?.kind);
  ok('and how many days it cost', filed.probation?.daysAdded > 0, `${filed.probation?.daysAdded} day(s)`);
  ok('the message names the days rather than leaving them to be inferred',
    /another \d+ days on your probation/i.test(filed.probation?.message || ''),
    (filed.probation?.message || '').slice(0, 100));
  ok('and names the new review date', /your review moves to/i.test(filed.probation?.message || ''),
    (filed.probation?.message || '').match(/Your review moves to [^.]*/i)?.[0] || '(not named)');

  v = await views();
  ok('the period on file grew by the same amount', v.probation?.extendedDays > 0,
    `extendedDays=${v.probation?.extendedDays}`);
  ok('and the standing line now reads as 90 plus the extension',
    /90-day period plus/.test(v.probation?.standing || ''), v.probation?.standing?.slice(0, 110));

  head('5. Nothing is returned where nothing happened');
  // A not-at-fault knock is not the driver's, and the period does not move for it.
  const clean = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Minor', faultAttribution: 'Other', preventable: false,
    damageIncurredPct: 6, truckDamagePctAfter: 6, trailerDamagePctAfter: -1,
    description: 'Hit in a truck stop while parked.',
    locationCity: 'Denver', locationState: 'CO',
  });
  ok('a not-at-fault knock returns no probation outcome', !clean.probation,
    clean.probation?.kind || 'nothing returned');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
