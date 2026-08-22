/* A small second career at a carrier that runs dedicated freight, purely for that screenshot. */
const B = 'http://127.0.0.1:5312/api';
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`${m} ${p}: ${j?.error || t.slice(0, 200)}`);
  return j;
}
const un = (r) => r.snapshot || r;

(async () => {
  const app = {
    driverName: 'J. Vance', preferredDivision: 'Dry Van', secondDivision: 'Reefer',
    transmissionPreference: 'automatic', experienceYears: 3, freightExperience: ['Dry Van'],
    preferredTripLength: 'medium', homeTimePreference: 'weekly',
    homeCity: 'Green Bay', homeState: 'WI', acceptsProbation: true,
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00', code: 'SNI' }));

  S = un(await api('/status', 'POST', {
    locationCity: 'Green Bay', locationState: 'WI', locationKind: 'Terminal',
    gameTime: '2000-01-03T07:00', fuelPct: 88, atsOdometer: 640,
    truckDamagePct: 1, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 41200,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 62 });

  const r = await api('/career/dedicated', 'POST', { onDedicated: true, account: 'Walmart' });
  S = r.snapshot;

  // A board where the account load is worth less than someone else's freight.
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Groceries', trailerType: 'Dry Van', atLocation: true,
    originCity: 'Green Bay', originState: 'WI', destCity: 'Chicago', destState: 'IL',
    loadedMiles: 210, deadheadMiles: 0, gameRevenue: 890, deadlineHours: 20,
    weightLbs: 38000, shipper: 'Walmart DC', receiver: 'Walmart RDC',
  });
  await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', atLocation: true,
    originCity: 'Green Bay', originState: 'WI', destCity: 'Minneapolis', destState: 'MN',
    loadedMiles: 290, deadheadMiles: 0, gameRevenue: 1640, deadlineHours: 24,
    weightLbs: 41000, shipper: 'Voltison', receiver: 'North Star Industrial',
  });
  const dec = await api('/board/add', 'POST', {
    cargo: 'Paper Rolls', trailerType: 'Dry Van', atLocation: true,
    originCity: 'Green Bay', originState: 'WI', destCity: 'Detroit', destState: 'MI',
    loadedMiles: 420, deadheadMiles: 0, gameRevenue: 1980, deadlineHours: 30,
    weightLbs: 43000, shipper: 'Ganton Mill', receiver: 'Great Lakes Print',
  });

  console.log(`carrier   : ${S.company.name}`);
  console.log(`dedicated : ${S.views.dedicated.dedicatedAccount}`);
  console.log(`decision  : ${dec.headline}`);
  console.log(`note      : ${dec.dispatchNotes.find((n) => /Dedicated/.test(n)) || ''}`);
  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
