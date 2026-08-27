/* Issues #104, #105 and #106 — three things the app knew and did not say.
 *
 * #104: the Monday true-up only fired when the driver was standing ON a Monday. The clock moves in
 * whatever jumps their play took, so a 34 taken over a weekend, or a long run, stepped over the day and
 * the week was never squared — skipped, not deferred. It could also be swallowed on arrival: the modal
 * chain returned on the first thing it found and a home brief came ahead of it, which is exactly when a
 * Monday is most likely to have been stepped over.
 *
 * #105: paydays settle on whichever endpoint moved the clock across a Friday. Four do; two of the four
 * showed the result and two threw it away. A payday landing on a fuel-stop log was paid, banked and
 * never mentioned — and by the next status report there was nothing left to announce, because it had
 * already been paid.
 *
 * #106: whether the receiver will have the truck on their property overnight was said once in the
 * dispatch briefing and lost with the board. It is planning information for the whole run.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5973}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
// Day 0 is 2000-01-01 and day 0 is a Monday, so day N is 2000-01-(N+1).
const day = (n, hhmm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hhmm}`;
};
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const named = (n) => `day ${n} (${WEEK[n % 7]})`;

let S;
async function at(n, city = 'Springfield', state = 'MO', kind = 'TruckStop', hhmm = '06:00') {
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: state, locationKind: kind, gameTime: day(n, hhmm),
    fuelPct: 88, atsOdometer: 400 + n * 30, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: 60000,
  });
  S = r.snapshot;
  return r;
}

/* One load run start to finish, so there is pay on the books for a Friday to settle. */
async function runLoad(n, dest = ['Oklahoma City', 'OK'], miles = 500) {
  await at(n, 'Springfield', 'MO', 'Shipper');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Palletised goods', trailerType: S.trailers[0].type,
    originCity: 'Springfield', originState: 'MO', receiver: 'Vitas Foods',
    destCity: dest[0], destState: dest[1], loadedMiles: miles, deadheadMiles: 0,
    gameRevenue: 2200, deadlineHours: 60, weightLbs: 38000, atLocation: true,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id });
  const id = auth.trip.id;
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(n, '06:00'), kind: 'BeginLoad', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(n, '08:30'), kind: 'EndLoad', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(n + 1, '10:00'), kind: 'BeginUnload', detail: '' });
  await api(`/trips/${id}/event`, 'POST', { gameTime: day(n + 1, '12:00'), kind: 'EndUnload', detail: '' });
  const done = await api(`/trips/${id}/complete`, 'POST', {
    deliveredGameTime: day(n + 1, '12:00'), actualMiles: miles, endOdometer: 900 + n * 30,
    actualRevenue: 2200, fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 3, trailerDamageAfter: 2, cargoDamagePct: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: dest[0], locationState: dest[1], fuelPct: 55, gameTime: day(n + 1, '12:00'),
  });
  S = done.snapshot;
  return { done, id, trip: auth.trip };
}

const views = async () => (await api('/bootstrap')).views;

