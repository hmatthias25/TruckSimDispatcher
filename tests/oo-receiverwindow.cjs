/* Owner-Operator 0.9: the receiver takes it inside the game's window.
 *
 * Reported from play: arrived at 00:50 inside a 21:20-04:00 window with a flatbed load, and told the site opened at
 * 08:00, four hours past the delivery time. A receiver inside its window never holds a truck past it: a site is open
 * for the whole window, and whatever the line or the hold-up, the unload starts in time to be done by the close.
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
const at = (s) => Date.parse(s + ':00Z');

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'W. Indow', homeCity: 'Dallas', homeState: 'TX', day: 1, time: '18:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 10000, preset: 'Normal' });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);

  // Three night deliveries to sites, each arriving inside the window at a different hour, and one to a dock.
  const runs = [
    { cargo: 'Scaffolding', trailerType: 'Flatbed', receiver: 'Tractor Supply Co', arrive: '00:50' },
    { cargo: 'Pipes', trailerType: 'Flatbed', receiver: 'Kiewit', arrive: '02:10' },
    { cargo: 'Lumber', trailerType: 'Flatbed', receiver: 'Home Depot', arrive: '22:30' },
    { cargo: 'Furniture', trailerType: 'Dry Van', receiver: 'Ashley', arrive: '23:40' },
  ];
  let day = 1, odo = 10000;
  for (const [i, run] of runs.entries()) {
    head(`${i + 1}. ${run.cargo} to a ${run.trailerType === 'Flatbed' ? 'site' : 'dock'}, arriving ${run.arrive}`);
    S = await api('/status', 'POST', { locationCity: 'Dallas', locationState: 'TX', day, time: '18:00', odometer: odo });
    S = await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
    // Window opens 3:20 after listing (21:20) and shuts 10:00 after it (04:00), as the reported load did.
    await api('/board/add-many', 'POST', [{ cargo: run.cargo, trailerType: run.trailerType, destCity: 'Lawton', destState: 'OK',
      loadedMiles: 171, gameRevenue: 481, deadlineHours: 10, appointmentOpensHours: 3.33, shipper: 'Kuehne+Nagel', receiver: run.receiver }]);
    let r = await api('/calls', 'POST', { brokerId: starter.id });
    r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
    if (!r.snapshot.trip) { ok('booked', false, r.call.turns.at(-1).text); continue; }
    await api('/run/at-shipper', 'POST', { day, time: '18:20' });
    await api('/run/loaded', 'POST', { day, time: '18:40', odometer: odo + 1 });
    const arriveDay = run.arrive < '18:00' ? day + 1 : day;
    r = await api('/run/arrived', 'POST', { day: arriveDay, time: run.arrive });
    const t = r.snapshot.trip;
    const starts = t.workStartsGameTime, due = t.dueGameTime;
    ok('starts inside the window', at(starts) <= at(due), `${t.receiverCallKind}: starts ${starts}, due ${due}: ${r.said}`);
    ok('in time to be unloaded by the close', at(starts) + t.unloadingHours * 3600000 <= at(due) + 60000, `starts ${starts}, unload ${t.unloadingHours} h, due ${due}`);
    ok('no word of opening after the window', !/open (again )?at 0?[5-9]:|opening/.test(r.said) || at(starts) <= at(due), r.said);
    odo += 172;
    await api('/deliver', 'POST', { day: arriveDay, time: '04:30' > run.arrive && arriveDay > day ? '03:50' : '23:59', odometer: odo,
      driveRemaining: 8, shiftRemaining: 9, breakRemaining: 5, cycleRemaining: 55 }).catch((e) => ok('delivered', false, e.message));
    day += 2;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
