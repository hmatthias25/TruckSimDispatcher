/* The close-out summary, as figures (v0.88). Reported from play on 2026-11-09: "the summary page the player gets after
 * they deliver a load is basically AI slop word salad. Most of it makes no sense and some of it isn't even correct."
 *
 *   - the screen is short sections of label and value: the delivery, the docks, the distance, the money, where you stand
 *   - a late load is never also called on time, and says by how much and whose fault it was, once
 *   - the dock times split the waiting from the work, and say so where nothing was logged
 *   - no markup in the text, and no "you reported" for a figure the player never typed
 *   - the planner's own learning stays in the working, not on the screen
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5999}/api`;
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
const iso = (day, hm) => `2000-01-${String(day).padStart(2, '0')}T${hm}`;
const plus = (stamp, hours) => {
  const d = new Date(stamp + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + Math.round(hours * 60));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const sec = (a, key) => (a.summary || []).find((s) => s.key === key) || { rows: [] };
const row = (a, key, label) => sec(a, key).rows.find((r) => r.label === label);
const shown = (a) => JSON.stringify({ h: a.headline, s: a.summary, n: a.notes, d: a.directives });
function print(a) {
  console.log('  ## ' + a.headline);
  (a.summary || []).forEach((s) => s.rows.forEach((r) => console.log(`  ..  ${s.title.padEnd(20)} ${r.label.padEnd(18)} ${r.value}${r.detail ? '  — ' + r.detail : ''}`)));
}

async function run(day, odo, late, { logUnload = true } = {}) {
  await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(day, '06:00'),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 90000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  const st = await api('/export');
  if ((st.restartOrders || []).some((o) => o.status !== 'Complete')) { st.restartOrders = []; await api('/import', 'POST', st); }
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', receiver: 'Plains Paper', shipper: 'Mill',
    originCity: 'Wichita', originState: 'KS', destCity: 'Oklahoma City', destState: 'OK',
    loadedMiles: 160, deadheadMiles: 0, gameRevenue: 1800, deadlineHours: 14, weightLbs: 30000, atLocation: true, appointmentOpensHours: 5 });
  const d = await api('/board/evaluate');
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: d.evaluations[0].load.id, overrideTight: true })).trip;
  const ev = (kind, gt) => api(`/trips/${trip.id}/event`, 'POST', { kind, gameTime: gt });
  await api(`/trips/${trip.id}/at-shipper`, 'POST', { gameTime: iso(day, '06:00') });
  await ev('BeginLoad', iso(day, '06:30')); await ev('EndLoad', iso(day, '08:15'));
  await api(`/trips/${trip.id}/loaded`, 'POST', { odometer: odo, pulledOutGameTime: iso(day, '08:20') });
  const arrive = late ? plus(trip.dueGameTime, 2) : (trip.appointmentGameTime || trip.appointmentOpensGameTime);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: arrive });
  if (logUnload) { await ev('BeginUnload', plus(arrive, 0.5)); await ev('EndUnload', plus(arrive, 2.5)); }
  const r = await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: plus(arrive, 2.6), gameTime: plus(arrive, 2.6),
    endOdometer: odo + 171, truckDamageAfter: 3, trailerDamageAfter: 2, fuelPct: 70,
    hosDriveRemaining: 8, hosShiftRemaining: 9, hosBreakRemaining: 5, hosCycleRemaining: 58, delayReason: late ? 'traffic' : '' });
  return { a: r.audit, trip };
}

(async () => {
  const app = { driverName: 'P. Robe', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1, '06:00') }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. On time: the screen is figures');
  let { a } = await run(5, 91000, false);
  print(a);
  ok('five sections, in order', (a.summary || []).map((s) => s.key).join(',') === 'delivery,docks,miles,money,now',
    (a.summary || []).map((s) => s.key).join(','));
  ok('the headline says what and where, plainly', /^Paper delivered to Oklahoma City, OK, on time\.$/.test(a.headline), a.headline);
  ok('result on time', row(a, 'delivery', 'Result')?.value === 'On time' && row(a, 'delivery', 'Result')?.tone === 'good');
  ok('the shipper splits the wait from the work', row(a, 'docks', 'Shipper')?.detail === '0:30 waiting, 1:45 loading',
    JSON.stringify(row(a, 'docks', 'Shipper')));
  ok('the receiver splits it too', /waiting, 2:00 unloading|^All unloading$/.test(row(a, 'docks', 'Receiver')?.detail || ''),
    JSON.stringify(row(a, 'docks', 'Receiver')));
  ok('distance: driven against planned', row(a, 'miles', 'Driven loaded')?.value === '171 mi' && /Planned 160 mi/.test(row(a, 'miles', 'Driven loaded')?.detail),
    JSON.stringify(row(a, 'miles', 'Driven loaded')));
  ok('your pay is the pay on the trip', row(a, 'money', 'Your pay')?.value === `$${a.driverPay.toFixed(2)}`, row(a, 'money', 'Your pay')?.value);
  ok('where you stand: the clocks as they are after the unload', /^Drive 8:00 · shift .* · cycle 58:00 · break in /.test(row(a, 'now', 'Clocks')?.value || ''),
    row(a, 'now', 'Clocks')?.value);
  ok('no markup anywhere in the text', !/<\/?b>/.test(JSON.stringify({ ...a, trip: null })));
  ok('the planner\'s learning stays off the screen', !/planned on it from now on|speed|Dock time for/i.test(shown(a)));
  ok('but is still in the working', a.serviceFindings.some((x) => /Driven distance recorded/.test(x)));
  ok('no "you reported" for a dock time worked out from the log', !a.serviceFindings.some((x) => /You (reported|put) .* at the dock/.test(x)),
    a.serviceFindings.find((x) => /at the dock but/.test(x)) || '');

  head('2. Late: said once, by how much, and whose');
  ({ a } = await run(7, 91171, true));
  print(a);
  const result = row(a, 'delivery', 'Result');
  ok('late by the hours past due', result?.value === 'Late by 2:00' && result?.tone === 'bad', JSON.stringify(result));
  ok('whose fault, as a person would say it', row(a, 'delivery', 'Whose fault')?.value === "Nobody's: the road or the dock");
  ok('the headline says it was not theirs', /late, but not your fault\.$/.test(a.headline), a.headline);
  ok('never "on time" under a late load', !/counts as on time/.test(JSON.stringify(a)));
  ok('the fault reason is not repeated in the findings', a.serviceFindings.filter((x) => /Non-preventable delay/.test(x)).length === 0,
    a.serviceFindings.filter((x) => /Non-preventable/.test(x)).join(' | '));

  head('3. A dock nobody logged says so');
  ({ a } = await run(9, 91342, false, { logUnload: false }));
  const rec = row(a, 'docks', 'Receiver');
  ok('the planned time, marked as one', !rec || /Nothing logged|nothing logged|Waiting/.test(rec.detail), JSON.stringify(rec));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
