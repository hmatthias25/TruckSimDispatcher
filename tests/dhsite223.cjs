/* #223/#224 - what the receiver sees, and when you actually got there.
 *
 * Asked from play: "Does drop and hook know what trailer I have, so if I have a reefer I am more likely
 * to have an appointment, but a flatbed is a direct in if someone can unload it, like the trailers work
 * when I am using one?"
 *
 * Half of it did. Scoring the board preferred the LISTING's trailer type, so a flatbed Freight Market
 * load was read as a job site. Then the trip stored the ASSIGNED trailer - literally "Drop & Hook" - and
 * every facility question after that mapped it to a dock. So dispatch committed the truck on a job site
 * and the receiver behaved like a warehouse.
 *
 * And the other half, found on the way: "I have arrived" set a stamp nothing ever read. On a normal load
 * Begin unload covers for it. On drop and hook there IS no unload, so a driver who rolled onto the
 * property at 14:00 and closed out at 16:30 was judged to have arrived at 16:30.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5960}/api`;
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
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

/** Stand the truck somewhere with a full set of clocks. */
async function place(city, state, day, hm = '07:00') {
  return un(await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 95, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 90000,
  })) && api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
}

/** One Freight Market listing of a given trailer type, taken and authorized. */
async function runOne(trailerType, city, day) {
  await api('/board/clear', 'POST', {});
  const added = un(await api('/board/add', 'POST', {
    cargo: trailerType === 'Reefer' ? 'Frozen Foods' : 'Steel Coils',
    trailerType, receiver: 'Midwest Supply',
    originCity: 'Omaha', originState: 'NE', destCity: city, destState: 'NE',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 1900, deadlineHours: 40,
    weightLbs: 41000, atLocation: true, preLoaded: true,
  }));
  const board = added.board || [];
  const d = await api('/board/evaluate');
  const pick = (d.evaluations || []).find((e) => e.recommendation === 'Authorize') || (d.evaluations || [])[0];
  if (!pick) return { decision: d, trip: null };
  const r = await api('/dispatch/authorize', 'POST', { loadId: pick.load?.id || board[0]?.id });
  const snap = un(r);
  return { decision: d, trip: r.trip || (snap.trips || [])[0], board };
}

(async () => {
  const app = { driverName: 'D. Halvorsen', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Omaha', homeState: 'NE', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // Put the driver on the standing drop-and-hook slot the same way the drophook suite does: the state
  // directly, because the arrangement is operations' to give and there is no button for taking it.
  const raw = await api('/export');
  raw.driver.assignedTrailerUnit = 'DH-1';
  await api('/import', 'POST', raw);
  await place('Omaha', 'NE', 12);
  ok('the driver is on drop and hook',
    (await api('/bootstrap')).views?.dropHook?.on === true, 'on');

  head('1. The trip records what is actually on the back');
  const flat = await runOne('Flatbed', 'Lincoln', 12);
  ok('a load was authorized', !!flat.trip, flat.trip?.number || (flat.decision.headline || '').slice(0, 70));
  console.log(`  ..    trailerType=${flat.trip?.trailerType} freightTrailerType=${flat.trip?.freightTrailerType}`);
  ok('the assigned trailer still reads Drop & Hook',
    flat.trip?.trailerType === 'Drop & Hook', `${flat.trip?.trailerType}`);
  ok('and the freight type is kept beside it',
    flat.trip?.freightTrailerType === 'Flatbed', `${flat.trip?.freightTrailerType}`);

  head('2. A flatbed on drop and hook is a job site, not a warehouse');
  // The whole point. Arriving at 04:00 at a job site means waiting for somebody to turn up; a dock runs
  // all night. Before this the flatbed went down the dock branch and was told to back straight in.
  let call = await api(`/trips/${flat.trip.id}/arrived`, 'POST', { gameTime: iso(13, '04:00') });
  const c1 = call.call || call;
  console.log(`  ..    ${c1.kind}: ${(c1.headline || '').slice(0, 90)}`);
  ok('the receiver call is made against the freight, not the slot',
    /site|open|nobody|morning|queue|gate/i.test(`${c1.kind} ${c1.headline} ${c1.instruction}`),
    `${c1.kind}`);

  head('4. A reefer on the same arrangement is still a booked door');
  await api(`/trips/${flat.trip.id}/cancel`, 'POST', { reason: 'fixture', fault: 'Dispatcher' });
  await place('Omaha', 'NE', 14);
  const reefer = await runOne('Reefer', 'Lincoln', 14);
  ok('the reefer load was authorized', !!reefer.trip,
    reefer.trip?.number || (reefer.decision.headline || '').slice(0, 70));
  console.log(`  ..    freightTrailerType=${reefer.trip?.freightTrailerType}`);
  ok('it records reefer, not Drop & Hook',
    reefer.trip?.freightTrailerType === 'Reefer', `${reefer.trip?.freightTrailerType}`);

  const rc = await api(`/trips/${reefer.trip.id}/arrived`, 'POST', { gameTime: iso(15, '04:00') });
  const c2 = rc.call || rc;
  console.log(`  ..    reefer at 04:00 -> ${c2.kind}: ${(c2.headline || '').slice(0, 80)}`);
  ok('a cold dock at four in the morning is not waiting for anybody to turn up',
    !/nobody|morning|open/i.test(`${c2.headline} ${c2.instruction}`),
    `${c2.kind}`);
  ok('the two loads reached different answers at the same hour on the same yard',
    c1.kind !== c2.kind, `flatbed ${c1.kind} vs reefer ${c2.kind}`);

  head('5. I have arrived is what the on-time record is judged on');
  // The reported shape: onto the property early, closed out much later. There is no Begin unload to log
  // on drop and hook, so before this the close-out clock WAS the arrival.
  await api(`/trips/${reefer.trip.id}/arrived`, 'POST', { gameTime: iso(15, '14:00') });
  const t = (await api('/bootstrap')).views?.activeTrip;
  ok('the stamp is on the trip', !!t?.arrivedGameTime, `${t?.arrivedGameTime}`);

  const closed = await api(`/trips/${reefer.trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(15, '16:30'), endOdometer: 90400, actualMiles: 120,
    truckDamageAfter: 2, trailerDamageAfter: 0,
  });
  const done = (un(closed).trips || []).find((x) => x.id === reefer.trip.id);
  console.log(`  ..    arrived ${done?.arrivedGameTime} / delivered ${done?.deliveredGameTime}`);
  const notes = JSON.stringify(closed);
  ok('arrival is taken from when they said they arrived, not the close-out clock',
    (done?.deliveredGameTime || '').includes('14:00') || /told me you had arrived/i.test(notes),
    `${done?.deliveredGameTime} — ${(notes.match(/Taking [^"]{0,80}/) || ['(no note)'])[0]}`);
  ok('and it does not claim they logged an unload they never did',
    !/logged Begin unload/i.test(notes), 'wording fits drop and hook');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
