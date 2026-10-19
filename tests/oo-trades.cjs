/* Owner-Operator 0.9: owning a trailer, specialist brokers, and the companies that hire directly.
 *
 *   - power-only to start, on the Freight Market; a trailer bought opens the Cargo Market, and not mid-run
 *   - every region has a specialist per trade, who wants the trailer for it (and ADR for fuel) besides a record
 *   - the eight companies decided with the project owner are in the roster, premium, wanting a long record
 *   - each listing is put in a trade, by the shipping company or the trailer
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'T. Rade', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal' });

  head('1. Power-only to start');
  ok('the Freight Market', S.trailer.powerOnly && S.trailer.market === 'Freight Market', JSON.stringify(S.trailer));

  head('2. Specialists');
  const specs = S.directory.filter((b) => b.specialty !== 'General' && b.kind === 'Broker');
  ok('one per trade in the home region', ['Agriculture', 'Fuel and petroleum', 'Lumber and forest products', 'Construction and steel']
    .every((t) => specs.some((b) => b.specialty === t)), specs.map((b) => b.specialty).join(', '));
  const fuel = specs.find((b) => b.specialty === 'Fuel and petroleum');
  ok('a fuel specialist wants a tanker and ADR, besides a record', /tanker/.test(fuel.notYet) && /ADR for flammable liquids/.test(fuel.notYet) && /loads/.test(fuel.notYet), fuel.notYet);
  ok('and says so in the directory', /tanker/.test(fuel.requirement), fuel.requirement);

  head('3. Buying a tanker');
  S = await api('/trailer', 'POST', { type: 'Tanker', gameId: 'ABC 123', year: 2018 });
  ok('it goes behind the truck: the Cargo Market', !S.trailer.powerOnly && S.trailer.type === 'Tanker' && S.trailer.market === 'Cargo Market');
  const fuel2 = S.directory.find((b) => b.id === fuel.id);
  ok('the fuel specialist no longer asks for the trailer', !/tanker/.test(fuel2.notYet) && /ADR/.test(fuel2.notYet), fuel2.notYet);
  S = await api('/settings', 'POST', { skills: { longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: ['Flammable liquids'] } });
  ok('nor, with ADR, for that: only the record', !/ADR/.test(S.directory.find((b) => b.id === fuel.id).notYet), S.directory.find((b) => b.id === fuel.id).notYet);
  ok('a kind of trailer the game does not sell is refused', /Which kind/.test(await refused(() => api('/trailer', 'POST', { type: 'Spaceship' }))));
  S = await api('/trailer/power-only', 'POST');
  ok('and back to power-only, keeping the tanker on the books', S.trailer.powerOnly && S.ownedTrailer && S.ownedTrailer.type === 'Tanker');

  head('4. The companies that hire directly');
  const all = ['Wallbert', 'Shop Town', 'Plaster & Sons', 'Taylor Construction Group', 'Sunshine Crops', "Farmer's Barn", 'Vortex', 'Gallon Oil'];
  const known = S.directory.filter((b) => b.kind === 'Shipper');
  ok('those working this region are in the directory', known.length > 0 && known.every((b) => all.includes(b.name)), known.map((b) => b.name).join(', '));
  ok('premium, and wanting a long record', known.every((b) => b.tier === 'Premium' && /60 loads/.test(b.notYet)), known[0] && known[0].notYet);

  head('5. Trades on the board');
  S = (await api('/board/add-many', 'POST', [
    { cargo: 'Diesel', shipper: 'Gallon Oil', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 900, deadlineHours: 30 },
    { cargo: 'Logs', trailerType: 'Log', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 400, deadlineHours: 30 },
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
  ])).snapshot;
  const trade = (cargo) => S.board.find((v) => v.load.cargo === cargo).trade;
  ok('Gallon Oil freight is fuel', trade('Diesel') === 'Fuel and petroleum', trade('Diesel'));
  ok('a log trailer is lumber', trade('Logs') === 'Lumber and forest products', trade('Logs'));
  ok('anything else is general', trade('Paper') === 'General', trade('Paper'));

  head('6. Not mid-run');
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.specialty === 'General');
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  if (r.call.status === 'Open') {
    await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
    ok('no trailer swap with a load on', /Deliver it first/.test(await refused(() => api('/trailer', 'POST', { type: 'Dry Van' }))));
  } else ok('a starter broker had an offer', false, r.call.turns.at(-1).text);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
