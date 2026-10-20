/* Owner-Operator 0.9: brokers read the board and make the offer.
 *
 *   - the directory starts with the brokers who work home, at least three of them starter brokers
 *   - established and premium brokers will not take a new authority, and say what they want first
 *   - a starter broker offers from the bottom half of the board, below the game's pay, never past the skills
 *   - countering moves them toward a ceiling the page never sees; pushing too far ends the call
 *   - an argument that is not true is called out and earns nothing
 *   - taking it books the load: the board cleared, on the record, and one booking at a time
 *   - typed words work without a key: a figure is a counter
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5991}/api`;
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

const BOARD = [
  { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
  { cargo: 'Toys', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 760, deadlineHours: 30 },
  { cargo: 'Glass', destCity: 'Omaha', destState: 'NE', loadedMiles: 190, gameRevenue: 1150, deadlineHours: 30 },
  { cargo: 'Tires', destCity: 'Tulsa', destState: 'OK', loadedMiles: 250, gameRevenue: 980, deadlineHours: 30 },
  { cargo: 'Beans', destCity: 'Des Moines', destState: 'IA', loadedMiles: 195, gameRevenue: 1400, deadlineHours: 30 },
  { cargo: 'Pipes', destCity: 'Oklahoma City', destState: 'OK', loadedMiles: 350, gameRevenue: 1850, deadlineHours: 40 },
];

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'B. Roker', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 500, preset: 'Normal' });

  head('1. The directory');
  const dir = S.directory;
  const starters = dir.filter((b) => b.tier === 'Starter' && b.worksHere);
  ok('starter brokers work home', starters.length >= 3, `${starters.length}`);
  ok('they take a new authority', starters.every((b) => b.takesYou));
  const premium = dir.find((b) => b.tier === 'Premium' && b.worksHere);
  ok('a premium broker works home too, and will not take you yet', premium && !premium.takesYou && /loads/.test(premium.notYet), premium?.notYet);
  ok('only the home region is known yet', dir.every((b) => b.worksHere), dir.map((b) => b.regions[0]).join(','));
  ok('no margins or personalities on the page', !JSON.stringify(dir).match(/margin|personality|ceiling/i));

  head('2. A broker with no board to read');
  let r = await api('/calls', 'POST', { brokerId: starters[0].id });
  ok('asks for the board', r.call.status === 'Nothing' && /board/.test(r.call.turns[0].text), r.call.turns[0].text);

  head('3. Above your tier');
  r = await api('/calls', 'POST', { brokerId: premium.id });
  ok('a short no, in their voice, with what they want', r.call.status === 'NotYet' && /loads/.test(r.call.turns[0].text), r.call.turns[0].text);

  head('4. A starter broker reads the board');
  S = (await api('/board/add-many', 'POST', BOARD)).snapshot;
  const byValue = [...S.board].filter((v) => v.feasibility.verdict !== 'Infeasible').sort((a, b) => a.netPerDay - b.netPerDay);
  const bottomHalf = byValue.slice(0, Math.ceil(byValue.length / 2)).map((v) => v.load.id);
  r = await api('/calls', 'POST', { brokerId: starters[0].id });
  let call = r.call;
  ok('an offer is on the table', call.status === 'Open' && call.load && call.offer > 0, `${call.load?.cargo} ${call.offer}`);
  ok('from the bottom half of the board', bottomHalf.includes(call.load.id), `${call.load.cargo}; bottom half ${byValue.slice(0, bottomHalf.length).map((v) => v.load.cargo)}`);
  ok('below the game\'s pay, by a starter broker\'s margin', call.offer < call.gamePay * 0.9 && call.offer > call.gamePay * 0.5, `${call.offer} of ${call.gamePay}`);
  ok('the ceiling is never sent', !JSON.stringify(r).match(/ceiling/i));
  ok('the broker says who they are', /this is/.test(call.turns[0].text), call.turns[0].text);
  ok('no load past Long Distance 1 is offered', call.load.loadedMiles <= 400);

  head('5. A lie is called out');
  const tierOne = S.board.find((v) => v.load.id === call.load.id);
  const before = call.offer;
  r = await api(`/calls/${call.id}/say`, 'POST', { kind: 'counter', amount: before + 400, arguments: ['record'] });
  call = r.call;
  ok('claiming a record you do not have gets nothing', call.offer === before && /record/.test(call.turns.at(-1).text), call.turns.at(-1).text);

  head('6. Countering');
  if (call.status === 'Open') {
    r = await api(`/calls/${call.id}/say`, 'POST', { kind: 'counter', amount: Math.round(call.gamePay) });
    call = r.call;
    const moved = call.offer > before || /terms|quick pay|detention/i.test(call.turns.at(-1).text);
    ok('asking the full game pay moves them, or a broker who will not move on rate says so', moved || call.status !== 'Open',
      `${before} -> ${call.offer}: ${call.turns.at(-1).text}`);
    ok('but never to the game\'s pay', call.offer < call.gamePay);
    let rounds = 0;
    while (call.status === 'Open' && rounds < 8) {
      r = await api(`/calls/${call.id}/say`, 'POST', { kind: 'counter', amount: Math.round(call.gamePay) });
      call = r.call; rounds++;
    }
    ok('pushing past the ceiling ends the call', call.status === 'HungUp', `${call.status} after ${rounds} more`);
    ok('and the load is still on the board to try elsewhere', r.snapshot.board.some((v) => v.load.id === call.load.id));
  }

  head('7. Typed words, no key');
  r = await api('/calls', 'POST', { brokerId: starters[1].id });
  call = r.call;
  ok('the second broker makes an offer', call.status === 'Open', call.turns[0].text);
  const typed = Math.round(call.offer + 5);
  r = await api(`/calls/${call.id}/say`, 'POST', { text: `I can do it for $${typed}` });
  call = r.call;
  ok('a typed figure is read as a counter', call.turns.find((t) => t.who === 'you').amount === typed, JSON.stringify(call.turns.find((t) => t.who === 'you')));
  ok('and five dollars over is met', call.status === 'Booked', `${call.status}: ${call.turns.at(-1).text}`);

  head('8. Booked');
  S = r.snapshot;
  ok('the booking is the rate confirmation', S.booking && S.booking.rate === typed && S.booking.number === 'OO-001', JSON.stringify(S.booking && { n: S.booking.number, rate: S.booking.rate }));
  ok('the game\'s pay is kept beside it', S.booking.gamePay === call.gamePay);
  ok('the load is off the board', !S.board.some((v) => v.load.id === call.load.id));
  ok('and the board is cleared: it was this city\'s market, and the next one is read where the load ends', S.board.length === 0, `${S.board.length} left`);
  ok('the broker has learned something and so have you', S.directory.find((b) => b.id === starters[1].id).loadsBooked === 1
    && S.directory.find((b) => b.id === starters[1].id).notes.length > 0);
  ok('never above what the game pays', S.bookings.every((b) => b.rate <= b.gamePay), S.bookings.map((b) => `${b.rate}/${b.gamePay}`).join(' '));
  ok('one load at a time: mid-run, a call is about the next lane, and only from a stop',
    /Pull over/.test(await refused(() => api('/calls', 'POST', { brokerId: starters[2].id }))));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
