/* Getting to a shipper across town, before the app has learned anything (reported from play, v0.86): a fresh
 * career parked at Amazon in Phoenix, a FedEx load forty-five minutes away planned as no time at all — and those
 * minutes were the difference between one rest on the way to San Francisco and two.
 *
 *   - a city row with no distance, in the town the truck is in, plans an hour to get there until pickups are learned
 *   - a row flagged as at this dock but naming another shipper is not at this dock
 *   - a row naming the place the truck is parked at still is
 *   - a move to another town does not carry the last receiver's name with it
 *   - at a rest stop every shipper is somewhere else, name or no name
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const app = { driverName: 'P. Ickup', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6,
    homeCity: 'Chicago', homeState: 'IL', acceptsProbation: true, homeTimePreference: 'none' };
  await api('/onboarding/market', 'POST', app);
  const S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' }));
  const type = S.trailers[0].type;
  await api('/status', 'POST', { locationCity: 'Phoenix', locationState: 'AZ', locationKind: 'Receiver', locationDetail: 'Amazon',
    gameTime: '2000-01-03T09:00', fuelPct: 90, atsOdometer: 5000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OnDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  const load = (over) => ({ cargo: 'Packaged Food', trailerType: type, shipper: 'FedEx', receiver: 'R',
    originCity: 'Phoenix', originState: 'AZ', destCity: 'Los Angeles', destState: 'CA',
    loadedMiles: 370, deadheadMiles: 0, gameRevenue: 1800, weightLbs: 40000, deadlineHours: 30, ...over });
  const first = (d) => d.evaluations[0];
  const pickupRow = (e) => e.feasibility.timeline.find((t) => /Deadhead to the shipper/.test(t.label));

  head('1. A city row across town, nothing learned yet');
  await api('/board/clear', 'POST', {});
  let e = first(await api('/board/add', 'POST', load({ atLocation: false })));
  const row = pickupRow(e);
  ok('an hour to get there, not none', row && Math.abs(row.hours - 1) < 0.01, row ? `${row.hours}h ${row.label}` : 'no pickup step');
  ok('  and it says it is a default, not learned', (e.feasibility.warnings || []).some((w) => /the default until there are enough/.test(w)));

  head('2. A dock row naming another shipper');
  await api('/board/clear', 'POST', {});
  e = first(await api('/board/add', 'POST', load({ atLocation: true })));
  ok('not at this dock', e.load.atLocation === false, String(e.load.atLocation));
  ok('  so the run across town is planned', !!pickupRow(e));

  head('3. A dock row naming where the truck is');
  await api('/board/clear', 'POST', {});
  e = first(await api('/board/add', 'POST', load({ atLocation: true, shipper: 'Amazon' })));
  ok('at this dock', e.load.atLocation === true, String(e.load.atLocation));
  ok('  with no run to plan', !pickupRow(e));

  head('4. Moved to another town without naming the place');
  await api('/status', 'POST', { locationCity: 'Tucson', locationState: 'AZ', locationKind: 'Shipper', gameTime: '2000-01-03T12:00' });
  ok('the last town\'s receiver is not carried over', (await api('/bootstrap')).status.locationDetail === '');
  await api('/board/clear', 'POST', {});
  e = first(await api('/board/add', 'POST', load({ atLocation: true, originCity: 'Tucson' })));
  ok('so a dock row here is taken at its word', e.load.atLocation === true, String(e.load.atLocation));

  head('5. At a rest stop in town, no place name to go on');
  await api('/status', 'POST', { locationCity: 'Phoenix', locationState: 'AZ', locationKind: 'RestArea', gameTime: '2000-01-03T14:00' });
  await api('/board/clear', 'POST', {});
  e = first(await api('/board/add', 'POST', load({ atLocation: false })));
  const rest = pickupRow(e);
  ok('nothing is loaded at a rest stop: an hour to the shipper', rest && Math.abs(rest.hours - 1) < 0.01, rest ? `${rest.hours}h` : 'no pickup step');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
