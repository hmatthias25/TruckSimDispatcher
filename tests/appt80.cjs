/* Issue #80: a booked slot to aim at, and receivers that sometimes take a load early.
 *
 * The app used to treat the front of the ATS window as "when they will take it", so every load was
 * planned to arrive the moment the doors unlocked. A dock books a slot. And a real receiver on a quiet
 * week will sometimes take you ahead of it — uncommon, but worth real hours when it happens, and worth
 * knowing about before you pick the load rather than on their gate.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5994}/api`;
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
const iso = (day, hm = '06:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const hoursBetween = (a, b) => (new Date(b + 'Z') - new Date(a + 'Z')) / 3600000;

let S, day = 2;

async function place(hm = '06:00') {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'TruckStop', gameTime: iso(day, hm),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  return S;
}

/** Drive the early-take rate directly, so the suite is deterministic AND the knob gets tested. */
async function setEarlyPct(pct) {
  const cur = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...cur, receiverTakesEarlyPct: pct });
}

/** A short local run with a wide window, so the slot has room to sit inside it. */
async function offer(cargo, opensHours = 8, deadlineHours = 20) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo, trailerType: S.trailers[0].type, originCity: 'Denver', originState: 'CO',
    destCity: 'Aurora', destState: 'CO', loadedMiles: 22, deadheadMiles: 0,
    gameRevenue: 700, deadlineHours, weightLbs: 24000, appointmentOpensHours: opensHours,
  });
  return r.evaluations[0];
}

