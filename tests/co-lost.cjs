/* Coach Driver 0.1: a duty the game lost.
 *
 *   - an assignment not started is handed back, nothing more
 *   - a duty under way that the game lost (a crash, a reload, the job dropped) is given up with nothing on the record
 *   - the time worked until then is paid, the leg on the road counts as driving, and the coach's damage is read
 *   - the clock moves to when it was lost; the coach is left at the last stop on the books, to be positioned from
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
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

const FR = { city: 'Frankfurt am Main', cc: 'DE' };
const stuttgart = { menu: 'Contract', stopCount: 3, stops: [{ ...FR, time: '08:00' }, { city: 'Mannheim', cc: 'DE' }, { city: 'Stuttgart', cc: 'DE' }], passengers: 40 };

(async () => {
  await api('/start', 'POST', { driverName: 'L. Ost', coachLevel: 1, day: 1, time: '06:00', companyId: 'blablacar', homeDepot: 'Frankfurt am Main|DE' });
  await api('/coach/bought', 'POST', {});
  await api('/test/rank', 'POST', { rank: 2, probation: false });

  head('1. Not started: handed back');
  let r = await api('/board/add', 'POST', { jobs: [stuttgart], replace: true });
  r = await api('/duty/accept', 'POST', { offerId: r.snapshot.board.offers.find((o) => o.assigned).id });
  r = await api('/duty/handback', 'POST', { why: 'gone from the menu' });
  ok('handed back, nothing more', !r.snapshot.duty && /Nothing goes on your record/.test(r.said), r.said);
  ok('no pay for a duty never started', r.snapshot.pay.pending.length === 0);

  head('2. Lost on the road');
  r = await api('/board/add', 'POST', { jobs: [stuttgart], replace: true });
  r = await api('/duty/accept', 'POST', { offerId: r.snapshot.board.offers.find((o) => o.assigned).id });
  const d = r.snapshot.duty;
  await api('/duty/depart', 'POST', { stop: 0, ...at(d.stops[0].scheduledDepart), boarded: 40 });
  await api('/duty/arrive', 'POST', { stop: 1, ...at(d.stops[1].scheduledArrive), alighted: 5, pct: 90, veryHappy: 30, happy: 5, unhappy: 0, veryUnhappy: 0 });
  r = await api('/duty/depart', 'POST', { stop: 1, ...at(d.stops[1].scheduledDepart), boarded: 3 });
  const before = r.snapshot.hours.driveLeft;
  const kmBefore = r.snapshot.coach.km;
  const lost = at(d.stops[1].scheduledDepart, 40);
  let why = await refused(() => api('/duty/handback', 'POST', { why: 'crashed to desktop', ...lost }));
  ok('the coach\'s damage is read, as after any run', /damage as the game shows/.test(why || ''), why);
  r = await api('/duty/handback', 'POST', { why: 'crashed to desktop', ...lost, damage: 2, damageCause: 'Game' });
  ok('given up: no duty open, nothing on the record', !r.snapshot.duty && r.snapshot.discipline.entries.length === 0 && /Nothing goes on your record/.test(r.said), r.said);
  const worked = (ms(d.stops[1].scheduledDepart) + 40 * 60000 - ms(d.stops[0].scheduledDepart)) / 3600000 + 0.25;
  const paid = r.snapshot.pay.pending.find((l) => /worked until the game lost it/.test(l.text));
  ok('the time worked is paid', paid && paid.amount > 0 && paid.text.includes(`${Math.floor(worked)}:`), paid && `${paid.text} (expected ${worked.toFixed(2)} h)`);
  ok('the leg on the road counts as driving', Math.abs(before - r.snapshot.hours.driveLeft - 40 / 60) < 0.05, `${(before - r.snapshot.hours.driveLeft).toFixed(2)} h`);
  ok('the clock is where it was lost', r.snapshot.gameTime.endsWith(lost.time), r.snapshot.gameTime);
  ok('the damage is on the coach, the game\'s doing', r.snapshot.coach.damagePct === 2 && r.snapshot.coach.entries[0].cause === 'Game');
  ok('the leg finished goes on the books, the one lost does not', r.snapshot.coach.km - kmBefore > 40 && r.snapshot.coach.km - kmBefore < 150, `${r.snapshot.coach.km - kmBefore} km`);
  ok('told to position from the last stop', /positioning run/.test(r.said) && r.snapshot.place === 'Mannheim, DE', `${r.snapshot.place}: ${r.said}`);
  ok('not counted as a duty done', r.snapshot.record.duties === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
