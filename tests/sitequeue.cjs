/* Pulling up to a job site at 3am when they take it 7am to 3pm.
 *
 * From play: "The GAME won't stop me from delivering it. However I think the APP should tell the driver
 * that while he was the nth driver there to drop off (can be random, the earlier they get there the
 * better) they still have to set the clock to a time to simulate having to wait until folks were there
 * to unload him."
 *
 * ATS has no opinion about this. A construction site does: there is nobody there at three in the morning,
 * and when the gate does go up the trucks that spent the night are through it first. The app already tells
 * drivers to sit breaks and rests on the dev-console clock — this is the same instruction for the same
 * reason, and without it the site hours it now plans around are advice the driver cannot act on.
 *
 * The trade has to be visible from both sides: a night at the gate buys a place at the front, and rolling
 * up at opening puts you behind everyone who waited. Otherwise "arrive early" is just a penalty.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5901}/api`;
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
const iso = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 90000;
const views = async () => (await api('/bootstrap')).views;

/* The cycle from play: pull onto the property, tell the app you are there with the clock you can see,
   and it answers with when to log Begin unload and why. */
const arrive = (tripId, day, hm) =>
  api(`/trips/${tripId}/arrived`, 'POST', { gameTime: iso(day, hm) });

async function report(city, st, day, hm, kind = 'Receiver') {
  S = un(await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day, hm),
    fuelPct: 70, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 100000,
  }));
}

