/* Issue #53: reading the clocks off a GDC Companion recap screenshot.
 *
 * The API call itself is not exercised here — no key, no network. What is exercised is everything that
 * turns what the reader transcribed into clocks and recap batches, which is where the mistakes would
 * be: used-versus-remaining, HH:MM parsing, and the day arithmetic that decides which midnight a
 * batch of hours lands on.
 *
 * The figures throughout are from a real screenshot: cycle used 34:42, left 35:18, today Day 13,
 * remaining row "D 05:58 | S 05:58 | B 08:00 | C 35:18", and recap returns on days 17 to 21.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5740}/api`;
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
const at = (d, hm = '08:00') => `2000-${String(Math.floor((d - 1) / 28) + 1).padStart(2, '0')}-${String(((d - 1) % 28) + 1).padStart(2, '0')}T${hm}`;
const near = (a, b, tol = 0.005) => a != null && Math.abs(a - b) < tol;
const hhmm = (h) => (h == null ? '--' : `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0')}`);

/** The reader's output for the screenshot in the issue. */
const REAL = {
  driveText: '05:58', shiftText: '05:58', breakText: '08:00', cycleText: '35:18',
  clocksFrom: 'status tooltip D/S/B/C row; cycle also in the header',
  todayDayText: 'Day 13',
  recap: [
    { dayText: 'Day 14 00:00', hoursText: '00:00' },
    { dayText: 'Day 15 00:00', hoursText: '00:00' },
    { dayText: 'Day 16 00:00', hoursText: '00:00' },
    { dayText: 'Day 17 00:00', hoursText: '00:25' },
    { dayText: 'Day 18 00:00', hoursText: '05:34' },
    { dayText: 'Day 19 00:00', hoursText: '09:54' },
    { dayText: 'Day 20 00:00', hoursText: '06:41' },
    { dayText: 'Day 21 00:00', hoursText: '02:30' },
  ],
  // The rolling 8-day on-duty totals, which is what recap is actually derived from.
  dailyTotals: [
    { dayText: 'Today • Day 13', onDutyText: '02:30' },
    { dayText: '-1d • Day 12', onDutyText: '06:41' },
    { dayText: '-2d • Day 11', onDutyText: '09:54' },
    { dayText: '-3d • Day 10', onDutyText: '05:34' },
    { dayText: '-4d • Day 9', onDutyText: '00:25' },
    { dayText: '-5d • Day 8', onDutyText: '00:00' },
    { dayText: '-6d • Day 7', onDutyText: '00:00' },
    { dayText: '-7d • Day 6', onDutyText: '00:00' },
  ],
  unreadable: [], notes: '', confidence: 'high',
};

const read = (payload) => api('/hos/interpret', 'POST', payload);

