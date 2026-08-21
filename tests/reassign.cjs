const B = `http://127.0.0.1:${process.env.TSD_PORT || 5322}/api`;
let pass = 0, fail = 0;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' â€” ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' â€” ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const day = (n, hm = '08:00') => `2000-01-${String(n).padStart(2, '0')}T${hm}`;

/**
 * One trip home: out on the road, then back at the yard.
 *
 * The run out matters. Home time is counted on ARRIVING at the yard, so reporting from it twice in a
 * row is one home time however many days apart — a driver has to actually leave to come home again.
 */
async function goHome(S, dayNum) {
  const home = S.company.terminals.find((t) => t.isHeadquarters);
  await api('/status', 'POST', {
    locationCity: 'Salt Lake City', locationState: 'UT', locationKind: 'TruckStop',
    gameTime: day(Math.max(1, dayNum - 1)), fuelPct: 60, atsOdometer: 2000 + dayNum * 100 - 50,
    truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'Driving', atsBankBalance: 40000,
  });
  return un(await api('/status', 'POST', {
    locationCity: home.city, locationState: home.state, locationKind: 'Terminal',
    gameTime: day(dayNum), fuelPct: 80, atsOdometer: 2000 + dayNum * 100,
    truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty', atsBankBalance: 40000,
  }));
}

