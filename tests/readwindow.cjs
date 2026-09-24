/* The reader transcribes the window; the app converts it. Only the app has the clock.
 *
 *   Reported from play with the game card beside it. Chicago to Kansas City, listing "Expected Mon 11:14
 *   pm - Tue 5:54 am CDT", game clock Mon Day 1 11:34 — and the screenshot reader brought the load in
 *   with "delivered in" showing 162.15 hours, about six days past the truth.
 *
 * The prompt already tells the reader to put the window text in deliverByText and LEAVE deadlineHours AT
 * 0, precisely because a model has no game clock to subtract from. It does not always obey. InterpretLoad
 * then converted the text itself — correctly — and threw that away, because it only used its own answer
 * when the model had offered no number:
 *
 *     if (l.DeadlineHours <= 0) { l.DeadlineHours = win.HoursUntilDue; }
 *
 * So the one figure the app could work out for certain lost to the one it had told the reader not to
 * send. Present since 2026-08-18 and nothing to do with the day numbering; it only ever showed when the
 * model volunteered a number AND got it wrong.
 *
 * A BARE time is the exception worth keeping: "5:54 am" alone does not say which day, so a stated
 * time-to-deliver really is the only evidence of the day meant. Same distinction RollToDeadline draws.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5902}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

/** One row exactly as the reader hands it over. */
async function interpret(row) {
  const r = await api('/board/interpret', 'POST', [{
    cargo: 'Waste Paper', originCity: 'Chicago', originState: 'IL',
    destCity: 'Kansas City', destState: 'MO', loadedMiles: 493, gameRevenue: 1598,
    weightLbs: 39199, trailerType: 'Dry Van', confidence: 'high', unreadable: [],
    ...row,
  }]);
  return (r.loads || [])[0];
}

(async () => {
  const app = { driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: 4,
    homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Chicago', locationState: 'IL', locationKind: 'Shipper', gameTime: '2000-01-01T11:34',
    fuelPct: 100, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 828450,
  });

  head('1. The reported row, exactly as it came back');
  const reported = await interpret({
    deliverByText: 'Mon 11:14 pm - Tue 5:54 am', deadlineHours: 162.15,
  });
  ok('the reader’s number is discarded for the app’s own',
    Math.abs(reported.deadlineHours - 18.33) < 0.75, `162.15 -> ${reported.deadlineHours}h`);
  ok('and the opening is tonight, not next week',
    reported.appointmentOpensHours > 0 && reported.appointmentOpensHours < 24,
    `opens in ${reported.appointmentOpensHours}h`);

  head('2. It is the TEXT that decides, not whether a number was sent');
  const obedient = await interpret({ deliverByText: 'Mon 11:14 pm - Tue 5:54 am', deadlineHours: 0 });
  ok('a reader that obeyed gets the same answer',
    Math.abs(obedient.deadlineHours - reported.deadlineHours) < 0.01,
    `${obedient.deadlineHours}h both ways`);

  head('3. A day number anchors it too');
  const numbered = await interpret({ deliverByText: 'Day 2 05:54', deadlineHours: 162.15 });
  ok('an explicit day beats the reader as well',
    Math.abs(numbered.deadlineHours - 18.33) < 0.75, `${numbered.deadlineHours}h`);

  head('4. A bare time still defers to the stated countdown');
  // The case the guard was written for: no day in the text, so the reader's figure is the only thing
  // that says which day was meant.
  const bare = await interpret({ deliverByText: '5:54 am', deadlineHours: 42.4 });
  ok('a bare time keeps the reader’s number', Math.abs(bare.deadlineHours - 42.4) < 0.01,
    `${bare.deadlineHours}h`);

  head('5. A remaining-duration listing is untouched');
  // Nothing absolute to convert, which is the other half of how ATS prints these.
  const duration = await interpret({ deliverByText: '', deadlineHours: 30 });
  ok('no window text means the countdown stands', Math.abs(duration.deadlineHours - 30) < 0.01,
    `${duration.deadlineHours}h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