(async () => {
  const app = { driverName: 'T. Old', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  console.log(`     hired on ${named(1)}`);

  head('1. #104 A brand-new career does not open owing a reconciliation');
  // Making a passed Monday count meant a career hired on a Tuesday would otherwise be asked, on its
  // first day, to square a week it was not around for.
  let v = await views();
  ok('nothing is due on the day of hire', v.trueUp.due === false, `due=${v.trueUp.due}`);
  await at(3);
  v = await views();
  ok('nor mid-week before the first Monday since', v.trueUp.due === false, `due=${v.trueUp.due} on ${named(3)}`);

  head('2. #104 On the Monday itself, as it always did');
  await at(7);                                       // day 7 is a Monday
  v = await views();
  ok('due on the Monday', v.trueUp.due === true, `due=${v.trueUp.due} on ${named(7)}`);
  ok('and it says which Monday it means', v.trueUp.forDay === 7, `day ${v.trueUp.forDay}`);
  ok('which is today, so it is not called late', v.trueUp.daysAgo === 0, `${v.trueUp.daysAgo} days ago`);
  const squared = await api('/finance/true-up', 'POST', { atsBalance: v.trueUp.expected });
  ok('squaring it works', squared.squared === true, squared.message?.slice(0, 70));
  ok('and it stops asking', (await views()).trueUp.due === false, 'settled');

  head('3. #104 The reported case: a 34 over a Monday, reporting in on the Wednesday');
  // Sunday, then straight to Wednesday. The Monday in between never existed as far as the app was
  // concerned, and the week was silently skipped rather than deferred.
  await at(13);                                      // Sunday
  ok('nothing due on the Sunday before it', (await views()).trueUp.due === false, `on ${named(13)}`);
  await at(16);                                      // Wednesday — day 14's Monday was stepped over
  v = await views();
  ok('the skipped Monday is still due on the Wednesday', v.trueUp.due === true,
    `due=${v.trueUp.due} on ${named(16)}`);
  ok('and it names the Monday rather than pretending it is today', v.trueUp.forDay === 14,
    `for day ${v.trueUp.forDay}, today is ${named(16)}`);
  ok('saying how long ago it was', v.trueUp.daysAgo === 2, `${v.trueUp.daysAgo} days ago`);

  head('4. #104 It is still one week, not one per day stepped over');
  await api('/finance/true-up', 'POST', { atsBalance: (await views()).trueUp.expected });
  v = await views();
  ok('squared once and it is done', v.trueUp.due === false, `due=${v.trueUp.due}`);
  await at(17);
  ok('and it does not come back the next day', (await views()).trueUp.due === false, `on ${named(17)}`);

  head('5. #104 A long jump forward still only owes the most recent Monday');
  await at(40);
  v = await views();
  ok('due again after several weeks', v.trueUp.due === true, `due=${v.trueUp.due} on ${named(40)}`);
  ok('for the most recent Monday, not the first missed one', v.trueUp.forDay === 35,
    `for day ${v.trueUp.forDay}`);
  await api('/finance/true-up', 'POST', { atsBalance: (await views()).trueUp.expected });

  head('6. #105 and #107 A payday nobody has been shown is held, not lost');
  // Fridays are the days where day % 7 == 4 — 4, 11, 18, 25, 32, 39, 46, 53. This load loads on the
  // Thursday and delivers on the Friday, so closing it out is what crosses the payday.
  //
  // It is also #107 in miniature. The unload event logged at ten on the Friday moves the clock, finds
  // nothing owed because the trip is not closed yet, and used to mark the Friday done on the way past —
  // so the close-out two hours later found the payday already behind it and the load waited a week for
  // a settlement it should have been on.
  const r1 = await runLoad(45);                      // day 45 Thu -> day 46 Fri
  let v6 = await views();
  const held = v6.unannouncedPay || [];
  ok('the week settled on the close-out', (r1.done.paid || []).length >= 1,
    (r1.done.paid || []).map((p) => p.number).join(', ') || '(nothing settled)');
  ok('and it is on the snapshot as unannounced', held.length >= 1,
    held.map((p) => p.number).join(', ') || '(none held)');
  ok('with the money on it, so there is something to show',
    held.length >= 1 && held[0].gross > 0, `$${held[0]?.gross}`);
  ok('#107 it is dated to the Friday the load was actually delivered on',
    /Day 46/i.test((r1.done.paid || [])[0]?.notes || ''),
    ((r1.done.paid || [])[0]?.notes || '').slice(0, 60) || '(no note)');
  ok('and the trip is settled rather than left waiting a week',
    (S.trips || []).filter((x) => x.status === 'Delivered' && !x.settlementNumber).length === 0,
    'nothing left unsettled');

  head('7. #105 It stays held until something says it was actually shown');
  // The distinction the old code did not make: paying is the calendar's job, telling the driver is the
  // screen's. Conflating them is how a payday landed on a fuel-stop log and went unmentioned.
  await at(47, 'Oklahoma City', 'OK');
  ok('a status report does not quietly clear it', ((await views()).unannouncedPay || []).length >= 1,
    'still held');
  const ackd = await api('/pay/acknowledge', 'POST', { numbers: held.map((p) => p.number) });
  ok('acknowledging clears it', ackd.marked >= 1, `${ackd.marked} marked`);
  ok('and it is gone from the snapshot', ((await views()).unannouncedPay || []).length === 0, 'clear');

  head('8. #105 The bug itself: settled on a call with no screen behind it');
  // A load closed out well clear of a Friday, so its pay sits unsettled on the books.
  await runLoad(48);                                 // day 48 Sun -> day 49 Mon: no Friday crossed
  ok('nothing settled on that close-out', ((await views()).unannouncedPay || []).length === 0,
    'quiet close');

  // Now log a fuel stop on the far side of the next Friday. Under the old code this paid the week,
  // advanced LastPaydayDay and handed the settlement to a handler that toasted "Logged." and dropped it.
  // The driver was paid and never told, and by the next status report there was nothing left to say.
  await at(50, 'Oklahoma City', 'OK');
  const move = await api('/moves', 'POST', {
    destCity: 'Wichita', destState: 'KS', kind: 'EmptyMove', reason: 'fixture reposition',
  });
  await api(`/trips/${move.trip.id}/event`, 'POST', {
    gameTime: day(53, '09:00'), kind: 'Fuel', detail: 'Fuelled 120 gal', gallons: 120, pricePerGal: 3.4,
  });
  const afterFuel = (await views()).unannouncedPay || [];
  ok('the fuel-stop log settled the week', afterFuel.length >= 1,
    afterFuel.map((p) => p.number).join(', ') || '(nothing settled)');
  ok('and the driver is still going to be told, because the snapshot holds it',
    afterFuel.length >= 1 && afterFuel[0].gross > 0, `$${afterFuel[0]?.gross}`);
  ok('it is a payday, not a leaving settlement',
    afterFuel.every((p) => p.trigger === 'Payday'), afterFuel.map((p) => p.trigger).join(', '));
  await api('/pay/acknowledge', 'POST', {});
  await api(`/trips/${move.trip.id}/cancel`, 'POST', { reason: 'fixture' });

  head('9. #106 The parking answer rides on the trip, not just the briefing');
  await at(55, 'Wichita', 'KS', 'Shipper');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const bd = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation: true,
    originCity: 'Wichita', originState: 'KS', receiver: 'Cattle Ranch',
    destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 160, deadheadMiles: 0,
    gameRevenue: 900, deadlineHours: 48, weightLbs: 36000,
  });
  const open = await api('/dispatch/authorize', 'POST', { loadId: bd.evaluations[0].load.id });
  const pk = (await views()).receiverParking;
  ok('the open trip carries a parking answer', !!pk, pk ? pk.headline : '(none)');
  if (pk) {
    ok('it names the receiver it is about', /Cattle Ranch/i.test(pk.receiver), pk.receiver);
    ok('and where they are', /Oklahoma City/i.test(pk.where), pk.where);
    ok('the answer is yes or no, not a maybe', typeof pk.allowed === 'boolean', `${pk.allowed}`);
    ok('a refusal says what to do about it',
      pk.allowed || /plan the last leg/i.test(pk.detail || ''), (pk.detail || '').slice(-90));
    ok('#121 permission is offered rather than ordered',
      !pk.allowed || /your call|if you want it/i.test(pk.detail || ''), (pk.detail || '').slice(-90));
    ok('the headline reads as an answer at a glance',
      /sit on their property|No overnight parking/i.test(pk.headline), pk.headline);
  }

  head('9b. #121 The gate being open is a fact. Where to sleep is not.');
  // Both branches, for real. Whether any one customer allows it is seeded, so the trip above exercises
  // whichever the seed picked — this walks receivers until it has met both and checks each on its own
  // terms. Dispatch may direct a driver it has left no choice; it may not direct one it has.
  const seen = {};
  for (const [city, state, who] of [
    ['Oklahoma City', 'OK', 'Cattle Ranch'], ['Dallas', 'TX', 'Voltison'], ['Denver', 'CO', 'Sellgoods'],
    ['Phoenix', 'AZ', 'Bushnell'], ['Tucson', 'AZ', 'Gallogher'], ['Reno', 'NV', 'Trameri'],
    ['Boise', 'ID', 'Posped'], ['Helena', 'MT', 'Stokes'], ['Butte', 'MT', 'NextBase'],
    ['Salt Lake City', 'UT', 'Chemso'], ['Elko', 'NV', 'Tradeaux'], ['Ely', 'NV', 'Kaarfor'],
  ]) {
    const r = await api(`/facility/parking?city=${encodeURIComponent(city)}&state=${state}&receiver=${encodeURIComponent(who)}`);
    seen[r.allowsOvernight ? 'yes' : 'no'] ??= { who, city, note: r.note };
    if (seen.yes && seen.no) break;
  }

  ok('some receivers allow it and some do not', !!seen.yes && !!seen.no,
    `${seen.yes?.who || '(none allowed)'} / ${seen.no?.who || '(none refused)'}`);

  if (seen.yes) {
    ok('when it is allowed, the note hands the decision over',
      /your call|if that suits you|not where to sleep/i.test(seen.yes.note),
      seen.yes.note.slice(-95));
    ok('and it does not order anyone to park up',
      !/park up there|so park up/i.test(seen.yes.note), 'no instruction');
    ok('it still names the other option and what it costs',
      /truck stop/i.test(seen.yes.note) && /\d+:\d\d/.test(seen.yes.note), 'trade-off given');
  }

  if (seen.no) {
    ok('when it is refused, it is still directive — there is no choice to hand over',
      /find a truck stop/i.test(seen.no.note), seen.no.note.slice(0, 80));
  }

  head('10. #106 Asking again cannot change the story halfway down the road');
  // Seeded on the career, the customer and the city, which is why it does not need storing on the trip:
  // recomputing gives the same answer the briefing gave, days and several hundred miles later.
  const again = (await views()).receiverParking;
  ok('the same answer comes back', again?.allowed === pk?.allowed,
    `${pk?.allowed} then ${again?.allowed}`);
  ok('and the same wording with it', again?.detail === pk?.detail, 'unchanged');

  head('11. #106 No open load, nothing to say');
  await api(`/trips/${open.trip.id}/cancel`, 'POST', { reason: 'fixture' });
  ok('the parking answer goes with the trip', !(await views()).receiverParking,
    `${(await views()).receiverParking}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
