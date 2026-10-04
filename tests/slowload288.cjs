/* A slow load is the shipper's delay too (reported from play, v0.81): held 3:00 for the freight and then
 * loaded slowly, the two together ate the slack, and the late delivery was left for the driver to explain.
 *
 *   - waiting and loading past what the plan allowed, together at least the slack: nobody's fault
 *   - a shipper that took less than the slack does not excuse the lateness on its own
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5971}/api`;
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
function plus(isoTime, hours) {
  const d = new Date(Date.parse(isoTime + ':00Z') + Math.round(hours * 60) * 60000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` +
         `T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function take(day) {
  await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(day, '06:00'),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 90000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'Prairie Mill', receiver: 'Midwest Steel',
    originCity: 'Wichita', originState: 'KS', destCity: 'Topeka', destState: 'KS', loadedMiles: 130, deadheadMiles: 0,
    gameRevenue: 1800, deadlineHours: 40, weightLbs: 42000, atLocation: false, appointmentOpensHours: 3 }));
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick?.load?.id || (added.board || [])[0]?.id });
  return r.trip || (un(r).trips || [])[0];
}

/** Report at the shipper, load for `loadHours`, and deliver an hour after the deadline. */
async function run(trip, day, loadHours) {
  const call = (await api(`/trips/${trip.id}/at-shipper`, 'POST', { gameTime: iso(day, '06:30') })).call;
  const start = call.workStartsGameTime;
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: start });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'EndLoad', gameTime: plus(start, loadHours) });
  const r = await api(`/trips/${trip.id}/complete`, 'POST', { deliveredGameTime: plus(trip.dueGameTime, 1),
    endOdometer: 90130, actualMiles: 130, truckDamageAfter: 2, trailerDamageAfter: 2 });
  const done = (un(r).trips || []).find((x) => x.id === trip.id);
  return { done, call, findings: (r.audit?.serviceFindings || []).join(' || ') };
}

(async () => {
  const app = { driverName: 'R. Okafor', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 10, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. Held, then loaded slowly: together past the slack');
  let trip = await take(10);
  const f = trip.feasibilityAtDispatch;
  const planned = (f.timeline || []).find((t) => /^Loading/.test(t.label))?.hours ?? 1;
  // Whatever the shipper's wait, load for long enough that the time there is over the plan by the slack and an hour.
  let r = await run(trip, 10, planned + f.slackHours + 1);
  ok('late, and nobody\'s fault', r.done.serviceResult === 'Late' && r.done.faultAttribution === 'Unavoidable',
    `${r.done.serviceResult} ${r.done.faultAttribution}`);
  ok('and it says the shipper took it', /Facility delay at the shipper/.test(r.findings + ' ' + (r.done.delayFault || '') + JSON.stringify(r.done)), r.findings.slice(0, 250));

  head('2. A shipper that took less than the slack is not the lateness');
  trip = await take(12);
  r = await run(trip, 12, planned);
  ok('not put down to the shipper', !/Facility delay at the shipper/.test(JSON.stringify(r.done)) || r.call.waitHours >= trip.feasibilityAtDispatch.slackHours,
    `${r.done.faultAttribution}, waited ${r.call.waitHours}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
