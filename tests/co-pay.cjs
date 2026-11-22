/* Coach Driver 0.1: pay. By the hour from book-on to book-off, with the trade's extras.
 *
 *   - night hours (22:00 to 06:00) at +25%, Sunday hours at +50%
 *   - a daily allowance over eight hours; the night allowance for a night away from home, hotel or depot rest room
 *   - tips on excursions, more for happier passengers, nothing under 60%
 *   - paid on Friday's payslip
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
const dayOf = (iso) => Math.floor((Date.parse(iso + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;
const plus = (iso, min) => new Date(Date.parse(iso + ':00Z') + min * 60000).toISOString().slice(0, 16);
const at = (iso, min = 0) => { const x = plus(iso, min); return { day: dayOf(x), time: x.slice(11, 16) }; };

async function run(job, { pct = 88, counts = [20, 15, 5, 0] } = {}) {
  let r = await api('/board/add', 'POST', { jobs: [job], replace: true });
  const pick = r.snapshot.board.offers.find((o) => o.assigned);
  if (!pick) throw new Error('nothing assigned: ' + JSON.stringify(r.snapshot.board.offers.map((o) => o.why)));
  r = await api('/duty/accept', 'POST', { offerId: pick.id });
  const s = r.snapshot.duty.stops;
  await api('/duty/depart', 'POST', { stop: 0, ...at(s[0].scheduledDepart), boarded: 40 });
  for (let i = 1; i < s.length; i++) {
    await api('/duty/arrive', 'POST', { stop: i, ...at(s[i].scheduledArrive), alighted: 0, pct, veryHappy: counts[0], happy: counts[1], unhappy: counts[2], veryUnhappy: counts[3] });
    if (i < s.length - 1) await api('/duty/depart', 'POST', { stop: i, ...at(s[i].scheduledDepart), boarded: 0 });
  }
  return api('/duty/close', 'POST', { damage: 0 });
}
const kinds = (co) => co.summary.find((s) => s.key === 'money').rows.map((r) => r.label);

(async () => {
  // A tour house: its probationary drivers run local excursions, so tips are in reach from the start.
  await api('/start', 'POST', { driverName: 'P. Ay', coachLevel: 1, skills: { passengerFavourite: 2 }, day: 1, time: '07:00',
    companyId: 'busabout', homeDepot: 'London|UK' });
  await api('/coach/bought', 'POST', {});

  head('1. An excursion: hours, and tips');
  let r = await run({ menu: 'Tourist', stops: [{ city: 'London', cc: 'UK', time: '09:30' }], landmark: 'Tower Bridge', landmarkScope: 'Local', passengers: 40 },
    { pct: 93 });
  let co = r.closeout;
  ok('the excursion closes, a round trip home', co.grade === 'Excellent' && r.snapshot.atHome, `${co.grade} ${r.snapshot.place}`);
  const tips = co.summary.find((s) => s.key === 'money').rows.find((x) => x.label === 'Tips');
  // 40 passengers x 1 x 1.5 (over 90%) x 1.2 (Passenger Favourite 2) = 72
  ok('tips: 40 passengers at 93%, with Passenger Favourite', tips && tips.value === '€72.00', tips && `${tips.value} ${tips.detail}`);
  ok('the hours at the rate', kinds(co).includes('Hours'));

  r = await run({ menu: 'Tourist', stops: [{ city: 'London', cc: 'UK', time: '10:00' }], landmark: 'Tower Bridge', landmarkScope: 'Local', passengers: 40 },
    { pct: 52, counts: [2, 10, 20, 2] });
  const noTips = r.closeout.summary.find((s) => s.key === 'money').rows.find((x) => x.label === 'Tips');
  ok('no tips from unhappy passengers', !noTips || noTips.value === '€0.00', noTips && noTips.detail);

  head('2. A night line: the night supplement, and the night allowance away');
  // A tour house runs no lines; join a mixed firm for this.
  r = await api('/jobs/apply', 'POST', { companyId: 'arriva-dk', homeDepot: 'København|DK' });
  let g = r.snapshot.gameTime;
  let d = at(g, 60), a = at(g, 60 + 14 * 60);
  await api('/position', 'POST', { damage: 0, city: 'København', cc: 'DK', departDay: d.day, departTime: d.time, arriveDay: a.day, arriveTime: a.time });
  await api('/coach/bought', 'POST', {});
  r = await run({ menu: 'Contract', stops: [{ city: 'København', cc: 'DK', time: '23:00' }, { city: 'Odense', cc: 'DK' }] });
  co = r.closeout;
  ok('night hours paid at +25%', kinds(co).includes('Night'), kinds(co).join(','));
  ok('away from home after it', !r.snapshot.atHome && r.snapshot.place === 'Odense, DK');
  g = r.snapshot.gameTime;
  r = await api('/clock', 'POST', at(g, 10 * 60));
  ok('a night\'s rest away: the night allowance, in a hotel', r.snapshot.pay.pending.some((l) => l.kind === 'Night away' && /hotel/.test(l.text)), r.said);

  head('3. Sunday');
  // Move on to the next Sunday morning, at Odense, and run a line home on it.
  const now = r.snapshot.gameTime;
  let day = dayOf(now);
  while ((day % 7) !== 0) day++;   // Day 1 is a Monday, so a day number divisible by 7 is a Sunday
  r = await api('/clock', 'POST', { day, time: '06:00' });
  r = await run({ menu: 'Contract', stops: [{ city: 'Odense', cc: 'DK', time: '08:00' }, { city: 'København', cc: 'DK' }] });
  ok('Sunday hours paid at +50%', kinds(r.closeout).includes('Sunday'), kinds(r.closeout).join(','));

  head('4. Friday\'s payslip');
  const pending = r.snapshot.pay.pendingTotal;
  let fri = dayOf(r.snapshot.gameTime);
  while ((fri % 7) !== 5) fri++;
  r = await api('/clock', 'POST', { day: fri, time: '19:00' });
  const slip = r.snapshot.pay.payslips[0];
  ok('a payslip on Friday evening, with everything owed', slip && Math.abs(slip.gross - pending) < 0.01 && r.snapshot.pay.pending.length === 0,
    slip && `${slip.number} ${slip.gross} vs ${pending}`);
  ok('every payslip is gross, line by line', slip.lines.length >= 3 && slip.lines.every((l) => l.text && l.amount !== undefined));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
