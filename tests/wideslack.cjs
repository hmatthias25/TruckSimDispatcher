/* A tier-one city is one name covering a great deal of ground, and the pickup inside it is a drive.
 *
 *   "We should expand slack to 3 hours for tier 1 city PICKUPS and only those on the CITY BOARD. Tier 1
 *    cities you may have to drive more than 2 hours to get the load as they cover a lot of area so this
 *    would help make deliveries more reasonable. Rest of the tiers should remain at 2."
 *
 *   "tier one slack at 2 hours is fine for the board at the receiver since we are already there"
 *
 * Los Angeles, Dallas and Chicago are each a single entry in Markets.cs and an hour and a half of
 * driving end to end. A listing names the city and not the street, so the deadhead to a shipper
 * somewhere inside one is both long and badly estimated — and the required buffer is the app's only
 * defence against an estimate it knows is soft.
 *
 * TWO CONDITIONS, BOTH NECESSARY. Off the CITY board, because a load offered at the facility the truck
 * is already standing at has no such drive in front of it. And tier ONE, because the problem is the
 * size of the market rather than the strength of it — the thinner tiers are single towns where the
 * shipper is ten minutes away.
 *
 * Added to the configured buffer rather than replacing it, so a driver who has set their own margin
 * keeps it and gets the extra hour on top. Against the default two, it reads as the three asked for.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5907}/api`;
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

/** One load on an empty board, evaluated, and the buffer its plan asked for. */
async function bufferFor({ originCity, originState, atLocation }) {
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', atLocation,
    originCity, originState, destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 600, deadheadMiles: atLocation ? 0 : 30, gameRevenue: 1600,
    deadlineHours: 72, weightLbs: 30000,
  });
  const ev = (await api('/board/evaluate')).evaluations || [];
  return ev[0]?.feasibility?.requiredBufferHours;
}

(async () => {
  const app = { driverName: 'W. Probe', preferredDivision: 'Dry Van', experienceYears: 6,
    homeCity: 'Dallas', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  const base = (await api('/bootstrap')).settings.safetyBufferHours;
  console.log(`  ..    the configured safety buffer is ${base}h`);

  head('1. A tier-one pickup off the city board buys an hour');
  await api('/status', 'POST', {
    locationCity: 'Dallas', locationState: 'TX', locationKind: 'Shipper', gameTime: '2000-01-01T08:00',
    fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 500000,
  });
  const cityT1 = await bufferFor({ originCity: 'Dallas', originState: 'TX', atLocation: false });
  ok('three hours against the default two', Math.abs(cityT1 - (base + 1)) < 0.01, `${cityT1}h`);

  head('2. The same city at the dock does not');
  //   "tier one slack at 2 hours is fine for the board at the receiver since we are already there"
  const dockT1 = await bufferFor({ originCity: 'Dallas', originState: 'TX', atLocation: true });
  ok('still the configured two', Math.abs(dockT1 - base) < 0.01, `${dockT1}h`);
  ok('and the city board really is the only difference', cityT1 > dockT1,
    `city ${cityT1}h vs dock ${dockT1}h`);

  head('3. The thinner tiers stay where they are, on either board');
  //   "Rest of the tiers should remain at 2." A tier-three town is a town: the shipper is ten minutes
  //   away and there is nothing to buffer against.
  await api('/status', 'POST', {
    locationCity: 'Eureka', locationState: 'CA', locationKind: 'Shipper', gameTime: '2000-01-01T08:00',
    fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 500000,
  });
  const cityT3 = await bufferFor({ originCity: 'Eureka', originState: 'CA', atLocation: false });
  ok('a tier-three city board pickup is unchanged', Math.abs(cityT3 - base) < 0.01, `${cityT3}h`);
  const dockT3 = await bufferFor({ originCity: 'Eureka', originState: 'CA', atLocation: true });
  ok('and so is the dock', Math.abs(dockT3 - base) < 0.01, `${dockT3}h`);

  head('4. A tier-two city is not a tier-one city');
  // The line is drawn at tier one on purpose: it is about the size of the market, and Barstow is not
  // Los Angeles however well it reloads.
  await api('/status', 'POST', {
    locationCity: 'Barstow', locationState: 'CA', locationKind: 'Shipper', gameTime: '2000-01-01T08:00',
    fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 500000,
  });
  const cityT2 = await bufferFor({ originCity: 'Barstow', originState: 'CA', atLocation: false });
  ok('tier two gets nothing extra', Math.abs(cityT2 - base) < 0.01, `${cityT2}h`);

  head('5. It is added to the driver’s own margin, not substituted for it');
  // Somebody who has set a four-hour buffer has said what their margin is. The extra hour is about the
  // drive across a large market, which is a different thing and sits on top.
  await api('/settings', 'POST', { ...(await api('/bootstrap')).settings, safetyBufferHours: 4 });
  await api('/status', 'POST', {
    locationCity: 'Los Angeles', locationState: 'CA', locationKind: 'Shipper', gameTime: '2000-01-01T08:00',
    fuelPct: 100, atsOdometer: 100000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 500000,
  });
  const wide = await bufferFor({ originCity: 'Los Angeles', originState: 'CA', atLocation: false });
  ok('a four-hour margin becomes five on a tier-one city pickup', Math.abs(wide - 5) < 0.01, `${wide}h`);
  const narrow = await bufferFor({ originCity: 'Los Angeles', originState: 'CA', atLocation: true });
  ok('and stays four at the dock', Math.abs(narrow - 4) < 0.01, `${narrow}h`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
