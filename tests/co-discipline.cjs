/* Coach Driver 0.1: the record. Happy passengers and kept timetables pay; unhappy ones and late coaches cost.
 *
 *   - a poor duty is a strike; three strikes are a step up the ladder
 *   - a bad duty is a step at once: verbal warning, written reprimand, final warning, dismissal
 *   - lateness the driver could not help is set aside; an early departure never is
 *   - on probation, a written reprimand ends it: not kept on, and that company will not take you back
 *   - ten clean duties step the record down
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5993}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const dayOf = (iso) => Math.floor((Date.parse(iso + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const plus = (iso, min) => new Date(Date.parse(iso + ':00Z') + min * 60000).toISOString().slice(0, 16);
const at = (iso, min = 0) => { const x = plus(iso, min); return { day: dayOf(x), time: x.slice(11, 16) }; };

const out = { menu: 'Contract', stops: [{ city: 'Paris', cc: 'FR', time: '09:00' }, { city: 'Lille', cc: 'FR' }] };
const home = { menu: 'Contract', stops: [{ city: 'Lille', cc: 'FR', time: '15:00' }, { city: 'Paris', cc: 'FR' }] };

/** One leg of the shuttle, run however it is told to, and closed. */
async function leg(job, { late = 0, early = 0, pct = 88, vu = 0, fault = 'Driver' } = {}) {
  let r = await api('/board/add', 'POST', { jobs: [job], replace: true });
  let pick = r.snapshot.board.offers.find((o) => o.assigned);
  // The weekly rest, when it falls due: taken as a driver would, then the board read again.
  if (!pick && r.snapshot.board.offers.some((o) => o.why.some((w) => /weekly rest/.test(w)))) {
    await api('/clock', 'POST', at(r.snapshot.gameTime, 46 * 60));
    r = await api('/board/add', 'POST', { jobs: [job], replace: true });
    pick = r.snapshot.board.offers.find((o) => o.assigned);
  }
  if (!pick) throw new Error('nothing assigned: ' + JSON.stringify(r.snapshot.board.offers.map((o) => o.why)));
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  const d = r.snapshot.duty;
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart, -early), boarded: 40 });
  await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive, late), alighted: 40, pct,
    veryHappy: 10, happy: 20, unhappy: 10 - vu > 0 ? 10 - vu : 0, veryUnhappy: vu });
  return api('/duty/close', 'POST', { damage: 0, fault });
}
/** There and back: two duties, ending at home. */
async function shuttle(opts = {}, backOpts = opts) { const a = await leg(out, opts); const b = await leg(home, backOpts); return [a, b]; }

(async () => {
  await api('/start', 'POST', { driverName: 'R. Ecord', coachLevel: 1, day: 1, time: '07:00', companyId: 'blablacar', homeDepot: 'Paris|FR' });
  await api('/coach/bought', 'POST', {});

  head('1. Lateness that was not the driver\'s');
  let [a] = await shuttle({ late: 25, fault: 'Road' }, {});
  ok('a stop 25 minutes late, put down to the road: not held against you', a.closeout.grade === 'Good' && a.snapshot.discipline.strikesSinceStep === 0,
    `${a.closeout.grade}, strikes ${a.snapshot.discipline.strikesSinceStep}`);
  ok('and said so', a.closeout.summary.find((s) => s.key === 'time').rows.some((r) => /not held against you/.test(r.detail)));

  head('2. Strikes to a warning');
  [a] = await shuttle({ late: 20 }, {});
  ok('a stop 20 minutes late on the driver: poor, a strike', a.closeout.grade === 'Poor' && a.snapshot.discipline.strikesSinceStep === 1);
  [a] = await shuttle({ pct: 55 }, {});
  ok('passengers at 55%: poor, a second strike', a.closeout.grade === 'Poor' && a.snapshot.discipline.strikesSinceStep === 2, a.closeout.headline);
  [a] = await shuttle({ vu: 3, pct: 75 }, {});
  ok('three very unhappy passengers: poor, the third strike, a verbal warning', a.closeout.grade === 'Poor' && a.snapshot.discipline.level === 1
    && a.closeout.notes.some((n) => /verbal warning/.test(n)), `level ${a.snapshot.discipline.level}: ${a.closeout.notes.join(' | ')}`);

  head('3. A bad duty on probation');
  a = await leg(out, { pct: 40 });
  const S = a.snapshot;
  ok('passengers at 40%: bad, a step at once to a written reprimand, and probation is over', a.closeout.grade === 'Bad' && S.job.status === 'Dismissed',
    `${a.closeout.grade}, status ${S.job.status}: ${a.closeout.notes.join(' | ')}`);
  ok('on the record as probation not passed', S.history.some((h) => h.ended === 'ProbationFailed'), JSON.stringify(S.history));
  ok('that company will not take you back', S.companies.find((c) => c.id === 'blablacar').whyNot.some((w) => /will not take you back/.test(w)));
  let why = null; try { await api('/board/add', 'POST', { jobs: [home], replace: true }); const b = await api('/bootstrap');
    if (b.board.offers.length) await api('/duty/accept', 'POST', { offerId: b.board.offers[0].id }); } catch (e) { why = e.message; }
  ok('no more duties for them', /not with a company/.test(why || ''), why);

  head('4. Another company, and a clean run');
  let r = await api('/jobs/apply', 'POST', { companyId: 'ecolines', homeDepot: 'Rīga|LV' });
  ok('a budget company takes the driver on', r.snapshot.job.status === 'Active' && r.snapshot.job.company.id === 'ecolines', r.said);
  ok('a fresh record with the new company', r.snapshot.discipline.level === 0);
  const g = r.snapshot.gameTime;
  const dep = at(g, 60), arr = at(g, 60 + 20 * 60);
  await api('/position', 'POST', { damage: 0, city: 'Rīga', cc: 'LV', departDay: dep.day, departTime: dep.time, arriveDay: arr.day, arriveTime: arr.time });
  // Six days worked since the career began: the weekly rest is due before anything else.
  const rest = at(plus(g, 60 + 20 * 60), 46 * 60);
  r = await api('/clock', 'POST', rest);
  ok('a weekly rest taken', /Weekly rest/.test(r.said), r.said);
  await api('/coach/bought', 'POST', {});
  const rigaOut = { menu: 'Contract', stops: [{ city: 'Rīga', cc: 'LV', time: '09:00' }, { city: 'Valmiera', cc: 'LV' }] };
  const rigaBack = { menu: 'Contract', stops: [{ city: 'Valmiera', cc: 'LV', time: '13:00' }, { city: 'Rīga', cc: 'LV' }] };
  await leg(rigaOut, { late: 20 });
  await leg(rigaBack, { late: 20 });
  r = await leg(rigaOut, { late: 20 });
  ok('three strikes with the new company: a verbal warning', r.snapshot.discipline.level === 1, r.snapshot.discipline.levelName);
  for (let i = 0; i < 10; i++) r = await leg(i % 2 === 0 ? rigaBack : rigaOut, { pct: 92 });
  ok('ten clean duties step it down', r.snapshot.discipline.level === 0
    && r.snapshot.discipline.entries.some((e) => e.kind === 'Stepped down'), r.snapshot.discipline.levelName);
  ok('excellent duties earn a duty bonus', r.snapshot.pay.pending.some((l) => l.kind === 'Duty bonus'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
