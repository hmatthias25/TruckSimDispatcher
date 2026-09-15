/* #225 - waiting for a door is detention; waiting because you turned up early is not.
 *
 * Asked from play: "If I arrive with a load at 9AM but am told they can't take it until 10AM even though
 * I have a 9AM appointment, should I get detention pay for an hour? I honestly don't know."
 *
 * The hour should count. It did not count at all - detention came off the BeginUnload/EndUnload span, so
 * the clock started when the receiver TOOK you and the time sat in their yard was invisible. Which is
 * backwards: waiting is the thing detention exists to compensate, the unload is just the job.
 *
 * The app already said so out loud and then did not pay it. ReceiverCall's backed-up branch tells the
 * driver "the whole 2:15 is detention and it comes out of your window", and the pay engine counted zero.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5961}/api`;
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
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let FREE = 2;

/** Shift an ISO game time by hours, keeping the same shape. */
function plus(isoTime, hours) {
  const d = new Date(Date.parse(isoTime + ':00Z') + hours * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` +
         `T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The moment the receiver is due to have this load, which is what the clock runs from. */
const slotOf = (trip) => trip.appointmentGameTime || trip.appointmentOpensGameTime;

/** Take one load and return the trip, with a stated hours-to-deliver. */
async function take(day, deadlineHours = 30, opensHours = 3) {
  await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(day, '06:00'),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });

  // A restart order raised by an earlier close-out blocks the board, and it has nothing to do with what
  // this suite is measuring — it would just make the later cases quietly assert nothing. Clear any open
  // one rather than sitting thirty-four hours in a detention fixture.
  const state = await api('/export');
  if ((state.restartOrders || []).some((o) => o.status !== 'Complete')) {
    state.restartOrders = [];
    await api('/import', 'POST', state);
  }

  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', {
    cargo: 'Steel Coils', trailerType: 'Flatbed', receiver: 'Midwest Steel',
    originCity: 'Wichita', originState: 'KS', destCity: 'Topeka', destState: 'KS',
    loadedMiles: 130, deadheadMiles: 0, gameRevenue: 1800, deadlineHours,
    weightLbs: 42000, atLocation: true, preLoaded: true,
    appointmentOpensHours: opensHours,
  }));
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  if (!pick) { console.log(`  ..    no load on day ${day}: ${(d.headline || '').slice(0, 80)}`); return null; }
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick.load?.id || (added.board || [])[0]?.id });
  return r.trip || (un(r).trips || [])[0];
}

/** Close a trip out and hand back the stored trip plus the audit findings. */
async function close(trip, deliveredAt, extra = {}) {
  const r = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: deliveredAt, endOdometer: 90130, actualMiles: 130,
    truckDamageAfter: 2, trailerDamageAfter: 2, ...extra,
  });
  const done = (un(r).trips || []).find((x) => x.id === trip.id);
  return { done, findings: (r.audit?.serviceFindings || []).join(' || '), raw: JSON.stringify(r) };
}

const logEvent = (trip, kind, gameTime) =>
  api(`/trips/${trip.id}/event`, 'POST', { kind, gameTime });

