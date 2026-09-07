/* Docks and job sites wait for different things.
 *
 * From play: "Appointments are very common and expected with dry van and reefer loads (both need to be
 * unloaded at docks). In fact reefer should almost ALWAYS have an appointment as those are more time
 * sensitive goods (only cold goods — if the reefer trailer is hauling say cardboard it should act as a
 * dry van). On the other hand flatbed, tankers, etc RARELY have appointments as they are unloaded when
 * they hit the job site. HOWEVER they do have to wait if say 5 trucks are there at the same time."
 *
 * And then the part that inverts it: "a job site for a flatbed would likely have no people there at 3AM
 * but would at 6AM... Early is early for Reefer and dry van, I am pulling up to a dock or a store being
 * stocked by 3rd shift guys."
 *
 * So:
 *   DOCK  (dry van, reefer)      staffed round the clock; you wait for your SLOT, a point in time
 *   SITE  (flatbed, tanker, ...) rarely booked; you wait for OPENING, and then for the queue at the gate
 *
 * The app used to run everything through the dock model, so a load with no appointment had no wait at
 * all, ever — which made half the fleet look free of the one cost that dominates the other half.
 *
 * The rule that keeps this honest: where the app is GUESSING at a working day rather than reading the
 * range off the listing, that guess may cost the driver hours but must never be what refuses a load ATS
 * says is deliverable.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5900}/api`;
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
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);
const iso = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S;

/** Stand the driver at a shipper at a chosen hour of the day, clocks full. */
async function at(hm) {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: iso(12, hm),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
}

/** One short local run, so arrival is close to the clock we just set. */
async function offer(type, cargo, extra = {}) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo, trailerType: type, receiver: 'Front Range Aggregates',
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 18, deadheadMiles: 0, gameRevenue: 600, deadlineHours: 36,
    weightLbs: 24000, preLoaded: true, ...extra,
  });
  return r.evaluations[0];
}

