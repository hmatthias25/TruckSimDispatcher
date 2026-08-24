/* Issue #78 — a break-capped drive clock, accepted at face value.
 *
 * HOS mods cap the drive figure on their display at whatever will stop the driver next, so before the
 * first break of a shift a fresh clock reads D 8:00 with eleven hours of legal driving in it. Copying
 * that across is the sensible thing to do and exactly wrong: the four clocks are independent counters
 * here, three hours vanish from every shift, and every load judged against that shift is judged on a
 * window three hours too short. The refusal then talks about hours rather than about the misread.
 *
 * The fix is a question, not a correction. Nothing here rewrites a reported clock unless the driver
 * says to.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5962}/api`;
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
const day = (n, hm = '08:00') => `2000-01-${String(n).padStart(2, '0')}T${hm}`;

// Report clocks the way the Dispatch tab does.
const clocks = (drive, shift, brk, cycle) =>
  api('/hos', 'POST', { driveRemaining: drive, shiftRemaining: shift, breakRemaining: brk, cycleRemaining: cycle });

const query = async () => (await api('/bootstrap')).views.clockQuery;

(async () => {
  const app = { driverName: 'C. Apper', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(2), code: 'PRI' });
  await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: day(2),
    fuelPct: 90, atsOdometer: 4000, dutyStatus: 'OnDuty',
  });

  head('1. The fingerprint: a fresh clock straight off a capping display');
  await clocks(8, 14, 8, 70);
  let q = await query();
  ok('the question is raised', !!q, q ? 'raised' : 'silent');
  ok('it names both clocks reading the same', /both 8:00/.test(q.question || ''), (q.question || '').slice(0, 70));
  ok('and says what it thinks is happening',
    /capping the drive figure at the break/i.test(q.question || ''), 'wording');
  ok('the recovered figure is the drive limit', Math.abs(q.recovered - 11) < 0.01, `${q.recovered}h`);
  ok('and the hours at stake are named', Math.abs(q.atStake - 3) < 0.01, `${q.atStake}h`);
  ok('the other reading is offered too, not just the correction',
    /is my drive clock/i.test(q.genuine || ''), (q.genuine || '').slice(0, 60));
  ok('nothing has been rewritten behind the driver',
    (await api('/bootstrap')).hos.driveRemaining === 8, 'drive still 8:00');

  head('2. Mid-shift, part way through the first stint');
  await clocks(4, 9, 4, 62);
  q = await query();
  ok('still the fingerprint', !!q, q ? 'raised' : 'silent');
  ok('11 - 8 + 4 = 7', Math.abs(q.recovered - 7) < 0.01, `${q.recovered}h`);
  ok('three hours at stake whatever the point in the stint', Math.abs(q.atStake - 3) < 0.01, `${q.atStake}h`);

  head('3. Readings that are not the fingerprint are left alone');
  await clocks(11, 14, 8, 70);            // an uncapped display on a fresh clock
  ok('drive above the break threshold says nothing', !(await query()), 'silent');
  await clocks(6, 11, 8, 64);             // after the break: drive is the binding one and reads true
  ok('a break clock back at 8 with drive below it says nothing', !(await query()), 'silent');
  await clocks(0, 3, 0, 40);              // out of driving hours
  ok('0:00 on both is out of hours, not a cap', !(await query()), 'silent');
  await clocks(7.5, 12, 7.6, 66);         // near, not equal
  ok('six minutes apart is not the same figure', !(await query()), 'silent');

  head('4. Taking the correction');
  await clocks(8, 14, 8, 70);
  let r = await api('/hos/clock-check', 'POST', { uncap: true });
  ok('the drive clock moves to the recovered figure',
    Math.abs(un(r).hos.driveRemaining - 11) < 0.01, `${un(r).hos.driveRemaining}h`);
  ok('the break clock is untouched — it was never wrong',
    Math.abs(un(r).hos.breakRemaining - 8) < 0.01, `${un(r).hos.breakRemaining}h`);
  ok('the shift clock is untouched', Math.abs(un(r).hos.shiftRemaining - 14) < 0.01, `${un(r).hos.shiftRemaining}h`);
  ok('it says what it did and by how much', /3:00/.test(r.message || ''), (r.message || '').slice(0, 80));
  ok('the question is settled', !(await query()), 'silent');
  ok('and the mod is now known to cap',
    (await api('/bootstrap')).settings.hos.driveDisplayCaps === 'yes', 'yes');

  head('5. Knowing it caps does not silence it — the coincidence is real');
  await clocks(8, 14, 8, 70);
  q = await query();
  ok('asked again on the next reading', !!q, q ? 'raised' : 'silent');
  ok('and it says the driver has told it so before',
    /You have told me your display caps/i.test(q.question || ''), 'wording');
  ok('the genuine reading explains how both clocks land together',
    /driven 3:00/.test(q.genuine || ''), (q.genuine || '').slice(0, 80));

  head('6. Keeping what was reported');
  r = await api('/hos/clock-check', 'POST', { uncap: false });
  ok('the drive clock is exactly what was typed',
    Math.abs(un(r).hos.driveRemaining - 8) < 0.01, `${un(r).hos.driveRemaining}h`);
  ok('and it says so plainly', /as you reported it/i.test(r.message || ''), (r.message || '').slice(0, 60));
  ok('the question is settled', !(await query()), 'silent');
  ok('but it is still on record that the display caps',
    (await api('/bootstrap')).settings.hos.driveDisplayCaps === 'yes', 'yes');
  let again = null;
  try { await api('/hos/clock-check', 'POST', { uncap: true }); } catch (e) { again = e.message; }
  ok('answering a settled question is refused', again !== null, (again || '(allowed!)').slice(0, 70));

  head('7. Re-armed by every fresh reading, including the same numbers again');
  await clocks(8, 14, 8, 70);
  ok('a new reading asks again', !!(await query()), 'raised');
  await api('/hos/clock-check', 'POST', { uncap: false });
  ok('settled', !(await query()), 'silent');
  await clocks(8, 14, 8, 70);
  ok('the identical reading typed again is still a fresh chance to have copied it', !!(await query()), 'raised');

  head('8. A driver whose display does not cap can stop it');
  r = await api('/hos/clock-check', 'POST', { uncap: false, stopAsking: true });
  ok('it says it will stop', /stop asking/i.test(r.message || ''), (r.message || '').slice(0, 70));
  ok('recorded against the rule set',
    (await api('/bootstrap')).settings.hos.driveDisplayCaps === 'no', 'no');
  await clocks(8, 14, 8, 70);
  ok('and the fingerprint no longer raises anything', !(await query()), 'silent');
  ok('the reported clock is still exactly what was typed',
    (await api('/bootstrap')).hos.driveRemaining === 8, 'drive 8:00');

  // Back on, the way Settings does it.
  let st = (await api('/bootstrap')).settings;
  st.hos.driveDisplayCaps = '';
  await api('/settings', 'POST', st);
  await clocks(8, 14, 8, 70);
  ok('turning it back on in Settings brings the question back', !!(await query()), 'raised');

  head('9. With the break switched off there is no break clock to be capped at');
  st = (await api('/bootstrap')).settings;
  st.hos.requireBreak = false;
  await api('/settings', 'POST', st);
  await clocks(8, 14, 8, 70);
  ok('nothing is asked', !(await query()), 'silent');
  st = (await api('/bootstrap')).settings;
  st.hos.requireBreak = true;
  await api('/settings', 'POST', st);

  head('10. It is a question, never a correction');
  await clocks(8, 14, 8, 70);
  const before = (await api('/bootstrap')).hos.driveRemaining;
  const plan = (await api('/bootstrap')).views.hos;
  ok('the projection still plans on the reported figure, untouched',
    Math.abs(plan.driveRemaining - before) < 0.01, `${plan.driveRemaining}h planned on ${before}h reported`);
  ok('so the app is never quietly running on a number nobody typed',
    Math.abs(before - 8) < 0.01, `${before}h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