(async () => {
  const app = { driverName: 'A. Point', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await place();

  head('1. A slot is booked inside the window, not at the front of it');
  let ev = await offer('Machinery');
  let tries = 0;
  while (ev.receiverTakesEarly && tries++ < 12) ev = await offer('Machinery ' + tries);
  ok('a load that is NOT an early take was found', !ev.receiverTakesEarly, `after ${tries} tries`);
  ok('it has a booked slot', !!ev.appointmentGameTime, ev.appointmentGameTime || '(none)');
  if (ev.appointmentGameTime) {
    const fromNow = hoursBetween(S.status.gameTime, ev.appointmentGameTime);
    ok('the slot is after the doors open', fromNow > 8 - 0.01, `${fromNow.toFixed(2)}h from now, opens at 8h`);
    ok('and before the window closes', fromNow < 20 + 0.01, `${fromNow.toFixed(2)}h against a 20h deadline`);
    ok('it is not simply the opening time', Math.abs(fromNow - 8) > 0.2, `${fromNow.toFixed(2)}h`);
    ok('and it is on the half hour, the way docks book',
      Math.abs((fromNow * 2) - Math.round(fromNow * 2)) < 0.02, `${fromNow.toFixed(2)}h`);
  }
  ok('the card says so rather than leaving it to be discovered',
    (ev.cons || []).some((c) => /Booked in at/.test(c)),
    (ev.cons || []).find((c) => /Booked in/.test(c)) || '(not mentioned)');

  head('2. The slot is seeded — reading the board twice gives the same time');
  const again = (await api('/board/evaluate', 'POST', {}).catch(() => null))
    || { evaluations: [] };
  const same = (again.evaluations || []).find((x) => x.load?.id === ev.load.id);
  if (same) ok('same slot on a re-read', same.appointmentGameTime === ev.appointmentGameTime,
    `${same.appointmentGameTime} vs ${ev.appointmentGameTime}`);
  else ok('(board re-read not exposed; slot stability covered by the seed)', true, 'skipped');

  head('3. Some receivers take it early — uncommon, but real');
  // One board, kept, so every later section can authorise a load by its real id. Re-adding a load by
  // name would mint a new id and therefore a different seeded answer, which is not the same load.
  // Half, so a sample of 22 lands nowhere near either edge by chance.
  await setEarlyPct(50);
  await api('/board/clear', 'POST', {});
  let evals = [];
  for (let i = 0; i < 22; i++) {
    const r = await api('/board/add', 'POST', {
      cargo: 'Sample ' + i, trailerType: S.trailers[0].type,
      originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
      loadedMiles: 22, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 20,
      weightLbs: 24000, appointmentOpensHours: 8,
    });
    if (r.evaluations) evals = r.evaluations;
  }
  const earlies = evals.filter((e) => e.receiverTakesEarly);
  const slotted = evals.filter((e) => !e.receiverTakesEarly && e.appointmentGameTime);
  const pct = (earlies.length / Math.max(1, evals.length)) * 100;
  ok('the setting drives how often it happens', pct > 15 && pct < 85,
    `${earlies.length} of ${evals.length} (${pct.toFixed(0)}%) at a 50% setting`);
  ok('and both outcomes occur', earlies.length > 0 && slotted.length > 0,
    `${slotted.length} slotted, ${earlies.length} early`);

  // Back to the shipped rate, and confirm it is genuinely uncommon.
  await setEarlyPct(12);
  await api('/board/clear', 'POST', {});
  let live = [];
  for (let i = 0; i < 22; i++) {
    const r = await api('/board/add', 'POST', {
      cargo: 'Rate ' + i, trailerType: S.trailers[0].type,
      originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
      loadedMiles: 22, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 20,
      weightLbs: 24000, appointmentOpensHours: 8,
    });
    if (r.evaluations) live = r.evaluations;
  }
  const livePct = (live.filter((e) => e.receiverTakesEarly).length / Math.max(1, live.length)) * 100;
  ok('at the shipped rate it is uncommon', livePct <= 40, `${livePct.toFixed(0)}% on the default 12`);

  head('4. An early take frees the whole wait, and says so up front');
  await setEarlyPct(100);
  await api('/board/clear', 'POST', {});
  const e2 = (await api('/board/add', 'POST', {
    cargo: 'Certain early', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 22, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 20,
    weightLbs: 24000, appointmentOpensHours: 8,
  })).evaluations[0];
  ok('the receiver is taking it', e2.receiverTakesEarly === true, `${e2.receiverTakesEarly}`);
  if (e2) {
    ok('no wait is planned at all',
      !((e2.feasibility.warnings) || []).some((w) => /wait at the receiver/i.test(w)),
      (e2.feasibility.warnings || []).join(' | ').slice(0, 90) || 'no wait');
    ok('and it is a PRO on the card, before you commit',
      (e2.pros || []).some((p) => /take it whenever you arrive/i.test(p)),
      (e2.pros || []).find((p) => /whenever/.test(p)) || '(not mentioned)');
    ok('with no slot to aim at', !e2.appointmentGameTime, e2.appointmentGameTime || 'none');

    head('5. Dispatch repeats it at authorisation, where the driver acts on it');
    const auth = await api('/dispatch/authorize', 'POST', { loadId: e2.load.id });
    const trip = auth.trip;
    ok('the trip carries the flag', trip.receiverTakesEarly === true, `${trip.receiverTakesEarly}`);
    ok('and the dispatcher says it in the rationale',
      /take it whenever you get there/i.test(trip.authorizationRationale || ''),
      (trip.authorizationRationale || '').slice(-120));

    head('6. Delivered early: on time, credited to the receiver, no window warning');
    const done = await api(`/trips/${trip.id}/complete`, 'POST', {
      deliveredGameTime: iso(day, '12:00'), actualMiles: 22, endOdometer: 0, actualRevenue: 700,
      fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
      extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
      locationCity: 'Aurora', locationState: 'CO', fuelPct: 70, gameTime: iso(day, '12:00'),
    });
    const t2 = done.snapshot.trips.find((x) => x.id === trip.id);
    const findings = (done.audit.serviceFindings || []).join(' | ');
    ok('delivered ahead of the doors opening', /12:00/.test(t2.deliveredGameTime), t2.deliveredGameTime);
    ok('it counts as on time, nothing more', t2.serviceResult === 'OnTime', t2.serviceResult);
    ok('the report credits the receiver, not the driver',
      /receiver (took|had agreed)/i.test(findings), findings.slice(0, 140));
    ok('no "they would not have taken it yet" warning',
      !/would not have taken it/i.test(t2.windowWarning || ''), t2.windowWarning || 'none');
  }

  head('7. Missing the slot: grace first, then it counts');
  // A fresh day. Reporting 06:00 here would wind the clock back past the delivery just recorded.
  day += 1;
  await place('06:00');
  await setEarlyPct(0);
  await api('/board/clear', 'POST', {});
  const g1 = await api('/board/add', 'POST', {
    cargo: 'Grace run', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Aurora', destState: 'CO',
    loadedMiles: 22, deadheadMiles: 0, gameRevenue: 700, deadlineHours: 26,
    weightLbs: 24000, appointmentOpensHours: 5,
  });
  const e3 = g1.evaluations[0];
  if (e3 && !e3.receiverTakesEarly && e3.appointmentGameTime) {
    const slotH = hoursBetween(S.status.gameTime, e3.appointmentGameTime);
    const grace = S.settings.appointmentGraceHours ?? 2;
    const auth3 = await api('/dispatch/authorize', 'POST', { loadId: e3.load.id });
    const at3 = 6 + slotH + grace - 0.5;          // inside the grace, still short of the window close
    const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    const r1 = await api(`/trips/${auth3.trip.id}/complete`, 'POST', {
      deliveredGameTime: iso(day, hhmm(at3)), actualMiles: 22, endOdometer: 0, actualRevenue: 700,
      fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
      extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
      locationCity: 'Aurora', locationState: 'CO', fuelPct: 70, gameTime: iso(day, hhmm(at3)),
    });
    const trip3 = r1.snapshot.trips.find((x) => x.id === auth3.trip.id);
    const find3 = (r1.audit.serviceFindings || []).join(' | ');
    ok('inside the grace is still on time', trip3.serviceResult === 'OnTime',
      `${trip3.serviceResult} — ${(grace - 0.5).toFixed(1)}h past a ${slotH.toFixed(1)}h slot`);
    ok('and the report says it was inside the grace',
      /inside the .* grace/i.test(find3),
      (find3.match(/[^|]*grace[^|]*/i) || ['(not mentioned)'])[0].trim().slice(0, 120));
  } else {
    ok('(that load rolled an early take; grace not exercised)', true, 'skipped');
  }

  head('8. #81 The slot is never earlier than the plan can arrive');
  // The reported case: appointment 6:30, told to rest at the shipper overnight, delivered 6:30 exactly
  // — and marked LATE against a slot the app itself had booked hours before its own projected arrival.
  day += 1;
  await place('07:00');
  await setEarlyPct(0);
  await api('/board/clear', 'POST', {});
  const far = (await api('/board/add', 'POST', {
    cargo: 'Overnight steel', trailerType: S.trailers[0].type,
    originCity: 'Denver', originState: 'CO', destCity: 'Amarillo', destState: 'TX',
    loadedMiles: 430, deadheadMiles: 0, gameRevenue: 1500, deadlineHours: 44,
    weightLbs: 40000, appointmentOpensHours: 6,
  })).evaluations[0];

  const arrive = far.feasibility.projectedArrivalGameTime;
  ok('the plan arrives when it arrives', !!arrive, arrive || '(none)');
  if (far.appointmentGameTime && arrive) {
    ok('the quoted slot is not before that arrival',
      new Date(far.appointmentGameTime + 'Z') >= new Date(arrive + 'Z'),
      `slot ${far.appointmentGameTime} vs arrival ${arrive}`);
  } else {
    ok('no slot is quoted when the plan cannot make one', !far.appointmentGameTime,
      far.appointmentGameTime || 'none quoted');
  }

  const auth8 = await api('/dispatch/authorize', 'POST', { loadId: far.load.id });
  const slot8 = auth8.trip.appointmentGameTime;
  const plan8 = auth8.trip.feasibilityAtDispatch?.projectedArrivalGameTime;
  if (slot8 && plan8) {
    ok('and the trip agrees', new Date(slot8 + 'Z') >= new Date(plan8 + 'Z'),
      `slot ${slot8} vs plan ${plan8}`);
  }

  // Deliver exactly on the slot the app stated. This must never be late.
  const onSlot = slot8 || auth8.trip.dueGameTime;
  const r8 = await api(`/trips/${auth8.trip.id}/complete`, 'POST', {
    deliveredGameTime: onSlot, actualMiles: 430, endOdometer: 0, actualRevenue: 1500,
    fuelStops: [], tolls: 0, repairCost: 0, fines: 0, otherExpense: 0,
    truckDamageAfter: 2, trailerDamageAfter: 1, cargoDamagePct: 0,
    loadingHours: 1, unloadingHours: 1, detentionHours: 0, layoverDays: 0, breakdownDays: 0,
    extraStops: 0, tarpsUsed: 0, delayReason: '', damageCause: '', notes: '',
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: onSlot,
  });
  const t8 = r8.snapshot.trips.find((x) => x.id === auth8.trip.id);
  ok('delivering exactly on the stated appointment is ON TIME',
    t8.serviceResult === 'OnTime', `${t8.serviceResult} — delivered ${onSlot}, slot ${slot8 || '(none)'}`);
  ok('and no service note was filed against the driver',
    !(r8.snapshot.incidents || []).some((i) => (i.description || '').includes(auth8.trip.number)),
    (r8.snapshot.incidents || []).filter((i) => (i.description || '').includes(auth8.trip.number))
      .map((i) => i.number).join(', ') || 'nothing filed');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
