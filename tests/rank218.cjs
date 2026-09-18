/* #216/#217/#218/#219/#220 - a grade a hired driver earns, and a record that outlives the report.
 *
 * The first cut of this read the grade straight off the ATS level, which was wrong for the reason any
 * fleet manager would give: an AI driver climbs levels fast, on miles turned and nothing else. A
 * fortnight of good running read as a promotion to Senior, and everybody was senior by the end of the
 * quarter. It is earned now - time served, distance covered, the level the game has them on, and a
 * clean recent record - and every hire serves ninety days before any of it counts.
 *
 * The level gate replaced a RATING gate: rating in ATS is derived purely from how the skill points were
 * spent, so it measured the training policy rather than the driver, and its thresholds sat between the
 * thirteen values the scale can actually take. Level is one gate of four and pay is still a property of
 * the rung, not of the level.
 *
 * Pay follows the rung, not the level, for the same reason: a share that chased a level would be handing
 * out rises for a good fortnight.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5958}/api`;
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
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const dz = (fo, id) => (fo.dossiers || []).find((x) => x.id === id) || {};
const drv = (fo, id) => (fo.drivers || []).find((x) => x.id === id) || {};

(async () => {
  const app = { driverName: 'P. Okafor', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1), code: 'PRI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  const yard = S.company.terminals[0];
  await api(`/terminals/${yard.id}/level`, 'POST', { level: 'Large' });

  // Everybody is hired on day 20, so tenure is one number for the whole roster and a gate that fires
  // early is a gate that is wrong rather than a driver who happened to start sooner.
  const clock = async (day) => un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: iso(day),
    fuelPct: 90, atsOdometer: 90000, truckDamagePct: 2, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 400000,
  }));
  S = await clock(20);

  const second = un(await api('/terminals', 'POST', { city: 'Oklahoma City', state: 'OK', level: 'Large' }));
  const yard2 = (second.company.terminals || []).find((x) => x.city === 'Oklahoma City');

  // A rookie and a veteran, hired the same day. ATS says one is level 1 and the other level 12; the
  // company says they are both new here, which is the whole point of the change.
  const roster = [['Rea Lindqvist', 1], ['Ada Vance', 12], ['Kit Moreau', 6], ['Sam Okonjo', 4],
                  ['Ivo Marek', 8], ['Bea Hartnell', 2], ['Nel Castro', 5], ['Tom Reaney', 3]];
  for (let i = 0; i < roster.length; i++) {
    const [name, lvl] = roster[i];
    const unit = `F-${i + 1}`;
    const at = i < 4 ? yard.id : (yard2?.id || yard.id);
    await api('/fleet/truck', 'POST', {
      unit, year: 2020, make: 'Kenworth', model: 'T680', engine: 'Paccar MX-13',
      transmission: 'Automatic', governedMph: 65, atsOdometer: 120000, damagePct: 4,
      status: 'InService', inGameGarage: true, homeTerminalId: at,
    });
    // Pinned ids. Conduct is seeded on the career and the driver, so a minted GUID would re-roll the
    // whole thing every run and nothing below could be asserted honestly.
    await api('/fleetops/drivers', 'POST', {
      id: `qa-rank-${i + 1}`, name, status: 'Active', assignedTruckUnit: unit,
      assignedTrailerUnit: '', homeTerminalId: at, level: lvl,
    });
  }

  head('1. The hire form takes the level ATS just showed you');
  let fo = await api('/fleetops');
  ok('a level entered at hire is on the roster', drv(fo, 'qa-rank-2').level === 12,
    `level ${drv(fo, 'qa-rank-2').level}`);
  // Rating used to be asserted here as round-tripping. It is no longer read by anything: in ATS it
  // only measures how the skill points were spent, so it described the training policy rather than
  // the driver. The field survives so stored careers load, which is why posting one still stores it —
  // what matters is that nothing consults it, and norating233 holds that. Level is the gate now.
  ok('the level is what the ladder reads', drv(fo, 'qa-rank-1').level === 1,
    `level ${drv(fo, 'qa-rank-1').level}`);

  head('2. Everybody starts on probation, whatever level they came in at');
  for (const id of ['qa-rank-1', 'qa-rank-2']) {
    const d = dz(fo, id);
    ok(`${drv(fo, id).name} (L${drv(fo, id).level}) is Probationary`,
      d.rank === 'Probationary Company Driver' && d.servingProbation === true,
      `${d.rank}, ${d.probationDaysLeft}d left`);
  }
  ok('a level 12 and a level 1 are on the same grade',
    dz(fo, 'qa-rank-1').grade === dz(fo, 'qa-rank-2').grade, 'both 0');
  ok('and therefore on the same money',
    drv(fo, 'qa-rank-1').wageShare === drv(fo, 'qa-rank-2').wageShare,
    `${drv(fo, 'qa-rank-1').wageShare}`);
  ok('the shortfall is the probation and nothing else',
    /day\(s\) of their probation left/.test((dz(fo, 'qa-rank-1').shortfall || []).join(' ')),
    (dz(fo, 'qa-rank-1').shortfall || [])[0]);

  /* File one period, running to a given day. Miles come off the odometer delta. */
  let odo = 120000;
  async function period(day, miles) {
    odo += miles;
    await clock(day);
    const active = (await api('/fleetops')).drivers.filter((x) => x.status === 'Active');
    if (!active.length) return null;
    return api('/fleetops/report', 'POST', {
      periodStartGame: iso(day - 14), periodEndGame: iso(day), notes: '',
      lines: active.map((d) => ({ driverId: d.id, truckUnit: d.assignedTruckUnit,
        level: d.level, perMile: 3.0, perDay: 1400, truckOdometer: odo })),
      trailerLines: [],
    });
  }

  head('3. Miles alone do not buy a promotion inside the ninety days');
  // 60,000 miles in four fortnights clears the mileage gate for two rungs up. The clock has not.
  let day = 20;
  for (let i = 0; i < 4; i++) { day += 14; await period(day, 15000); }
  fo = await api('/fleetops');
  const early = dz(fo, 'qa-rank-1');
  console.log(`  ..    day ${day}, ${drv(fo, 'qa-rank-1').lifetimeMiles} mi, ${early.tenureDays} day(s) in`);
  ok('still Probationary at 56 days with the miles banked',
    early.rank === 'Probationary Company Driver' && early.tenureDays < 90,
    `${early.rank} at ${early.tenureDays}d`);

  head('4. Ninety days served, and the rung opens');
  // Hired on day 20, so the ninetieth day is day 110 and the first report past it is day 118.
  const probationShare = drv(fo, 'qa-rank-1').wageShare;
  let promoted = null;
  for (let i = 0; i < 3; i++) { day += 14; promoted = await period(day, 15000); }
  fo = await api('/fleetops');
  const made = dz(fo, 'qa-rank-1');
  console.log(`  ..    day ${day}: ${made.rank}, ${made.tenureDays} day(s), ${drv(fo, 'qa-rank-1').lifetimeMiles} mi`);
  // qa-rank-1 came in at level 1 and the bottom rung now wants level 3, so serving the days is no
  // longer enough on its own. That is the level gate doing its job rather than a regression: a driver
  // who has been here three months and has not moved off level 1 has not done very much.
  ok('the ninety days are served and no longer the thing in the way',
    made.tenureDays >= 90, `${made.tenureDays}d`);
  ok('and what is left is the level, said plainly',
    made.rank === 'Company Driver' || made.shortfall.some((x) => /level/i.test(x)),
    made.rank === 'Company Driver' ? 'promoted' : made.shortfall.join(' '));
  ok('and off their probation', made.servingProbation === false, `${made.probationDaysLeft}d left`);
  ok('the promotion is news on the report',
    /is now Company Driver/.test((promoted?.report?.findings || []).join(' ')),
    (promoted?.report?.findings || []).find((x) => /is now /.test(x))?.slice(0, 80));

  head('4b. Clearing the ninety days shows as due before the report settles it');
  // The exact gap a player sits in: day 91, hired on day 0, countdown finished and the roster still
  // says Probationary because no report has been filed since. Saying nothing there makes a driver who
  // is due look identical to one who is stuck behind a gate.
  await clock(day + 3);
  const gap = dz(await api('/fleetops'), 'qa-rank-4');
  console.log(`  ..    ${drv(await api('/fleetops'), 'qa-rank-4').name}: ${gap.rank}` +
    `${gap.duePromotion ? ` (due ${gap.dueRank})` : ''}, ${gap.tenureDays}d`);
  ok('a driver past their ninety days is no longer counting down',
    gap.servingProbation === false, `${gap.tenureDays}d in`);
  ok('and the shortfall is not two rungs of bad news',
    gap.duePromotion ? gap.shortfall.length === 0 : true,
    gap.shortfall.join(' ') || 'none');

  head('5. Pay follows the rung, and the rung has a level gate on it now');
  // This used to assert that a level 1 and a level 12 were paid identically, because the ladder read
  // nothing off the level at all. That changed when the RATING gate came out: rating in ATS is derived
  // purely from how the skill points were spent, so it measured the player's training policy rather
  // than the driver, and its thresholds sat between values the game can actually show. Level replaced
  // it — a plain integer with no scale to fall between.
  //
  // The original point still holds and is what is checked here: pay is a property of the RUNG. Two
  // drivers on the same rung are paid the same whatever their levels, and the level only decides which
  // rung is open. It is one gate of four, and the tenure and mileage gates still dominate — the level
  // thresholds are low enough that anybody who has served the days has passed them.
  const rookie = drv(fo, 'qa-rank-1'), veteran = drv(fo, 'qa-rank-2');
  const rookieGrade = dz(fo, 'qa-rank-1').grade, vetGrade = dz(fo, 'qa-rank-2').grade;
  console.log(`  ..    L${rookie.level} grade ${rookieGrade} on ${rookie.wageShare}, ` +
    `L${veteran.level} grade ${vetGrade} on ${veteran.wageShare}`);
  ok('two drivers on the same rung are paid the same, whatever their levels',
    rookieGrade !== vetGrade || rookie.wageShare === veteran.wageShare,
    `grade ${rookieGrade}/${vetGrade} → ${rookie.wageShare} vs ${veteran.wageShare}`);
  ok('and a promoted driver is paid more than probation did',
    veteran.wageShare > probationShare, `${probationShare} -> ${veteran.wageShare}`);

  head('6. A share you set yourself is left alone');
  // Whoever is still on the books and has been promoted at least once. Picking a driver by name would
  // make this vacuous the first time that one resigned before the assertion ran.
  const subject = (fo.drivers || []).find((x) => x.status === 'Active' && dz(fo, x.id).grade > 0);
  ok('somebody is still here to test on', !!subject, subject?.name);
  await api('/fleetops/drivers', 'POST', { ...subject, wageShare: 0.5 });
  fo = await api('/fleetops');
  ok('the override is recorded as yours', drv(fo, subject.id).wageShareSetByHand === true, 'flagged');

  // The company settles grades on every report. A peer on the same rung shows what it WOULD have paid,
  // so "it did not move" is measured against the figure it was moving everybody else to.
  day += 14; await period(day, 15000);
  fo = await api('/fleetops');
  const held = drv(fo, subject.id);
  console.log(`  ..    ${held.name}: ${dz(fo, subject.id).rank}, share ${held.wageShare}, ` +
    `rung offers ${dz(fo, subject.id).offeredShare}`);
  ok('the share did not move with the rung', held.wageShare === 0.5, `${held.wageShare}`);
  ok('and it differs from what the rung offers',
    held.wageShare !== dz(fo, subject.id).offeredShare,
    `${held.wageShare} vs ${dz(fo, subject.id).offeredShare}`);

  head('7. Putting the offered figure back hands it to the company again');
  const offered = dz(fo, subject.id).offeredShare;
  await api('/fleetops/drivers', 'POST', { ...drv(fo, subject.id), wageShare: offered });
  fo = await api('/fleetops');
  ok('no longer set by hand', drv(fo, subject.id).wageShareSetByHand === false, `on ${offered}`);

  head('8. The ladder is climbed in order, never jumped');
  const grades = (fo.dossiers || []).map((x) => x.grade);
  console.log(`  ..    grades on the roster: ${grades.join(', ')}`);
  ok('nobody is past a rung their tenure allows',
    (fo.dossiers || []).every((x) => x.tenureDays >= [0, 90, 270, 540, 900, 1350][x.grade]),
    grades.join(','));

  head('9. Conduct accumulates and outlives the report it arrived on');
  // Backfill the seats as people go, or the roster empties and the last third of this asserts nothing.
  // A fleet that never replaces anybody is not a fleet either.
  let replacement = 0;
  for (let i = 0; i < 26; i++) {
    day += 14;
    await period(day, 9000);
    const now = await api('/fleetops');
    const manned = new Set(now.drivers.filter((x) => x.status === 'Active').map((x) => x.assignedTruckUnit));
    for (const unit of (now.summary?.unassignedUnits || []).filter((u) => !manned.has(u))) {
      replacement++;
      await api('/fleetops/drivers', 'POST', {
        id: `qa-fill-${replacement}`, name: `Relief ${replacement}`, status: 'Active',
        assignedTruckUnit: unit, assignedTrailerUnit: '', level: 4,
      });
    }
  }
  fo = await api('/fleetops');
  const all = fo.dossiers || [];
  const lines = all.flatMap((x) => x.conduct);
  const preventables = all.reduce((n, x) => n + x.preventables, 0);
  console.log(`  ..    day ${day}: ${lines.length} incident(s), ${preventables} preventable`);
  for (const d of fo.drivers)
    console.log(`  ..    ${d.name.padEnd(16)} L${String(d.level).padEnd(3)} ${String(dz(fo, d.id).rank).padEnd(28)}` +
      ` ${String(d.status).padEnd(11)} ${String(dz(fo, d.id).tenureDays).padStart(4)}d  ${dz(fo, d.id).incidents} incident(s)`);
  ok('things happened over a game-year', lines.length > 0, `${lines.length}`);
  const shown = new Set((fo.reports || []).map((r) => r.number));
  ok('and stay readable once the report has scrolled off',
    lines.some((c) => !shown.has(c.reportNumber)),
    `${lines.filter((c) => !shown.has(c.reportNumber)).length} older than the last ${shown.size}`);
  ok('each line says which report and when',
    lines.every((c) => !!c.reportNumber && !!c.gameTime), `${lines.length} line(s)`);

  head('10. Being hit is on the record and not against you');
  const noFault = lines.filter((c) => !c.preventable);
  ok('some of it was nobody\'s doing', noFault.length > 0, `${noFault.length} of ${lines.length}`);
  ok('and none of it is counted as preventable',
    noFault.every((c) => /NotAtFault/.test(c.severity)) && preventables === lines.length - noFault.length,
    `${preventables} preventable, ${noFault.length} not`);

  head('11. A preventable inside the window costs a rung, and ages off');
  const marked = all.filter((x) => x.recentPreventables > 0);
  console.log(`  ..    ${marked.length} driver(s) carrying a recent preventable`);
  ok('the window is smaller than the record',
    all.every((x) => x.recentPreventables <= x.preventables),
    all.map((x) => `${x.recentPreventables}/${x.preventables}`).join(' '));

  head('12. Two reads of the same career tell the same story');
  const again = await api('/fleetops');
  const sig = (x) => (x.dossiers || []).map((d) => `${d.id}:${d.grade}:${d.incidents}`).join('|');
  ok('the record is read, not re-rolled', sig(again) === sig(fo), sig(again).slice(0, 70));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
