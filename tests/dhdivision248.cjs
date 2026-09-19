/* The arrangement is not a division, and a blank trailer type is not one either.
 *
 *   "Error getting freight. The freight shown should be valid, however I'm being told it is not."
 *
 * Two listings out of Odessa TX — aluminium scrap to Alamosa CO at $3.61/mi, mixed retail to Longview TX
 * at $2.76/mi, both comfortably over target — and every one of them refused:
 *
 *     NOTHING WORTH RUNNING OUT OF ODESSA, TX AT THIS DOCK.
 *     Alamosa, CO Aluminum Scrap: Drop & Hook is not a division this company operates.
 *     Longview, TX Mixed Retail Recovery: Drop & Hook is not a division this company operates.
 *
 * Drop and hook is modelled as a trailer type — DropHook.cs is explicit that this is the trick the whole
 * feature turns on, because it lets a driver with no box of their own travel every code path that
 * expects one. This is where it leaks. /board/add fills a blank trailer type from whatever is hooked,
 * which on the arrangement is the string "Drop & Hook"; DivisionFor then reads that off the listing, and
 * DivisionForTrailer has no case for it, so it falls through to `var t => t` and becomes a division no
 * carrier has ever operated. Every load on the board hard-fails, and the reason names a thing the driver
 * cannot do anything about.
 *
 * A listing that only knows it came off the Freight Market tells us nothing about the freight. That is
 * what blank means, and blank is what it should have stayed.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const fails = (e) => (e?.hardFails || []).join(' | ');

(async () => {
  const app = { driverName: 'S. Ferreira', preferredDivision: 'Dry Van', experienceYears: 9,
    homeCity: 'Odessa', homeState: 'TX', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));

  // The reported carrier: Reefer, Flatbed, Tanker and Dry Van. Note there is no "Drop & Hook" in it,
  // because no carrier has one — it is how the driver works, not what they haul.
  let st = await api('/export');
  st.company.divisions = ['Reefer', 'Flatbed', 'Tanker', 'Dry Van'];
  st.trailers.push({
    unit: 'DH-1', type: 'Drop & Hook', subtype: '', division: 'Dry Van', year: 2022,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'DH-1';
  S = un(await api('/import', 'POST', st));
  ok('the driver is on the drop-and-hook slot', S.driver.assignedTrailerUnit === 'DH-1',
    S.driver.assignedTrailerUnit);
  ok('and the carrier has no such division', !S.company.divisions.includes('Drop & Hook'),
    S.company.divisions.join(', '));

  head('1. The reported board, entered with no trailer type on either row');
  await api('/status', 'POST', {
    locationCity: 'Odessa', locationState: 'TX', locationKind: 'Shipper', gameTime: iso(4),
    fuelPct: 90, atsOdometer: 40000, truckDamagePct: 3, dutyStatus: 'OnDuty',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Aluminum Scrap', originCity: 'Odessa', originState: 'TX',
    destCity: 'Alamosa', destState: 'CO', loadedMiles: 524, deadheadMiles: 0,
    gameRevenue: 1891, deadlineHours: 30, weightLbs: 35273, atLocation: true,
  });
  const board = await api('/board/add', 'POST', {
    cargo: 'Mixed Retail Recovery', originCity: 'Odessa', originState: 'TX',
    destCity: 'Longview', destState: 'TX', loadedMiles: 539, deadheadMiles: 0,
    gameRevenue: 1486, deadlineHours: 30, weightLbs: 39683, atLocation: true,
  });

  const rows = board.evaluations || [];
  console.log(`  ..    "${(board.headline || '').slice(0, 95)}"`);
  for (const e of rows) console.log(`  ..    ${e.load.destCity}: ${fails(e) || 'no hard fails'}`);

  ok('both listings are on the board', rows.length === 2, `${rows.length}`);
  ok('neither is refused for a division',
    !rows.some((e) => /is not a division this company operates/i.test(fails(e))),
    rows.map((e) => (fails(e).match(/[^|]*division[^|]*/i) || [''])[0]).join(' ') || 'no division fails');
  ok('and nothing anywhere calls the arrangement a division',
    !/Drop & Hook is not a division/i.test(JSON.stringify(board)), 'not said');
  ok('so one of them is actually authorised', !!board.authorizedLoadId,
    board.headline?.slice(0, 80) || '(nothing)');

  head('2. The arrangement is never written onto the listing');
  // The root of it. Blank means the freight has not said, which is the normal state off the Freight
  // Market, and it must stay blank rather than being filled in with how the driver is working.
  const stored = (await api('/export')).board;
  console.log(`  ..    stored types: ${stored.map((l) => `${l.destCity}="${l.trailerType}"`).join(', ')}`);
  ok('no board row carries the arrangement as its type',
    !stored.some((l) => /drop *&? *hook/i.test(l.trailerType || '')),
    stored.map((l) => l.trailerType || '(blank)').join(', '));

  head('3. A type the player DOES give is still honoured, and still gated');
  // The division gate is not being switched off. A carrier that does not run heavy haul still does not
  // run heavy haul, and on drop and hook the listing's own type is what says which it is.
  await api('/board/clear', 'POST', {});
  const lowboy = await api('/board/add', 'POST', {
    cargo: 'Excavator', trailerType: 'Lowboy', originCity: 'Odessa', originState: 'TX',
    destCity: 'Midland', destState: 'TX', loadedMiles: 25, deadheadMiles: 0,
    gameRevenue: 900, deadlineHours: 20, weightLbs: 60000, atLocation: true,
  });
  const lb = (lowboy.evaluations || [])[0];
  ok('heavy haul off-division is still refused', /Heavy Haul is not a division/i.test(fails(lb)),
    fails(lb) || '(allowed)');

  await api('/board/clear', 'POST', {});
  const reefer = await api('/board/add', 'POST', {
    cargo: 'Ice Cream', trailerType: 'Reefer', originCity: 'Odessa', originState: 'TX',
    destCity: 'Midland', destState: 'TX', loadedMiles: 25, deadheadMiles: 0,
    gameRevenue: 700, deadlineHours: 20, weightLbs: 30000, atLocation: true,
  });
  const rf = (reefer.evaluations || [])[0];
  ok('and a division the carrier does run goes through',
    !/is not a division/i.test(fails(rf)), fails(rf) || 'no division fail');

  head('4. A career already carrying the bad stamp recovers on read');
  // Boards persist. A row written before the fix still says "Drop & Hook", and the driver should not
  // have to clear their board to get freight again.
  st = await api('/export');
  st.board = [{
    id: 'stamped1', cargo: 'Aluminum Scrap', trailerType: 'Drop & Hook',
    originCity: 'Odessa', originState: 'TX', destCity: 'Alamosa', destState: 'CO',
    loadedMiles: 524, deadheadMiles: 0, gameRevenue: 1891, deadlineHours: 30,
    weightLbs: 35273, atLocation: true,
  }];
  await api('/import', 'POST', st);
  const old = await api('/board/evaluate');
  const oe = (old.evaluations || [])[0];
  console.log(`  ..    ${fails(oe) || 'no hard fails'}`);
  ok('a stamped row is not refused for it either',
    !/is not a division this company operates/i.test(fails(oe)), fails(oe) || 'no division fail');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
