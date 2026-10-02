/* #269 - step 3 of Euro Truck Simulator 2 support (#266): the European data.
 *
 * Nobody can START an ETS2 career until onboarding offers the choice (#275), so this makes one the way
 * an old career file would arrive: export, set the game, import. Then it checks that every table the
 * profile hands out answers for Europe - and that an ATS career next to it still answers for America.
 *
 *   - countries, one switch each, every one on by default (decided: "just in case a person doesn't want
 *     to go all the way to Iceland"), grouped by base game, map DLC, ProMods and ProMods Middle-East
 *   - city coordinates, under the game's own spellings
 *   - the freight markets, SCS and ProMods
 *   - metric and euros by default, fuel by country, ADR, carriers in Europe
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5977}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const KM = 1.609344;
const km = async (a, sa, b, sb) => {
  const r = await api(`/geo/distance?cityA=${encodeURIComponent(a)}&stateA=${sa}&cityB=${encodeURIComponent(b)}&stateB=${sb}`);
  return { km: r.miles == null ? null : r.miles * KM, measured: r.measured };
};

(async () => {
  const app = { driverName: 'K. Vogel', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) });

  head('0. An ATS career still answers for America');
  const atsDist = await km('Dallas', 'TX', 'Houston', 'TX');
  ok('Dallas to Houston is measured', atsDist.measured && atsDist.km > 300, `${Math.round(atsDist.km)} km`);
  const atsRegions = (await api('/bootstrap')).views.mapCoverage;
  ok('its regions are states', atsRegions.regions.some((r) => r.code === 'TX'), `${atsRegions.regions.length} regions`);

  head('1. The same career, opened as ETS2');
  const state = await api('/export');
  state.game = 'ETS2';
  state.settings.runnableStates = [];          // no choice made yet: the game's default applies
  await api('/import', 'POST', state);
  const boot = await api('/bootstrap');
  ok('the career is ETS2', boot.game?.id === 'ETS2' && boot.game.name === 'Euro Truck Simulator 2', boot.game?.name);
  ok('shown in km, litres and kg', boot.units?.id === 'metric' && boot.units.distance === 'km' && boot.units.volume === 'L',
    `${boot.units?.distance} ${boot.units?.volume} ${boot.units?.weight}`);
  ok('in euros', boot.units?.symbol === '€' && boot.units.currency === 'EUR', `${boot.units?.symbol} ${boot.units?.currency}`);

  head('2. Where you run is countries, every one on by default');
  const mc = boot.views.mapCoverage;
  const codes = mc.regions.map((r) => r.code);
  ok('the regions are countries', codes.includes('DE') && codes.includes('FR') && !codes.includes('TX'), `${codes.length} countries`);
  ok('every one of them on', mc.regions.every((r) => r.on), `${mc.selectedCount} of ${mc.regions.length} on`);
  for (const c of ['IS', 'IE', 'NO', 'UA', 'GE', 'SJ', 'EG']) ok(`${c} is there to switch off`, codes.includes(c));
  const groups = (mc.groups || []).map((g) => g.key);
  ok('grouped by where the country comes from',
    ['Base game', 'Scandinavia', 'Iberia', 'West Balkans', 'ProMods', 'ProMods Middle-East'].every((k) => groups.includes(k)),
    groups.join(' · '));
  ok('Northern Ireland is part of the UK, not a country of its own', !codes.includes('NI') && codes.includes('UK'));
  ok('the panel says what the default means', /Iceland/.test(mc.defaultNote || ''), (mc.defaultNote || '').slice(0, 80));

  // Switching one off is the point of the setting.
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, runnableStates: codes.filter((c) => c !== 'IS') });
  const after = (await api('/bootstrap')).views.mapCoverage;
  ok('Iceland can be switched off on its own', after.regions.find((r) => r.code === 'IS')?.on === false
    && after.regions.filter((r) => r.on).length === codes.length - 1);
  await api('/settings', 'POST', { ...(await api('/bootstrap')).settings, runnableStates: [] });

  head('3. Distances come off European coordinates, under the game\'s spellings');
  const bp = await km('Berlin', 'DE', 'Praha', 'CZ');
  ok('Berlin to Praha is measured', bp.measured, String(bp.measured));
  ok('and about the right distance', bp.km > 280 && bp.km < 420, `${Math.round(bp.km)} km by road estimate`);
  const local = await km('Wien', 'AT', 'Graz', 'AT');
  ok('Wien and Graz are found by the names the game uses', local.measured && local.km > 120 && local.km < 260, `${Math.round(local.km)} km`);
  const accent = await km('København', 'DK', 'Kobenhavn', 'DK');
  ok('accents fold: København and Kobenhavn are one place', accent.measured && accent.km === 0, `${accent.km}`);
  const promods = await km('Reykjavík', 'IS', 'Akureyri', 'IS');
  ok('ProMods\' Iceland is on the map too', promods.measured && promods.km > 250, `${Math.round(promods.km || 0)} km`);
  ok('the coordinate table is the European one', (await api('/geo/meta')).knownCityCount > 50000,
    String((await api('/geo/meta')).knownCityCount));

  head('4. The freight markets are ETS2\'s');
  const markets = await api('/markets');
  ok('a full table', markets.length >= 450, `${markets.length} shown (capped at 500)`);
  const scs = await api('/markets?state=DE');
  ok('German cities, tiered', scs.some((c) => c.city === 'Berlin') && scs.every((c) => c.tier >= 1 && c.tier <= 3), `${scs.length} in DE`);
  const ice = await api('/markets?state=IS');
  ok('Iceland\'s ProMods cities are in it', ice.length > 10 && ice.every((c) => c.source === 'ProMods' || c.source === 'Iceland'),
    `${ice.length} in IS`);
  const tr = await api('/markets?state=TR');
  // The English names the cargo list shows (localized names on, the default): Istanbul, not İstanbul.
  ok('and the names the game shows in English', tr.some((c) => c.city === 'Istanbul') && tr.some((c) => c.city === 'Tekirdağ'),
    tr.map((c) => c.city).join(', '));

  head('5. Fuel, ADR, carriers');
  ok('fuel is priced in euros per litre', boot.settings.fuelPricePerGal > 0, `stored ${boot.settings.fuelPricePerGal} per gallon`);
  const keys = [...new Set((JSON.stringify(boot).match(/"label":"ADR class (\d)/g) || []).map((k) => k.slice(-1)))].sort().join(',');
  ok('dangerous goods are ADR classes', keys === '1,2,3,4,6,8', keys || '(none labelled ADR)');
  const market = (await api('/market')).market || [];
  const names = market.map((c) => c.name);
  ok('the carriers are European', names.includes('Girteka') || names.includes('Baltic Line Logistics'), names.slice(0, 5).join(', '));
  ok('and none of them American', !names.includes('Schneider National') && !names.includes('Werner Enterprises'));

  head('6. Back to ATS, nothing of Europe is left');
  const back = await api('/export');
  back.game = 'ATS';
  await api('/import', 'POST', back);
  const b2 = await api('/bootstrap');
  ok('ATS again', b2.game?.id === 'ATS' && b2.units?.symbol === '$', `${b2.game?.id} ${b2.units?.symbol}`);
  const again = await km('Dallas', 'TX', 'Houston', 'TX');
  ok('and America is measured again', again.measured && Math.abs(again.km - atsDist.km) < 0.01, `${Math.round(again.km)} km`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
