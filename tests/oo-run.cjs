/* Owner-Operator 0.9: the run itself, on Core's trip log.
 *
 *   - booking a load opens a trip, planned as it stands
 *   - at the shipper, loading, pulling out, breaks, rests, fuel, at the receiver, unloading: each logged
 *   - delivery closes the trip: miles off the odometer, dock times learned, lateness by the clock
 *   - and the planner learns how fast this driver's roads are
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5994}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'R. Unner', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 10000, preset: 'Normal' });

  head('1. Nothing to run yet');
  ok('refused without a booking', /Nothing is booked/.test(await refused(() => api('/run/at-shipper', 'POST', {}))));

  head('2. Booking opens a trip');
  await api('/board/add-many', 'POST', [
    { cargo: 'Toys', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 760, deadlineHours: 30, shipper: 'Acme', receiver: 'Bolt' },
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
  ]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  ok('a trip on the log, with the plan it was booked on', S.trip && S.trip.number === S.booking.number && S.trip.plan && S.trip.plan.verdict, JSON.stringify(S.trip && { n: S.trip.number, v: S.trip.plan?.verdict }));
  const miles = S.booking.load.loadedMiles;
  const dest = S.booking.load.destCity;

  head('3. The run');
  r = await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
  ok('at the shipper: told whether the load is ready', /at the shipper/.test(r.said), r.said);
  S = await api('/run/event', 'POST', { kind: 'BeginLoad', day: 3, time: '06:40' });
  S = await api('/run/event', 'POST', { kind: 'EndLoad', day: 3, time: '07:10' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '07:15', odometer: 10002, weightLbs: 30000 });
  ok('loaded and rolling', r.snapshot.trip.loadedReported === true && r.snapshot.trip.pulledOutGameTime.endsWith('07:15'), r.snapshot.trip.pulledOutGameTime);
  S = await api('/run/event', 'POST', { kind: 'Break', day: 3, time: '10:00', hours: 0.5 });
  S = await api('/run/event', 'POST', { kind: 'Fuel', day: 3, time: '10:00', gallons: 80, pricePerGal: 4.1, city: 'Emporia', state: 'KS' });
  ok('a break needs an end', /ended|how long/.test(await refused(() => api('/run/event', 'POST', { kind: 'Rest', day: 3, time: '11:00' }))));
  ok('events on the log in order', S.trip.events.map((e) => e.kind).join(',') === 'BeginLoad,EndLoad,Break,Fuel', S.trip.events.map((e) => e.kind).join(','));
  r = await api('/run/arrived', 'POST', { day: 3, time: '11:20' });
  ok('at the receiver: told when they take it', /arrived/.test(r.said), r.said);
  S = await api('/run/event', 'POST', { kind: 'BeginUnload', day: 3, time: '11:25' });
  S = await api('/run/event', 'POST', { kind: 'EndUnload', day: 3, time: '12:05' });

  head('4. Delivered');
  r = await api('/deliver', 'POST', { day: 3, time: '12:05', odometer: 10002 + miles + 6 });
  S = r.snapshot;
  ok('the invoice is raised', r.invoice && r.invoice.number === 'INV-001');
  ok('on time by the clock', S.bookings[0].late === false && S.record.onTimePct === 100);
  ok('the trip is closed', !S.trip && !S.booking);
  const runLog = S.events.filter((e) => e.channel === 'run').map((e) => e.message).join(' | ');
  ok('the planner learned the road speed', /mph|Planning speed/i.test(runLog), runLog.slice(0, 300));
  ok('the truck is at the receiver with the odometer', S.status.city === dest && S.status.odometer === 10002 + miles + 6, `${S.status.city} ${S.status.odometer}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
