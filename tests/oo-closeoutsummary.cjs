/* Owner-Operator 0.92: the close-out summary, as figures. Reported from play on 2026-11-09: the summary after a delivery
 * read as word salad, and in places was wrong — "it counts as on time" under a load marked late.
 *
 *   - short sections of label and value: the delivery, the docks, the distance, the money, where you stand
 *   - the money is the invoice, when it is due, and what the game paid that goes to Broker holding
 *   - a late load is never also called on time
 *   - no damage row: the truck is the Companion App's to look after
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5998}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const sec = (a, key) => (a.summary || []).find((s) => s.key === key) || { rows: [] };
const row = (a, key, label) => sec(a, key).rows.find((r) => r.label === label);
function print(a) {
  console.log('  ## ' + a.headline);
  (a.summary || []).forEach((s) => s.rows.forEach((r) => console.log(`  ..  ${s.title.padEnd(20)} ${r.label.padEnd(16)} ${r.value}${r.detail ? '  — ' + r.detail : ''}`)));
}
async function book(day, job) {
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '06:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST');
  await api('/board/add-many', 'POST', [job]);
  const S = await api('/bootstrap');
  const b = S.directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou);
  let r = await api('/calls', 'POST', { brokerId: b.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  return r.snapshot;
}

(async () => {
  await api('/start', 'POST', { game: 'ATS', driverName: 'P. Robe', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });

  head('1. On time, with the docks logged');
  await book(3, { cargo: 'Paper', trailerType: 'Dry Van', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380,
    deadlineHours: 20, appointmentOpensHours: 6 });
  await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
  await api('/run/event', 'POST', { kind: 'BeginLoad', day: 3, time: '06:40' });
  await api('/run/event', 'POST', { kind: 'EndLoad', day: 3, time: '08:15' });
  await api('/run/loaded', 'POST', { day: 3, time: '08:20', odometer: 1000 });
  await api('/run/arrived', 'POST', { day: 3, time: '12:30' });
  await api('/run/event', 'POST', { kind: 'BeginUnload', day: 3, time: '13:00' });
  await api('/run/event', 'POST', { kind: 'EndUnload', day: 3, time: '14:40' });
  let r = await api('/deliver', 'POST', { day: 3, time: '14:45', odometer: 1071, drive: 9.5, shift: 8, break: 6, cycle: 60, fuelPct: 80 });
  let a = r.audit;
  print(a);
  ok('five sections, in order', (a.summary || []).map((s) => s.key).join(',') === 'delivery,docks,miles,money,now',
    (a.summary || []).map((s) => s.key).join(','));
  ok('the headline says what and where', /^Paper delivered to Topeka, KS, on time\.$/.test(a.headline), a.headline);
  ok('on time', row(a, 'delivery', 'Result')?.value === 'On time');
  ok('the shipper: waiting and loading', row(a, 'docks', 'Shipper')?.detail === '0:10 waiting, 1:35 loading', JSON.stringify(row(a, 'docks', 'Shipper')));
  ok('the receiver: waiting and unloading', row(a, 'docks', 'Receiver')?.detail === '0:30 waiting, 1:40 unloading', JSON.stringify(row(a, 'docks', 'Receiver')));
  ok('the invoice, to whom', /^INV-001 to /.test(row(a, 'money', 'Invoice')?.value || ''), row(a, 'money', 'Invoice')?.value);
  ok('when it is due', !!row(a, 'money', 'Due')?.value && /^Net \d+$|^Quick pay$/.test(row(a, 'money', 'Due')?.detail), JSON.stringify(row(a, 'money', 'Due')));
  ok('the game\'s pay, and where it goes', row(a, 'money', 'The game paid')?.value === '$380.00' && /Broker holding/.test(row(a, 'money', 'The game paid')?.detail));
  ok('the broker standing moved, said shortly', /^\d+ \(up \d+\)$/.test(row(a, 'money', 'Broker standing')?.value || ''), row(a, 'money', 'Broker standing')?.value);
  ok('no damage row: the Companion App has the truck', !row(a, 'now', 'Damage'));
  ok('the clocks after the unload, marked as worked out', /^Drive 9:30 · shift 5:50/.test(row(a, 'now', 'Clocks')?.value || '')
    && /Worked out/.test(row(a, 'now', 'Clocks')?.detail), JSON.stringify(row(a, 'now', 'Clocks')));
  ok('no markup in the text', !/<\/?b>/.test(JSON.stringify({ ...a, trip: null })));
  ok('no "you reported" for a dock time off the log', !a.serviceFindings.some((x) => /You (reported|put) .* at the dock/.test(x)));

  head('2. Late, on a load the receiver takes whenever it arrives');
  await book(4, { cargo: 'Paper', trailerType: 'Dry Van', destCity: 'Salina', destState: 'KS', loadedMiles: 180, gameRevenue: 700,
    deadlineHours: 5, appointmentOpensHours: 2 });
  await api('/run/at-shipper', 'POST', { day: 4, time: '06:10' });
  await api('/run/loaded', 'POST', { day: 4, time: '06:30', odometer: 1071 });
  await api('/run/arrived', 'POST', { day: 4, time: '13:00' });
  r = await api('/deliver', 'POST', { day: 4, time: '14:00', odometer: 1260 });
  a = r.audit;
  print(a);
  ok('late, by how much', /^Late/.test(row(a, 'delivery', 'Result')?.value || '') && row(a, 'delivery', 'Result')?.tone === 'bad',
    JSON.stringify(row(a, 'delivery', 'Result')));
  ok('whose fault is a row', !!row(a, 'delivery', 'Whose fault'));
  ok('never "on time" under a late load', !/counts as on time/.test(JSON.stringify(a)));
  ok('no dock was logged, and it says so', [row(a, 'docks', 'Shipper'), row(a, 'docks', 'Receiver')].filter(Boolean)
    .every((x) => /Nothing logged|nothing logged|Waiting/.test(x.detail)), JSON.stringify(sec(a, 'docks').rows));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
