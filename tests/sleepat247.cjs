/* Where the ten is sat, when the answer is "on somebody's property".
 *
 *   "I was in Carlsbad NM and there was no valid freight there. Closest freight was Artesia NM. With 44
 *    minutes left on clock, if I showed the app the Artesia board would it have rejected and told me to
 *    rest?"  ...  "this was drop and hook not the cargo board, would this still be the case?"
 *
 * On a company trailer: refused, by the dock-window blocker. 2:24 of window against a dock wanting 1:30
 * and a truck that still has to clear their lot.
 *
 * On drop and hook: authorised. The hook is twenty-five minutes rather than an hour and a half, so the
 * window is ample and the deadhead to Artesia fits inside the forty-four minutes. The plan that comes
 * back is: pre-trip, deadhead 36 mi, hook, TEN-HOUR RESET, then the linehaul in the morning.
 *
 * Which is the right answer — repositioning into the market on the last of the clock and securing a
 * preloaded trailer is what a driver does. What was wrong is that it did not say so. The reset was
 * planned wherever the truck happened to be standing, with no label and no warning, and where the truck
 * happened to be standing was the shipper's yard. The app has careful reasoning about whether a RECEIVER
 * will have a truck overnight and none of it reached this.
 *
 * Drop and hook is what makes it ordinary rather than rare: a live load needs hours of window, so a
 * driver with the clock to load had the clock to leave.
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
const iso = (d, hm = '14:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S;
const line = (f) => (f?.timeline || []).map((x) => x.label).join(' | ');

/** Carlsbad, the reported clocks, and the Artesia board. */
async function artesia(shipper) {
  await api('/status', 'POST', {
    locationCity: 'Carlsbad', locationState: 'NM', locationKind: 'TruckStop', gameTime: iso(4),
    fuelPct: 80, atsOdometer: 10000, truckDamagePct: 3, dutyStatus: 'OnDuty',
  });
  // D 0:44  S 2:24  B 8:00  C 34:00
  await api('/hos', 'POST', { driveRemaining: 0.7333, shiftRemaining: 2.4, breakRemaining: 8, cycleRemaining: 34 });
  await api('/board/clear', 'POST', {});
  return api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', shipper,
    originCity: 'Artesia', originState: 'NM', destCity: 'Albuquerque', destState: 'NM',
    loadedMiles: 280, deadheadMiles: 36, gameRevenue: 1100, deadlineHours: 36, weightLbs: 38000,
  });
}

