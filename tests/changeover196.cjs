/* #196 — the trailer changeover, moved to the drop that ends the tour.
 *
 * Reported from play, in one go: arrived at the yard, was told the trailer was NOT changing, was asked
 * to record where the company's trailers were anyway, and was then shown a notice saying a change WAS
 * coming — costed against a trailer "three days out" whose position had been typed in seconds earlier.
 * None of it was actionable. The change described was the home time after that one, a fortnight away,
 * and by then the position would mean nothing.
 *
 * The shape it should have: at the last drop before running home empty, ask about the HOME YARD's boxes
 * from wherever the driver is standing, pick one there, quote the wait against the home time being
 * driven to — and where the pick is a parked trailer nobody is using, tell them to mark it as their own
 * in the ATS trailer manager so no AI driver takes it in the fortnight before they are back.
 *
 * Drop and hook is the special case throughout: DH-1 is a slot, not a box on a yard. Nothing to locate,
 * nothing to wait for, nothing to reserve — and it must never win the idle preference, because it is
 * idle by definition and would then win every single time.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5896}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (d, hm = '09:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + d * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 90000;
const views = async () => (await api('/bootstrap')).views;

async function report(city, st, day, kind = 'TruckStop', moved = 0) {
  odo += moved;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: at(day),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  S = un(r);
  return r;
}

/* Close a short empty move out AWAY from home — the tour-ending drop the whole feature hangs on. */
async function dropAwayFrom(city, st, day) {
  const mv = await api('/moves', 'POST', {
    kind: 'EmptyMove', destCity: city, destState: st, miles: 40, reason: 'Repositioning',
  });
  const trip = (un(mv).trips || []).find((x) => x.status !== 'Delivered');
  odo += 40;
  const closed = await api(`/trips/${trip.id}/complete`, 'POST', {
    deliveredGameTime: at(day), actualMiles: 40, endOdometer: odo,
    locationKind: 'TruckStop', gameTime: at(day), fuelPct: 70,
    truckDamageAfter: 3, trailerDamageAfter: 2,
  });
  S = un(closed);
  return closed;
}

