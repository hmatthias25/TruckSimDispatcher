/* #229 — the app costed fuel at $4.05 while the pump charged $6.29.
 *
 * Reported from play: "gas prices that you looked up and set in the app are totally wrong. They are WAY
 * too low and this messes up when a player gets gas with real gas price app. Should be $6/gallon or
 * around that at this point."
 *
 * Which is exactly the shape of the harm. Anybody running a real fuel-price mod pays the real figure at
 * the pump and reports it on the receipt, and the app costed their loads against two-thirds of it: every
 * margin read low, the break-even rate read low, and the driver was effectively billed for fuelling
 * their own truck. Diesel had roughly doubled year-on-year and the shipped figure never moved.
 *
 * What this suite holds:
 *   1. a fresh career starts on the real number, not the stale one
 *   2. a career already on the stale one is lifted, and told
 *   3. a price somebody typed themselves is left alone
 *   4. logged receipts are never rewritten — they are measurements, not assumptions
 *   5. the lift happens once and cannot keep overwriting a low price the player wants
 *   6. the state table still says California is the expensive one
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5929}/api`;
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
const iso = (day, hm = '08:00') => `2000-01-${String(day).padStart(2, '0')}T${hm}`;

/** What diesel really cost the week this was written. The app should not be far off it. */
const REAL = 6.29;

let S;

