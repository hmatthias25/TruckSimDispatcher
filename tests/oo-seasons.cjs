/* Owner-Operator 0.9: freight by the season, region by region. Asked for from play: "should we make freight demand seasonal?
 * ... should probably be regional", and "let the user know in the app what is going on demand wise".
 *
 *   - the same reefer job out of Kansas City, offered by the same broker: more in April (produce season in the Plains) than
 *     in January, never above what the game pays
 *   - the board says so on the job, and the "where the freight is" table shows the month and what is coming
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5987}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const REEFER = { cargo: 'Lettuce', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 600, deadlineHours: 30, trailerType: 'Reefer' };

async function offerOn(day) {
  // At home throughout, so home life stays out of it.
  await api('/test/home', 'POST', { score: 100 });
  let S = await api('/status', 'POST', { day, time: '08:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/clear', 'POST');
  S = (await api('/board/add-many', 'POST', [REEFER])).snapshot;
  const b = S.directory.find((x) => x.tier === 'Starter' && x.worksHere && x.takesYou && x.specialty === 'General');
  const r = await api('/calls', 'POST', { brokerId: b.id });
  await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'decline' });
  return { S, r, b };
}

(async () => {
  await api('/start', 'POST', { game: 'ATS', driverName: 'S. Eason', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '08:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 0, preset: 'Normal', startMonth: 1 });

  head('1. January and April, the same job, the same broker');
  const jan = await offerOn(5);
  const apr = await offerOn(100);   // Day 100 of a January start is 9 April
  ok('the calendar says April', apr.S.status.monthDay.startsWith('Apr'), apr.S.status.monthDay);
  ok('the same broker both times', jan.b.id === apr.b.id);
  ok('produce season: more for the same reefer job', apr.r.call.offer > jan.r.call.offer, `Jan ${jan.r.call.offer} -> Apr ${apr.r.call.offer}`);
  ok('never above what the game pays', apr.r.call.offer <= REEFER.gameRevenue);
  ok('and the broker says why', /busy this time of year/.test(apr.r.call.turns[0].text), apr.r.call.turns[0].text);

  head('2. The app says so');
  const note = apr.S.board[0].notes.find((n) => /season/.test(n));
  ok('on the job: busy season for produce out of the Plains', /Busy season for produce on reefers out of the Plains & Southwest/.test(note || ''), note);
  const t = apr.S.seasonTable;
  const ri = t.regions.indexOf('Plains & Southwest'), ki = t.kinds.indexOf('Produce');
  ok('the table: April, May, June', t.months.join(',') === '4,5,6', t.months.join(','));
  ok('produce in the Plains at its peak in April', t.index[0][ri][ki] >= 1.25, `${t.index[0][ri][ki]}`);
  ok('and the line on the board names it', apr.S.seasons.some((x) => x.kind === 'Produce' && x.region === 'Plains & Southwest' && x.busy));
  ok('the region you are in is known', apr.S.status.region === 'Plains & Southwest', apr.S.status.region);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