(async () => {
  const app = { driverName: 'L.Варга', preferredDivision: 'Dry Van', experienceYears: 10,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. On a company trailer the window refuses it, as reported');
  const own = await artesia('Acme Plant');
  console.log(`  ..    "${(own.headline || '').slice(0, 80)}"`);
  ok('nothing is authorised', !own.authorizedLoadId, own.authorizedLoadId || 'nothing');
  ok('and the reason is the window against the dock',
    /window left. Loading .* takes about/i.test(((own.evaluations || [])[0]?.hardFails || []).join(' ')),
    (((own.evaluations || [])[0]?.hardFails || [])[0] || '(none)').slice(0, 90));

  head('2. On drop and hook it is taken — and that is right');
  // Twenty-five minutes at the dock instead of an hour and a half, so the window is ample and the
  // deadhead fits the drive clock. Repositioning into the market to secure a preloaded box is a good
  // move, and refusing it would be the worse answer.
  let st = await api('/export');
  st.trailers.push({
    unit: 'DH-1', type: 'Drop & Hook', subtype: '', division: 'Dry Van', year: 2022,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'DH-1';
  S = un(await api('/import', 'POST', st));

  const dh = await artesia('Acme Plant');
  const e = (dh.evaluations || [])[0];
  console.log(`  ..    ${line(e?.feasibility)}`);
  ok('the load is authorised', !!dh.authorizedLoadId, dh.headline?.slice(0, 70));
  ok('the deadhead happens today', /Deadhead/i.test(line(e?.feasibility)), 'deadhead planned');
  ok('the hook happens today', /Hook/i.test(line(e?.feasibility)), 'hook planned');
  ok('and the day ends in a reset before the linehaul',
    line(e?.feasibility).indexOf('reset') < line(e?.feasibility).indexOf('Line haul'),
    'reset before the run');

  head('3. The plan now says WHERE that reset is sat');
  // The whole of the change. It used to read "10-hour off-duty reset" and leave the driver to work out
  // that the truck had not moved since the hook, so the ten was being taken in the shipper's yard.
  const rest = (e?.feasibility?.timeline || []).find((x) => x.kind === 'Rest');
  console.log(`  ..    "${rest?.label}"`);
  ok('the rest step names the shipper', /shipper/i.test(rest?.label || ''), rest?.label);
  const warns = (e?.feasibility?.warnings || []).join(' || ');
  ok('and a warning says the day ends there without moving',
    /day ends at the shipper without the truck moving/i.test(warns),
    (warns.match(/[^|]*day ends[^|]*/i) || ['(not said)'])[0].slice(0, 130));
  ok('naming how little of the run happens today',
    /only 0:3\d of driving happens today|only 0:\d\d of driving/i.test(warns),
    (warns.match(/only [0-9:]+ of driving[^.]*/i) || ['(not said)'])[0].slice(0, 90));

  head('4. Whether they will have you is the same question asked of the receiver');
  // Seeded per facility and city, so some shippers will and some will not — and the one that will not
  // is the case worth planning around, because the driver has to get off the lot on a clock that has
  // already gone. Walk shippers until each answer has turned up.
  let welcomed = '', turnedAway = '';
  for (const name of ['Acme Plant', 'Permian Supply', 'Pecos Foods', 'Delaware Basin Co',
                      'Loving Logistics', 'Eddy County Grain', 'Guadalupe Freight', 'Whites City Depot']) {
    const r = await artesia(name);
    const w = ((r.evaluations || [])[0]?.feasibility?.warnings || []).join(' || ');
    if (/do NOT allow overnight/i.test(w)) turnedAway ||= `${name}: ${w.match(/[^|]*do NOT allow[^|]*/i)[0]}`;
    else if (/They will have you overnight/i.test(w)) welcomed ||= `${name}: yes`;
    if (welcomed && turnedAway) break;
  }
  ok('some shippers will have the truck overnight', !!welcomed, welcomed || '(none found)');
  ok('and some will not', !!turnedAway, (turnedAway || '(none found)').slice(0, 150));
  ok('the ones that will not say to check the clock to reach a truck stop',
    /clock to reach a truck stop/i.test(turnedAway), turnedAway.slice(-90) || '(not said)');

  head('5. A reset out on the road is still nobody\'s property');
  // The rule is about not having moved since a dock. A driver who has run half a day and stops for the
  // night is finding their own truck stop, and the app has nothing to add.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const far = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Dry Van', shipper: 'Acme Plant',
    originCity: 'Carlsbad', originState: 'NM', destCity: 'Chicago', destState: 'IL',
    loadedMiles: 1300, deadheadMiles: 0, gameRevenue: 4200, deadlineHours: 96, weightLbs: 38000,
  });
  const fe = (far.evaluations || [])[0];
  const fRest = (fe?.feasibility?.timeline || []).find((x) => x.kind === 'Rest');
  console.log(`  ..    "${fRest?.label}"`);
  ok('a long run still needs a reset', !!fRest, `${fe?.feasibility?.restsRequired} rest(s)`);
  ok('and it is not attributed to anybody\'s lot', !/shipper|receiver/i.test(fRest?.label || ''),
    fRest?.label);
  ok('nor does it warn about a day ending on a dock',
    !/day ends at the/i.test((fe?.feasibility?.warnings || []).join(' ')), 'nothing claimed');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
