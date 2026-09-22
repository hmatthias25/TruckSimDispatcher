/* Opening the employer's yard costs nothing and asks nothing. Expanding one is money.
 *
 * Reported from play, looking at the full yard form after clicking "Open a yard" on Green Bay — city,
 * state, level, capacity, fuel price, upkeep, services, the lot:
 *
 *   "eehhh don't like this. I click on open yard it needs to open EXACTLY what the company has (this is
 *    a large yard why is it asking me what size it is!) it should just open the appropriately sized
 *    yard, as it is already 'owned' by the company so it just shows up in the app then. Nothing really
 *    happens until the yard is populated which is another function already defined. HOWEVER for any
 *    added/expanded yards the app should ask how much it cost IN GAME and this should go down in
 *    finance as an expense."
 *
 * Right on both halves. A terminal the carrier already runs is not a purchase — it appears in the app
 * because the driver has finally been there, at the size the carrier runs it, and nothing happens at it
 * until it is stocked. Buying a yard of your own, or taking one up a tier, is money that left the
 * player's ATS bank and belongs on the books.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5995}/api`;
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
const iso = (day, hm = '07:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}`;
};
const yardAt = (S, city) => (S.company.terminals || []).find((t) => t.city === city);
// Off the raw state: the snapshot carries only views.finance, a summary, so reading S.ledger returns
// undefined and every assertion about what was posted passes on an empty array. Two did.
const property = async () =>
  ((await api('/export')).ledger || []).filter((e) => (e.category || '') === 'Property');

(async () => {
  const app = {
    driverName: 'Y. Keeper', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: '', homeState: '', acceptsProbation: true,
    homeTimePreference: 'biweekly', preferredTripLength: 'otr',
  };
  await api('/onboarding/market', 'POST', app);
  // Schneider: a Large carrier, HQ Green Bay, with Dallas / Charlotte / Phoenix / Chicago behind it.
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'SNI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  // Based at Phoenix rather than the default Green Bay, so the carrier's own headquarters is a yard
  // this career does NOT hold — which is the case section 3 is about.
  S = un(await api('/career/domicile', 'POST', { city: 'Phoenix', state: 'AZ' }));
  console.log(`  ..    ${S.company.name}, based ${S.company.terminalCity} — network ${(S.company.networkCities || []).join(' | ')}`);
  ok('the career holds one yard, and it is not the carrier headquarters',
    (S.company.terminals || []).length === 1 && !yardAt(S, 'Green Bay'), S.company.terminalCity);

  head('1. You have to have been there');
  // ATS generates no cargo for a city revealed with a save editor rather than driven to, so a yard
  // there is a yard with nothing coming out of it. The whole panel is discovery-gated; so is this.
  let threw = '';
  try { await api('/terminals/open-network', 'POST', { city: 'Chicago', state: 'IL' }); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 120) || '(allowed)'}`);
  ok('a yard in a city nobody has driven to is refused', /have not been to/i.test(threw), threw.slice(0, 60));
  ok('and it says why, not just no', /will not generate freight/i.test(threw), 'explained');

  head('2. Drive there, and it opens at the size the company runs it');
  await api('/status', 'POST', {
    locationCity: 'Chicago', locationState: 'IL', locationKind: 'TruckStop', gameTime: iso(4),
    fuelPct: 60, atsOdometer: 1200, truckDamagePct: 1, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  const before = (await property()).length;
  const opened = await api('/terminals/open-network', 'POST', { city: 'Chicago', state: 'IL' });
  S = un(opened);
  const chi = yardAt(S, 'Chicago');
  console.log(`  ..    ${opened.message}`);
  ok('the yard is on the books', !!chi, chi ? `${chi.city}, ${chi.state}` : '(none)');
  // Schneider is a Large carrier, so the HQ is Large and the rest of the network sits a tier under it.
  ok('at the tier the carrier runs it, not one the player picked',
    chi.level === 'Medium', chi.level);
  ok('and the capacity follows the tier rather than defaulting to one',
    chi.truckCapacity > 1, `${chi.truckCapacity} slot(s)`);
  ok('it is not made the headquarters', chi.isHeadquarters === false, `hq=${chi.isHeadquarters}`);
  ok('nothing was asked and nothing was charged', chi.purchasePrice === 0, `$${chi.purchasePrice}`);
  const afterOpen = (await property()).length;
  ok('so no money moved for it', afterOpen === before, `${afterOpen} property entries, was ${before}`);
  ok('and it starts empty — stocking it is its own step',
    (S.trucks || []).every((t) => t.homeTerminalId !== chi.id),
    `${(S.trucks || []).filter((t) => t.homeTerminalId === chi.id).length} tractors based there`);

  head('3. The headquarters city is the big one, wherever the driver is based');
  // Read off the CARRIER's headquarters, not off whichever yard the driver is domiciled at: choosing
  // Phoenix as your base does not make Green Bay a small yard. Reported as "this is a large yard".
  await api('/status', 'POST', {
    locationCity: 'Green Bay', locationState: 'WI', locationKind: 'TruckStop', gameTime: iso(6),
    fuelPct: 60, atsOdometer: 2400, truckDamagePct: 1, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  S = un(await api('/terminals/open-network', 'POST', { city: 'Green Bay', state: 'WI' }));
  const gb = yardAt(S, 'Green Bay');
  console.log(`  ..    Green Bay opened as ${gb?.level} (${gb?.truckCapacity} slots)`);
  ok('the carrier headquarters opens Large', gb?.level === 'Large', `${gb?.level}`);
  ok('which is bigger than the yard down the network', gb.truckCapacity > chi.truckCapacity,
    `${gb.truckCapacity} vs ${chi.truckCapacity}`);

  head('4. Somewhere the employer does not run is not this button\'s business');
  await api('/status', 'POST', {
    locationCity: 'Bangor', locationState: 'ME', locationKind: 'TruckStop', gameTime: iso(8),
    fuelPct: 60, atsOdometer: 3600, truckDamagePct: 1, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  });
  threw = '';
  try { await api('/terminals/open-network', 'POST', { city: 'Bangor', state: 'ME' }); } catch (e) { threw = e.message; }
  console.log(`  ..    ${threw.slice(0, 130) || '(allowed)'}`);
  ok('a city off the network is refused', /does not run a terminal/i.test(threw), threw.slice(0, 60));
  ok('and the driver is told it is a purchase instead', /is a purchase/i.test(threw), 'pointed at the form');

  head('5. Opening the same yard twice is refused rather than doubled');
  threw = '';
  try { await api('/terminals/open-network', 'POST', { city: 'Chicago', state: 'IL' }); } catch (e) { threw = e.message; }
  ok('the second one is refused', /already has a yard/i.test(threw), threw.slice(0, 60));
  ok('and there is still only one Chicago',
    (S.company.terminals || []).filter((t) => t.city === 'Chicago').length === 1, 'one');

  head('6. Expanding a yard IS money, and it goes on the books');
  const wasProperty = (await property()).length;
  const before2 = yardAt(S, 'Chicago').truckCapacity;
  S = un(await api(`/terminals/${chi.id}/level`, 'POST', { level: 'Large', costPaid: 285000 }));
  const grown = yardAt(S, 'Chicago');
  const all = await property();
  const posted = all.filter((e) => /Chicago/i.test(e.memo || ''));
  console.log(`  ..    Chicago ${before2} -> ${grown.truckCapacity} slots, ${posted.length} property entr(ies)`);
  ok('the yard actually grew', grown.level === 'Large' && grown.truckCapacity > before2,
    `${grown.level}, ${grown.truckCapacity} slots`);
  ok('the upgrade is booked as an expense', all.length > wasProperty, `${all.length} vs ${wasProperty}`);
  // Guarded, because every() over an empty list is true and would pass this section on nothing.
  ok('there is an entry for this yard to look at', posted.length > 0, `${posted.length}`);
  ok('for the amount the player said they paid',
    posted.some((e) => Math.abs(Number(e.amount)) === 285000), posted.map((e) => e.amount).join(', '));
  ok('as money out, not in',
    posted.length > 0 && posted.every((e) => Number(e.amount) <= 0), 'negative');
  ok('and the memo says which yard and what happened to it',
    posted.some((e) => /Chicago/i.test(e.memo) && /medium/i.test(e.memo) && /large/i.test(e.memo)),
    posted.map((e) => e.memo).join(' | '));
  ok('the cost is remembered against the yard too', grown.purchasePrice === 285000, `$${grown.purchasePrice}`);

  head('7. A re-tier that does not move the tier does not charge for it');
  // Saving the yard form without touching the level must not post a second expense.
  const steady = (await property()).length;
  S = un(await api(`/terminals/${chi.id}/level`, 'POST', { level: 'Large', costPaid: 285000 }));
  const settled = (await property()).length;
  ok('nothing is booked when the tier did not change', settled === steady, `${settled} vs ${steady}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
