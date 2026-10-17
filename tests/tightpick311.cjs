/* A load dispatch books has to be one the driver can accept (reported from play, v0.87, on probation, Kansas City):
 * "I am hard locked here, being told to take this load with 0:27 of slack, but when I try to take it I am being told
 * I can't." And: "the wording says something about home time and I'm not scheduled to be home."
 *
 *   - a listing whose trailer type the hooked trailer does not cover is a misread: dock time is the hooked trailer's
 *   - the nothing-clears-the-buffer pick is accepted by a driver with no say over tight loads
 *   - and it is not described as the run home
 *   - a plan that leaves the receiver for a reset and comes back measures slack from coming back
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
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
const at = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();

(async () => {
  const app = { driverName: 'T. Pick', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 0,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  const status = async () => api('/status', 'POST', { locationCity: 'Denver', locationState: 'CO', locationKind: 'TruckStop',
    gameTime: '2000-01-03T06:00', fuelPct: 90, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 40000 });
  await status();
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const load = (over) => ({ cargo: 'Paper', trailerType: type, shipper: 'S', receiver: 'R', atLocation: false,
    originCity: 'Denver', originState: 'CO', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 520, deadheadMiles: 5, gameRevenue: 2600, weightLbs: 30000, deadlineHours: 48, ...over });

  head('1. Listed as a Reefer, hooked to a ' + type);
  await api('/board/clear', 'POST', {});
  let d = await api('/board/add', 'POST', load({ trailerType: 'Reefer' }));
  let e = d.evaluations[0];
  const dockLine = (e.scoreDetail || []).find((x) => /Dock time assumed/.test(x)) || '';
  ok('the mismatch is said', (e.cons || []).some((c) => /Listed as a Reefer/.test(c)));
  ok('and the dock time is the hooked trailer\'s, not the reefer default of 3:00', !/3:00 to load/.test(dockLine), dockLine);

  head('2. Nothing clears the buffer: the pick dispatch makes is one the driver can take');
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', load({}));
  const gateAfter = 48 - d.evaluations[0].feasibility.slackHours;
  await api('/board/clear', 'POST', {});
  d = await api('/board/add', 'POST', load({ deadlineHours: Math.round((gateAfter + 0.8) * 100) / 100 }));
  e = d.evaluations[0];
  ok('tight and booked', e.feasibility.verdict === 'Tight' && d.authorizedLoadId === e.load.id, `${e.feasibility.verdict}, ${d.headline}`);
  ok('not described as the run home', !(d.dispatchNotes || []).some((n) => /run home|overdue home|heads there/.test(n)),
    (d.dispatchNotes || []).join(' | ').slice(0, 300));
  let trip = null, err = '';
  try { trip = (await api('/dispatch/authorize', 'POST', { loadId: e.load.id, rationale: null, overrideTight: false })).trip; }
  catch (x) { err = x.message; }
  ok('accepted with the ordinary Accept button', trip && trip.status === 'Authorized', err || trip?.number);
  if (trip) await api(`/trips/${trip.id}/cancel`, 'POST', { reason: 'test', fault: 'GameLimitation' }).catch(() => {});

  head('3. Short of window at the receiver: away for a reset, and slack from coming back');
  await status();
  await api('/hos', 'POST', { driveRemaining: 6, shiftRemaining: 6.5, breakRemaining: 8, cycleRemaining: 70 });
  let found = null;
  for (let i = 0; i < 40 && !found; i++) {
    await api('/board/clear', 'POST', {});
    d = await api('/board/add', 'POST', load({ receiver: `Dock ${i}`, destCity: 'Grand Junction', destState: 'CO',
      loadedMiles: 180, deadheadMiles: 0, deadlineHours: 30 }));
    const f = d.evaluations[0].feasibility;
    if ((f.timeline || []).some((t) => /Reposition to a truck stop — no/.test(t.label))) found = f;
  }
  ok('a receiver that will not have the truck overnight sends it away first', !!found);
  if (found) {
    const back = found.timeline.find((t) => /^Back to the receiver/.test(t.label));
    ok('the gate time is when the truck is back', back && at(found.projectedDockStartGameTime) >= at(back.endGameTime) - 60000,
      `${found.projectedDockStartGameTime} vs back ${back?.endGameTime}`);
    const slackFromBack = (at(found.dueGameTime) - at(found.projectedDockStartGameTime)) / 3600000;
    ok('and slack is measured from there', Math.abs(slackFromBack - found.slackHours) < 0.05, `${found.slackHours} vs ${slackFromBack.toFixed(2)}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
