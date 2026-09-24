/* Whether dock time is duty or rest, and which clock pays for it.
 *
 *   "When loading/unloading a dry van or reefer it is common for the driver to go into sleeper berth so
 *    cycle time won't advance, because once they are in the dock there is not anything for them to do
 *    really until the dock clears them to leave. Same with intermodal, just sit and wait for the crane.
 *    However for flatbed and tanker there is work to be done, hooking up hoses, strapping, tarping, etc
 *    so this should be how it is now where cycle time is used as we are on duty."
 *
 * The engine charged every dock the same way: on duty, both clocks, whatever was on the back. That is
 * right behind a flatbed and wrong behind a reefer, and the difference is not small — two hours a stop,
 * twice a day, is most of a day of cycle across a week.
 *
 * WHICH CLOCK. The seventy is the one that moves. Sleeper-berth time is not on-duty time, so it never
 * counts toward the cycle. The fourteen still runs: a couple of hours in the berth is not a qualifying
 * split and an ELD would not pause the window for it, so the app does not pretend otherwise — the same
 * treatment it already gives the thirty-minute break.
 *
 * AND THE CLOSE-OUT HAS TO AGREE. TripService carried the dock time across the unload by subtracting it
 * from both clocks. Left alone, the planner would promise a reefer run cost no cycle and the close-out
 * would take it anyway — the app disagreeing with itself across two screens about one load.
 *
 * WHAT THE DRIVER SETS. None of this is true unless they actually go into the sleeper in ATS, so the
 * plan says so before they accept and the close-out says so again while they are reading the clocks.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5897}/api`;
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

/** The same run, planned behind a given trailer. Only the trailer differs. */
const plan = (trailerType) => api('/hos/plan', 'POST', {
  deadheadMiles: 0, loadedMiles: 300, loadingHours: 1, unloadingHours: 2,
  trailerType, deadlineHours: 40, extraStops: 0,
});

const dockSteps = (p) => (p.timeline || []).filter((t) => t.kind === 'DockRest' || (t.kind === 'OnDuty' && /load|bunk/i.test(t.label)));

