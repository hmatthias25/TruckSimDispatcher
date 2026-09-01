/* Issue #9: the carrier's equipment standard must decide what you are actually put in. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5411}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 250));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

const baseApp = (over) => ({
  driverName: 'Equip Tester', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
  experienceYears: 8, freightExperience: ['Dry Van', 'Flatbed', 'Reefer'], homeCity: 'Denver', homeState: 'CO',
  acceptsProbation: true, homeTimePreference: 'monthly', hasHazmat: true, hasTanker: true, hasDoublesTriples: true,
  ...over,
});

async function hireAt(code, over) {
  const app = baseApp(over);
  await api('/reset', 'POST', { confirm: 'RESET', resetSettings: false });
  await api('/onboarding/market', 'POST', app);
  const r = await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00', code });
  return un(r);
}

(async () => {
  head('Market: equipment stars vary and are visible');
  let app = baseApp();
  await api('/onboarding/market', 'POST', app);
  const mk = (await api('/onboarding/market', 'POST', app)).market;
  const byStars = {};
  mk.forEach((c) => { (byStars[c.equipmentStars] ||= []).push(c.code); });
  ok('carriers span several standards', Object.keys(byStars).length >= 3, JSON.stringify(byStars));

  const five = mk.find((c) => c.equipmentStars === 5);
  const low = mk.filter((c) => c.equipmentStars <= 2).sort((a, b) => a.equipmentStars - b.equipmentStars)[0]
    || mk.sort((a, b) => a.equipmentStars - b.equipmentStars)[0];
  ok('found a 5-star carrier', !!five, five?.name);
  ok('found a low-star carrier', !!low, `${low?.name} (${low?.equipmentStars}★)`);

  head(`Hire at ${low.name} — ${low.equipmentStars} star`);
  let S = await hireAt(low.code);
  const lowTruck = S.trucks[0];
  ok('company stores the standard', S.company.equipmentStars === low.equipmentStars,
    `${S.company.equipmentStars}`);
  console.log(`     ${lowTruck.year} ${lowTruck.make} ${lowTruck.model}, ${Math.round(lowTruck.serviceMiles).toLocaleString()} mi, ${lowTruck.avgMpg} mpg`);
  ok('automatic honoured', lowTruck.transmissionType === 'automatic', lowTruck.transmission);

  head(`Hire at ${five.name} — 5 star`);
  S = await hireAt(five.code);
  const hiTruck = S.trucks[0];
  ok('company stores the standard', S.company.equipmentStars === 5, `${S.company.equipmentStars}`);
  console.log(`     ${hiTruck.year} ${hiTruck.make} ${hiTruck.model}, ${Math.round(hiTruck.serviceMiles).toLocaleString()} mi, ${hiTruck.avgMpg} mpg`);
  ok('automatic honoured', hiTruck.transmissionType === 'automatic', hiTruck.transmission);

  head('The better carrier gives the better truck');
  ok('newer model year', hiTruck.year > lowTruck.year, `${hiTruck.year} vs ${lowTruck.year}`);
  ok('fewer miles on it', hiTruck.serviceMiles < lowTruck.serviceMiles,
    `${Math.round(hiTruck.serviceMiles).toLocaleString()} vs ${Math.round(lowTruck.serviceMiles).toLocaleString()}`);
  ok('better fuel economy', hiTruck.avgMpg >= lowTruck.avgMpg, `${hiTruck.avgMpg} vs ${lowTruck.avgMpg}`);
  ok('it is a sleeper, not a day cab', hiTruck.cabConfig === 'Sleeper', hiTruck.cabConfig);

  head('Manual preference still honoured at both ends');
  S = await hireAt(five.code, { transmissionPreference: 'manual' });
  const hiMan = S.trucks[0];
  ok('5-star manual is a manual', hiMan.transmissionType === 'manual', `${hiMan.year} ${hiMan.make} ${hiMan.model} — ${hiMan.transmission}`);
  S = await hireAt(low.code, { transmissionPreference: 'manual' });
  const loMan = S.trucks[0];
  ok('low-star manual is a manual', loMan.transmissionType === 'manual', `${loMan.year} ${loMan.make} ${loMan.model}`);
  ok('and still worse than the 5-star manual', hiMan.year > loMan.year, `${hiMan.year} vs ${loMan.year}`);

  head('Stocking a yard respects the same standard');
  S = await hireAt(five.code);
  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  const stock = await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'automatic', addTrailers: false,
  });
  S = stock.snapshot;
  const added = S.trucks.filter((t) => stock.result.trucks.includes(t.unit));
  const oldest = Math.min(...added.map((t) => t.year));
  ok('stocked units are modern too', oldest >= 2020, `oldest stocked: ${oldest}`);
  added.forEach((t) => console.log(`     ${t.unit}: ${t.year} ${t.make} ${t.model}, ${Math.round(t.serviceMiles).toLocaleString()} mi`));

  head('Joining a carrier does NOT create yards in undiscovered cities');
  S = await hireAt(five.code);
  ok('exactly one yard on hire', S.company.terminals.length === 1,
    `${S.company.terminals.length}: ${S.company.terminals.map((t) => t.city).join(', ')}`);
  ok('nothing flagged as undiscovered backdrop', S.views.backdrop.yards === 0, JSON.stringify(S.views.backdrop));

  head('Garages you own survive a change of employer');
  S = un(await api('/terminals', 'POST', {
    city: 'Amarillo', state: 'TX', level: 'Medium', truckCapacity: 3, hasFuel: true, hasParking: true,
  }));
  const before = S.company.terminals.map((t) => t.city).sort();
  ok('two yards now', before.length === 2, before.join(', '));
  await api('/career/clear-probation', 'POST', { force: true, note: 'test setup' });   // see #157 — a probationary driver is a one-in-ten application
  const moved = await api('/market/apply', 'POST', { code: low.code, reason: 'Better home time' });
  S = un(moved);
  const after = S.company.terminals.map((t) => t.city).sort();
  ok('bought yard is still there', after.includes('Amarillo'), after.join(', '));
  ok('new employer HQ present', S.company.terminals.some((t) => t.isHeadquarters),
    S.company.terminals.filter((t) => t.isHeadquarters).map((t) => t.city).join(','));
  ok('equipment standard followed the move', S.company.equipmentStars === low.equipmentStars,
    `${S.company.equipmentStars} (expected ${low.equipmentStars})`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
