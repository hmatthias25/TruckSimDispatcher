/* Dock time as the break, on the clocks (reported from play, v0.81): behind a dry van or a reefer the dock does
 * the work, and an hour of it is the 45-minute break — the planner always said so, but the break clock typed
 * after loading came off the companion, which never saw it, and the next plan sent the driver on a break they
 * had already had.
 *
 *   - End load after 45 minutes or more: the break clock is back to 4:30
 *   - clocks typed straight after, still showing the old B: kept at what the dock gave back
 *   - typed hours later: no more than the hours since could have used
 *   - a load under 45 minutes is not a break
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
const hos = async () => (await api('/export')).hos;
const clocks = (at, b) => api('/hos', 'POST', { driveRemaining: 6, shiftRemaining: 9, breakRemaining: b, cycleRemaining: 40, asOfGameTime: at,
  euWeekDriven: 16, euLastWeekDriven: 30, euHoursSinceWeeklyRest: 30, spreadEstimated: false });

async function take(at) {
  await api('/status', 'POST', { locationCity: 'Munich', locationState: 'DE', locationKind: 'Shipper', gameTime: at,
    fuelPct: 95, atsOdometer: 1000, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 90000 });
  await clocks(at, 1.5);
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Munich', originState: 'DE', destCity: 'Verona', destState: 'IT', loadedMiles: 270, deadheadMiles: 0,
    gameRevenue: 3000, deadlineHours: 72, weightLbs: 40000, atLocation: true }));
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick?.load?.id || (added.board || [])[0]?.id });
  return r.trip || (un(r).trips || [])[0];
}

(async () => {
  const app = { driverName: 'C. Smith', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. A dry van loaded for 1:10: the break clock is back to 4:30');
  let trip = await take('2000-01-03T06:00');
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: '2000-01-03T06:10' });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'EndLoad', gameTime: '2000-01-03T07:20' });
  let h = await hos();
  ok('B 4:30 after End load', h.breakRemaining === 4.5, `${h.breakRemaining}`);
  const ev = (await api('/export')).trips.find((t) => t.id === trip.id).events.find((e) => e.kind === 'EndLoad');
  ok('and the log says why', /counted as your 45-minute break/.test(ev.detail), ev.detail);

  head('2. Clocks typed straight after, the companion still on 1:30');
  await clocks('2000-01-03T07:20', 1.5);
  h = await hos();
  ok('kept at 4:30', h.breakRemaining === 4.5, `${h.breakRemaining}`);

  head('3. Typed three hours later: no more than 1:30 left of what the dock gave');
  await clocks('2000-01-03T10:20', 0.5);
  h = await hos();
  ok('B 1:30, not 4:30 and not the 0:30 typed', Math.abs(h.breakRemaining - 1.5) < 0.02, `${h.breakRemaining}`);
  await clocks('2000-01-03T10:20', 2.5);
  h = await hos();
  ok('and a higher reading than that stands', h.breakRemaining === 2.5, `${h.breakRemaining}`);

  head('4. A load under 45 minutes is not a break');
  await api(`/trips/${trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'GameLimitation' });
  trip = await take('2000-01-04T06:00');
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'BeginLoad', gameTime: '2000-01-04T06:10' });
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'EndLoad', gameTime: '2000-01-04T06:40' });
  h = await hos();
  ok('B left where it was', h.breakRemaining === 1.5, `${h.breakRemaining}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