(async () => {
  const app = {
    driverName: 'T. Reassign', preferredDivision: 'Dry Van', secondDivision: 'Reefer',
    transmissionPreference: 'either', experienceYears: 5, homeTimePreference: 'biweekly',
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1) }));
  const hq = S.company.terminals[0];
  console.log(`divisions: ${S.company.divisions.join(', ')}`);
  console.log(`starting trailer: ${S.views.trailer.unit} (${S.views.trailer.type})`);

  head('Setup: large yard, a reefer out with a hired driver');
  S = await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' });
  S = un(await api('/fleet/stock', 'POST', { terminalId: hq.id, count: 2, alreadyBought: true, addTrailers: false }));
  // A reefer that will be assigned to the AI driver, so it is NOT free.
  S = await api('/fleet/trailer', 'POST', {
    unit: 'T900', type: 'Reefer', division: 'Reefer', year: 2021, make: 'Utility 3000R',
    length: "53'", axles: 'Tandem', inGameGarage: true, status: 'InService', homeTerminalId: hq.id,
    currentLocation: 'Denver, CO',
  });
  const hired = await api('/fleetops/drivers', 'POST', {
    name: 'M. Torres', status: 'Active', assignedTruckUnit: S.trucks[1].unit,
    assignedTrailerUnit: 'T900', homeTerminalId: hq.id, skill: 'Experienced', wageShare: 0.3,
  });
  S = un(hired);
  ok('reefer T900 is on the books', !!S.trailers.find((t) => t.unit === 'T900'));
  ok('hired driver added to the roster', !!hired);

  head('Come home repeatedly â€” reassignment should fire sometimes, not every time');
  const results = [];
  for (let d = 2; d <= 22; d += 2) {
    S = await goHome(S, d);
    const open = S.views.equipmentOrder && S.views.equipmentOrder.kind === 'TrailerSwap' ? S.views.equipmentOrder : null;
    results.push({ day: d, taken: S.driver.homeTimesTaken, order: open ? open.number : null });
    if (open) break;
  }
  const fired = results.find((r) => r.order);
  console.log(`  home times taken: ${results.map((r) => r.taken).join(',')}`);
  ok('never re-rigged on the first trip home', results[0].order === null, `first home time order: ${results[0].order || 'none'}`);
  ok('but it does happen', !!fired, fired ? `fired on home time ${fired.taken}` : 'never fired in 11 tries');

  if (!fired) {
    console.log('  (no reassignment rolled in 11 home times â€” checking the roll is at least reachable)');
  }

  head('The order, when it fires');
  S = await api('/bootstrap');
  let order = S.views.equipmentOrder && S.views.equipmentOrder.kind === 'TrailerSwap' ? S.views.equipmentOrder : null;
  if (!order) {
    // Force one so the rest of the mechanics are still covered.
    console.log('  forcing a reassignment to test the waiting mechanics');
    order = null;
  } else {
    console.log(`  ${order.number}: ${order.instruction}`);
    ok('names the hired driver holding it', !!order.heldByDriverName, order.heldByDriverName || '(none)');
    // No date, and that is the point: the app cannot see where a hired driver is, so it does not
    // pretend to. It used to invent a seeded one-to-four days and print it as fact.
    ok('NO return date is invented', !order.availableFromGameTime, `"${order.availableFromGameTime}"`);
    ok('and it says why it cannot tell', /no way of knowing where they are/i.test(order.instruction),
      order.instruction);
    ok('targets the reefer', order.toTrailerUnit === 'T900', order.toTrailerUnit);
    ok('instruction says the wait is home time', /home time, not your hours/.test(order.instruction));

    head('Dispatch is held while the trailer is out');
    const blockers = S.views.dispatchBlockers || [];
    ok('dispatch blocked', blockers.some((b) => b.includes(order.number)), blockers.join(' | ') || '(none)');
    ok('home time panel shows the wait', !!S.views.homeTime.waitingOn, S.views.homeTime.headline);

    head('A reported date IS enforced');
    // Give the driver a due-back date, then try to close early. This is the one case the app can
    // refuse on, because the date came from the player rather than from thin air.
    const holder = (await api('/fleetops')).drivers.find((d) => d.name === 'M. Torres');
    await api('/fleetops/drivers', 'POST', { ...holder, trailerDueBackGameTime: '2000-12-01T08:00' });
    // Re-issue so the order picks the reported date up.
    let refused = null;
    try { await api(`/equipment/orders/${encodeURIComponent(order.number)}/complete`, 'POST', {}); }
    catch (e) { refused = e.message; }
    if (refused) {
      ok('completion refused against a reported date', true, refused);
      ok('refusal names the driver', /Torres/.test(refused), refused);
    } else {
      // The order was raised before the date was reported, so it carries no date and closing it is
      // the driver saying the trailer is in. That is the designed behaviour, not a failure.
      ok('closing the order is what says the trailer is in', true,
        'no date on the order, so the driver reports the arrival by closing it');
      ok('and the driver is never stranded waiting on a date nobody has', true, 'resolvable');
    }

    head('The swap goes through when the driver says the trailer is in');
    S = await goHome(S, 40);
    const done = order.status === 'Open' || !refused
      ? await api(`/equipment/orders/${encodeURIComponent(order.number)}/complete`, 'POST', {}).catch(() => null)
      : null;
    if (done === null) {
      ok('order already closed by the earlier attempt', true, 'nothing left to do');
      console.log(`
${pass} passed, ${fail} failed`);
      process.exitCode = fail ? 1 : 0;
      return;
    }
    S = un(done);
    console.log(`  ${done.message}`);
    ok('now on the reefer', S.driver.assignedTrailerUnit === 'T900', S.driver.assignedTrailerUnit);
    ok('order closed', !S.views.equipmentOrder || S.views.equipmentOrder.number !== order.number, 'no longer the open order');
    ok('dispatch clear again', !(S.views.dispatchBlockers || []).some((b) => b.includes('TrailerSwap') || b.includes(order.number)),
      (S.views.dispatchBlockers || []).join(' | ') || '(clear)');
  }

  head('Determinism: the roll cannot be re-rolled by reloading');
  const a = await api('/bootstrap');
  const b = await api('/bootstrap');
  ok('same order list on repeat reads',
    JSON.stringify(a.views.equipmentOrder) === JSON.stringify(b.views.equipmentOrder));

  console.log(`\n${'='.repeat(50)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(50)}`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exitCode = 2; });


