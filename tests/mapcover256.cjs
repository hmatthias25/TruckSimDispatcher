/* The map a driver runs is smaller than the map they installed.
 *
 *   "Setting up to use C2C map and want some states/provinces excluded when dispatch is considering
 *    loads. Should be done by State/Province abbreviations probably. Default All US States, no Canadian
 *    Provinces. Selectable in settings. If a state/province is not selected then no loads should be
 *    dispatched from it (auto reject by dispatch)."
 *
 * Base ATS grows a few states at a time. Coast to Coast does not — it lays the continent down at once,
 * and a driver who wanted the western states is then offered Maine, with nothing between them and a
 * four-day deadhead but remembering to say no every single time.
 *
 * So: a list the player keeps, and a gate that holds dispatch to it. Both ends of the load, not just the
 * pickup. "Dispatched from" was the ask and it is the obvious half; a load DELIVERING into a region the
 * driver does not run is the same problem arriving later, with the truck parked at the far end of it and
 * nothing to pull out.
 *
 * Nothing is said about what a run passes THROUGH. The app has city coordinates and no roads, so it has
 * no honest opinion about the route, and a guess is not a thing to refuse a load on.
 *
 * Two failure modes are guarded harder than the feature itself, because both are silent:
 *   - an empty list must not mean "refuse everything" — that is indistinguishable from a broken app
 *   - a region code this app has never heard of must be ALLOWED, because map mods invent them and
 *     refusing what we cannot identify turns every mod into a wall the player cannot clear
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
const at = (day, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (day - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;

async function setRegions(list) {
  const cur = (await api('/bootstrap')).settings;
  S = un(await api('/settings', 'POST', { ...cur, runnableStates: list }));
}

/** One listing on an otherwise empty board, evaluated. */
async function offer({ from, fromState, to, toState }) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'General Freight', trailerType: 'Dry Van', receiver: 'Depot',
    originCity: from, originState: fromState, destCity: to, destState: toState,
    loadedMiles: 300, deadheadMiles: 0, gameRevenue: 1400, deadlineHours: 36,
    weightLbs: 34000, atLocation: true,
  });
  return (board.evaluations || [])[0];
}

const offMap = (e) => (e.hardFails || []).find((f) => /do not run/i.test(f)) || '';

