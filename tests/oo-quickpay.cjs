/* Owner-Operator 0.9: a price and terms in one breath.
 *
 * Reported from play: "I want $350 and quick pay" got the price but not the quick pay, twice; "quick pay" on its own
 * worked. A price with terms now carries them: granted, they go on the deal; refused, nothing is booked on the price
 * alone. And terms agreed on a lane's call go onto the job taken for the lane.
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
const CLOCKS = { driveRemaining: 9, shiftRemaining: 11, breakRemaining: 6, cycleRemaining: 55 };

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'Q. Uick', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });

  head('1. Typed: a price and quick pay');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  const offer = r.call.offer;
  r = await api(`/calls/${r.call.id}/say`, 'POST', { text: `I want $${offer} and quick pay` });
  const said = r.call.turns.at(-1).text;
  if (r.call.status === 'Booked') {
    const k = r.snapshot.booking;
    ok('booked with the quick pay asked for', k.quickPay === true && k.daysToPay === 2, said);
    ok('and the broker says so, with the fee and what it leaves', /quick pay/i.test(said) && /\d%/.test(said), said);
    ok("the fee is the broker's", k.quickPayFeePct === r.snapshot.directory.find((b) => b.id === starter.id).quickPayFeePct && k.quickPayFeePct > 0, String(k.quickPayFeePct));
    ok('the call shows quick pay agreed, and the net', r.call.quickPay === true && Math.abs(r.call.quickPayNet - Math.round(k.rate * (1 - k.quickPayFeePct / 100) * 100) / 100) < 0.01, JSON.stringify({ q: r.call.quickPay, net: r.call.quickPayNet }));
    await api('/run/at-shipper', 'POST', { day: 3, time: '06:30' });
    await api('/run/loaded', 'POST', { day: 3, time: '06:50', odometer: 5001 });
    const d = await api('/deliver', 'POST', { day: 3, time: '09:00', odometer: 5071, driveRemaining: 9, shiftRemaining: 10, breakRemaining: 6, cycleRemaining: 60 });
    const inv = d.snapshot.invoices.find((i) => i.bookingNumber === k.number);
    const fee = Math.round(k.rate * k.quickPayFeePct) / 100;
    ok('invoiced at the rate less the fee', inv && Math.abs(inv.amount - (k.rate - fee)) < 0.01 && Math.abs(inv.quickPayFee - fee) < 0.01, JSON.stringify(inv && { amount: inv.amount, fee: inv.quickPayFee, rate: k.rate }));
    S = d.snapshot;
  } else {
    ok('refused the quick pay: not booked on the price alone', r.call.status === 'Open' && /usual terms/.test(said), `${r.call.status}: ${said}`);
  }
  ok('never booked without the quick pay asked for', !(r.call.status === 'Booked' && !r.snapshot.booking.quickPay));

  head('2. On a lane, through to the job');
  // A load on the truck, for the lane call to ring about.
  await api('/board/add-many', 'POST', [{ cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  r = await api('/run/at-shipper', 'POST', { day: 3, time: '10:00' });
  r = await api('/run/loaded', 'POST', { day: 3, time: '10:40', odometer: r.snapshot.status.odometer });
  S = r.snapshot;
  ok('a broker rings with a lane', S.call && S.call.lane);
  // A D broker gives quick pay to anyone who asks, so the lane is booked on it whatever the broker's mood.
  await api('/test/broker', 'POST', { id: S.call.brokerId, credit: 'D' });
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { text: `${r.call.offer} and quick pay` });
  ok('the lane booked with quick pay', r.call.status === 'Booked' && r.call.quickPay === true, r.call.turns.at(-1).text);
  if (r.call.status !== 'Booked') { ok('lane booked (broker refused the terms this time; nothing more to check)', /usual terms/.test(r.call.turns.at(-1).text), r.call.turns.at(-1).text); }
  else {
    S = r.snapshot;
    const lane = S.lane;
    await api('/deliver', 'POST', { day: 3, time: '13:00', odometer: S.status.odometer + 70 });
    await api('/status', 'POST', { locationCity: lane.pickupCity, locationState: lane.pickupState, day: 3, time: '18:00' });
    r = await api('/board/add-many', 'POST', [{ cargo: 'Fits', destCity: 'Tulsa', destState: 'OK', loadedMiles: Math.round((lane.minMiles + lane.maxMiles) / 2), gameRevenue: 1100, deadlineHours: 40 }]);
    const job = r.snapshot.board.find((v) => v.load.cargo === 'Fits');
    r = await api('/lane/take', 'POST', { loadId: job.load.id });
    ok('the job taken for the lane is on quick pay', r.booking.quickPay === true && r.booking.daysToPay === 2, JSON.stringify({ q: r.booking.quickPay, d: r.booking.daysToPay }));
    ok("with the lane broker's fee", r.booking.quickPayFeePct > 0, String(r.booking.quickPayFeePct));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
