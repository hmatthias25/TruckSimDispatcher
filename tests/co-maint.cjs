/* Coach Driver 0.1: the coach's condition, held to the Dispatcher's damage rules.
 *
 *   - the damage is read after every run, a duty or an empty one; what the run caused is after less before
 *   - the bands: under 5% nothing, 5% worth a look at the next depot, 10% no passengers beyond the run home,
 *     15% no passengers at all, 30% out of service; home is the shop while the coach is fit to get there
 *   - what the driver caused is graded as the Dispatcher grades an incident; another road user's doing costs nothing
 *   - a repair anywhere, in the shop for hours; the service and the inspections only in the company's garage
 *   - the service by distance and the safety inspection by date; past an inspection the coach carries nobody
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5999}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const ms = (iso) => Date.parse(iso + ':00Z');
const at = (iso, min = 0) => { const x = new Date(ms(iso) + min * 60000).toISOString().slice(0, 16);
  return { day: Math.floor((ms(x) - Date.UTC(2000, 0, 1)) / 86400000) + 1, time: x.slice(11, 16) }; };
const sec = (co, key) => co.summary.find((s) => s.key === key);
const row = (co, key, label) => (sec(co, key)?.rows || []).find((r) => r.label === label);

const FR = { city: 'Frankfurt am Main', cc: 'DE' }, MA = { city: 'Mannheim', cc: 'DE' }, KO = { city: 'Köln', cc: 'DE' };
const line = (from, to, time) => ({ menu: 'Contract', stopCount: 2, stops: [{ ...from, time }, { ...to }], passengers: 40 });
const fm = line(FR, MA, '08:00'), mf = line(MA, FR, '11:00'), mk = line(MA, KO, '12:30');

/** The board read in; the company's pick, waiting out a rest if the hours want one. */
async function board(jobs) {
  let r;
  for (const wait of [0, 12 * 60, 48 * 60]) {
    if (wait) await api('/clock', 'POST', at(r.snapshot.gameTime, wait));
    r = await api('/board/add', 'POST', { jobs, replace: true });
    if (r.snapshot.board.offers.some((o) => o.assigned)) break;
  }
  return r.snapshot;
}
/** A duty run stop by stop, closed with the damage given. */
async function run(d, close) {
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 40 });
  await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), alighted: 40, pct: 92, veryHappy: 30, happy: 10, unhappy: 0, veryUnhappy: 0 });
  return api('/duty/close', 'POST', close);
}
async function take(jobs, close) {
  const S = await board(jobs);
  const pick = S.board.offers.find((o) => o.assigned);
  const r = await api('/duty/accept', 'POST', { offerId: pick.id });
  return run(r.snapshot.duty, close);
}

