/* "No appointment" is worth two different things, and the app only ever said the dock one.
 *
 *   "I have a flatbed load, it says they can take it early but that isn't totally the case right? I
 *    thought this was the case where if we get there before the window we have to wait. This should be
 *    indicated as this is different from say a reefer receiver taking it early and just allowing us to
 *    unload as soon as we get there."
 *
 * Right on every count, and the app was already behaving correctly — it was only speaking incorrectly.
 *
 * ReceiverTakesEarly means UNBOOKED: nobody is holding a door for you at a stated time. It has never
 * meant "they will take it before the window opens", and nothing in the app does that. The planner waits
 * for the opening, ReceiverCall.BeforeTheyOpen holds the truck to it, and at a site AtSite then puts it
 * behind whoever queued at the gate. All correct.
 *
 * What the driver was told was the opposite. The board card, the authorisation rationale and the trip
 * panel all printed the warehouse story on every unbooked load: "take it whenever you get there", "do
 * not sit on their gate", "do not sit waiting for the window". So a flatbed driver was promised a walk-in
 * and then held at the gate by the same app on the same load, which is the contradiction that got
 * reported.
 *
 * A dock and a site are not the same place. At a warehouse, unbooked means the wait is gone: the doors
 * are staffed and there is no slot to sit for. At a job site it means nobody is expecting anybody —
 * which is not the same as no wait, because a gate opens on a clock and has a line behind it. Turning up
 * early buys a place in that line and nothing else.
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
const hm = (i) => (i || '').slice(11);

let S, odo = 310000;

/** One listing, evaluated. The knob is pinned so every receiver is unbooked and the seed cannot decide it. */
async function offer({ trailerType, cargo, receiver, dest }) {
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo, trailerType, receiver,
    originCity: 'Denver', originState: 'CO', destCity: dest, destState: 'CO',
    loadedMiles: 120, deadheadMiles: 0, gameRevenue: 900, deadlineHours: 36,
    weightLbs: 40000, atLocation: true, appointmentOpensHours: 9,
  });
  return (board.evaluations || [])[0];
}

const joined = (e) => [...(e.pros || []), ...(e.cons || [])].join(' ');

