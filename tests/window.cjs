/* Issue #38: the delivery window is read as ATS shows it — a time range — and the app does the
   arithmetic, because it has the clock and the reader does not. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5680}/api`;
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

let S;
const hhmm = (h) => { const w = Math.floor(h + 1e-9); return `${w}:${String(Math.round((h - w) * 60)).padStart(2, '0')}`; };
// Game day 0 is the epoch, a Monday. Day 38 is therefore a Thursday, 39 a Friday, 40 a Saturday.
const gday = (day, hm) => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

(async () => {
  head('1. Hire and set the clock to 06:01, as reported');
  const app = { driverName: 'Window Tester', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 5, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:01' }));
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-01T06:01',
    fuelPct: 90, atsOdometer: 1000, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 40000,
  }));
  ok('clock is 06:01', S.status.gameTime === '2000-01-01T06:01', S.status.gameTime);

  head('2. The reported case: 6:15 AM to 12:55 PM from 06:01');
  let r = await api('/window/read', 'POST', { text: '6:15 AM - 12:55 PM' });
  ok('it is read as a range', r.hadRange === true, JSON.stringify(r));
  ok('the receiver opens at 06:15', /T06:15$/.test(r.opensAt || ''), r.opensAt);
  ok('the load is due at 12:55, not 14:01', /T12:55$/.test(r.dueAt || ''), r.dueAt);
  ok('which is 6:54 from now, not 8:00', Math.abs(r.hoursUntilDue - 6.9) < 0.02,
    `${hhmm(r.hoursUntilDue)} (${r.hoursUntilDue})`);

  head('3. AM/PM is honoured');
  r = await api('/window/read', 'POST', { text: '2:55 PM' });
  ok('an afternoon time is afternoon', /T14:55$/.test(r.dueAt || ''), r.dueAt);
  r = await api('/window/read', 'POST', { text: '12:30 AM' });
  ok('midnight-hour AM wraps to the next day', /02T00:30$/.test(r.dueAt || ''), r.dueAt);

  head('4. 24-hour and day-qualified times still work');
  r = await api('/window/read', 'POST', { text: '14:00' });
  ok('a bare 24-hour time', /T14:00$/.test(r.dueAt || ''), r.dueAt);
  r = await api('/window/read', 'POST', { text: 'Day 3 09:30' });
  // "Day 3" is the game's day 3, three days after the epoch: 2000-01-04. The clock here reads
  // 2000-01-01T06:01, which is day 0, so the window is three days and change out.
  ok('a day-qualified time lands on that day', /04T09:30$/.test(r.dueAt || ''), r.dueAt);
  ok('and the hours span the days', r.hoursUntilDue > 60 && r.hoursUntilDue < 84, `${r.hoursUntilDue}`);

  head('5. A window already past today is tomorrow');
  r = await api('/window/read', 'POST', { text: '5:00 AM' });
  ok('05:00 from 06:01 is tomorrow', /02T05:00$/.test(r.dueAt || ''), r.dueAt);

  head('6. Unreadable stays unreadable — nothing is invented');
  for (const junk of ['', 'soon', 'ASAP', 'urgent']) {
    r = await api('/window/read', 'POST', { text: junk });
    ok(`"${junk || '(empty)'}" gives nothing back`, r.readable === false, JSON.stringify(r));
  }

  head('7. The plausibility check is a backstop, not the fix');
  const type = encodeURIComponent(S.trailers[0].type);

  // ATS is genuinely generous on short runs — the real window here was 6:54 against a ~2:40 run.
  // Flagging ordinary generosity would be noise, so it stays quiet.
  const normal = await api(`/window/check?deadlineHours=8&miles=19&trailerType=${type}`);
  ok('ordinary ATS generosity is NOT questioned', !normal.warning, normal.warning || '(quiet)');
  ok('but the app knows what the run needs', normal.needed > 2 && normal.needed < 4,
    `${hhmm(normal.needed)} for 19 mi`);

  const absurd = await api(`/window/check?deadlineHours=72&miles=19&trailerType=${type}`);
  ok('three days for 19 mi is questioned', !!absurd.warning, absurd.warning || '(none)');
  ok('and it says what the run actually needs', /needs about/.test(absurd.warning || ''), absurd.warning);

  const fine = await api(`/window/check?deadlineHours=24&miles=600&trailerType=${type}`);
  ok('a realistic long haul is not questioned', !fine.warning, fine.warning || '(quiet)');

  const short = await api(`/window/check?deadlineHours=1&miles=600&trailerType=${type}`);
  ok('an impossible window is called impossible', /cannot be run/.test(short.warning || ''), short.warning);
  ok('600 mi genuinely needs more than 12 hours',
    (await api(`/window/check?deadlineHours=12&miles=600&trailerType=${type}`)).needed > 12,
    'drive plus dock at both ends');

  head('8. A wrong window on a load in flight can be corrected');
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST', {});
  const board = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 8, weightLbs: 20000,
  });
  const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
  S = auth.snapshot;
  let trip = S.views.activeTrip;
  ok('the load went out with the wrong window', /T14:01$/.test(trip.dueGameTime || ''), trip.dueGameTime);

  const fixed_ = await api(`/trips/${trip.id}/window`, 'POST', {
    deadlineHours: 6.9, note: 'Read off the game: 6:15 AM to 12:55 PM.',
  });
  S = un(fixed_);
  trip = S.views.activeTrip;
  ok('the appointment moves to 12:55', /T12:55$/.test(trip.dueGameTime || ''), trip.dueGameTime);
  ok('the correction is on the trip log',
    (trip.events || []).some((x) => /window corrected/i.test(x.detail || '')),
    (trip.events || []).map((x) => x.detail).join(' | '));
  ok('and the warning is cleared', !trip.windowWarning, trip.windowWarning || '(clear)');

  head('9. A closed load cannot have its window rewritten');
  let refused = false, msg = '';
  try {
    await api(`/trips/${trip.id}/window`, 'POST', { deadlineHours: 0 });
  } catch (e) { refused = true; msg = e.message; }
  ok('a zero window is refused', refused, msg);

  head('10. Arriving before the receiver opens means waiting');
  // Close the load out first so the board is free.
  await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: '2000-01-01T08:00', actualMiles: 19, endOdometer: 1019, actualRevenue: 300,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 0, trailerDamageAfter: 0, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0,
    layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
    delayReason: '', damageCause: '', notes: '',
    locationCity: 'Denver', locationState: 'CO', fuelPct: 80, gameTime: '2000-01-01T08:00',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  await api('/board/clear', 'POST', {});
  const near = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 12, weightLbs: 20000, appointmentOpensHours: 6,
  });
  const nearEv = near.evaluations[0];
  let f = nearEv.feasibility;
  // #80: an early take has nothing to wait through. Fourth section in this suite that needs the split.
  if (nearEv.receiverTakesEarly) {
    ok('taking it early, so no wait is planned', !f.waitForAppointmentHours,
      (nearEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the wait is planned, not ignored', f.waitForAppointmentHours > 0,
      `${hhmm(f.waitForAppointmentHours || 0)}`);
    ok('and it is called out as coming off the window',
      (f.warnings || []).some((w) => /before they open/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }

  head('11. A load with NO opening time plans exactly as before');
  await api('/board/clear', 'POST', {});
  const plain = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 12, weightLbs: 20000,
  });
  f = plain.evaluations[0].feasibility;
  ok('no wait is invented', !f.waitForAppointmentHours, `${f.waitForAppointmentHours}`);
  ok('nothing warns about a dock that was never mentioned',
    !(f.warnings || []).some((w) => /before they open/.test(w)),
    (f.warnings || []).join(' | ') || '(quiet)');
  ok('and the load is still feasible', f.verdict === 'Feasible', f.verdict);

  head('12. A long wait is taken as the reset rather than burned at the gate');
  await api('/board/clear', 'POST', {});
  const overnight = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const overnightEv = overnight.evaluations[0];
  f = overnightEv.feasibility;
  if (overnightEv.receiverTakesEarly) {
    ok('taking it early, so there is no wait to take as a reset',
      !f.waitForAppointmentHours,
      (overnightEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the long wait is recognised', f.waitForAppointmentHours > 10, `${hhmm(f.waitForAppointmentHours || 0)}`);
    ok('and sat as the reset, not spent on duty',
      (f.warnings || []).some((w) => /reset/.test(w) && /not wasted/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }
  ok('so the driver is not stranded out of hours', f.verdict !== 'Infeasible', f.verdict);

  head('13. Whether the receiver will have you overnight is per-facility and stable');
  // Find one of each by asking about a spread of receivers.
  const names = ['Walmart DC', 'Kroger', 'Target DC', 'Costco', 'Sysco', 'US Foods', 'Home Depot', 'Lowes'];
  const verdicts = [];
  for (const who of names) {
    const q = await api(`/facility/parking?city=Aurora&state=CO&receiver=${encodeURIComponent(who)}`);
    verdicts.push({ who, allows: q.allowsOvernight, note: q.note });
  }
  console.log('     ' + verdicts.map((v) => `${v.who}:${v.allows ? 'yes' : 'no'}`).join('  '));
  ok('some receivers allow it', verdicts.some((v) => v.allows), verdicts.filter((v) => v.allows).map((v) => v.who).join(', ') || 'none');
  ok('and some do not', verdicts.some((v) => !v.allows), verdicts.filter((v) => !v.allows).map((v) => v.who).join(', ') || 'none');

  const first = verdicts[0];
  const again = await api(`/facility/parking?city=Aurora&state=CO&receiver=${encodeURIComponent(first.who)}`);
  ok('the same receiver gives the same answer every time', again.allowsOvernight === first.allows,
    `${first.who}: ${first.allows} then ${again.allowsOvernight}`);

  const otherCity = await api(`/facility/parking?city=Pueblo&state=CO&receiver=${encodeURIComponent(first.who)}`);
  ok('but it is judged per site, not per company', typeof otherCity.allowsOvernight === 'boolean',
    `${first.who} Aurora=${first.allows} Pueblo=${otherCity.allowsOvernight}`);

  head('14. No overnight parking means the reset is sat at a truck stop');
  const noPark = verdicts.find((v) => !v.allows);
  const yesPark = verdicts.find((v) => v.allows);

  await api('/board/clear', 'POST', {});
  const away = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', receiver: noPark.who, loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const awayEv = away.evaluations[0];
  f = awayEv.feasibility;
  // #80: an early take means no wait, and a driver with nothing to wait through is not sent anywhere
  // to wait it out. Only the waiting case can exercise the reposition.
  if (awayEv.receiverTakesEarly) {
    ok('taking it early, so there is no reset to reposition for',
      !(f.timeline || []).some((x) => /Reposition to a truck stop/.test(x.label)),
      (awayEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('the driver is sent to a truck stop',
      (f.warnings || []).some((w) => /do not allow overnight parking/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
    ok('and the run either side is on the timeline',
      (f.timeline || []).some((x) => /Reposition to a truck stop/.test(x.label)),
      (f.timeline || []).map((x) => x.label).join(' | '));
    ok('with the trip back for the appointment',
      (f.timeline || []).some((x) => /Back to the receiver/.test(x.label)),
      (f.timeline || []).map((x) => x.label).join(' | '));
  }
  ok('it is still runnable', f.verdict !== 'Infeasible', f.verdict);

  await api('/board/clear', 'POST', {});
  const stay = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', receiver: yesPark.who, loadedMiles: 19, deadheadMiles: 0,
    gameRevenue: 300, deadlineHours: 30, weightLbs: 20000, appointmentOpensHours: 18,
  });
  const stayEv = stay.evaluations[0];
  f = stayEv.feasibility;
  // #80: this one can roll an early take, and then there is no sitting to do anywhere.
  if (stayEv.receiverTakesEarly) {
    ok('taking it early, so there is nothing to sit through',
      !(f.warnings || []).some((w) => /wait at the receiver/.test(w)),
      (stayEv.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
  } else {
    ok('a friendly receiver keeps you on their property',
      (f.warnings || []).some((w) => /let you sit on their/.test(w)),
      (f.warnings || []).join(' | ') || '(none)');
  }
  ok('and there is no repositioning',
    !(f.timeline || []).some((x) => /truck stop/i.test(x.label)),
    (f.timeline || []).map((x) => x.label).join(' | '));

  head('15. A short wait is sat at the receiver either way');
  for (const who of [noPark.who, yesPark.who]) {
    await api('/board/clear', 'POST', {});
    const brief = await api('/board/add', 'POST', {
      cargo: 'Machinery', trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
      destCity: 'Aurora', destState: 'CO', receiver: who, loadedMiles: 19, deadheadMiles: 0,
      gameRevenue: 300, deadlineHours: 12, weightLbs: 20000, appointmentOpensHours: 6,
    });
    const ev = brief.evaluations[0];
    const bf = ev.feasibility;
    // #80: roughly one receiver in eight takes it whenever you turn up, and then there is no wait to
    // sit anywhere. Seeded on the load, so which one it is here is fixed rather than flaky.
    if (ev.receiverTakesEarly) {
      ok(`${who}: taking it early, so there is no wait at all`,
        !(bf.warnings || []).some((w) => /wait at the receiver/.test(w)),
        (ev.pros || []).find((p) => /take it whenever/.test(p)) || 'no wait planned');
    } else {
      // Either answer is right, and which one depends on whether this plan HAS a rest to hang the
      // wait on (#185). With one, the rest runs longer and the driver arrives at opening with the
      // window intact; without one, a fresh ten will not fit inside the slack and it gets sat.
      // What must never happen is nobody being sent to a truck stop over it — asserted below.
      ok(`${who}: the wait is either sat at the receiver or slept off before it`,
        (bf.warnings || []).some((w) => /wait at the receiver|gets sat at the receiver/.test(w))
        || bf.sleptInHours > 0,
        bf.sleptInHours > 0
          ? `rest held ${bf.sleptInHours}h longer instead`
          : (bf.warnings || []).find((w) => /before they open/.test(w)) || '(none)');
    }
    ok(`${who}: and nobody is sent to a truck stop`,
      !(bf.timeline || []).some((x) => /truck stop/i.test(x.label)),
      (bf.timeline || []).map((x) => x.label).join(' | '));
  }
  head('THE ROCK SPRINGS CASE: every weekday name contains the letters "day"');
  // Reported off a real card. Now THURSDAY day 38, 13:44, at Rock Springs — full clock, nothing loaded.
  // The ATS window read "Friday 9:26PM - Sat 4:06AM", and the app booked it Thursday night into Friday
  // morning: one day early. A 770-mile run that had a day and a half to reach the window came back
  // INFEASIBLE, missing by 14:25.
  //
  // The day-number scan did IndexOf("day"), which lands at index 3 of "Friday", then read the digits
  // after it and got 9 from "9:26PM".
  await api('/status', 'POST', {
    locationCity: 'Rock Springs', locationState: 'WY', locationKind: 'Shipper',
    gameTime: gday(38, '13:44'), fuelPct: 95, atsOdometer: 41000, dutyStatus: 'OnDuty',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const dow = (d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d % 7];
  ok('day 38 is a Thursday, 39 a Friday, 40 a Saturday',
    dow(38) === 'Thu' && dow(39) === 'Fri' && dow(40) === 'Sat',
    `${dow(38)} ${dow(39)} ${dow(40)}`);

  await api('/board/clear', 'POST', {});
  const wk = await api('/board/add', 'POST', {
    cargo: 'Fertilizer', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Omaha', destState: 'NE',
    loadedMiles: 770, deadheadMiles: 0, gameRevenue: 2418,
    windowText: 'Friday 9:26PM - Sat 4:06AM', weightLbs: 40000,
  });
  const wkLoad = (wk.evaluations || [])[0].load;
  // Thursday 13:44 -> Friday 21:26 is 31.7 h; -> Saturday 04:06 is 38.4 h.
  ok('the window opens on the Friday, not tonight',
    Math.abs(wkLoad.appointmentOpensHours - 31.7) < 1.5, `opens in ${wkLoad.appointmentOpensHours}h`);
  ok('and closes on the Saturday',
    Math.abs(wkLoad.deadlineHours - 38.4) < 1.5, `due in ${wkLoad.deadlineHours}h`);
  ok('so the load is not refused for a window it can easily make',
    (wk.evaluations || [])[0].feasibility.verdict !== 'Infeasible',
    (wk.evaluations || [])[0].feasibility.verdict);

  head('Short weekday forms too');
  await api('/board/clear', 'POST', {});
  const abbr = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Omaha', destState: 'NE',
    loadedMiles: 770, deadheadMiles: 0, gameRevenue: 2400,
    windowText: 'Fri 21:26 - Sat 04:06', weightLbs: 40000,
  });
  ok('"Fri" reads the same as "Friday"',
    Math.abs((abbr.evaluations || [])[0].load.appointmentOpensHours - 31.7) < 1.5,
    `opens in ${(abbr.evaluations || [])[0].load.appointmentOpensHours}h`);

  head('An explicit day number still wins');
  await api('/board/clear', 'POST', {});
  const explicit = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Omaha', destState: 'NE',
    loadedMiles: 200, deadheadMiles: 0, gameRevenue: 800,
    windowText: 'Day 40 08:00 - 18:00', weightLbs: 30000,
  });
  ok('an explicit day number is two days out, not read off a weekday',
    Math.abs((explicit.evaluations || [])[0].load.appointmentOpensHours - 42.3) < 1.5,
    `opens in ${(explicit.evaluations || [])[0].load.appointmentOpensHours}h`);

  head('A bare clock range with no day in it');
  // Reported off a real card. 770 mi Rock Springs -> Omaha, full clock, sitting at the shipper, and the
  // app called it INFEASIBLE against a window closing twelve hours out. The listing's window was a bare
  // clock range, which resolves to the soonest future occurrence — tonight — and that mis-dated window
  // then overwrote the time-to-deliver the driver had typed off the listing.
  await api('/board/clear', 'POST', {});
  const long = await api('/board/add', 'POST', {
    cargo: 'Fertilizer', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Omaha', destState: 'NE',
    loadedMiles: 770, deadheadMiles: 0, gameRevenue: 2418,
    deadlineHours: 36,                       // straight off the listing's countdown
    windowText: '21:26 - 04:06',             // and the window, which carries no day
    weightLbs: 40000,
  });
  const row = (long.evaluations || [])[0].load;
  ok('the typed time-to-deliver is not thrown away', row.deadlineHours >= 30,
    `${row.deadlineHours}h against the 36h typed`);
  ok('and the window moved with it rather than staying on tonight',
    row.appointmentOpensHours > 24, `opens in ${row.appointmentOpensHours}h`);

  head('A window that agrees with the countdown is left alone');
  await api('/board/clear', 'POST', {});
  const nearWin = await api('/board/add', 'POST', {
    cargo: 'Palletised goods', trailerType: 'Dry Van',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 180, deadheadMiles: 0, gameRevenue: 700,
    deadlineHours: 11, windowText: '18:00 - 23:00', weightLbs: 20000,
  });
  const sameDay = (nearWin.evaluations || [])[0].load;
  ok('a same-day window is not rolled forward', sameDay.deadlineHours < 24,
    `${sameDay.deadlineHours}h`);

  head('THE TULSA CASE: waiting on duty must not spend the window the dock needs');
  // Reported off a real card. Thursday day 38, 13:44, Rock Springs with a full clock and home time
  // overdue in Springfield MO. 1,004 miles to Tulsa, window Sat 02:04 - 08:44, and INFEASIBLE: the plan
  // arrived 9:01 before the doors opened, sat that out ON DUTY, then found it needed 1:49 of window it
  // no longer had — so it took a ten anyway and landed 9:20 past the close.
  //
  // The truck is parked either way. Sitting the reset DURING the wait costs nothing and starts the
  // unload on a full window, which is what the app's own blocker text was already advising.
  await api('/status', 'POST', {
    locationCity: 'Rock Springs', locationState: 'WY', locationKind: 'Shipper',
    gameTime: gday(38, '13:44'), fuelPct: 100, atsOdometer: 52000, dutyStatus: 'OnDuty',
  });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  await api('/board/clear', 'POST', {});
  const tulsa = await api('/board/add', 'POST', {
    cargo: 'Pumpjack', trailerType: 'Flatbed',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Tulsa', destState: 'OK',
    loadedMiles: 1004, deadheadMiles: 0, gameRevenue: 2199,
    windowText: 'Sat 2:04 AM - Sat 8:44 AM', weightLbs: 6600,
  });
  const tEval = (tulsa.evaluations || [])[0];
  ok('the window is the Saturday off the listing',
    Math.abs(tEval.load.deadlineHours - 43.0) < 1.5, `due in ${tEval.load.deadlineHours}h`);
  ok('it is no longer refused', tEval.feasibility.verdict !== 'Infeasible',
    tEval.feasibility.verdict);
  ok('and nothing says it arrives past the window closing',
    !(tEval.feasibility.blockers || []).some((x) => /past the .* window closing/i.test(x)),
    (tEval.feasibility.blockers || []).join(' | ') || 'no blockers');

  const timeline = (tEval.feasibility.timeline || []).map((x) => x.label || x).join(' | ');
  ok('the pre-dock wait is rested, not idled on duty',
    /taken as the reset|Rest timed to the opening/i.test(timeline), timeline.slice(-130) || '(none)');
  // This used to assert a ten-hour rest never appeared here, which is exactly how the phantom reset
  // hid: the plan credited a full 11 and 14 for a six-hour sit and the timeline looked reasonable.
  // A reset costs a reset. What must NOT happen is sitting it AT the receiver, and the next section
  // guards the case where the window survives the wait and no reset is taken at all.
  ok('a rest that restores the clocks actually spends a full reset',
    /Rest timed to the opening/.test(timeline)
      ? /Rest timed to the opening — (1[0-9]|[2-9][0-9]):/.test(timeline)
      : true,
    timeline.match(/Rest timed to the opening — [0-9:]+/)?.[0] || 'no such rest in this plan');
  ok('the driver is told why',
    (tEval.feasibility.warnings || []).some((x) => /Sleep in at your last stop|reset there|unload fresh/i.test(x)),
    (tEval.feasibility.warnings || []).find((x) => /Sleep in|reset/i.test(x))?.slice(0, 120) || '(none)');

  head('A short wait with plenty of window left is still spent on duty');
  // The fix must not turn every early arrival into a ten-hour sit. Where the window survives the wait,
  // waiting at the gate is right — it is quicker and the driver keeps their day.
  await api('/board/clear', 'POST', {});
  const quick = await api('/board/add', 'POST', {
    cargo: 'Palletised goods', trailerType: 'Dry Van',
    originCity: 'Rock Springs', originState: 'WY', destCity: 'Salt Lake City', destState: 'UT',
    loadedMiles: 180, deadheadMiles: 0, gameRevenue: 700,
    appointmentOpensHours: 6, deadlineHours: 14, weightLbs: 20000,
  });
  const qEval = (quick.evaluations || [])[0];
  const qTimeline = (qEval.feasibility.timeline || []).map((x) => x.label || x).join(' | ');
  // Whether a receiver takes a load early is seeded on the load id, and /board/add mints a fresh GUID
  // every time — so this is genuinely a different answer per run rather than a stable property of the
  // load. When they take it early there is no wait to spend at all, which is a pass of a different kind.
  if (qEval.receiverTakesEarly) {
    ok('this receiver takes it early, so there is no wait to spend', !/Waiting for the receiver/i.test(qTimeline),
      'taken on arrival');
  } else {
    // Nineteen miles, so there is no rest anywhere in this plan to hang the wait on and a fresh ten
    // will not fit inside six hours of slack. Sitting really is the only option here — which is a
    // different thing from sitting being the right answer generally (see the section below).
    ok('a short wait with nothing to sleep off first stays on duty at the gate',
      /Waiting for the receiver to open/i.test(qTimeline) && !/taken as the reset|Rest timed|held /i.test(qTimeline),
      qTimeline.slice(-110));
  }

  head('#185 Burlington IA to Texarkana TX on a full clock — the reported run');
  // Reported from play on this exact lane and this exact clock: told they would reach the receiver
  // seven hours early. The load was legal; the plan was just worse than the driver's own answer —
  // "take my 10 and extend my 10 so I get there at or a little before my appointment, otherwise I'm
  // burning my shift clock for no reason."
  //
  // Long enough to need a rest on the way, so there IS one to extend. The same hours are parked either
  // way; the only question is whether they come off the fourteen.
  // Named, because whether a receiver takes a load whenever you turn up is decided per facility and a
  // load with no receiver on it is taken early — and then there is no appointment to be early FOR.
  // Kroger holds you to the window; section 15 above relies on the same fact.
  await api('/board/clear', 'POST', {});
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  const far = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, receiver: 'Kroger',
    originCity: 'Burlington', originState: 'IA', destCity: 'Texarkana', destState: 'TX',
    loadedMiles: 730, deadheadMiles: 0,
    // Picked up Wednesday 18:00, due Friday 04:30 — 34.5 hours.
    gameRevenue: 2900, appointmentOpensHours: 34.5, deadlineHours: 34.5, weightLbs: 40000,
  });
  const fEval = (far.evaluations || [])[0];
  ok('the receiver holds you to the appointment', fEval && !fEval.receiverTakesEarly,
    fEval?.receiverTakesEarly ? 'took it early — nothing to test' : 'held to the window');
  const ff = fEval.feasibility;
  const fLine = (ff.timeline || []).map((x) => x.label || x).join(' | ');
  console.log('     plan:');
  for (const x of (ff.timeline || [])) {
    console.log(`       ${String(x.kind).padEnd(8)} ${hhmm(x.hours).padStart(6)}  ` +
                `drive ${hhmm(x.driveRemainingAfter).padStart(6)}  shift ${hhmm(x.shiftRemainingAfter).padStart(6)}  ${x.label}`);
  }

  ok('the run is long enough to need a rest', ff.restsRequired > 0, `${ff.restsRequired} rest(s)`);
  ok('the wait is held onto that rest rather than sat at the gate', ff.sleptInHours > 0,
    `${hhmm(ff.sleptInHours)} added to the rest`);
  ok('and nothing is spent waiting at the receiver', !ff.waitForAppointmentHours,
    `${ff.waitForAppointmentHours} waiting`);
  ok('the timeline says the rest ran longer', /held .* longer rather than arriving early/i.test(fLine),
    (ff.timeline || []).map((x) => x.label).find((l) => /held /i.test(l)) || fLine.slice(0, 140));
  ok('and it is not a second reset bolted on', ff.restsRequired === 1, `${ff.restsRequired}`);
  ok('the driver rolls up with the window intact rather than spent',
    ff.shiftRemainingOnArrival > 4, `${hhmm(ff.shiftRemainingOnArrival)} of 14 left on arrival`);
  ok('and it is said before they commit, not left in the timeline',
    (ff.warnings || []).some((w) => /held your rest/i.test(w)),
    (ff.warnings || []).find((w) => /held your rest/i.test(w))?.slice(0, 130) || '(silent)');

  head('#186 And those parked hours count against the load when it is picked');
  // "This is not the best job for a dispatcher to choose really. The truck will be sitting an extra 9
  // hours to hit the appointment, which is less equipment utilisation." Slack is scored as a GOOD
  // thing — so before this, a load that held the truck nine hours scored better for it.
  ok('the parked hours are recorded as idle', ff.idleHours > 0, `${hhmm(ff.idleHours)} idle`);
  ok('and they are the hours held onto the rest, not the mandatory reset',
    Math.abs(ff.idleHours - ff.sleptInHours) < 0.02,
    `${hhmm(ff.idleHours)} idle vs ${hhmm(ff.sleptInHours)} held`);
  ok('the score is marked down for them',
    (fEval.scoreDetail || []).some((d) => /tied up waiting on the appointment: -/.test(d)),
    (fEval.scoreDetail || []).find((d) => /tied up waiting/.test(d)) || '(not scored)');
  ok('and the driver is told why it is worse than the rate looks',
    (fEval.cons || []).some((c) => /earning nothing/i.test(c)),
    (fEval.cons || []).find((c) => /earning nothing/i.test(c))?.slice(0, 130) || '(silent)');


  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; });