(async () => {
  const app = { driverName: 'T. Alvarez', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 7, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. A new career starts on what diesel actually costs');
  const fresh = (await api('/bootstrap')).settings;
  console.log(`  ..    shipped price $${fresh.fuelPricePerGal}/gal`);
  ok('the shipped price is in the right country of the real one',
    Math.abs(fresh.fuelPricePerGal - REAL) < 0.60, `$${fresh.fuelPricePerGal} vs $${REAL}`);
  ok('and it is emphatically not the old $4.05',
    fresh.fuelPricePerGal > 5.5, `$${fresh.fuelPricePerGal}`);

  head('2. The yards buy on contract, under the pump but not under the old pump');
  const yards = (await api('/bootstrap')).company.terminals.filter((t) => t.hasFuel);
  ok('there is a yard with fuel', yards.length > 0, `${yards.length}`);
  for (const y of yards) {
    ok(`${y.level || 'Small'} yard is cheaper than the pump`,
      y.fuelPricePerGal < fresh.fuelPricePerGal, `$${y.fuelPricePerGal} vs $${fresh.fuelPricePerGal}`);
    ok(`${y.level || 'Small'} yard is still a ${new Date().getFullYear()}-era price`,
      y.fuelPricePerGal > 5.0, `$${y.fuelPricePerGal}`);
  }

  head('3. An old career carrying the stale figure is lifted, and told about it');
  let state = await api('/export');
  state.schemaVersion = 19;
  state.settings.fuelPricePerGal = 4.05;
  for (const t of state.company.terminals) if (t.hasFuel) t.fuelPricePerGal = 3.85;
  S = un(await api('/import', 'POST', state));
  const lifted = (await api('/bootstrap')).settings;
  console.log(`  ..    $4.05 -> $${lifted.fuelPricePerGal}`);
  ok('the stale price is brought up to the real one',
    Math.abs(lifted.fuelPricePerGal - fresh.fuelPricePerGal) < 0.001, `$${lifted.fuelPricePerGal}`);
  ok('the yards came up with it',
    (await api('/bootstrap')).company.terminals.filter((t) => t.hasFuel)
      .every((t) => t.fuelPricePerGal > 5.0), 'all lifted');
  const events = await api('/events?take=60');
  const said = events.find((e) => /repriced/i.test(e.message || ''));
  ok('and it is said out loud rather than done quietly', !!said, said?.message?.slice(0, 120) || '(silent)');
  ok('the note says where the figure came from', /EIA/i.test(said?.message || ''), 'basis cited');
  ok('and points at Settings for a game that charges less',
    /settings/i.test(said?.message || ''), 'escape hatch named');

  head('4. It is a one-shot: a price the player sets afterwards is theirs to keep');
  // This is the whole reason the lift is stamped. Migrations run on EVERY load, so an unstamped one
  // would pin the setting above $4.05 for good and no economy-mod career could ever say otherwise.
  S = un(await api('/settings', 'POST', { ...(await api('/bootstrap')).settings, fuelPricePerGal: 3.20 }));
  const round = await api('/export');
  S = un(await api('/import', 'POST', round));
  const kept = (await api('/bootstrap')).settings;
  ok('a deliberately cheap price survives a reload',
    Math.abs(kept.fuelPricePerGal - 3.20) < 0.001, `$${kept.fuelPricePerGal}`);
  ok('and the schema is stamped so it cannot run again',
    (await api('/bootstrap')).schemaVersion >= 20, String((await api('/bootstrap')).schemaVersion));

  head('5. A price somebody typed above the old default is never touched');
  let custom = await api('/export');
  custom.schemaVersion = 19;
  custom.settings.fuelPricePerGal = 4.44;   // above the stale $4.05: somebody was already correcting
  S = un(await api('/import', 'POST', custom));
  ok('their own figure is left exactly as it was',
    Math.abs((await api('/bootstrap')).settings.fuelPricePerGal - 4.44) < 0.001,
    `$${(await api('/bootstrap')).settings.fuelPricePerGal}`);

  head('6. Receipts are measurements and are never rewritten');
  // Injected straight onto the career rather than driven, because what is being asserted is what the
  // migration does to a receipt, not how the receipt got there.
  let withStops = await api('/export');
  withStops.schemaVersion = 19;
  withStops.settings.fuelPricePerGal = 4.05;
  withStops.trips = withStops.trips || [];
  const cheap = { state: 'OK', gallons: 100, pricePerGal: 3.11, gameTime: iso(3), totalCost: 311 };
  if (withStops.trips.length > 0) {
    withStops.trips[0].fuelStops = [cheap];
    const id = withStops.trips[0].id;
    S = un(await api('/import', 'POST', withStops));
    const back = (await api('/export')).trips.find((t) => t.id === id);
    ok('a $3.11 receipt is still a $3.11 receipt',
      Math.abs(back.fuelStops[0].pricePerGal - 3.11) < 0.001, `$${back.fuelStops[0].pricePerGal}`);
    ok('even though the assumption around it moved',
      (await api('/bootstrap')).settings.fuelPricePerGal > 5.5, 'setting lifted, receipt untouched');
  } else {
    // No trips yet on a career this young, and the point still holds: the lift touches settings and
    // yards only. Assert that nothing invented a receipt to go with it.
    S = un(await api('/import', 'POST', withStops));
    const stops = ((await api('/export')).trips || []).flatMap((t) => t.fuelStops || []);
    ok('no receipt is conjured by the repricing', stops.length === 0, `${stops.length} stop(s)`);
    ok('while the assumption itself did move',
      (await api('/bootstrap')).settings.fuelPricePerGal > 5.5,
      `$${(await api('/bootstrap')).settings.fuelPricePerGal}`);
  }

  head('7. The table still knows where the expensive fuel is');
  const view = (await api('/bootstrap')).views.fuel;
  const at = (st) => (view.board || []).find((x) => x.state === st);
  const ca = at('CA'), ok_ = at('OK'), tx = at('TX');
  console.log(`  ..    CA $${ca?.perGallon?.toFixed?.(2)} · OK $${ok_?.perGallon?.toFixed?.(2)} · TX $${tx?.perGallon?.toFixed?.(2)}`);
  ok('the board prices every state it knows', (view.board || []).length >= 20, `${(view.board || []).length}`);
  ok('California is still the one to cross with full tanks',
    ca && ok_ && ca.perGallon > ok_.perGallon, `$${ca?.perGallon} vs $${ok_?.perGallon}`);
  ok('and it is dear enough to still be worth a warning',
    ca && ca.index >= 1.08, `index ${ca?.index}`);
  ok('the cheap end is a real price now, not a 2021 one',
    ok_ && ok_.perGallon > 5.5, `$${ok_?.perGallon}`);
  ok('the reference the whole board hangs off is the new one',
    Math.abs(view.reference - 6.32) < 0.001, `$${view.reference}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
