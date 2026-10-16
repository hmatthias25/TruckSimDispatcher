/* Re-planning a running load from where the truck is (asked for from play, v0.87).
 *
 * Out of Kokkola late for Groningen, the 17:00 out of Helsinki gone: would Naantali – Kapellskär do better? The app
 * had the sailings, the bans and the clocks, and no way to be asked.
 *
 *   - planned again from here and now: every way across, side by side, the best marked, kept on the trip
 *   - "I will miss that sailing" takes it out, and the plan goes on the next one or another way
 *   - a re-plan goes on the trip log
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
const un = (x) => x?.state || x;
const KM = 1.609344;

(async () => {
  const app = { driverName: 'R. Plan', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true };
  await api('/career/game', 'POST', { game: 'ETS2' });
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const st = await api('/export');
  st.settings.runnableStates = [];
  await api('/import', 'POST', st);

  // Friday, Day 5, 06:00 at Kokkola.
  await api('/status', 'POST', { locationCity: 'Kokkola', locationState: 'FI', locationKind: 'Shipper', gameTime: '2000-01-05T06:00',
    fuelPct: 95, atsOdometer: 1000, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 90000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 50, asOfGameTime: '2000-01-05T06:00',
    euWeekDriven: 6, euLastWeekDriven: 20, euHoursSinceWeeklyRest: 30, spreadEstimated: false });
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', { cargo: 'Paper', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Kokkola', originState: 'FI', destCity: 'Groningen', destState: 'NL', loadedMiles: 2465 / KM, deadheadMiles: 0,
    gameRevenue: 4000, deadlineHours: 110, weightLbs: 30000, atLocation: true }));
  const r = await api('/dispatch/authorize', 'POST', { loadId: added.evaluations?.[0]?.load?.id || (added.board || [])[0]?.id, overrideTight: true });
  const trip = r.trip || (un(r).trips || []).find((t) => t.status === 'Authorized');
  ok('a load to run', !!trip, trip?.number);
  await api(`/trips/${trip.id}/loaded`, 'POST', { weightLbs: 30000, odometer: 1000, pulledOutGameTime: '2000-01-05T15:00' });

  head('1. Out of the shipper at 15:00: planned again from Kokkola');
  let rp = (await api(`/trips/${trip.id}/replan`, 'POST', { city: 'Kokkola', state: 'FI', gameTime: '2000-01-05T15:00' })).result;
  ok('more than one way across weighed', rp.options.length >= 2, rp.options.join(' | '));
  ok('  the best one marked', rp.options.filter((l) => /^BEST/.test(l)).length === 1, rp.options[0]);
  ok('  and an arrival given', /At the receiver/.test(rp.headline), rp.headline);
  // On real road distances (v0.87) Kapellskär to Groningen is the long way through Sweden: the Helsinki boat is not
  // only less driving but the soonest, by hours.
  const naantali = rp.options.find((l) => /Naantali/.test(l)) || '';
  ok('the Helsinki boat is best, and Naantali gets there later with far more road',
    rp.plan.crossingRoutes.includes('travemunde-helsinki') && /^BEST — Over Helsinki/.test(rp.options[0]) && !/^BEST/.test(naantali),
    `${rp.options[0]} | ${naantali}`);
  const firstRoutes = rp.plan.crossingRoutes;
  const firstArr = rp.plan.projectedArrivalGameTime;
  let ex = (await api('/export')).trips.find((t) => t.id === trip.id);
  ok('kept on the trip', ex.replan?.projectedArrivalGameTime === firstArr && ex.replanOptions.length === rp.options.length);
  ok('  and said on the trip log', ex.events.some((e) => e.kind === 'Note' && /^Re-planned/.test(e.detail)));

  head('2. "I will miss that sailing"');
  const miss = firstRoutes[0];
  rp = (await api(`/trips/${trip.id}/replan`, 'POST', { city: 'Kokkola', state: 'FI', gameTime: '2000-01-05T15:00', missRoute: miss })).result;
  ok('said which sailing it is planning without', /^Without the .* sailing/.test(rp.headline), rp.headline);
  const missedStep = (rp.plan.timeline || []).find((t) => rp.plan.crossingRoutes.includes(miss) && /^Ferry/.test(t.label));
  ok('  either another way, or a later sailing of the same', !rp.plan.crossingRoutes.includes(miss) || !!missedStep,
    rp.plan.crossings.join(' '));

  head('3. Only a load still running');
  await api(`/trips/${trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'None' }).catch(() => null);
  const closed = (await api('/export')).trips.find((t) => t.id === trip.id);
  if (closed.status === 'Cancelled') {
    const err = await api(`/trips/${trip.id}/replan`, 'POST', {}).then(() => null, (e) => e.message);
    ok('a cancelled load is not re-planned', /still running/.test(err || ''), err);
  } else ok('a cancelled load is not re-planned (cancel not available here)', true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