(async () => {
  const app = { driverName: 'L. Whitcombe', preferredDivision: 'Dry Van', experienceYears: 10,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(4) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(5, '06:00'),
    fuelPct: 95, atsOdometer: 250000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. A fresh career runs the United States and nothing else');
  const mc = (await api('/bootstrap')).views.mapCoverage;
  const on = mc.regions.filter((r) => r.on).map((r) => r.code);
  console.log(`  ..    ${mc.regions.length} regions offered, ${on.length} on`);
  ok('every US state and DC is on', on.length === 51, `${on.length}`);
  ok('including the ones base ATS has never had', on.includes('ME') && on.includes('FL'), 'ME, FL');
  ok('no Canadian province is on', !mc.regions.some((r) => r.country === 'CA' && r.on), 'all off');
  ok('no Mexican state is on', !mc.regions.some((r) => r.country === 'MX' && r.on), 'all off');
  ok('but Canada is on the list to be switched on',
    mc.regions.some((r) => r.code === 'ON' && r.country === 'CA'), 'Ontario offered');
  ok('and so is Mexico', mc.regions.some((r) => r.country === 'MX'), 'offered');

  head('2. Stock behaviour is unchanged — a US load is a US load');
  const home = await offer({ from: 'Denver', fromState: 'CO', to: 'Salt Lake City', toState: 'UT' });
  ok('nothing is said about the map', !offMap(home), offMap(home) || 'quiet');

  head('3. Switch a region off and dispatch will not load out of it');
  // The reported case, in the player's own words: a load dispatched FROM somewhere they do not run.
  await setRegions([...mc.usDefault, 'ON']);
  await api('/status', 'POST', {
    locationCity: 'Toronto', locationState: 'ON', locationKind: 'Shipper', gameTime: at(5, '06:00'),
    fuelPct: 95, atsOdometer: 250000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });
  const okOut = await offer({ from: 'Toronto', fromState: 'ON', to: 'Buffalo', toState: 'NY' });
  ok('with Ontario on, freight out of Toronto is fine', !offMap(okOut), offMap(okOut) || 'quiet');

  await setRegions(mc.usDefault);
  const outOfOn = await offer({ from: 'Toronto', fromState: 'ON', to: 'Buffalo', toState: 'NY' });
  console.log(`  ..    ${offMap(outOfOn)}`);
  ok('with Ontario off, it is refused', !!offMap(outOfOn));
  ok('it names the region', /Ontario/.test(offMap(outOfOn)));
  ok('and says it is the setting and not the load',
    /not a judgement on the load/i.test(offMap(outOfOn)));
  ok('the card is a Reject', outOfOn.recommendation === 'Reject', outOfOn.recommendation);

  head('4. And will not send the truck INTO one either');
  // The half the ask did not mention and needs as much. A load delivering somewhere the driver does not
  // run ends with the truck parked there, empty, with nothing to pull out.
  await api('/status', 'POST', {
    locationCity: 'Buffalo', locationState: 'NY', locationKind: 'Shipper', gameTime: at(5, '06:00'),
    fuelPct: 95, atsOdometer: 250000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });
  const intoOn = await offer({ from: 'Buffalo', fromState: 'NY', to: 'Toronto', toState: 'ON' });
  console.log(`  ..    ${offMap(intoOn)}`);
  ok('delivering into a region you do not run is refused too', !!offMap(intoOn));
  ok('and the reason says it is the delivery end', /where this one delivers/i.test(offMap(intoOn)));

  head('5. Both ends off is one decision, said once');
  const across = await offer({ from: 'Toronto', fromState: 'ON', to: 'Montreal', toState: 'QC' });
  const both = (across.hardFails || []).filter((f) => /do not run/i.test(f));
  console.log(`  ..    ${both[0] || '(silent)'}`);
  ok('it is refused', both.length > 0);
  ok('once, not twice', both.length === 1, `${both.length} reason(s)`);
  ok('naming both regions', /Ontario/.test(both[0] || '') && /Quebec/.test(both[0] || ''));

  head('6. Authorising one anyway is refused at the door');
  let threw = '';
  try { await api('/dispatch/authorize', 'POST', { loadId: across.load.id }); }
  catch (e) { threw = e.message; }
  ok('the gate holds on authorize, not only on the card', /do not run/i.test(threw), threw.slice(0, 90) || 'went through');

  head('7. Parked somewhere you have switched off, and told so once');
  await api('/status', 'POST', {
    locationCity: 'Toronto', locationState: 'ON', locationKind: 'Shipper', gameTime: at(5, '06:00'),
    fuelPct: 95, atsOdometer: 250000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });
  const stuck = await offer({ from: 'Toronto', fromState: 'ON', to: 'Ottawa', toState: 'ON' });
  const board = await api('/board/evaluate', 'POST', {});
  const note = (board.dispatchNotes || []).find((n) => /switched off/i.test(n)) || '';
  console.log(`  ..    ${note.slice(0, 150)}`);
  ok('the board says why everything on it is refused', !!note);
  ok('and says how to get out of it', /switch .* back on|move the truck/i.test(note));
  ok('the load itself is still refused', !!offMap(stuck));

  head('8. A region this app has never heard of is allowed');
  // Map mods rename and invent regions. Refusing what we cannot identify would turn every mod into a
  // wall of rejections the player has no box to clear — absence of data is not evidence.
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(5, '06:00'),
    fuelPct: 95, atsOdometer: 250000, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });
  const modded = await offer({ from: 'Denver', fromState: 'CO', to: 'Nordkapp', toState: 'ZZ' });
  ok('an unknown state code does not refuse the load', !offMap(modded), offMap(modded) || 'quiet');
  const blank = await offer({ from: 'Denver', fromState: 'CO', to: 'Somewhere', toState: '' });
  ok('and neither does a blank one', !offMap(blank), offMap(blank) || 'quiet');

  head('9. Clearing every box is read as unset, not as a total block');
  // The silent failure this guards: a board that refuses everything with no explanation is
  // indistinguishable from the app being broken.
  await setRegions([]);
  const afterEmpty = await offer({ from: 'Denver', fromState: 'CO', to: 'Salt Lake City', toState: 'UT' });
  ok('a US load still runs on an empty list', !offMap(afterEmpty), offMap(afterEmpty) || 'quiet');
  const stillOff = await offer({ from: 'Denver', fromState: 'CO', to: 'Toronto', toState: 'ON' });
  ok('and Canada is still off, because the fallback IS the default', !!offMap(stillOff));

  head('10. Junk in the list is dropped on the way in');
  await setRegions(['co', 'UT', 'NOPE', 'CO', 'WY']);
  const kept = (await api('/bootstrap')).settings.runnableStates;
  console.log(`  ..    stored as ${JSON.stringify(kept)}`);
  ok('case is normalised', kept.includes('CO'), kept.join(','));
  ok('duplicates are dropped', kept.filter((x) => x === 'CO').length === 1, `${kept.filter((x) => x === 'CO').length}`);
  ok('a code no checkbox can ever clear is not stored', !kept.includes('NOPE'), kept.join(','));
  ok('and what the driver ticked survives', kept.includes('UT') && kept.includes('WY'), kept.join(','));

  head('11. The career remembers it across a reload');
  const exported = await api('/export');
  S = un(await api('/import', 'POST', exported));
  ok('the list comes back as it went in',
    JSON.stringify(S.settings.runnableStates) === JSON.stringify(kept),
    JSON.stringify(S.settings.runnableStates));
  ok('and the schema is stamped', S.schemaVersion >= 26, `v${S.schemaVersion}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
