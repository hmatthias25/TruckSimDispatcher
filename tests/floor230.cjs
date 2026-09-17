/* #230 — the rate floor is derived, and two call sites read the manual override instead.
 *
 * CostModel.Thresholds works the floor out from live break-even — fuel, mpg, driver CPM, overhead,
 * the maintenance sweep — and only falls back to Scoring.FloorAllInRpm when UseManualThresholds is
 * on, which is off by default. The board does this properly and stores the answer on the evaluation
 * as floorRpmUsed.
 *
 * Two places read the raw setting anyway: the "this dock is not worth the truck" hold, and the
 * close-out audit line that tells a driver the load was under our floor. Both judged against $1.35
 * while the cost model said $1.62, so the board could commit a load against one floor and the audit
 * grade it against another. The driver hears two different numbers about one decision.
 *
 * Found while repricing fuel (#229), which is what pushed break-even clear of the stale figure and
 * made the gap visible. It is not a one-off: the floor is meant to move with what the truck costs to
 * run, so it drifts every time fuel, pay, overhead or mpg does.
 *
 * What this suite holds:
 *   1. the derived floor is genuinely above the old manual one, or the rest proves nothing
 *   2. the audit quotes the floor the board committed against, not $1.35
 *   3. raising the cost of fuel moves BOTH, together
 *   4. a player who asks for a manual floor still gets exactly that
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5921}/api`;
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
const iso = (day, hm = '06:00') => `2000-01-${String(day).padStart(2, '0')}T${hm}`;

/** The legacy fixed benchmark. Only ever correct when somebody has asked for it. */
const MANUAL_FLOOR = 1.35;

let S, day = 10, odo = 5000;

async function park(hm = '06:00') {
  S = un(await api('/status', 'POST', {
    locationCity: 'Oklahoma City', locationState: 'OK', locationKind: 'Shipper', gameTime: iso(day, hm),
    fuelPct: 95, atsOdometer: odo, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 120000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 65 });
  return S;
}

/** One load on the board, evaluated. */
async function offer(miles, revenue, atLocation = true) {
  await api('/board/clear', 'POST', {});
  const r = await api('/board/add', 'POST', {
    cargo: 'Machinery', trailerType: S.trailers[0].type, atLocation,
    originCity: 'Oklahoma City', originState: 'OK', destCity: 'Amarillo', destState: 'TX',
    loadedMiles: miles, deadheadMiles: 0, gameRevenue: revenue, deadlineHours: 40, weightLbs: 30000,
  });
  return r;
}

async function setFuel(price) {
  const cur = (await api('/bootstrap')).settings;
  S = un(await api('/settings', 'POST', { ...cur, fuelPricePerGal: price }));
}

(async () => {
  const app = { driverName: 'N. Bergstrom', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Oklahoma City', homeState: 'OK', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  await park();

  head('1. The derived floor is well clear of the stale manual one');
  const th = await api('/economics?miles=400');
  console.log(`  ..    derived floor $${th.floor} · target $${th.target} · manual mode ${th.manual}`);
  ok('manual thresholds are off, as shipped', th.manual === false, String(th.manual));
  ok('and the derived floor is above the old $1.35',
    th.floor > MANUAL_FLOOR + 0.1, `$${th.floor} vs $${MANUAL_FLOOR}`);
  const derived = th.floor;

  head('2. The board judges against the derived floor and says which it used');
  const thin = await offer(400, Math.round(400 * (derived - 0.25)));   // clearly under it
  const ev = thin.evaluations[0];
  console.log(`  ..    all-in $${ev.allInRpm}/mi against floorRpmUsed $${ev.floorRpmUsed}`);
  ok('the evaluation records the floor it used',
    Math.abs(ev.floorRpmUsed - derived) < 0.02, `$${ev.floorRpmUsed} vs $${derived}`);
  ok('and it is not the manual number',
    Math.abs(ev.floorRpmUsed - MANUAL_FLOOR) > 0.1, `$${ev.floorRpmUsed}`);

  head('3. The close-out audit quotes that same floor, not $1.35');
  // A thin load, run and closed, so the audit line is generated for real.
  const fat = await offer(400, Math.round(400 * (derived + 1.20)));    // clears it, so it authorizes
  const pick = fat.evaluations[0];
  const auth = await api('/dispatch/authorize', 'POST', { loadId: pick.load.id, overrideTight: true });
  const trip = auth.trip;
  ok('a load is on the truck to close out', !!trip, trip?.number);

  // Close it out at a revenue that lands under the floor, which is what makes the audit speak.
  odo += 400;
  const under = Math.round(400 * (derived - 0.30));
  const done = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: iso(day + 1, '12:00'), endOdometer: odo, actualMiles: 400,
    actualRevenue: under, truckDamageAfter: 2, trailerDamageAfter: 1,
    locationCity: 'Amarillo', locationState: 'TX', fuelPct: 60, gameTime: iso(day + 1, '12:00'),
  });
  const money = (done.audit?.moneyFindings || []).join(' | ');
  const said = (done.audit?.moneyFindings || []).find((x) => /under our \$/.test(x)) || '';
  console.log(`  ..    ${said || '(no floor line)'}`);
  ok('the audit says the load was under the floor', !!said, money.slice(0, 140));
  const quoted = parseFloat((said.match(/under our \$([\d.]+)/) || [])[1] || '0');
  ok('and the figure it quotes is the derived one',
    Math.abs(quoted - derived) < 0.02, `$${quoted} vs $${derived}`);
  ok('not the $1.35 manual override it used to read',
    Math.abs(quoted - MANUAL_FLOOR) > 0.1, `$${quoted}`);

  head('4. Dearer fuel moves the board and the audit together');
  await setFuel(9.50);
  await park('07:00');
  const dearer = (await api('/economics?miles=400')).floor;
  console.log(`  ..    fuel $9.50 -> floor $${dearer} (was $${derived})`);
  ok('the floor rises with the cost of running the truck', dearer > derived + 0.2,
    `$${dearer} vs $${derived}`);

  const ev2 = (await offer(400, Math.round(400 * (dearer - 0.25)))).evaluations[0];
  ok('the board moves with it', Math.abs(ev2.floorRpmUsed - dearer) < 0.02,
    `$${ev2.floorRpmUsed} vs $${dearer}`);

  head('5. A player who asks for a manual floor gets exactly that');
  await setFuel(6.32);
  const cur = (await api('/bootstrap')).settings;
  S = un(await api('/settings', 'POST', {
    ...cur, scoring: { ...cur.scoring, useManualThresholds: true, floorAllInRpm: 1.35, targetAllInRpm: 2.10 },
  }));
  const manual = await api('/economics?miles=400');
  console.log(`  ..    manual mode ${manual.manual} · floor $${manual.floor}`);
  ok('manual mode is honoured', manual.manual === true, String(manual.manual));
  ok('and the floor is the number they typed',
    Math.abs(manual.floor - MANUAL_FLOOR) < 0.001, `$${manual.floor}`);
  const evM = (await offer(400, Math.round(400 * 1.20))).evaluations[0];
  ok('the board uses their floor, not the cost model',
    Math.abs(evM.floorRpmUsed - MANUAL_FLOOR) < 0.02, `$${evM.floorRpmUsed}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