(async () => {
  const app = { driverName: 'HOS Reader', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 6, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) });
  await api('/status', 'POST', {
    locationCity: 'Wichita', locationState: 'KS', locationKind: 'TruckStop', gameTime: at(3, '06:00'),
    fuelPct: 70, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OffDuty', atsBankBalance: 50000,
  });

  head('1. The real screenshot, read end to end');
  let r = await read(REAL);
  ok('drive left is 5:58, not 11 minus used', near(r.driveRemaining, 5 + 58 / 60), `${r.driveRemaining}`);
  ok('shift left is 5:58', near(r.shiftRemaining, 5 + 58 / 60), `${r.shiftRemaining}`);
  ok('break clock is 8:00', near(r.breakRemaining, 8), `${r.breakRemaining}`);
  ok('cycle left is 35:18 -- the LEFT figure, not the 34:42 used',
    near(r.cycleRemaining, 35 + 18 / 60), `${r.cycleRemaining}`);
  ok('nothing was flagged unreadable', (r.unreadable || []).length === 0, JSON.stringify(r.unreadable));
  ok('it says where it read them', /tooltip/i.test(r.clocksFrom || ''), r.clocksFrom);

  head('2. The day arithmetic, done in the screenshot\'s own numbering');
  ok('today is day 13', r.todayDay === 13, `${r.todayDay}`);
  ok('the three empty boundaries are dropped', r.recap.length === 5, `${r.recap.length} batches`);
  const off = r.recap.map((x) => x.inDays).join(',');
  ok('day 17 becomes 4 days out, and so on', off === '4,5,6,7,8', off);
  ok('day 17 carries 0:25 back', near(r.recap[0].hours, 25 / 60), `${r.recap[0].hours}`);
  ok('day 19 carries 9:54 back', near(r.recap[2].hours, 9 + 54 / 60), `${r.recap[2].hours}`);
  ok('batches come back in order', r.recap.every((x, i, a) => !i || x.inDays > a[i - 1].inDays), off);
  ok('what was printed is kept for audit', (r.recapShown || []).length === 8,
    `${(r.recapShown || []).length} rows shown`);

  head('3. The offsets do NOT come from this app\'s own game day');
  // The career is on day 3; the screenshot says day 13. Only the gap between the screenshot's own rows
  // is portable, because the two apps count from different starting points.
  ok('career day and screenshot day differ', r.todayDay === 13, 'career is on day 3');
  ok('and day 17 is still 4 days out, not 14', r.recap[0].inDays === 4, `${r.recap[0].inDays}`);

  head('4. A clock that cannot be read stays EMPTY, never zero');
  r = await read({ ...REAL, cycleText: '' , unreadable: ['cycleText'] });
  ok('cycle comes back null, not 0', r.cycleRemaining === null, JSON.stringify(r.cycleRemaining));
  ok('and it is named', (r.unreadable || []).includes('cycleText'), JSON.stringify(r.unreadable));
  ok('the other clocks still read fine', near(r.driveRemaining, 5 + 58 / 60), `${r.driveRemaining}`);

  head('5. A garbled clock is flagged rather than half-parsed');
  r = await read({ ...REAL, driveText: '5:70', shiftText: 'xx:xx', breakText: '-1:00' });
  ok('8:70 is not a clock -- drive rejected', r.driveRemaining === null, JSON.stringify(r.driveRemaining));
  ok('letters are rejected', r.shiftRemaining === null, JSON.stringify(r.shiftRemaining));
  ok('a negative clock is rejected', r.breakRemaining === null, JSON.stringify(r.breakRemaining));
  const flagged = (r.unreadable || []).join(',');
  ok('all three are named even though the model did not name them',
    ['driveText', 'shiftText', 'breakText'].every((f) => flagged.includes(f)), flagged);
  ok('cycle, which was fine, is untouched', near(r.cycleRemaining, 35 + 18 / 60), `${r.cycleRemaining}`);

  head('6. 0:00 is a reading, not a failure');
  r = await read({ ...REAL, driveText: '00:00', shiftText: '0:00' });
  ok('drive reads zero hours left', r.driveRemaining === 0, JSON.stringify(r.driveRemaining));
  ok('shift reads zero hours left', r.shiftRemaining === 0, JSON.stringify(r.shiftRemaining));
  ok('and neither is flagged unreadable', !(r.unreadable || []).some((u) => /drive|shift/.test(u)),
    JSON.stringify(r.unreadable));

  head('7. No "today" means no arithmetic -- and it says so');
  r = await read({ ...REAL, todayDayText: '', unreadable: ['todayDayText'] });
  ok('no batches are converted', r.recap.length === 0, `${r.recap.length}`);
  ok('rather than guessing a frame', r.todayDay === null, JSON.stringify(r.todayDay));
  ok('the rows are still shown so they can be typed in', (r.recapShown || []).length === 5,
    `${(r.recapShown || []).length}`);
  ok('and the driver is told why', /could not read which day|by hand/i.test(r.notes || ''), r.notes);

  head('8. Boundaries already past carry nothing');
  // dailyTotals cleared: this section is about converting the tracker's projection, and a derivation
  // from day rows would otherwise take precedence (section 15).
  r = await read({
    ...REAL, dailyTotals: [], todayDayText: 'Day 19',
    recap: [
      { dayText: 'Day 17', hoursText: '00:25' },   // behind us
      { dayText: 'Day 19', hoursText: '05:34' },   // today, already had it
      { dayText: 'Day 21', hoursText: '02:30' },   // ahead
    ],
  });
  ok('only the boundary still ahead survives', r.recap.length === 1, `${r.recap.length}`);
  ok('and it is the day 21 one, two days out', r.recap[0].inDays === 2, `${r.recap[0].inDays}`);
  ok('carrying 2:30', near(r.recap[0].hours, 2.5), `${r.recap[0].hours}`);

  head('9. Decimal displays work too, for apps that show 8.5');
  r = await read({ ...REAL, driveText: '8.5', cycleText: '35.3' });
  ok('8.5 reads as eight and a half', near(r.driveRemaining, 8.5), `${r.driveRemaining}`);
  ok('and a decimal cycle', near(r.cycleRemaining, 35.3), `${r.cycleRemaining}`);

  head('10. Noise around the number does not defeat it');
  r = await read({ ...REAL, driveText: 'D 05:58', cycleText: 'left 35:18', breakText: '08:00 remaining' });
  ok('"D 05:58" reads', near(r.driveRemaining, 5 + 58 / 60), `${r.driveRemaining}`);
  ok('"left 35:18" reads', near(r.cycleRemaining, 35 + 18 / 60), `${r.cycleRemaining}`);
  ok('"08:00 remaining" reads', near(r.breakRemaining, 8), `${r.breakRemaining}`);

  head('11. Not a recap page at all');
  r = await read({
    driveText: '', shiftText: '', breakText: '', cycleText: '', clocksFrom: '', todayDayText: '',
    recap: [], unreadable: ['notScreen'], notes: 'This is the ATS freight board, not a recap page.',
    confidence: 'low',
  });
  ok('every clock is empty', [r.driveRemaining, r.shiftRemaining, r.breakRemaining, r.cycleRemaining]
    .every((x) => x === null), JSON.stringify([r.driveRemaining, r.cycleRemaining]));
  ok('nothing is invented for the recap', r.recap.length === 0, `${r.recap.length}`);
  ok('and the reason survives to the driver', /freight board/i.test(r.notes || ''), r.notes);

  head('12. Interpreting alone saves nothing -- applying is the extract endpoint\'s job');
  const before = un(await api('/bootstrap')).hos;
  await read(REAL);
  const after = un(await api('/bootstrap')).hos;
  ok('the stored cycle is unchanged by a read',
    before.cycleRemaining === after.cycleRemaining, `${before.cycleRemaining} -> ${after.cycleRemaining}`);
  ok('and the stored recap is unchanged',
    (before.recap || []).length === (after.recap || []).length,
    `${(before.recap || []).length} -> ${(after.recap || []).length}`);

  head('13. Saving what was read is the ordinary clocks report');
  r = await read(REAL);
  const saved = un(await api('/hos', 'POST', {
    driveRemaining: r.driveRemaining, shiftRemaining: r.shiftRemaining,
    breakRemaining: r.breakRemaining, cycleRemaining: r.cycleRemaining,
    recap: r.recap, source: 'GDC Companion', notes: '', asOfGameTime: at(3, '06:00'),
  }));
  ok('the cycle is on file', near(saved.hos.cycleRemaining, 35 + 18 / 60), `${saved.hos.cycleRemaining}`);
  ok('and all five recap batches with it', saved.hos.recap.length === 5, `${saved.hos.recap.length}`);
  ok('the source is recorded', saved.hos.source === 'GDC Companion', saved.hos.source);

  head('14. And the recap adviser now has something to weigh');
  const advice = saved.views.recap;
  ok('it is no longer working blind', advice && advice.verdict !== 'NoData', advice?.verdict);
  ok('it picks the nearest batch -- 0:25, four days out',
    near(advice.nextHours, 25 / 60) && advice.nextInDays === 4,
    `${advice.nextHours} h in ${advice.nextInDays} d`);
  ok('and with 35:18 of cycle in hand it does not order a restart',
    saved.views.restart?.needed !== true, JSON.stringify(saved.views.restart?.needed));

  head('14b. The day label is read off the word "Day", not the first digit in the string');
  // "-1d • Day 12" reads as day 12. Taking the first number gave day 1, which put seven of the eight
  // rolling rows behind the window and collapsed recap to a single batch.
  r = await read({
    ...REAL,
    dailyTotals: [
      { dayText: 'Today • Day 13', onDutyText: '02:30' },
      { dayText: '-1d • Day 12', onDutyText: '06:41' },
      { dayText: '-7d • Day 6', onDutyText: '01:00' },
    ],
  });
  const days = r.derived.map((x) => x.inDays).sort((a, b) => a - b);
  ok('all three rows survive', r.derived.length === 3, JSON.stringify(days));
  ok('day 12 lands 7 days out, not behind us', days.includes(7), JSON.stringify(days));
  ok('day 6 lands 1 day out', days.includes(1), JSON.stringify(days));
  ok('and day 13 lands 8 days out', days.includes(8), JSON.stringify(days));

  head('15. Recap is worked out here, not taken on trust');
  r = await read(REAL);
  ok('it derived batches from the day rows', r.derived.length === 5, `${r.derived.length}`);
  ok('day 13 comes back in 8 days -- the window length',
    r.derived.some((x) => x.inDays === 8 && near(x.hours, 2.5)),
    r.derived.map((x) => `${hhmm(x.hours)}/${x.inDays}d`).join(' '));
  ok('and day 9 in 4 days', r.derived.some((x) => x.inDays === 4 && near(x.hours, 25 / 60)), '');
  ok('the derivation is what gets used', r.recapSource && /worked out here/.test(r.recapSource),
    r.recapSource);
  ok('and it matches the tracker row for row',
    JSON.stringify(r.recap) === JSON.stringify(r.derived), 'identical');
  ok('the tracker projection is kept alongside for comparison', r.projected.length === 5,
    `${r.projected.length}`);

  head('16. The 9:38 your screenshot does not account for');
  // Cycle left 35:18 against a 70 means 34:42 used. The day rows only add up to 25:04. The difference
  // is on-duty time being charged with no day to come back on -- which is exactly the arithmetic a
  // recap-versus-restart call turns on, so it has to be surfaced rather than quietly absorbed.
  ok('the gap is found', r.unaccountedHours != null, `${r.unaccountedHours}`);
  ok('and it is 9:38', near(r.unaccountedHours, 9 + 38 / 60, 0.02), hhmm(r.unaccountedHours));
  const gapWarn = (r.disagreements || []).join(' | ');
  ok('it says the cycle is charging more than the rows explain',
    /charging .*but the day rows only account/i.test(gapWarn), gapWarn.slice(0, 150));
  ok('it warns the projection is short by that much', /Expect up to/i.test(gapWarn), '');
  ok('and it says not to trust a "take the 34" call on it',
    /take the 34.*suspicion|suspicion/i.test(gapWarn), '');

  head('17. Rows that add up leave no warning');
  // 70 minus the 25:04 the rows account for is 44:56 of cycle left. Nothing unaccounted for.
  r = await read({ ...REAL, cycleText: '44:56' });
  ok('no gap when the numbers reconcile', r.unaccountedHours == null, `${r.unaccountedHours}`);
  ok('and nothing is flagged', (r.disagreements || []).length === 0,
    (r.disagreements || []).join(' | '));

  head('18. A projection that disagrees with the day rows is called out');
  r = await read({
    ...REAL,
    recap: [
      { dayText: 'Day 17', hoursText: '00:25' },
      { dayText: 'Day 18', hoursText: '02:00' },   // rows say 05:34
      { dayText: 'Day 25', hoursText: '04:00' },   // no row accounts for this at all
    ],
  });
  const dis = (r.disagreements || []).join(' | ');
  ok('the mismatched boundary is named, with both figures',
    (r.disagreements || []).some((d) => /in 5 day\(s\)/i.test(d) && /5:34/.test(d) && /2:00/.test(d)),
    (r.disagreements || []).find((d) => /in 5 day/i.test(d)) || dis.slice(0, 200));
  ok('a projection row with no day behind it is dropped', /no\s+day row accounts for it/i.test(dis), '');
  ok('and the day rows win', r.recap.some((x) => x.inDays === 5 && near(x.hours, 5 + 34 / 60)),
    r.recap.map((x) => `${hhmm(x.hours)}/${x.inDays}d`).join(' '));
  ok('the bogus day-25 batch is not in what we use', !r.recap.some((x) => x.inDays === 12), '');

  head('19. No day rows at all falls back to the tracker projection');
  r = await read({ ...REAL, dailyTotals: [] });
  ok('it still produces recap', r.recap.length === 5, `${r.recap.length}`);
  ok('and says it came from the tracker', /projection table/i.test(r.recapSource || ''), r.recapSource);
  ok('with nothing derived', r.derived.length === 0, `${r.derived.length}`);

  head('20. The window length is the rule set, not a hard-coded 8');
  await api('/settings', 'POST', { ...(await api('/bootstrap')).settings,
    hos: { ...(await api('/bootstrap')).settings.hos, cycleDays: 7, cycleLimit: 60 } });
  r = await read(REAL);
  ok('day 13 now returns in 7 days', r.derived.some((x) => x.inDays === 7 && near(x.hours, 2.5)),
    r.derived.map((x) => `${hhmm(x.hours)}/${x.inDays}d`).join(' '));
  // Against a 60-hour limit, 35:18 left means only 24:42 used -- LESS than the 25:04 the rows account
  // for. That is the opposite complaint, and it gets the opposite message: the two disagree and the
  // clocks are the safer bet. Nothing is reported as "unaccounted", because nothing is missing.
  ok('no unaccounted hours when the rows exceed what was used', r.unaccountedHours == null,
    `${r.unaccountedHours}`);
  ok('but the contradiction is still raised',
    (r.disagreements || []).some((d) => /more than the .* your cycle says you have used/i.test(d)),
    (r.disagreements || []).join(' | ').slice(0, 160));
  ok('and it says which of the two to trust',
    (r.disagreements || []).some((d) => /clocks are the safer bet/i.test(d)), '');
  await api('/settings', 'POST', { ...(await api('/bootstrap')).settings,
    hos: { ...(await api('/bootstrap')).settings.hos, cycleDays: 8, cycleLimit: 70 } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
