/* Issue #6: filing an incident must produce a decision, not a form the driver fills in for themselves. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5366}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 200));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const app = { driverName: 'Disc Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));

  head('A driver-fault preventable incident decides itself');
  let r = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    cost: 0, tripNumber: '', description: 'Clipped a bollard backing into the dock',
  });
  S = r.snapshot;
  ok('an action was issued, not recommended', !!r.action, r.action ? `${r.action.number} ${r.action.level}` : '(none)');
  ok('first step is Coaching', r.action?.level === 'Coaching', r.action?.level);
  ok('it carries a corrective action', !!r.action?.correctiveAction, r.action?.correctiveAction);
  ok('linked to the incident', r.action?.incidentNumber === r.incident.number);
  ok('NOT acknowledged yet', r.action?.driverAcknowledged === false);
  ok('issued by Safety, not an override', r.action?.issuedBy !== 'Management override', r.action?.issuedBy);
  ok('shows in the unacknowledged list', (S.views.unacknowledged || []).length === 1);

  head('Driver acknowledges it');
  S = await api(`/discipline/${encodeURIComponent(r.action.number)}/acknowledge`, 'POST', {});
  ok('unacknowledged list is empty', (S.views.unacknowledged || []).length === 0);
  ok('flag set on the record', S.discipline[0].driverAcknowledged === true);

  head('A second preventable climbs the ladder on its own');
  r = await api('/incidents', 'POST', {
    kind: 'Damage', severity: 'Moderate', faultAttribution: 'Driver', preventable: true,
    cost: 900, tripNumber: '', description: 'Caught the trailer on a kerb',
  });
  ok('escalated past Coaching', r.action?.level === 'WrittenWarning', r.action?.level);

  head('A serious one skips a rung');
  r = await api('/incidents', 'POST', {
    kind: 'Collision', severity: 'Serious', faultAttribution: 'Driver', preventable: true,
    cost: 4000, tripNumber: '', description: 'Rear-ended a car at a light',
  });
  ok('jumped to Final warning', r.action?.level === 'FinalWarning', r.action?.level);

  head('Non-driver fault attaches nothing');
  r = await api('/incidents', 'POST', {
    kind: 'Damage', severity: 'Serious', faultAttribution: 'Mechanical', preventable: false,
    cost: 2200, tripNumber: '', description: 'Steer tyre blew out at speed',
  });
  ok('no action issued', r.action === null || r.action === undefined, r.action?.level || '(none)');

  head('Dispatcher fault attaches nothing either');
  r = await api('/incidents', 'POST', {
    kind: 'Late', severity: 'Moderate', faultAttribution: 'Dispatcher', preventable: false,
    cost: 0, tripNumber: '', description: 'Booked with no slack',
  });
  ok('no action issued', !r.action, r.action?.level || '(none)');

  head('Manual issuing still works, but is marked as an override');
  r = await api('/discipline', 'POST', {
    level: 'Commendation', reason: 'Ten clean loads', correctiveAction: 'Keep it up',
    incidentNumber: '', expiresAfterLoads: 20,
  });
  ok('issued', !!r.action, r.action?.number);
  ok('labelled as an override', r.action?.issuedBy === 'Management override', r.action?.issuedBy);

  const ev = await api('/events?take=50');
  ok('override is logged as one', ev.some((e) => /OVERRIDE/.test(e.message)),
    ev.find((e) => /OVERRIDE/.test(e.message))?.message || '(not logged)');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