(async () => {
  const app = { driverName: 'R. Vance', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1), code: 'PRI' }));
  await H.clearDiscipline(api);
  S = un(await api('/career/clear-probation', 'POST', { force: true }));

  const yard = S.company.terminals[0];
  S = un(await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' }));

  head('1. A yard with something of every kind on it, and one box three states away');
  // Two of each type the carrier could re-rig onto, so whatever the seed picks has a choice to make —
  // and so "idle beats near" has two candidates to choose between rather than one to fall back on.
  const kinds = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck'];
  let n = 0;
  for (const type of kinds) {
    for (const suffix of ['A', 'B']) {
      await api('/fleet/trailer', 'POST', {
        unit: `Y${++n}${suffix}`, type, division: type, year: 2021, make: 'Wabash', length: "53'",
        inGameGarage: true, status: 'InService', homeTerminalId: yard.id,
      });
    }
  }
  const far = un(await api('/terminals', 'POST', { city: 'Denver', state: 'CO', level: 'Small' }));
  const denver = (far.company.terminals || []).find((t) => t.city === 'Denver');
  for (const type of kinds) {
    await api('/fleet/trailer', 'POST', {
      unit: `FAR-${type.replace(/\W/g, '')}`, type, division: type, year: 2021, make: 'Wabash',
      length: "53'", inGameGarage: true, status: 'InService', homeTerminalId: denver.id,
    });
  }
  S = un(await api('/bootstrap'));
  ok('the home yard is stocked', S.trailers.length > kinds.length, `${S.trailers.length} trailers`);

  head('2. Walk tours until operations wants the driver on something else');
  // Each pass: run out, let home time come due, close a trip out on the road, then bring it in.
  let askedAt = null, noteAt = null, day = 6;
  for (let tour = 1; tour <= 9 && !askedAt; tour++) {
    day += 13;
    await report('Amarillo', 'TX', day, 'TruckStop', 500);
    const closed = await dropAwayFrom('Amarillo', 'TX', day);
    const rows = closed.audit?.askWhereabouts || [];
    const note = closed.audit?.changeoverNote || '';
    console.log(`  ..    tour ${tour}: on ${S.driver.assignedTrailerUnit}, ${rows.length} row(s)`
      + `${note ? ` — ${note.slice(0, 64)}...` : ''}`);

    // The invariant that holds on EVERY pass, change or no change: DH-1 is not a box on a yard and is
    // never something to go and look for.
    ok(`tour ${tour}: DH-1 is never asked about`, !rows.some((x) => /DH-/i.test(x.unit || '')),
      rows.map((x) => x.unit).join(', ') || '(no rows)');
    ok(`tour ${tour}: only home-yard boxes are asked about`,
      !rows.some((x) => /^FAR-/i.test(x.unit || '')), rows.map((x) => x.unit).join(', ') || '(no rows)');

    if (note && /drop and hook/i.test(note)) {
      ok('a drop-and-hook posting asks about no trailers at all', rows.length === 0,
        `${rows.length} row(s)`);
      ok('and it says there is nothing to go and find',
        /nothing to wait on|no box to go and find/i.test(note), note.slice(0, 120));
    }

    if (rows.length) { askedAt = { closed, rows, day }; noteAt = note; }
    else {
      day += 2;
      await report(yard.city, yard.state, day, 'Terminal', 400);
      // Do what a player does: hook whatever was issued. An order left open blocks the next change,
      // and a walk that never closes one is not a walk through tours, it is a walk through one tour.
      const o = S.views?.equipmentOrder;
      if (o && o.kind === 'TrailerSwap') S = un(await api(`/equipment/orders/${o.number}/complete`, 'POST', {}));
    }
  }

  if (!askedAt) {
    ok('a trailer change came up inside nine tours', false, '(none rolled — seed drifted)');
  } else {
    head('3. The questions arrive at the drop, not at the yard');
    ok('the close-out asks where the home-yard boxes are', askedAt.rows.length > 0,
      askedAt.rows.map((x) => x.unit).join(', '));
    ok('and it says a change is coming', /wants you on/i.test(noteAt), noteAt.slice(0, 140));
    ok('the driver is not at the yard when asked', S.driver.atHomeYard !== true,
      `atHomeYard=${S.driver.atHomeYard}`);

    // Every row offered has to be a box that could actually take the change. Not type EQUALITY — a step
    // deck covers flatbed freight, and TypeCovers knows that — but every row has to be one of ours,
    // standing at the home yard, and not the one already hooked to this driver.
    const yardUnits = (S.trailers || [])
      .filter((t) => t.homeTerminalId === yard.id).map((t) => t.unit);
    ok('every row is a box on the home yard',
      askedAt.rows.every((x) => yardUnits.includes(x.unit)),
      askedAt.rows.map((x) => `${x.unit}:${x.trailerType}`).join(', '));
    ok('and never the one already hooked to them',
      !askedAt.rows.some((x) => x.unit === S.driver.assignedTrailerUnit),
      `on ${S.driver.assignedTrailerUnit}`);

    head('4. Idle beats near, and an idle box gets reserved');
    // One out under somebody, one sitting still. The parked one should win even though the app has a
    // perfectly good position for the other.
    const [first, second] = [askedAt.rows[0], askedAt.rows[1] || askedAt.rows[0]];
    if (second && second.unit !== first.unit) {
      await api('/fleetops/whereabouts', 'POST', {
        trailerUnit: first.unit, direction: 'Outbound', city: 'Denver', state: 'CO',
      });
    }
    const answered = await api('/fleetops/whereabouts', 'POST', {
      trailerUnit: second.unit, direction: 'Parked', city: yard.city, state: yard.state,
    });
    S = un(answered);

    ok('answering says back what it bought them', !!answered.changeover,
      (answered.changeover || '(silent)').slice(0, 140));
    ok('the parked box is the one picked',
      (answered.changeover || '').includes(second.trailer || second.unit),
      (answered.changeover || '').slice(0, 160));
    ok('and they are told to mark it as their own to hold it',
      /own trailer in the ATS trailer manager|mark .* as your own/i.test(answered.changeover || ''),
      (answered.changeover || '').slice(0, 200));
    ok('it costs them nothing', /costs you nothing|straight hook/i.test(answered.changeover || ''),
      (answered.changeover || '').slice(0, 160));
    ok('the promise is on file against the driver',
      (S.driver.changeoverUnit || '').toLowerCase() === second.unit.toLowerCase(),
      `${S.driver.changeoverUnit} vs ${second.unit}`);

    head('5. The box promised at the drop is the box handed over at the yard');
    day += 2;
    const home = await report(yard.city, yard.state, day, 'Terminal', 400);
    S = un(home);
    const order = S.views?.equipmentOrder;
    ok('arriving home raised the swap', !!order && order.kind === 'TrailerSwap',
      order ? `${order.kind} -> ${order.toTrailerUnit}` : '(no order)');
    if (order && order.kind === 'TrailerSwap') {
      ok('and it is the box they were sent to reserve',
        (order.toTrailerUnit || '').toLowerCase() === second.unit.toLowerCase(),
        `${order.toTrailerUnit} vs ${second.unit}`);
      ok('the instruction remembers they already claimed it',
        /had you mark as your own/i.test(order.instruction || ''),
        (order.instruction || '').slice(0, 180));

      head('6. Confirming the swap releases the old box to the pool');
      const before = S.driver.assignedTrailerUnit;
      S = un(await api(`/equipment/orders/${order.number}/complete`, 'POST', {}));
      ok('the driver is on the new box',
        (S.driver.assignedTrailerUnit || '').toLowerCase() === second.unit.toLowerCase(),
        `${before} -> ${S.driver.assignedTrailerUnit}`);
      const old = (S.trailers || []).find((t) => t.unit === before);
      ok('the old one is unhooked', !old || !old.assignedTruckUnit,
        old ? `${old.unit} -> "${old.assignedTruckUnit}"` : '(gone)');
      // ...and reads as parked here, so a hired driver can take it — unless what they came OFF was the
      // drop-and-hook slot, which is not a box standing anywhere and has no position to record. Coming
      // off drop and hook releases nothing, because nothing was ever held.
      const wasSlot = old && /drop *&? *(and )?hook/i.test(old.type || '');
      ok(wasSlot ? 'coming off drop and hook releases no box, and records no position'
                 : 'and reads as parked here, for any hired driver to take',
        !old || (wasSlot ? !old.whereabouts : old.whereabouts === 'Parked'),
        old ? `${old.unit} (${old.type}): "${old.whereabouts}"` : '(gone)');
      const now = (S.trailers || []).find((t) => t.unit === second.unit);
      ok('the new one carries no stale position',
        !now || !now.whereabouts, now ? `${now.unit}: "${now.whereabouts}"` : '(gone)');
      ok('the promise is spent', !S.driver.changeoverUnit, `"${S.driver.changeoverUnit}"`);
    }
  }

  head('7. Standing on the yard, no notice about a fortnight from now');
  // The reported nonsense: told on arrival that nothing was changing, then shown a notice that
  // something was — about the home time AFTER this one, costed against a position typed in moments
  // earlier. What is happening THIS visit is the trailer decision, which the brief already carries.
  const v = await views();
  if (S.driver.atHomeYard) {
    ok('the coming-change notice is silent at the yard', !(v.homeTime?.reassignmentNotice || ''),
      (v.homeTime?.reassignmentNotice || '(silent)').slice(0, 120));
  } else {
    ok('driver is at the yard for this check', false, `atHomeYard=${S.driver.atHomeYard}`);
  }
  ok('and the brief still says what happened to the trailer this time',
    /Staying on|Re-rigged|no trailer issued/i.test(S.driver.lastTrailerDecision || ''),
    (S.driver.lastTrailerDecision || '(silent)').slice(0, 120));

  head('8. A driver on a trailer they asked for is not told they are changing');
  // The exemption lived only in the issuing, so an arrangement driver got the notice on the way in and
  // then arrived to find nothing happening at all.
  await api('/requests', 'POST', { kind: 'Trailer', detail: 'Flatbed', note: 'I want to stay on deck' })
    .catch(() => {});
  S = un(await api('/bootstrap'));
  if (S.driver.trailerByRequest) {
    day += 13;
    await report('Amarillo', 'TX', day, 'TruckStop', 500);
    const closed = await dropAwayFrom('Amarillo', 'TX', day);
    ok('no change is announced to an arrangement driver', !(closed.audit?.changeoverNote || ''),
      (closed.audit?.changeoverNote || '(silent)').slice(0, 120));
    ok('and no positions are asked for', !(closed.audit?.askWhereabouts || []).length,
      `${(closed.audit?.askWhereabouts || []).length} row(s)`);
  } else {
    console.log('  ..    no trailer arrangement in place; exemption checked in unit terms only');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