(async () => {
  const app = { driverName: 'M. Sandoval', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const boot = await api('/bootstrap');
  FREE = boot.driver?.pay?.detentionFreeHours ?? 2;
  console.log(`  ..    free window ${hhmm(FREE)} @ $${boot.driver?.pay?.detentionPerHour}/h`);

  head('1. The reported case: on the slot, held an hour, inside the free window');
  // 09:00 arrival against a 09:00 slot, taken at 10:00, done 11:30. Two and a half hours on the
  // property, which is half an hour past the free two. Before this it was 1:30 of unload and nothing.
  let trip = await take(10);
  ok('a load was authorized', !!trip, trip?.number);
  let slot = slotOf(trip);
  ok('and it has a stated appointment to run the clock from', !!slot, slot || '(none)');
  console.log(`  ..    slot ${slot}`);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: slot });
  await logEvent(trip, 'BeginUnload', plus(slot, 1));
  await logEvent(trip, 'EndUnload', plus(slot, 2.5));
  let r = await close(trip, plus(slot, 2.6));
  console.log(`  ..    unload ${hhmm(r.done.unloadingHours)}, detention ${hhmm(r.done.detentionHours)}`);
  console.log(`  ..    ${(r.findings.match(/On their property[^|]*/) || ['(no line)'])[0].trim()}`);
  ok('the unload itself is still an hour and a half',
    Math.abs(r.done.unloadingHours - 1.5) < 0.02, hhmm(r.done.unloadingHours));
  ok('the hour spent waiting is counted',
    /On their property 2:30/.test(r.findings), (r.findings.match(/On their property[^.]*/) || [''])[0]);
  ok('and half an hour of it is billable',
    Math.abs(r.done.detentionHours - 0.5) < 0.02, hhmm(r.done.detentionHours));
  ok('and the audit separates the waiting from the working',
    /1:00 of that was waiting rather than working/.test(r.findings),
    (r.findings.match(/[\d:]+ of that was waiting[^.]*/) || [''])[0]);

  head('1b. A trip that never said when it arrived falls back to what it always did');
  // Run here rather than at the end: the fixture is out of cycle by the last day and dispatch stops,
  // which would have this asserting nothing while looking like it passed.
  trip = await take(11, 40);
  ok('a load to test the fallback on', !!trip, trip?.number || 'none authorized');
  slot = slotOf(trip);
  await logEvent(trip, 'BeginUnload', plus(slot, 1));
  await logEvent(trip, 'EndUnload', plus(slot, 4.5));
  r = await close(trip, plus(slot, 4.6));
  console.log(`  ..    no arrival stamp: unload ${hhmm(r.done.unloadingHours)}, detention ${hhmm(r.done.detentionHours)}`);
  ok('the unload span alone still decides it',
    Math.abs(r.done.detentionHours - 1.5) < 0.02, hhmm(r.done.detentionHours));

  head('2. Turning up early is not detention');
  // Same unload, same wait as far as the driver is concerned — but they were two hours early for it,
  // and nobody is owed for their own keenness. The clock still starts at 09:00.
  trip = await take(12);
  slot = slotOf(trip);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: plus(slot, -2) });
  await logEvent(trip, 'BeginUnload', slot);
  await logEvent(trip, 'EndUnload', plus(slot, 1.5));
  r = await close(trip, plus(slot, 1.6));
  console.log(`  ..    arrived two hours early: on property ` +
    `${(r.findings.match(/On their property (\d+:\d+)/) || ['', '(n/a)'])[1]}, detention ${hhmm(r.done.detentionHours)}`);
  ok('the two hours sat at the gate early are not paid',
    r.done.detentionHours === 0, hhmm(r.done.detentionHours));

  head('2b. Early AND then held past the slot — only the held part counts');
  // The combination, which is the one a real day actually produces: you get there early to be safe, and
  // they still do not take you until after the time they booked. The early sitting is yours; everything
  // past the slot is theirs.
  trip = await take(13, 40);
  slot = slotOf(trip);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: plus(slot, -2) });
  await logEvent(trip, 'BeginUnload', plus(slot, 2));
  await logEvent(trip, 'EndUnload', plus(slot, 3.5));
  r = await close(trip, plus(slot, 3.6));
  console.log(`  ..    arrived 2h early, taken 2h late: ` +
    `${(r.findings.match(/On their property (\d+:\d+)/) || ['', '(n/a)'])[1]} on the clock, ` +
    `detention ${hhmm(r.done.detentionHours)}`);
  ok('the clock runs from the slot, not from when they rolled in',
    /their clock started at your/i.test(r.findings),
    (r.findings.match(/their clock started[^.]*/i) || [''])[0].slice(0, 80));
  ok('three and a half hours on their clock is ninety minutes billable',
    Math.abs(r.done.detentionHours - 1.5) < 0.02, hhmm(r.done.detentionHours));

  head('3. Turning up late does not buy the hour you missed');
  trip = await take(14);
  slot = slotOf(trip);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: plus(slot, 1) });
  await logEvent(trip, 'BeginUnload', plus(slot, 1.25));
  await logEvent(trip, 'EndUnload', plus(slot, 2.75));
  r = await close(trip, plus(slot, 2.85));
  console.log(`  ..    arrived 10:00 for a 09:00 slot: on property ${(r.findings.match(/On their property (\d+:\d+)/) || [])[1]}, detention ${hhmm(r.done.detentionHours)}`);
  ok('the clock runs from when they actually got there',
    /On their property 1:45/.test(r.findings) || r.done.detentionHours === 0,
    (r.findings.match(/On their property[^.]*/) || [''])[0]);
  ok('so nothing is billable on a 1:45 stop', r.done.detentionHours === 0, hhmm(r.done.detentionHours));

  head('4. Held long enough and it pays properly');
  trip = await take(16, 40);
  slot = slotOf(trip);
  await api(`/trips/${trip.id}/arrived`, 'POST', { gameTime: slot });
  await logEvent(trip, 'BeginUnload', plus(slot, 4));
  await logEvent(trip, 'EndUnload', plus(slot, 5));
  r = await close(trip, plus(slot, 5.1));
  console.log(`  ..    five hours on the property from ${slot}: detention ${hhmm(r.done.detentionHours)}`);
  ok('five hours on the property is three hours billable',
    Math.abs(r.done.detentionHours - 3) < 0.02, hhmm(r.done.detentionHours));
  const stub = r.done.pay || {};
  console.log(`  ..    detention pay $${stub.detentionPay}`);
  ok('and it reaches the pay stub', (stub.detentionPay || 0) > 0, `$${stub.detentionPay}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