(async () => {
  const app = { driverName: 'R. Okonkwo', preferredDivision: 'Flatbed', experienceYears: 11,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(4) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  // Every receiver unbooked, so the two cards differ only by where the freight is going.
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: 100 });

  // Both divisions, so the same driver can be offered both kinds of place.
  let st = await api('/export');
  st.company.divisions = ['Flatbed', 'Dry Van', 'Reefer'];
  st.trailers.push({
    unit: 'FB-9', type: 'Flatbed', subtype: '', division: 'Flatbed', year: 2021,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'FB-9';
  S = un(await api('/import', 'POST', st));
  await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: at(5, '04:00'),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, dutyStatus: 'OnDuty',
  });

  head('1. A flatbed is going to a site, and the card says which');
  const fb = await offer({ trailerType: 'Flatbed', cargo: 'Steel Beams', receiver: 'Brandt Construction', dest: 'Pueblo' });
  console.log(`  ..    ${(fb.pros || []).find((p) => /booked slot/i.test(p)) || '(nothing said)'}`);
  ok('it is unbooked', fb.receiverTakesEarly === true, String(fb.receiverTakesEarly));
  ok('and the card knows it is a site', fb.receiverIsSite === true, String(fb.receiverIsSite));
  ok('the driver is told it is a site and not a dock', /site rather than a dock/i.test(joined(fb)));
  ok('that the gate does not open before the window does',
    /will not open the gate before the window/i.test(joined(fb)));
  ok('and that being early only buys a place in the line',
    /place in the line, not an early start/i.test(joined(fb)));

  head('2. A reefer into a warehouse is the other case, and reads differently');
  st = await api('/export');
  st.trailers.push({
    unit: 'RF-4', type: 'Reefer', subtype: '', division: 'Reefer', year: 2022,
    status: 'InService', inGameGarage: true, homeTerminalId: st.company.terminals[0].id,
    damagePct: 0, stars: 5,
  });
  st.driver.assignedTrailerUnit = 'RF-4';
  S = un(await api('/import', 'POST', st));
  const dv = await offer({ trailerType: 'Reefer', cargo: 'Bottled Water', receiver: 'Kroger DC', dest: 'Greeley' });
  console.log(`  ..    ${(dv.pros || []).find((p) => /booked slot/i.test(p)) || '(nothing said)'}`);
  ok('also unbooked', dv.receiverTakesEarly === true, String(dv.receiverTakesEarly));
  ok('but not a site', dv.receiverIsSite === false, String(dv.receiverIsSite));
  ok('so it gets the dock answer: no door to wait on', /none of it is spent waiting on a door/i.test(joined(dv)));
  ok('and no gate queue is invented for a warehouse', !/place in the line/i.test(joined(dv)));

  head('3. Neither of them claims the window can be beaten');
  // The old copy said "do not sit waiting for the window", which is true nowhere. Nobody is taken before
  // a window opens — that is the game's own word on the place.
  for (const [what, e] of [['flatbed', fb], ['reefer', dv]]) {
    ok(`the ${what} card still holds the window`, /will not (take it|open the gate) before the window/i.test(joined(e)),
      joined(e).match(/will not [^.]*window[^.]*/i)?.[0]?.slice(0, 90) || '(silent)');
  }

  head('4. The briefing on an authorised site load matches what the gate will do');
  st = await api('/export');
  st.driver.assignedTrailerUnit = 'FB-9';
  S = un(await api('/import', 'POST', st));
  const again = await offer({ trailerType: 'Flatbed', cargo: 'Steel Beams', receiver: 'Brandt Construction', dest: 'Pueblo' });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: again.load.id });
  const why = auth.trip.authorizationRationale || '';
  console.log(`  ..    ${why.slice(-220)}`);
  ok('it does not promise a walk-in', !/Do not sit on their gate/i.test(why),
    /Do not sit on their gate/i.test(why) ? 'still promised' : 'quiet');
  ok('it says the gate waits for the window', /gate does not go up before the window/i.test(why));
  ok('and warns about the line', /expect a line/i.test(why));

  head('5. And the truck is actually held there, which is the point');
  const v = un(await api('/bootstrap'));
  ok('the view says this one is a site', v.views.receiverIsSite === true, String(v.views.receiverIsSite));
  const opens = v.trips.find((t) => t.id === auth.trip.id)?.appointmentOpensGameTime;
  const call = await api(`/trips/${auth.trip.id}/arrived`, 'POST', { gameTime: at(5, '06:00') });
  console.log(`  ..    arrived 06:00 against a window opening ${hm(opens)} — ${call.call?.headline}`);
  ok('turning up before the window is a wait, not a walk-in',
    call.call && call.call.workStartsGameTime > call.call.arrivedGameTime,
    `${hm(call.call?.arrivedGameTime)} → ${hm(call.call?.workStartsGameTime)}`);
  ok('and it is not before they open', call.call.workStartsGameTime >= opens,
    `${hm(call.call.workStartsGameTime)} against ${hm(opens)}`);

  head('6. Delivering before the window is queried whoever the receiver is');
  // This check used to let an unbooked load past on the reading that an agreeable receiver would take
  // freight before opening. None of them do.
  odo += 120;
  const done = await api(`/trips/${auth.trip.id}/complete`, 'POST', {
    deliveredGameTime: at(5, '06:00'), actualMiles: 120, endOdometer: odo, actualRevenue: 900,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 0, unloadingHours: 0, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Pueblo', locationState: 'CO', locationKind: 'Receiver',
    fuelPct: 60, gameTime: at(5, '06:00'),
  });
  const closed = done.snapshot.trips.find((t) => t.id === auth.trip.id);
  console.log(`  ..    ${closed.windowWarning || '(no query raised)'}`);
  ok('an unbooked delivery before opening is queried too',
    /would not have taken it yet/i.test(closed.windowWarning || ''), closed.windowWarning ? 'queried' : 'silent');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