(async () => {
  const app = { driverName: 'T. Okafor', preferredDivision: 'Flatbed', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1, '08:00'), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  head('1. A job site is shut in the small hours');
  // Sweep the clock round and see when this receiver will and will not take a flatbed. The hours are
  // seeded per customer, so the suite discovers them rather than assuming them.
  const seen = [];
  for (const hm of ['01:00', '03:00', '05:00', '07:00', '09:00', '11:00', '13:00']) {
    await at(hm);
    const ev = await offer('Flatbed', 'Steel Beams');
    seen.push({ hm, wait: ev.feasibility?.waitForAppointmentHours || 0,
                site: !!ev.feasibility?.waitedForSiteToOpen,
                queue: ev.feasibility?.queueHours || 0,
                idle: ev.feasibility?.idleHours || 0 });
  }
  for (const x of seen)
    console.log(`  ..    ${x.hm} -> wait ${hhmm(x.wait)}${x.site ? ' (site opening)' : ''}`
      + `${x.queue ? `, queue ${hhmm(x.queue)}` : ''}`);

  const early = seen.filter((x) => x.site && x.wait > 0);
  const open = seen.filter((x) => x.wait === 0);
  ok('turning up before they open means waiting', early.length > 0,
    early.map((x) => x.hm).join(', ') || '(never waits)');
  ok('and it is flagged as a site opening, not a booked slot', early.every((x) => x.site),
    `${early.length} of ${early.length}`);
  ok('inside their day there is no wait at all', open.length > 0,
    open.map((x) => x.hm).join(', ') || '(always waits)');
  ok('the small hours are the ones that wait',
    early.every((e) => Math.min(...open.map((o) => parseInt(o.hm, 10))) > parseInt(e.hm, 10)
                        || parseInt(e.hm, 10) < 6),
    early.map((x) => x.hm).join(', '));

  head('2. That wait is idle, and the queue is not');
  const waiter = early[0];
  if (waiter) {
    ok('waiting outside the gate is idle time', waiter.idle > 0, hhmm(waiter.idle));
  }
  const queued = seen.find((x) => x.queue > 0);
  if (queued) {
    ok('the queue is on the dock clock, not counted as idle',
      queued.idle === 0 || queued.queue !== queued.idle, `queue ${hhmm(queued.queue)} idle ${hhmm(queued.idle)}`);
    // Everyone turns up at opening, so it eases off through the morning.
    const later = seen.filter((x) => x.queue >= 0 && parseInt(x.hm, 10) > parseInt(queued.hm, 10));
    if (later.length)
      ok('and it eases off later in the day',
        Math.min(...later.map((x) => x.queue)) <= queued.queue,
        `${hhmm(queued.queue)} at ${queued.hm} -> ${hhmm(Math.min(...later.map((x) => x.queue)))}`);
  } else {
    console.log('  ..    this receiver is a quiet one; no queue to measure');
  }

  head('3. A dock is staffed at 3am — early is early, not shut');
  await at('03:00');
  const van = await offer('Dry Van', 'Palletised Goods');
  ok('a warehouse is never waiting for morning',
    !van.feasibility?.waitedForSiteToOpen, `${van.feasibility?.waitedForSiteToOpen}`);
  ok('and no queue at the gate is invented for one',
    !(van.feasibility?.queueHours > 0), `${van.feasibility?.queueHours}`);

  head('4. Reefer is booked; a reefer full of cardboard is a dry van');
  // Seeded per load, so the honest measure is across a spread of them rather than any single roll.
  // The roll is seeded per load, so a handful of cargoes cannot tell 95% from 75%. Enough of them can.
  const N = 30;
  const cold = [], dry = [];
  for (let i = 1; i <= N; i++) {
    cold.push(`Frozen Foods lot ${i}`);
    dry.push(`Cardboard lot ${i}`);
  }

  await at('09:00');
  let coldBooked = 0, dryBooked = 0;
  for (const c of cold) {
    const ev = await offer('Reefer', c, { appointmentOpensHours: 6 });
    if (!ev.receiverTakesEarly) coldBooked++;
  }
  for (const c of dry) {
    const ev = await offer('Reefer', c, { appointmentOpensHours: 6 });
    if (!ev.receiverTakesEarly) dryBooked++;
  }
  console.log(`  ..    booked: cold ${coldBooked}/${N}, dry ${dryBooked}/${N}`);
  ok('cold freight is almost always on an appointment', coldBooked >= N * 0.85,
    `${coldBooked}/${N}`);
  ok('a reefer full of cardboard is booked more like a dry van', dryBooked < coldBooked,
    `${dryBooked}/${N} against ${coldBooked}/${N}`);
  ok('but still usually booked — it is going to a warehouse either way', dryBooked >= N * 0.5,
    `${dryBooked}/${N}`);

  head('5. A guess never refuses a load the game called deliverable');
  // The seeded working day may cost hours. It may not turn a legal run into an illegal one — the game
  // gave the deadline and the app only guessed the hours.
  let refusedOnGuess = 0;
  for (const hm of ['02:00', '04:00', '18:00', '20:00', '22:00', '23:30']) {
    await at(hm);
    const ev = await offer('Flatbed', 'Steel Beams', { deadlineHours: 14 });
    if (ev.feasibility?.verdict === 'Infeasible') refusedOnGuess++;
  }
  ok('a runnable flatbed is never refused on our own idea of opening hours',
    refusedOnGuess === 0, `${refusedOnGuess} refused`);

  head('6. Arriving after a guessed closing time is not held to the morning');
  // We guessed the working day; we did not see them lock the gate. Holding a load overnight on that is
  // what turned a 1,004-mile run infeasible by a minute.
  await at('20:00');
  const evening = await offer('Flatbed', 'Steel Beams');
  ok('an evening arrival is not pushed to tomorrow',
    (evening.feasibility?.waitForAppointmentHours || 0) < 6,
    hhmm(evening.feasibility?.waitForAppointmentHours || 0));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
