/* Owner-Operator 0.9: poor credit pays for the risk.
 *
 * Asked for from play: "so what would be the reason to even go to a D broker?" There was none: same margin, all the
 * risk. Now a C broker keeps four points less of the game's pay and a D nine, quick pay comes easier from them, and
 * the Brokers tab says what each grade means and how each broker has really paid you.
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

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'C. Redit', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  // Two jobs alike in every way that matters to the rate, so each call is priced on the same freight.
  const job = (cargo) => ({ cargo, destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 800, deadlineHours: 30 });
  await api('/board/add-many', 'POST', [job('Paper'), job('Boxes'), job('Cans')]);

  head('1. The same broker, B then D');
  S = await api('/test/broker', 'POST', { id: starter.id, credit: 'B', personality: 'Grinder' });
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  const atB = r.call.offer / r.call.gamePay;
  await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'decline' });
  S = await api('/test/broker', 'POST', { id: starter.id, credit: 'D', personality: 'Grinder' });
  r = await api('/calls', 'POST', { brokerId: starter.id });
  const atD = r.call.offer / r.call.gamePay;
  ok('a D broker offers a bigger share of the game\'s pay', atD - atB >= 0.07, `B ${(atB * 100).toFixed(1)}% -> D ${(atD * 100).toFixed(1)}%`);
  ok('never above the game\'s pay', r.call.offer <= r.call.gamePay);

  head('2. Quick pay comes easier from a D broker');
  // Wear their patience down asking for better: a B broker would not give terms now.
  for (let i = 0; i < 3; i++) r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'better' });
  ok('patience worn down, still on the line', r.call.status === 'Open', r.call.status);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'terms', term: 'quickpay' });
  ok('and the D broker still gives quick pay', r.call.quickPay === true, r.call.turns.at(-1).text);

  head('3. The Brokers tab says what credit means, and how they have paid');
  const d = r.snapshot.directory.find((b) => b.id === starter.id);
  ok('what D means, in words', /never paid|collections/.test(d.creditSays) && /quick pay/.test(d.creditSays), d.creditSays);
  ok('a payment record, empty to start', d.payRecord && d.payRecord.invoices === 0, JSON.stringify(d.payRecord));
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '07:30', odometer: 5001 });
  r = await api('/deliver', 'POST', { day: 3, time: '12:00', odometer: 5201, driveRemaining: 8, shiftRemaining: 9, breakRemaining: 5, cycleRemaining: 60 });
  const after = r.snapshot.directory.find((b) => b.id === starter.id);
  ok('the invoice shows on their record', after.payRecord.invoices === 1 && after.payRecord.open === 1, JSON.stringify(after.payRecord));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
