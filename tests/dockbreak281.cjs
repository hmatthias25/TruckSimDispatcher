/* Dock time as the break (reported from play: a plan that sent the driver on a break minutes after an hour at
 * the dock). FMCSA since 2020: any 30 consecutive minutes not driving satisfies the 30-minute break, on duty at
 * the dock included — so on ATS an hour at the dock is the break whatever the trailer. (The EU side, where only
 * a dock that does the work counts, is in hoseu270.)
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5981}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };

(async () => {
  const app = { driverName: 'D. Check', preferredDivision: 'Dry Van', transmissionPreference: 'either', experienceYears: 6, acceptsProbation: true,
    homeCity: 'Springfield', homeState: 'MO', homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-08T06:00' });
  // 1:30 of driving left before the break, an hour's empty run, an hour at the dock, four hours loaded.
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 1.5, cycleRemaining: 60, asOfGameTime: '2000-01-08T06:00' });
  for (const trailer of ['Dry Van', 'Flatbed']) {
    const p = await api('/hos/plan', 'POST', { deadlineHours: 40, loadingHours: 1, unloadingHours: 1, trailerType: trailer, usableFuelRangeMiles: 99999,
      startGameTime: '2000-01-08T06:00', deadheadMiles: 50, loadedMiles: 220 });
    const tl = p.timeline || [];
    ok(`${trailer}: the hour at the dock counts as the 30-minute break`, tl.some((t) => /counts as your 30-minute break/.test(t.label)),
      tl.map((t) => t.label).join(' | ').slice(0, 220));
    ok(`${trailer}: so no break is planned a few minutes after it`, !tl.some((t) => t.kind === 'Break'), tl.filter((t) => t.kind === 'Break').map((t) => t.label).join(', '));
  }
  // With the break switched off in Settings, nothing is said about it.
  const st = (await api('/bootstrap')).settings;
  await api('/settings', 'POST', { ...st, hos: { ...st.hos, requireBreak: false } });
  const off = await api('/hos/plan', 'POST', { deadlineHours: 40, loadingHours: 1, unloadingHours: 1, trailerType: 'Dry Van', usableFuelRangeMiles: 99999,
    startGameTime: '2000-01-08T06:00', deadheadMiles: 50, loadedMiles: 220 });
  ok('with the break switched off, the dock is not called a break', !(off.timeline || []).some((t) => /counts as your/.test(t.label)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