(async () => {
  const app = { driverName: 'M. Sandoval', preferredDivision: 'Reefer', experienceYears: 5,
    homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2), code: 'PRI' });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(30),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 250000,
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 })
    .catch(() => {});

  head('1. Behind a reefer the driver waits, and the seventy does not move');
  const reefer = await plan('Reefer');
  ok('the dock time is booked as rest, not duty', reefer.dockRestHours >= 2.9,
    `${reefer.dockRestHours} h in the bunk of 3 h dock time`);
  ok('and none of it lands in on-duty hours',
    reefer.onDutyHours < reefer.driveHours + 0.5,
    `onDuty ${reefer.onDutyHours} vs drive ${reefer.driveHours} (pre-trip only)`);
  ok('the timeline says what they are doing', dockSteps(reefer).some((t) => /bunk/i.test(t.label)),
    dockSteps(reefer).map((t) => t.label).join(' | '));

  head('2. Behind a flatbed the driver works, and both clocks pay');
  const flat = await plan('Flatbed');
  ok('none of the dock time is rest', (flat.dockRestHours || 0) < 0.01, `${flat.dockRestHours}`);
  ok('it is all on duty', flat.onDutyHours > flat.driveHours + 2.9,
    `onDuty ${flat.onDutyHours} vs drive ${flat.driveHours}`);
  ok('the timeline calls it work', dockSteps(flat).some((t) => /hook|unload/i.test(t.label)),
    dockSteps(flat).map((t) => t.label).join(' | '));

  head('3. Same run, same hours — the cycle is what differs');
  // The whole point. Identical miles and identical dock time; the only input that changed is the box.
  const cycleAfter = (p) => {
    const last = (p.timeline || [])[p.timeline.length - 1];
    return last ? last.cycleRemainingAfter : null;
  };
  ok('the two plans take the same elapsed time',
    Math.abs(reefer.elapsedHours - flat.elapsedHours) < 0.05,
    `${reefer.elapsedHours} vs ${flat.elapsedHours} h`);
  ok('but the reefer run ends with more cycle in hand',
    cycleAfter(reefer) > cycleAfter(flat) + 2.9,
    `reefer ${cycleAfter(reefer)} vs flatbed ${cycleAfter(flat)}`);

  head('4. Intermodal waits with the vans, not with the flatbeds');
  const box = await plan('Container');
  ok('a container is hands-off too', box.dockRestHours >= 2.9, `${box.dockRestHours} h`);

  head('5. A trailer nobody has classified is treated as work');
  // The failure modes are not symmetrical: crediting hours a driver did not have puts them over their
  // cycle in the game with an app insisting they are fine.
  const odd = await plan('Pneumatic Dry Bulk');
  ok('an unrecognised type counts as on duty', (odd.dockRestHours || 0) < 0.01, `${odd.dockRestHours}`);
  const none = await plan('');
  ok('and so does a blank one, which is how every caller behaved before this existed',
    (none.dockRestHours || 0) < 0.01, `${none.dockRestHours}`);

  head('6. The plan says what to set in the game');
  ok('the reefer plan names the sleeper', /sleeper/i.test(reefer.dockAdvice || ''),
    (reefer.dockAdvice || '(nothing)').slice(0, 100));
  ok('and says the 70 does not move', /70 does not move/i.test(reefer.dockAdvice || ''), '');
  ok('the flatbed plan says to stay on duty', /on duty/i.test(flat.dockAdvice || ''),
    (flat.dockAdvice || '(nothing)').slice(0, 100));

  head('7. The close-out follows the same rule');
  // The half that would otherwise disagree: the planner promises no cycle, and then TripService takes
  // it anyway as the load closes.
  async function closeOut(trailerType) {
    let st = await api('/export');
    st.status.gameTime = iso(31);
    // confirmed:true is the baseline the carry needs — CarryClocksAcrossTheDock refuses to adjust
    // clocks it cannot vouch for, and the previous close-out in this suite clears the flag. Without it
    // the second trailer silently takes the 'no reading to work from' branch and nothing moves, which
    // reads exactly like the rule failing to apply.
    st.hos = { ...st.hos, driveRemaining: 9, shiftRemaining: 12, breakRemaining: 7, cycleRemaining: 60,
               asOfGameTime: iso(31), projected: false, confirmed: true };
    st.trips = [{
      id: 'dock-' + trailerType, number: 'PRI-L-700', kind: 'Freight', status: 'InTransit',
      cargo: 'Test load', trailerType,
      originCity: 'Springfield', originState: 'MO', destCity: 'Tulsa', destState: 'OK',
      dispatchedGameTime: iso(31), startOdometer: 90000, loadedMiles: 180,
      loadingHours: 1, unloadingHours: 2, detentionHours: 0, events: [],
    }];
    st.status.activeTripId = 'dock-' + trailerType;
    await api('/import', 'POST', st);

    const r = await api('/trips/dock-' + trailerType + '/complete', 'POST', {
      deliveredGameTime: iso(31, '18:00'), atsOdometer: 90180,
      truckDamagePct: 2, trailerDamagePct: 2, unloadingHours: 2, unloadAlreadyRan: true,
    }).catch((e) => ({ error: e.message }));
    if (r.error) return { error: r.error };
    const after = await api('/export');
    return { cycle: after.hos.cycleRemaining, shift: after.hos.shiftRemaining,
             audit: JSON.stringify(r.audit?.carriedForward || r.audit || '') };
  }

  const rClose = await closeOut('Reefer');
  const fClose = await closeOut('Flatbed');

  if (rClose.error || fClose.error) {
    ok('the close-out ran', false, rClose.error || fClose.error);
  } else {
    ok('a reefer unload leaves the cycle where it was', rClose.cycle === 60,
      `60 -> ${rClose.cycle}`);
    ok('a flatbed unload takes it off the cycle', fClose.cycle < 60,
      `60 -> ${fClose.cycle}`);
    ok('the window runs down either way', rClose.shift < 12 && fClose.shift < 12,
      `reefer shift ${rClose.shift}, flatbed shift ${fClose.shift}`);
    ok('and the driver is told what to set for the reefer',
      /sleeper|bunk/i.test(rClose.audit), rClose.audit.slice(0, 140));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
