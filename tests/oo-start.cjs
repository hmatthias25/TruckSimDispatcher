/* Owner-Operator 0.9: the first screen, and the board ranked by what a load leaves.
 *
 *   - the first screen builds a career: home garage, the truck there, power-only, full clocks, home discovered
 *   - a city the game does not have, or no clock, is refused and said
 *   - the board ranks by verdict, then by what a load leaves per day after the cost per mile
 *   - Long Distance and the other skills are checked against each load, against editable limits
 *   - moving town clears the board, and the key is never sent back
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5990}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };

(async () => {
  head('1. Before the first screen');
  let S = await api('/bootstrap');
  ok('not started, version 0.9', S.started === false && S.version === '0.9', `${S.started} ${S.version}`);
  ok('the board is refused until then', (await refused(() => api('/board/add-many', 'POST', [{ cargo: 'x' }]))).length > 0);
  const cities = await api('/cities');
  ok('the home picker has the game\'s cities', cities.length > 100 && cities.some((c) => c.city === 'Kansas City'), `${cities.length}`);

  head('2. The first screen');
  const base = { game: 'ATS', driverName: 'O. Operator', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '08:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1234, preset: 'Normal' };
  ok('a city the game does not have is refused', /not a city I know/.test(await refused(() => api('/start', 'POST', { ...base, homeCity: 'Atlantis' }))));
  ok('ETS2 is not yet', /American Truck Simulator/.test(await refused(() => api('/start', 'POST', { ...base, game: 'ETS2' }))));
  ok('no day is refused', /day number/.test(await refused(() => api('/start', 'POST', { ...base, day: 0 }))));
  S = await api('/start', 'POST', base);
  ok('started', S.started === true);
  ok('the truck is at home', S.status.city === 'Kansas City' && S.status.state === 'KS', `${S.status.city}, ${S.status.state}`);
  ok('on the game clock', S.status.day === 1 && /08:00/.test(S.status.gameTime), S.status.gameTime);
  ok('with the odometer', S.status.odometer === 1234);
  ok('rested', S.hos.drive === 11 && S.hos.shift === 14 && S.hos.cycle === 70, JSON.stringify(S.hos));
  ok('an older truck on Normal', S.truck && S.truck.year < 2016, JSON.stringify(S.truck));
  ok('Long Distance 1 is 400 mi', S.settings.longDistanceLimit === 400, `${S.settings.longDistanceLimit}`);
  ok('it cannot be started twice', /already started/.test(await refused(() => api('/start', 'POST', base))));

  head('3. The board, ranked by what a load leaves');
  let r = await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 900, deadlineHours: 20 },
    { cargo: 'Toys', destCity: 'Saint Louis', destState: 'MO', loadedMiles: 250, gameRevenue: 1400, deadlineHours: 20 },
    { cargo: 'Steel', destCity: 'Denver', destState: 'CO', loadedMiles: 600, gameRevenue: 2600, deadlineHours: 2 },
  ]);
  S = r.snapshot;
  ok('three on the board', S.board.length === 3 && r.added === 3, `${S.board.length}`);
  const [a, b, c] = S.board;
  ok('the one that cannot make its window is last', c.load.cargo === 'Steel' && c.feasibility.verdict === 'Infeasible', `${c.load.cargo} ${c.feasibility.verdict}`);
  ok('the better payer per day first', a.load.cargo === 'Toys' && b.load.cargo === 'Paper', S.board.map((v) => v.load.cargo).join(','));
  ok('cost is the cost per mile times the miles', Math.abs(a.cost - 1.70 * a.miles) < 0.05, `${a.cost} vs ${a.miles}`);
  ok('what it leaves is pay less cost', Math.abs(a.netAtGamePay - (a.gamePay - a.cost)) < 0.01);
  ok('and per day over the time it ties the truck up', a.days > 0 && Math.abs(a.netPerDay - a.netAtGamePay / a.days) < 1, `${a.netPerDay} over ${a.days}`);
  ok('never less than half a day, however short the hop', a.days === 0.5 && a.feasibility.elapsedHours < 12, `${a.days} for ${a.feasibility.elapsedHours} h`);

  head('4. Skills');
  ok('600 mi at Long Distance 1 is said', c.skillNotes.some((n) => /Long Distance 1/.test(n)), c.skillNotes.join(' | '));
  ok('200 mi is not', a.skillNotes.length === 0 && b.skillNotes.length === 0);
  S = await api('/settings', 'POST', { longDistanceLimits: [250, 700, 650, 1000, 1600, 2500, null] });
  ok('a modded limit is honoured', S.settings.longDistanceLimit === 700 && !S.board.find((v) => v.load.cargo === 'Steel').skillNotes.some((n) => /Long Distance/.test(n)));
  S = await api('/settings', 'POST', { resetLongDistance: true });
  ok('and set back', S.settings.longDistanceLimit === 400);
  r = await api('/board/add-many', 'POST', [{ cargo: 'Acid', destCity: 'Topeka', destState: 'KS', loadedMiles: 60, gameRevenue: 500, deadlineHours: 10, isHazmat: true, hazmatClass: 'Corrosive' }]);
  const acid = r.snapshot.board.find((v) => v.load.cargo === 'Acid');
  ok('hazmat without ADR is said', acid.skillNotes.some((n) => /ADR/.test(n)), acid.skillNotes.join(' | '));
  S = await api('/settings', 'POST', { skills: { longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: ['Corrosive'] } });
  ok('and not once the class is unlocked', !S.board.find((v) => v.load.cargo === 'Acid').skillNotes.length);

  head('5. Costs and the key');
  S = await api('/settings', 'POST', { costPerMile: 2.10, anthropicApiKey: 'sk-ant-test-not-real' });
  ok('the cost per mile moves every figure', Math.abs(S.board[0].cost - 2.10 * S.board[0].miles) < 0.05);
  ok('the key is kept and never sent back', S.settings.hasApiKey === true && !JSON.stringify(S).includes('sk-ant-test'));

  head('6. Moving town clears the board');
  S = await api('/status', 'POST', { locationCity: 'Wichita', locationState: 'KS', day: 1, time: '14:00' });
  ok('cleared', S.board.length === 0, `${S.board.length}`);
  ok('and the town is discovered', S.status.city === 'Wichita');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
