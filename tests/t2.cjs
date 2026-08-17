const B = `http://127.0.0.1:${process.env.TSD_PORT || 5277}/api`;
let fails = 0, passes = 0;

async function api(path, method = 'GET', body) {
  const r = await fetch(B + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(json?.error || text.slice(0, 300)); e.status = r.status; throw e; }
  return json;
}
const check = (l, c, d = '') => { if (c) { passes++; console.log(`  PASS  ${l}${d ? ' — ' + d : ''}`); } else { fails++; console.log(`  FAIL  ${l}${d ? ' — ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  const app = {
    driverName: 'Fleet Owner', preferredDivision: 'Reefer', transmissionPreference: 'manual',
    experienceYears: 8, freightExperience: ['Reefer'], homeCity: 'Fresno', homeState: 'CA', acceptsProbation: true,
  };
  await api('/onboarding/market', 'POST', app);
  let S = (await api('/onboarding/hire', 'POST', { application: app, force: true })).snapshot;

  head('Start state');
  let hq = S.company.terminals[0];
  check('starts Small / capacity 1', hq.level === 'Small' && hq.truckCapacity === 1, `${hq.level} cap ${hq.truckCapacity}`);
  check('starts with 1 truck', S.trucks.length === 1);

  head('A full small yard refuses more, and says how to fix it');
  let refused = null;
  try {
    await api('/fleet/stock', 'POST', { terminalId: hq.id, count: 4, alreadyBought: true, transmissionPreference: 'manual', addTrailers: true });
  } catch (e) { refused = e.message; }
  check('refused while Small', refused !== null, refused || '(not refused!)');
  check('message points at the upgrade', /Upgrade it to Medium \(3\) or Large \(5\)/.test(refused || ''), refused || '');

  head('Upgrade the home garage to Large');
  S = await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' });
  hq = S.company.terminals.find((t) => t.id === hq.id);
  check('now Large', hq.level === 'Large', hq.level);
  check('capacity 5', hq.truckCapacity === 5, `${hq.truckCapacity}`);
  check('has a shop now', hq.hasShop === true);

  head('Stock the yard in one step');
  const stock = await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 4, alreadyBought: true, transmissionPreference: 'manual', addTrailers: true,
  });
  S = stock.snapshot;
  console.log(`  (${stock.result.message})`);
  check('4 tractors added', stock.result.trucks.length === 4, stock.result.trucks.join(', '));
  check('4 trailers added', stock.result.trailers.length === 4, stock.result.trailers.join(', '));
  check('fleet is now 5', S.trucks.length === 5, `${S.trucks.length}`);
  check('yard is full', stock.result.roomLeft === 0, `${stock.result.roomLeft} left`);
  check('unit numbers do not collide', new Set(S.trucks.map((t) => t.unit)).size === 5,
    S.trucks.map((t) => t.unit).join(' '));
  check('trailer numbers do not collide', new Set(S.trailers.map((t) => t.unit)).size === S.trailers.length,
    S.trailers.map((t) => t.unit).join(' '));
  check('all based at HQ', S.trucks.every((t) => t.homeTerminalId === hq.id));
  check('all marked in-garage as asked', S.trucks.every((t) => t.inGameGarage === true));
  check('manual preference honoured', S.trucks.filter((t) => t.transmissionType === 'manual').length === 5,
    S.trucks.map((t) => t.transmissionType[0]).join(''));
  check('damage all zero (never invented)', S.trucks.every((t) => t.damagePct === 0));
  check('nothing flagged as backdrop', S.views.backdrop.any === false, JSON.stringify(S.views.backdrop));

  head('Over-asking clamps to the room left rather than erroring');
  S = await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Medium' });
  // Medium is 3 but 5 are based here — capacity is now negative, so it must refuse.
  let over = null;
  try { await api('/fleet/stock', 'POST', { terminalId: hq.id, count: 2, alreadyBought: false, addTrailers: false }); }
  catch (e) { over = e.message; }
  check('over-capacity yard refuses', over !== null, over || '(allowed!)');

  head('Second yard: unbought units land as backdrop');
  const t2 = await api('/terminals', 'POST', { city: 'Phoenix', state: 'AZ', level: 'Medium', truckCapacity: 3, hasFuel: true, hasParking: true });
  S = t2.snapshot;
  const phx = S.company.terminals.find((t) => t.city === 'Phoenix');
  const s2 = await api('/fleet/stock', 'POST', {
    terminalId: phx.id, count: 9, alreadyBought: false, transmissionPreference: 'either', addTrailers: false,
  });
  S = s2.snapshot;
  console.log(`  (${s2.result.message})`);
  check('clamped to the 3 slots', s2.result.trucks.length === 3, `${s2.result.trucks.length}`);
  check('says it clamped', /only had room for 3/.test(s2.result.message), s2.result.message);
  check('unbought units are backdrop', S.views.backdrop.trucks === 3, JSON.stringify(S.views.backdrop));
  check('mixed transmissions', new Set(S.trucks.filter((t) => t.homeTerminalId === phx.id).map((t) => t.transmissionType)).size === 2,
    S.trucks.filter((t) => t.homeTerminalId === phx.id).map((t) => t.transmissionType).join(','));
  check('no trailers added when unticked', s2.result.trailers.length === 0);

  head('Trim leaves the bought fleet alone, drops only the backdrop');
  const trim = await api('/fleet/trim', 'POST', { includeYards: false });
  S = trim.snapshot;
  trim.notes.forEach((n) => console.log(`     · ${n}`));
  check('5 bought tractors survive', S.trucks.length === 5, `${S.trucks.length} left: ${S.trucks.map((t) => t.unit).join(' ')}`);
  check('all survivors are in-garage', S.trucks.every((t) => t.inGameGarage));
  check('Phoenix yard kept', S.company.terminals.some((t) => t.city === 'Phoenix'));

  console.log(`\n${'='.repeat(52)}\n  ${passes} passed, ${fails} failed\n${'='.repeat(52)}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('\nHARNESS ERROR:', e.message); process.exit(2); });
