/* #273 - step 7 of Euro Truck Simulator 2 support (#266): ferries and the Channel Tunnel.
 *
 *   - the app's own table of real routes and sailings, one per crossing ETS2 has, the tunnel included
 *   - at a port, the next real departure and what to set the clock to; with real sailings off, straight on
 *   - a crossing logged on the trip: its fare on the tolls, and what it counts as under EU rules - the game
 *     counts any ferry time as rest, the law only with a cabin and long enough
 *   - crossings in the dispatch calculation (the second half of this suite)
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const DAY = 7;
const atPort = (route, fromA, hm) => api('/ferries/at-port', 'POST', { route, fromA, gameTime: iso(DAY, hm) }).then((r) => r.call);
async function sailings(on) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, realFerrySailings: on });
}

(async () => {
  const app = { driverName: 'E. Byrne', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(DAY) });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('0. ATS has no ferries');
  ok('no crossings on an ATS career', (await api('/bootstrap')).views.ferries == null);

  const st = await api('/export');
  st.game = 'ETS2';
  st.settings.runnableStates = [];
  Object.assign(st.company.terminals[0], { city: 'Frankfurt am Main', state: 'DE', isHeadquarters: true });
  await api('/import', 'POST', st);

  head('1. Every crossing ETS2 has, matched to a real one where there is one');
  const f = (await api('/bootstrap')).views.ferries;
  ok('the table is there on ETS2', f && f.routes.length >= 64, `${f?.routes.length} crossings`);
  ok('the Channel Tunnel is one of them, as a train', f.routes.some((r) => r.train && /Folkestone/.test(r.label)));
  ok('real sailings are on by default', f.realSailings === true);
  const hull = f.routes.find((r) => r.id === 'hull-rotterdam');
  ok('a real route carries its real operator and crossing time', hull?.operator === 'P&O Ferries' && hull.hours === 12, `${hull?.operator}, ${hull?.hours} h`);
  const esb = f.routes.find((r) => r.id === 'hull-esbjerg');
  ok('one the game invented keeps the game\'s time, and says so', esb?.confidence === 'game' && esb.hours === esb.gameHours, esb?.note);

  head('2. At a port: the next real sailing, and what to set the clock to');
  let c = await atPort('harwich-hook', true, '07:00');
  ok('Harwich at 07:00, with an hour to check in, makes the 09:00', c.departs.endsWith('T09:00'), c.departs);
  ok('and lands seven hours later', c.lands.endsWith('T16:00'), c.lands);
  ok('two hours waiting, said', Math.abs(c.waitHours - 2) < 0.01 && /Set the game clock to/.test(c.instruction), `${c.waitHours} h`);
  ok('seven hours with a cabin is still only a break: a daily rest is nine at least', /45-minute break/.test(c.restValue), c.restValue);
  c = await atPort('harwich-hook', true, '22:30');
  ok('too late for the 23:00 with check-in: the 09:00 next day', c.departs === iso(DAY + 1, '09:00'), c.departs);
  c = await atPort('tunnel', true, '10:07');
  ok('the tunnel: half an hour to check in, then the next of four an hour', c.departs.endsWith('T10:45'), c.departs);
  ok('which is never a rest, though it can be half of a split break', /part of a split break/.test(c.restValue), c.restValue);
  c = await atPort('hull-rotterdam', true, '12:00');
  ok('Hull to Rotterdam overnight is a regular daily rest, with a cabin', /regular daily rest/.test(c.restValue), c.restValue);
  await sailings(false);
  c = await atPort('harwich-hook', true, '07:00');
  ok('with real sailings off, it leaves when you get there', c.departs === c.arrived && c.waitHours === 0, `${c.arrived} → ${c.departs}`);
  await sailings(true);

  // A load to log against.
  await api('/status', 'POST', { locationCity: 'Hull', locationState: 'UK', locationKind: 'TruckStop', gameTime: iso(DAY),
    fuelPct: 100, atsOdometer: 90000, truckDamagePct: 1, trailerDamagePct: 1, dutyStatus: 'OffDuty', atsBankBalance: 50000 });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(DAY),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', { cargo: 'Machinery', trailerType: 'Dry Van', shipper: 'S', receiver: 'R',
    originCity: 'Hull', originState: 'UK', destCity: 'Rotterdam', destState: 'NL', loadedMiles: 220, deadheadMiles: 0,
    gameRevenue: 3000, deadlineHours: 60, weightLbs: 30000, atLocation: true });
  const ev = (await api('/board/evaluate')).evaluations[0];
  const trip = (await api('/dispatch/authorize', 'POST', { loadId: ev.load.id, overrideTight: true })).trip;

  head('3. A crossing logged on the trip');
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Ferry', gameTime: iso(DAY, '20:30'), endGameTime: iso(DAY + 1, '08:30'),
    ferryRoute: 'hull-rotterdam', cabin: true, cost: 995 });
  let t = ((await api('/export')).trips || []).find((x) => x.id === trip.id);
  const logged = t.events.find((e) => e.kind === 'Ferry');
  ok('the fare goes on the load\'s tolls', t.tolls === 995, `${t.tolls}`);
  ok('the log says what it was, and what it counts as', /12:00 across, with a cabin/.test(logged.detail) && /regular daily rest/.test(logged.detail), logged.detail);
  ok('and the clock moves to the far side', (await api('/bootstrap')).status.gameTime === iso(DAY + 1, '08:30'));
  await api(`/trips/${trip.id}/event`, 'POST', { kind: 'Ferry', gameTime: iso(DAY + 1, '10:00'), endGameTime: iso(DAY + 1, '11:30'),
    ferryRoute: 'dover-calais', cabin: false, cost: 384 });
  t = ((await api('/export')).trips || []).find((x) => x.id === trip.id);
  const short = t.events.filter((e) => e.kind === 'Ferry')[1];
  ok('a short one with no cabin is a break, and says so', /without a cabin it is never a rest/.test(short.detail), short.detail);
  ok('both fares are on the tolls', t.tolls === 995 + 384, `${t.tolls}`);

  head('4. A crossing in the plan: the wait for the sailing, and what the crossing counts as');
  const plan = (c) => api('/hos/plan', 'POST', { deadlineHours: 200, loadingHours: 1, unloadingHours: 1, trailerType: 'Dry Van',
    usableFuelRangeMiles: 99999, startGameTime: iso(DAY, '07:00'), loadedMiles: 100, ...c });
  await api('/hos', 'POST', { driveRemaining: 9, shiftRemaining: 13, breakRemaining: 4.5, cycleRemaining: 56, asOfGameTime: iso(DAY, '07:00'),
    euWeekDriven: 0, euLastWeekDriven: 0, euHoursSinceWeeklyRest: 0 });
  let p = await plan({ loadedCrossing: { route: 'harwich-hook', fromA: true, milesBefore: 0, milesAfter: 100 } });
  const wait = p.timeline.find((t) => /for the .*sailing/.test(t.label));
  ok('Harwich after loading and check-in misses the 09:00, so it is the 23:00', /23:00 sailing/.test(wait?.label || ''), wait?.label);
  ok('and a wait that long is taken as the daily rest, at the terminal', wait?.kind === 'Rest', `${wait?.kind}, ${wait?.hours} h`);
  ok('the crossing is in the plan', p.crossings.length === 1 && p.timeline.some((t) => /^Ferry Harwich – Europoort/.test(t.label)),
    p.crossings.join(' | '));
  ok('and the wait is counted', p.ferryWaitHours > 10, `${p.ferryWaitHours} h at the port`);
  await sailings(false);
  p = await plan({ loadedCrossing: { route: 'harwich-hook', fromA: true, milesBefore: 0, milesAfter: 100 } });
  ok('with real sailings off there is no wait', !p.timeline.some((t) => /for the .*sailing/.test(t.label)) && p.ferryWaitHours === 0, `${p.ferryWaitHours}`);
  await sailings(true);
  p = await plan({ startGameTime: iso(DAY, '17:00'), loadedCrossing: { route: 'hull-rotterdam', fromA: true, milesBefore: 0, milesAfter: 100 } });
  const onboard = p.timeline.find((t) => /^Ferry Hull/.test(t.label));
  ok('Hull to Rotterdam overnight, with a cabin, is the daily rest on board', onboard?.kind === 'Rest' && /daily rest/.test(onboard.label), onboard?.label);
  p = await plan({ loadedCrossing: { route: 'tunnel', fromA: true, milesBefore: 50, milesAfter: 50 } });
  const shuttle = p.timeline.find((t) => /^Channel Tunnel/.test(t.label));
  ok('the tunnel is a crossing, not a rest', shuttle?.kind === 'Crossing' && /no cabin/.test(shuttle.label), `${shuttle?.kind}: ${shuttle?.label}`);

  head('5. The planner finds the water and picks the way across');
  p = await plan({ originCity: 'Palermo', originState: 'IT', destCity: 'Napoli', destState: 'IT', loadedMiles: 420 });
  ok('Palermo to Napoli needs a crossing, and the plan has one', p.crossings.length === 1, p.crossings.join(' | ') || 'none');
  ok('Sicily to the mainland, either the strait or the overnight ferry',
    /Messina|Villa San Giovanni|Palermo – Napoli|Napoli – Palermo/.test(p.crossings[0] || ''), p.crossings[0]);
  p = await plan({ originCity: 'Lyon', originState: 'FR', destCity: 'Paris', destState: 'FR', loadedMiles: 280 });
  ok('Lyon to Paris needs none', p.crossings.length === 0);
  p = await plan({ originCity: 'Paris', originState: 'FR', destCity: 'London', destState: 'UK', loadedMiles: 300 });
  ok('Paris to London crosses the Channel', p.crossings.length === 1, p.crossings.join(' | '));
  ok('and for a short hop the tunnel or Dover wins', /Channel Tunnel|Dover/.test(p.crossings[0] || ''), p.crossings[0]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