(async () => {
  const app = { driverName: 'D. Okonkwo', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1, '08:00'), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // Flatbed, so the destination is a site rather than a dock.
  const box = (S.trailers || []).find((t) => t.unit === S.driver.assignedTrailerUnit);
  if (box && box.type !== 'Flatbed')
    await api('/fleet/trailer', 'POST', { ...box, type: 'Flatbed', division: 'Flatbed', subtype: '' });

  head('1. Get a flatbed load running to a job site');
  await report('Denver', 'CO', 10, '06:00', 'Shipper');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const added = await api('/board/add', 'POST', {
    cargo: 'Steel Beams', trailerType: 'Flatbed', receiver: 'Front Range Aggregates',
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 115, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 40,
    weightLbs: 40000, preLoaded: true, atLocation: true,
  });
  const ev = (added.evaluations || [])[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: ev.load.id }).catch((e) => ({ error: e.message }));
  S = un(auth);
  const trip = (S.trips || []).find((t) => t.status !== 'Delivered');
  ok('a flatbed load is running to a site', !!trip, trip ? `${trip.number} -> ${trip.destCity}` : auth.error);

  if (trip) {
    head('2. Rolling up at 3am: told what the game will not tell them');
    await report('Pueblo', 'CO', 11, '03:00');
    const early = (await arrive(trip.id, 11, '03:00')).call;
    ok('the app has something to say about it', !!early,
      early ? `#${early.position}, set ${early.workStartsGameTime}` : '(silent)');
    if (early) {
      ok('it says ATS will let them drop it and a real site would not',
        /ATS will let you drop this the second you back up/i.test(early.instruction), early.instruction.slice(0, 120));
      ok('it names a clock time to set',
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(early.workStartsGameTime), early.workStartsGameTime);
      ok('and the time it names is later than now', early.waitHours > 0, `${early.waitHours}h`);
      ok('it tells them to log Begin unload at that time',
        /Begin unload/i.test(early.instruction), early.instruction.slice(-90));
    }

    head('3. A night at the gate buys a place at the front');
    // The trade has to cut both ways or "get there early" is only ever a cost.
    await report('Pueblo', 'CO', 11, '03:00');
    const atThree = (await arrive(trip.id, 11, '03:00')).call;
    await report('Pueblo', 'CO', 11, '06:45');
    const atQuarterTo = (await arrive(trip.id, 11, '06:45')).call;
    console.log(`  ..    03:00 -> #${atThree?.position ?? '-'} `
      + `(${atThree?.ahead ?? '-'} ahead), 06:45 -> #${atQuarterTo?.position ?? '-'} `
      + `(${atQuarterTo?.ahead ?? '-'} ahead)`);
    if (atThree && atQuarterTo)
      ok('turning up in the small hours puts you ahead of the one who slept in',
        atThree.ahead <= atQuarterTo.ahead,
        `${atThree.ahead} vs ${atQuarterTo.ahead} trucks ahead`);
    else
      ok('both arrivals produced a queue call', !!atThree && !!atQuarterTo,
        `${!!atThree} / ${!!atQuarterTo}`);

    head('4. Mid-morning the rush is gone and nothing is said');
    await report('Pueblo', 'CO', 11, '13:00');
    const midday = (await arrive(trip.id, 11, '13:00')).call;
    ok('arriving into a quiet afternoon is walked straight in, bad days aside',
      !midday || midday.kind === 'StraightIn'
        || /loader is down|operator has not turned up|one machine short/i.test(midday.instruction),
      midday ? `${midday.kind}, ${midday.waitHours}h` : '(silent)');

    head('5. Asking again does not roll a better place in the line');
    await report('Pueblo', 'CO', 11, '03:00');
    const again = (await arrive(trip.id, 11, '03:00')).call;
    ok('the same arrival gives the same answer',
      !!again && !!atThree && again.workStartsGameTime === atThree.workStartsGameTime,
      `${atThree?.workStartsGameTime} vs ${again?.workStartsGameTime}`);
  }

  head('5b. A site has its own bad days');
  // From play: "the same lateness can happen with flatbed — unloader broke down, unloading guy didn't
  // show up — could delay things sometimes (not super often though)." A yard runs on one machine and one
  // operator far more often than a warehouse does. It has to be uncommon: a hold-up on every visit is not
  // a hold-up, it is the schedule.
  if (trip) {
    let snags = 0, seen = 0;
    for (let d = 40; d < 100; d++) {
      const call = (await arrive(trip.id, d, '09:00')).call;
      if (!call) continue;
      seen++;
      if (/loader is down|operator has not turned up|one machine short/i.test(call.instruction)) snags++;
    }
    head('6. A dock never gets this — a warehouse is staffed at 3am');
  // On a REAL dry van run, not by editing the register under a flatbed load that is still on the truck.
  // The trip knows what it is carrying, and it is right to go on knowing after somebody edits the fleet.
  if (trip) {
    odo += 115;
    await api(`/trips/${trip.id}/complete`, 'POST', {
      deliveredGameTime: iso(11, '14:00'), actualMiles: 115, endOdometer: odo,
      locationKind: 'Receiver', gameTime: iso(11, '14:00'), fuelPct: 60,
      truckDamageAfter: 3, trailerDamageAfter: 2,
    });
  }
  const box2 = (S.trailers || []).find((x) => x.unit === S.driver.assignedTrailerUnit);
  if (box2) await api('/fleet/trailer', 'POST', { ...box2, type: 'Dry Van', division: 'Dry Van', subtype: '' });

  await report('Pueblo', 'CO', 12, '06:00', 'Shipper');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  await api('/board/clear', 'POST', {});
  const van = await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: 'Dry Van', receiver: 'Front Range Aggregates',
    originCity: 'Pueblo', originState: 'CO', destCity: 'Denver', destState: 'CO',
    loadedMiles: 115, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 40,
    weightLbs: 30000, preLoaded: true, atLocation: true,
  });
  const vanEv = (van.evaluations || [])[0];
  if (vanEv) S = un(await api('/dispatch/authorize', 'POST', { loadId: vanEv.load.id }).catch(() => ({})));
  const vanTrip = (S.trips || []).find((x) => x.status !== 'Delivered');
  ok('a dry van load is running to a warehouse', !!vanTrip,
    vanTrip ? `${vanTrip.number} ${vanTrip.trailerType}` : '(none)');

  await report('Denver', 'CO', 12, '03:00');
  const vanCall = vanTrip ? (await arrive(vanTrip.id, 12, '03:00')).call : null;
  ok('a dry van at 3am is never told the place is shut',
    !vanCall || !/would not|ahead of them opening|in line/i.test(vanCall.instruction),
    vanCall ? vanCall.instruction.slice(0, 110) : '(nothing to say)');

  // Close the dry van run out, or there is an open trip and nothing new can be authorised.
  if (vanTrip) {
    odo += 115;
    await api(`/trips/${vanTrip.id}/complete`, 'POST', {
      deliveredGameTime: iso(12, '16:00'), actualMiles: 115, endOdometer: odo,
      locationKind: 'Receiver', gameTime: iso(12, '16:00'), fuelPct: 60,
      truckDamageAfter: 3, trailerDamageAfter: 2,
    }).catch(() => {});
  }

  head('7. A booked dock: they take you early, on time, or not for a while');
  // The other half of arriving, from play: "If I get to a warehouse at 2:30 for a 3PM appointment, they
  // COULD take me early, on time OR be backed up and take me later than my appointment."
  //
  // The roll is seeded on the trip and the hour they pulled in, so one booked load turned up at fourteen
  // different times exercises it honestly — and proves the same arrival never changes its mind.
  await report('Denver', 'CO', 30, '05:00', 'Shipper');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  await api('/board/clear', 'POST', {});
  const bk = await api('/board/add', 'POST', {
    cargo: 'Palletised Goods', trailerType: 'Dry Van', receiver: 'Blue Ridge Foods',
    originCity: 'Denver', originState: 'CO', destCity: 'Pueblo', destState: 'CO',
    loadedMiles: 115, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 34,
    weightLbs: 30000, preLoaded: true, atLocation: true, appointmentOpensHours: 20,
  });
  const bkEv = (bk.evaluations || [])[0];
  if (bkEv) S = un(await api('/dispatch/authorize', 'POST', { loadId: bkEv.load.id }).catch(() => ({})));
  const booked = (S.trips || []).find((x) => x.status !== 'Delivered');
  ok('a booked dock load is running', !!booked && !!booked.appointmentOpensGameTime,
    booked ? `${booked.number} slot ${booked.appointmentOpensGameTime}` : '(none)');

  const kinds = {};
  if (booked && booked.appointmentOpensGameTime) {
    const slot = Date.parse(booked.appointmentOpensGameTime + ':00Z');
    for (let h = 1; h <= 14; h++) {
      const at = new Date(slot - h * 3600000).toISOString().slice(0, 16);
      const call = (await api(`/trips/${booked.id}/arrived`, 'POST', { gameTime: at })).call;
      const k = call ? call.kind : 'StraightIn';
      kinds[k] = (kinds[k] || 0) + 1;
    }
    console.log(`  ..    booked slot, arriving 1-14h early: ${JSON.stringify(kinds)}`);

    ok('a booked dock does not always do the same thing', Object.keys(kinds).length >= 2,
      Object.keys(kinds).join(', '));
    ok('sometimes they have a door free and take you early', (kinds.TakenEarly || 0) > 0,
      `${kinds.TakenEarly || 0} of 14`);
    ok('sometimes it is the slot and not a minute before', (kinds.OnTime || 0) > 0,
      `${kinds.OnTime || 0} of 14`);
    ok('and sometimes they are behind and you wait past your own appointment',
      (kinds.BackedUp || 0) > 0, `${kinds.BackedUp || 0} of 14`);

    const twice = (await api(`/trips/${booked.id}/arrived`, 'POST',
      { gameTime: new Date(slot - 3600000).toISOString().slice(0, 16) })).call;
    const thrice = (await api(`/trips/${booked.id}/arrived`, 'POST',
      { gameTime: new Date(slot - 3600000).toISOString().slice(0, 16) })).call;
    ok('the same arrival cannot be re-rolled for a better answer',
      (twice?.kind || '') === (thrice?.kind || ''), `${twice?.kind} vs ${thrice?.kind}`);
  }

  console.log(`  ..    arriving 0:30 early on a booked slot: ${JSON.stringify(kinds)}`);
  ok('a booked dock does not always do the same thing', Object.keys(kinds).length >= 2,
    Object.keys(kinds).join(', '));
  ok('sometimes they have a door free and take you early', (kinds.TakenEarly || 0) > 0,
    `${kinds.TakenEarly || 0} of 14`);
  ok('sometimes it is the slot and not a minute before', (kinds.OnTime || 0) > 0,
    `${kinds.OnTime || 0} of 14`);
  ok('and sometimes they are behind and you wait past your own appointment',
    (kinds.BackedUp || 0) > 0, `${kinds.BackedUp || 0} of 14`);

  console.log(`  ..    ${snags} snags across ${seen} arrivals`);
    ok('a site does sometimes have a bad day', snags > 0, `${snags}/${seen}`);
    ok('but not most days', snags < seen * 0.35, `${snags}/${seen}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
