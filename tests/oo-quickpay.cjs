/* Owner-Operator 0.91: terms, as they work in the trade.
 *
 * Decided 2026-10-22, from play: quick pay is chosen on the invoice after delivery, like factoring, not agreed on the call;
 * and detention is on every rate con at the broker's rate, not negotiated (asking for it kept getting it refused). On the
 * call, asking about either costs no patience: the broker says how it works, and the price is worked as any other.
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
const refused = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message || 'refused'; } };
const CLOCKS = { driveRemaining: 9, shiftRemaining: 11, breakRemaining: 6, cycleRemaining: 55 };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'T. Erms', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);

  head('1. On the call: asking costs nothing, and the broker says how terms work');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  const patience = r.call.mood;
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'terms', term: 'quickpay' });
  ok('quick pay: chosen on the invoice, the fee said', /when you send the paperwork in/.test(r.call.turns.at(-1).text) && new RegExp(`${starter.quickPayFeePct}%`).test(r.call.turns.at(-1).text), r.call.turns.at(-1).text);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'terms', term: 'detention' });
  ok('detention: on every rate con, at the starter rate', /on every rate con/.test(r.call.turns.at(-1).text) && /\$25/.test(r.call.turns.at(-1).text), r.call.turns.at(-1).text);
  ok('and no patience spent asking', r.call.mood === patience && r.call.status === 'Open', `${patience} -> ${r.call.mood}`);
  ok('the call says both, before you take it', r.call.detentionRate === 25 && r.call.quickPayFeePct === starter.quickPayFeePct);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { text: `I want $${r.call.offer} and quick pay` });
  const k = r.snapshot.booking;
  ok('a price with quick pay: booked at the price, on the broker\'s terms', r.call.status === 'Booked' && !k.quickPay && k.daysToPay > 2, `${r.call.status} ${k && k.daysToPay}`);
  ok('detention on the rate con', k.detentionPerHour === 25 && k.detentionAfterHours === 2, `${k.detentionPerHour}/${k.detentionAfterHours}`);

  head('2. After delivery: quick pay on the invoice');
  await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
  await api('/run/loaded', 'POST', { day: 3, time: '06:50', odometer: 5001 });
  r = await api('/deliver', 'POST', { day: 3, time: '09:00', odometer: 5071, drive: 9, shift: 10, break: 6, cycle: 60 });
  let inv = r.invoice;
  ok('invoiced at the full rate', inv.amount === k.rate && !inv.quickPayFee, `${inv.amount} vs ${k.rate}`);
  r = await api(`/invoices/${inv.id}/quickpay`, 'POST');
  inv = r.snapshot.invoices.find((i) => i.id === inv.id);
  const fee = Math.round(k.rate * starter.quickPayFeePct) / 100;
  ok('the broker\'s fee off', Math.abs(inv.quickPayFee - fee) < 0.01 && Math.abs(inv.amount - (k.rate - fee)) < 0.01, `${inv.amount} + ${inv.quickPayFee}`);
  ok('due in two days', (Date.parse(inv.dueGameTime + ':00Z') - Date.parse(r.snapshot.status.gameTime + ':00Z')) / 3600000 === 48, inv.dueGameTime);
  ok('said, with the credit warning where it applies', /on quick pay/.test(r.said), r.said);
  ok('the fee shows on Financial health', r.snapshot.finance.weeks[0].fees >= fee - 0.01, String(r.snapshot.finance.weeks[0].fees));

  head('3. A lane: the job taken for it on the broker\'s terms, detention on');
  // From Topeka, where the last one dropped: a short run back to Kansas City, for a lane call to ring about.
  await api('/board/add-many', 'POST', [{ cargo: 'Corn', destCity: 'Kansas City', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day: 3, time: '10:30' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '10:50', odometer: 5072 });
  S = r.snapshot;
  if (!S.call || !S.call.lane) ok('a lane call', false, 'no lane call rang');
  else {
    r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
    r = await api(`/calls/${r.call.id}/say`, 'POST', { text: `${r.call.offer} and quick pay` });
    ok('the lane booked at the price', r.call.status === 'Booked', r.call.turns.at(-1).text);
    const lane = r.snapshot.lane;
    await api('/deliver', 'POST', { day: 3, time: '13:00', odometer: 5142, drive: 9, shift: 10, break: 6, cycle: 60 });
    await api('/status', 'POST', { locationCity: lane.pickupCity, locationState: lane.pickupState, day: 3, time: '18:00' });
    r = await api('/board/add-many', 'POST', [{ cargo: 'Fits', destCity: 'Tulsa', destState: 'OK', loadedMiles: Math.round((lane.minMiles + lane.maxMiles) / 2), gameRevenue: 1100, deadlineHours: 40 }]);
    const job = r.snapshot.board.find((v) => v.load.cargo === 'Fits');
    r = await api('/lane/take', 'POST', { loadId: job.load.id });
    ok('the job: broker\'s terms, detention at their rate', !r.booking.quickPay && r.booking.detentionPerHour > 0, JSON.stringify({ q: r.booking.quickPay, d: r.booking.detentionPerHour }));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