(async () => {
  await api('/start', 'POST', { driverName: 'M. Aint', coachLevel: 10, skills: { demandingTimetables: 2, longerDuties: 3 }, day: 1, time: '06:00',
    companyId: 'flixbus', homeDepot: 'Frankfurt am Main|DE' });
  let r = await api('/coach/bought', 'POST', {});
  await api('/test/rank', 'POST', { rank: 3, probation: false });
  ok('a new coach: nothing on it, inspected the day it was bought', r.coach.damagePct === 0 && r.coach.checks.every((k) => k.status === 'Ok'),
    r.coach.checks.map((k) => `${k.kind} ${k.status}`).join(', '));

  head('1. Read after every run');
  let S = await board([fm, mf]);
  let pick = S.board.offers.find((o) => o.assigned);
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  let d = r.snapshot.duty;
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 40 });
  await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), alighted: 40, pct: 92, veryHappy: 30, happy: 10, unhappy: 0, veryUnhappy: 0 });
  let why = await refused(() => api('/duty/close', 'POST', {}));
  ok('a duty does not close without the damage', /damage as the game shows/.test(why || ''), why);
  r = await api('/duty/close', 'POST', { damage: 0.4 });
  let co = r.closeout;
  ok('a scuff under 1% is nothing: still excellent', co.grade === 'Excellent', co.grade);
  ok('the close-out has the coach: the damage, and what the company says', row(co, 'coach', 'Damage')?.value === '0.4%'
    && /monitor only/.test(row(co, 'coach', 'The company says')?.value || ''), JSON.stringify(sec(co, 'coach')?.rows.map((x) => `${x.label}: ${x.value}`)));
  ok('the distance goes on the books', r.snapshot.coach.km > 50, `${r.snapshot.coach.km} km`);

  head('2. Damage the driver caused');
  r = await take([mf], { damage: 3.4 });
  co = r.closeout;
  ok('3% of your doing: minor, so good, not excellent', co.grade === 'Good' && row(co, 'coach', 'Caused by')?.value === 'You' && /Minor/.test(row(co, 'coach', 'Caused by')?.detail),
    `${co.grade}; ${JSON.stringify(row(co, 'coach', 'Caused by'))}`);
  ok('no duty bonus for it', !sec(co, 'money').rows.some((x) => x.label === 'Duty bonus'));

  head('3. Worth a look: 5%');
  r = await take([fm], { damage: 6.4, damageCause: 'Other' });
  co = r.closeout;
  ok('another road user\'s doing costs nothing', co.grade === 'Excellent' && /not held against you/.test(row(co, 'coach', 'Caused by')?.detail || ''), co.grade);
  ok('at 6.4% it is worth a look at the next depot, not a trip', r.snapshot.coach.band === 'Watch' && co.notes.some((n) => /next time it stands at a depot/.test(n)), co.notes.join(' | '));
  S = await board([mf, mk]);
  const home = S.board.offers.find((o) => o.to === 'Frankfurt am Main, DE');
  ok('work goes on, and the company leans toward a line ending at a garage', S.board.offers.find((o) => o.to === 'Cologne, DE')?.ok && home.reasons.some((x) => /can be seen to/.test(x)),
    home.reasons.join(' | '));

  head('4. The shop line: 10%');
  r = await api('/coach/damage', 'POST', { damage: 12, cause: 'Other' });
  ok('a reading put right', r.snapshot.coach.damagePct === 12 && r.snapshot.coach.band === 'RunHome', r.snapshot.coach.headline);
  S = await board([mf, mk]);
  const cologne = S.board.offers.find((o) => o.to === 'Cologne, DE');
  const back = S.board.offers.find((o) => o.to === 'Frankfurt am Main, DE');
  ok('no passengers anywhere else', !cologne.ok && cologne.why.some((x) => /only a line that ends there/.test(x)), cologne.why.join(' | '));
  ok('but the line home carries them: a paying run home', back.ok && back.assigned, back.why.join(' | '));
  r = await api('/duty/accept', 'POST', { offerId: back.id });
  r = await run(r.snapshot.duty, { damage: 12 });
  ok('home, and the company says: repaired here before the next duty', r.snapshot.coach.band === 'Repair' && /no more passenger work/.test(r.snapshot.coach.headline), r.snapshot.coach.headline);
  S = await board([fm]);
  ok('nothing assigned until it is fixed', !S.board.offers[0].ok, S.board.offers[0].why.join(' | '));

  head('5. In the shop');
  const went = S.gameTime;
  r = await api('/coach/maintenance', 'POST', { kinds: ['Repair'], damageAfter: 0, cost: 2400 });
  ok('repaired in our own garage, with the time in the shop', /Repaired at your home depot/.test(r.said) && r.snapshot.coach.damagePct === 0 && r.snapshot.coach.inShopUntil, r.said);
  const hours = (ms(r.snapshot.coach.inShopUntil) - ms(went)) / 3600000;
  ok('8 hours in plus 0.9 a point, a third off in our own garage', Math.abs(hours - (8 + 12 * 0.9) * 0.7) < 0.1, `${hours.toFixed(2)} h`);
  const soon = at(went, 120).time, later = at(r.snapshot.coach.inShopUntil, 60).time;
  S = (await api('/board/add', 'POST', { jobs: [line(FR, MA, soon), line(FR, MA, later)], replace: true })).snapshot;
  const early = S.board.offers.find((o) => o.departs.endsWith(soon));
  ok('a duty booking on before it is out is not for this coach', !early.ok && early.why.some((x) => /in the shop until/.test(x)), early.why.join(' | '));
  ok('one after it is', S.board.offers.find((o) => o.departs.endsWith(later))?.ok, S.board.offers.map((o) => `${o.departs} ${o.why.join(' ')}`).join(' | '));
  why = await refused(() => api('/position', 'POST', { city: 'Mannheim', cc: 'DE', departDay: at(went, 30).day, departTime: at(went, 30).time, arriveDay: at(went, 90).day, arriveTime: at(went, 90).time, damage: 0 }));
  ok('nor does it drive anywhere while it is in the shop', /in the shop until/.test(why || ''), why);

  head('6. Further up: 15%, 20%, 30%');
  const g = r.snapshot.coach.inShopUntil;
  why = await refused(() => api('/position', 'POST', { city: 'Mannheim', cc: 'DE', departDay: at(g, 10).day, departTime: at(g, 10).time, arriveDay: at(g, 70).day, arriveTime: at(g, 70).time }));
  ok('an empty run needs the damage too', /damage as the game shows/.test(why || ''), why);
  r = await api('/position', 'POST', { city: 'Mannheim', cc: 'DE', departDay: at(g, 10).day, departTime: at(g, 10).time, arriveDay: at(g, 70).day, arriveTime: at(g, 70).time, damage: 0 });
  r = await api('/coach/damage', 'POST', { damage: 16, cause: 'Other' });
  ok('16%: run home, but empty: nobody rides in it until it is looked at', r.snapshot.coach.band === 'RunHome' && r.snapshot.coach.noPassengers && !r.snapshot.coach.onlyHome,
    r.snapshot.coach.lines.join(' | '));
  S = await board([mf]);
  ok('so not even the line home', !S.board.offers[0].ok, S.board.offers[0].why.join(' | '));
  r = await api('/coach/damage', 'POST', { damage: 22, cause: 'Other' });
  ok('22%: past the run-home cap, the nearest shop', r.snapshot.coach.band === 'NearestShop' && /Nearest shop/.test(r.snapshot.coach.headline), r.snapshot.coach.headline);
  r = await api('/coach/damage', 'POST', { damage: 31, cause: 'Other' });
  ok('31%: out of service', r.snapshot.coach.band === 'OutOfService', r.snapshot.coach.headline);
  why = await refused(() => api('/coach/maintenance', 'POST', { kinds: ['Service'] }));
  ok('the service is not done in a shop on the road', /own garage/.test(why || ''), why);
  const roadAt = r.snapshot.gameTime;
  r = await api('/coach/maintenance', 'POST', { kinds: ['Repair'], damageAfter: 0 });
  const roadHours = (ms(r.snapshot.coach.inShopUntil) - ms(roadAt)) / 3600000;
  ok('a repair on the road: a shop in Mannheim, at the full time', /a shop in Mannheim/.test(r.said) && Math.abs(roadHours - (8 + 31 * 0.9)) < 0.1, `${r.said} (${roadHours.toFixed(1)} h)`);
  await api('/clock', 'POST', at(r.snapshot.coach.inShopUntil, 60));

  head('7. Damage you caused, by size');
  r = await take([mf], { damage: 8 });
  ok('8% of yours: moderate, a poor duty and a strike', r.closeout.grade === 'Poor' && r.snapshot.discipline.strikesSinceStep === 1, `${r.closeout.grade}: ${r.closeout.headline}`);
  ok('said in the grade', /coach damaged 8%/.test(r.closeout.headline), r.closeout.headline);
  await api('/coach/maintenance', 'POST', { kinds: ['Repair'], damageAfter: 0 });
  await api('/clock', 'POST', at((await api('/bootstrap')).coach.inShopUntil, 30));
  r = await take([fm], { damage: 18 });
  ok('18%: serious, a bad duty and a step up the ladder', r.closeout.grade === 'Bad' && r.snapshot.discipline.level === 1, `${r.closeout.grade}, level ${r.snapshot.discipline.level}`);
  await api('/coach/maintenance', 'POST', { kinds: ['Repair'], damageAfter: 0 });
  await api('/clock', 'POST', at((await api('/bootstrap')).coach.inShopUntil, 30));
  await api('/test/rank', 'POST', { level: 0 });
  r = await take([mf], { damage: 27 });
  ok('27%: major, a final warning at once', r.closeout.grade === 'Bad' && r.snapshot.discipline.level === 3 && r.snapshot.job.status === 'Active',
    `level ${r.snapshot.discipline.level}: ${r.closeout.notes.join(' | ')}`);
  await api('/coach/maintenance', 'POST', { kinds: ['Repair'], damageAfter: 0 });
  await api('/clock', 'POST', at((await api('/bootstrap')).coach.inShopUntil, 30));
  await api('/test/rank', 'POST', { level: 0 });

  head('8. The service, by distance');
  await api('/test/coach', 'POST', { km: 36500 });
  S = await board([fm]);
  let svc = S.coach.checks.find((k) => k.kind === 'Service');
  ok('within a tenth of the interval: soon', svc.status === 'Soon', svc.text);
  await api('/test/coach', 'POST', { km: 44500 });
  S = await board([fm]);
  svc = S.coach.checks.find((k) => k.kind === 'Service');
  ok('a tenth past it: overdue, and only work that ends at a garage of ours', svc.status === 'Overdue' && !S.board.offers[0].ok && S.board.offers[0].why.some((x) => /service is .* overdue/.test(x)),
    S.board.offers[0].why.join(' | '));
  r = await api('/coach/maintenance', 'POST', { kinds: ['Service'] });
  svc = r.snapshot.coach.checks.find((k) => k.kind === 'Service');
  ok('serviced at home: the next one 40,000 km on', svc.status === 'Ok' && Math.round(svc.kmLeft) === 40000, `${r.said} ${svc.text}`);
  await api('/clock', 'POST', at(r.snapshot.coach.inShopUntil, 30));

  head('9. The safety inspection, by date');
  await api('/test/coach', 'POST', { inspectionDaysAgo: 40 });
  S = await board([fm]);
  let insp = S.coach.checks.find((k) => k.kind === 'Inspection');
  ok('due in two days: soon, and the company leans home for it', insp.status === 'Soon', insp.text);
  await api('/test/coach', 'POST', { inspectionDaysAgo: 43 });
  S = await board([fm]);
  insp = S.coach.checks.find((k) => k.kind === 'Inspection');
  ok('past it: the coach carries nobody', insp.status === 'Overdue' && !S.board.offers[0].ok && S.board.offers[0].why.some((x) => /carries nobody/.test(x)),
    S.board.offers[0].why.join(' | '));
  r = await api('/coach/maintenance', 'POST', { kinds: ['Inspection'] });
  ok('inspected in our garage: back to work after it', r.snapshot.coach.checks.find((k) => k.kind === 'Inspection').status === 'Ok', r.said);
  ok('every visit is in the coach\'s log', ['Repair', 'Service', 'Inspection'].every((k) => r.snapshot.coach.entries.some((e) => e.kind === k)));

  head('10. On probation, a major one ends it');
  await api('/reset', 'POST', { confirm: 'RESET' });
  await api('/start', 'POST', { driverName: 'P. Robe', coachLevel: 1, day: 1, time: '06:00', companyId: 'blablacar', homeDepot: 'Frankfurt am Main|DE' });
  await api('/coach/bought', 'POST', {});
  r = await take([fm], { damage: 30 });
  ok('30% on probation: let go', r.snapshot.job.status !== 'Active' && r.closeout.notes.some((n) => /let you go/.test(n)), r.closeout.notes.join(' | '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
