/* #268 - step 2 of Euro Truck Simulator 2 support (#266): figures in the career's units.
 *
 * The career is stored in miles, US gallons and pounds whatever the player sees; what changes is what is
 * shown. ATS shows US units unless Settings says otherwise (ATS itself can be driven in km), and an ETS2
 * career will show metric by default. This proves the server half: the units the snapshot reports, that
 * switching changes what the app SAYS and not what it STORES, that money keeps the game's currency, and
 * that switching back is exact. The browser half reads S.units and is the same arithmetic.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5976}/api`;
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
const KM = 1.609344;

async function setUnits(v) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, displayUnits: v });
}

/** The words dispatch writes about a board, which carry distance and money. */
async function board(miles) {
  await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'Shipper', gameTime: iso(6, '06:00'),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2, dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Paper Rolls', trailerType: 'Dry Van', receiver: 'Topeka Paper', originCity: 'Wichita', originState: 'KS',
    destCity: 'Topeka', destState: 'KS', loadedMiles: miles, deadheadMiles: 0, gameRevenue: 1500,
    deadlineHours: 30, weightLbs: 40000, atLocation: true,
  });
  return api('/board/evaluate');
}

(async () => {
  const app = { driverName: 'A. Novak', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 7, homeCity: 'Wichita', homeState: 'KS', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(5) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. An ATS career shows US units by default');
  let u = (await api('/bootstrap')).units;
  ok('the snapshot reports the units', !!u, JSON.stringify(u));
  ok('miles, gallons, pounds', u?.id === 'US' && u.distance === 'mi' && u.volume === 'gal' && u.weight === 'lb',
    `${u?.distance} ${u?.volume} ${u?.weight}`);
  ok('in dollars', u?.symbol === '$' && u.currency === 'USD', `${u?.symbol} ${u?.currency}`);
  ok('and says what the game default is', u?.gameDefault === 'US' && u.chosen === '', `${u?.gameDefault} / "${u?.chosen}"`);
  const usText = JSON.stringify(await board(130));
  ok('dispatch talks in miles', /\d+ total miles/.test(usText), (usText.match(/[^"]*total miles[^"]*/) || [''])[0].slice(0, 100));

  head('2. Switched to metric, the app says km and stores miles');
  await setUnits('metric');
  u = (await api('/bootstrap')).units;
  ok('the snapshot reports metric', u?.id === 'metric' && u.distance === 'km' && u.volume === 'L' && u.weight === 'kg',
    `${u?.distance} ${u?.volume} ${u?.weight}`);
  ok('with the conversion factors the browser needs', Math.abs(u?.distancePerMile - KM) < 1e-9, String(u?.distancePerMile));
  ok('and still the game\'s currency', u?.symbol === '$', u?.symbol);
  ok('it remembers that it was chosen', u?.chosen === 'metric', u?.chosen);
  const kmText = JSON.stringify(await board(130));
  const total = kmText.match(/on (\d[\d,]*) total km/);
  ok('dispatch talks in km', !!total, (kmText.match(/[^"]*total km[^"]*/) || [''])[0].slice(0, 100));
  ok('130 mi reads as 209 km', total && +total[1].replace(/,/g, '') === Math.round(130 * KM), total?.[1]);
  ok('and per-km rates, not per-mile', /\$\d+\.\d\d\/km all-in/.test(kmText), (kmText.match(/\$[\d.]+\/km all-in/) || [''])[0]);
  ok('no mile left in what dispatch said', !/total miles/.test(kmText));
  const stored = (await api('/export')).board || [];
  ok('the board is still stored in miles', stored.some((l) => l.loadedMiles === 130),
    stored.map((l) => l.loadedMiles).join(','));

  head('3. Switching back is exact');
  await setUnits('US');
  u = (await api('/bootstrap')).units;
  ok('chosen US', u?.id === 'US' && u.chosen === 'US', `${u?.id} / ${u?.chosen}`);
  const back = JSON.stringify(await board(130));
  ok('dispatch says exactly what it said before', back.match(/on [\d,]+ total miles/)?.[0] === usText.match(/on [\d,]+ total miles/)?.[0],
    back.match(/on [\d,]+ total miles/)?.[0]);
  await setUnits('');
  u = (await api('/bootstrap')).units;
  ok('and clearing it goes back to the game\'s own', u?.id === 'US' && u.chosen === '', `${u?.id} / "${u?.chosen}"`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
