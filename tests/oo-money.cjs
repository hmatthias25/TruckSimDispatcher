/* Owner-Operator 0.9: delivering, getting paid, and the two banks.
 *
 *   - delivering raises an invoice to the broker at the booked rate, due on their terms
 *   - the game's pay is shipper money: all of it moves from the game bank to Broker holding, with the game closed
 *   - the game bank shows what the player is allowed to spend: the balance less what is still to move
 *   - when it comes due the broker pays, and the rate is the player's to move out of Broker holding; the rest stays
 *   - the truck is where the load went, and the record counts the load, on time or late
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5992}/api`;
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

// Booked on quick pay: net 30 is a month of game time on the road, and home life would (rightly) send the driver
// home long before the broker paid.
async function bookOne(S) {
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  const r = await api('/calls', 'POST', { brokerId: starter.id });
  if (r.call.status !== 'Open') throw new Error(`no offer: ${r.call.turns.at(-1).text}`);
  await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'terms', term: 'quickpay' });
  return (await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' }));
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'M. Oney', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Normal' });

  head('1. Nothing to deliver yet');
  ok('refused', /Nothing is booked/.test(await refused(() => api('/deliver', 'POST', { day: 3, time: '10:00' }))));

  head('2. Book and deliver, on time');
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Toys', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 760, deadlineHours: 30 },
  ]);
  let r = await bookOne(S);
  S = r.snapshot;
  const k = S.booking;
  ok('booked, on quick pay', k && k.status === 'Booked' && k.quickPay && k.daysToPay === 2, `${k?.number} ${k?.quickPay} ${k?.daysToPay}`);
  ok('a time before the booking is refused', /before the load was booked/.test(await refused(() => api('/deliver', 'POST', { day: 2, time: '10:00' }))));
  ok('an odometer going backwards is refused', /lower than/.test(await refused(() => api('/deliver', 'POST', { day: 3, time: '12:00', odometer: 900 }))));
  r = await api('/deliver', 'POST', { day: 3, time: '12:00', odometer: 1000 + k.load.loadedMiles });
  S = r.snapshot;
  const inv = r.invoice;
  ok('an invoice for the booked rate', inv.amount === k.rate && inv.number === 'INV-001', `${inv.amount} vs ${k.rate}`);
  ok('due on the broker\'s terms', inv.dueGameTime > inv.issuedGameTime, `${inv.issuedGameTime} -> ${inv.dueGameTime}`);
  ok('the truck is at the receiver', S.status.city === k.load.destCity, S.status.city);
  ok('the record counts it, on time', S.record.loads === 1 && S.record.onTimePct === 100, JSON.stringify(S.record));
  ok('nothing booked now', !S.booking);

  head('3. The game\'s pay is not yours');
  const toHold = S.transfers.find((t) => t.kind === 'ToHolding');
  ok('all of the game\'s pay moves from the game bank to Broker holding', toHold && toHold.amount === k.gamePay && toHold.from === 'Game bank' && toHold.to === 'Broker holding',
    JSON.stringify(toHold && { a: toHold.amount, f: toHold.from, t: toHold.to }));
  ok('with the game closed', toHold.needsGameClosed === true);
  ok('the game bank says how much of it is not yours', S.gameBank.notYours === k.gamePay);
  ok('allowed to spend is unknown until the balance is read', S.gameBank.allowedToSpend === null);
  S = await api('/bank', 'POST', { balance: 5000 + k.gamePay });
  ok('read with the delivery in it, the shipper money is not spendable', S.gameBank.allowedToSpend === 5000, `${S.gameBank.allowedToSpend}`);
  ok('owed to you', S.owedToYou === k.rate);
  S = await api(`/transfers/${toHold.id}/done`, 'POST');
  ok('moved: nothing in the game bank that is not yours', S.gameBank.notYours === 0 && S.transfers.find((t) => t.id === toHold.id).status === 'Done');
  ok('and the game bank is what you can spend', S.gameBank.estimate === 5000 && S.gameBank.allowedToSpend === 5000, `${S.gameBank.estimate}`);
  ok('Broker holding holds the game\'s pay, waiting on the broker', S.holding.balance === k.gamePay && S.holding.waitingOnBrokers === k.gamePay);

  head('4. The broker pays when it comes due');
  // The game day the invoice falls due, counted from Day 1 the way the game does, and two days past it.
  const dueDay = Math.floor((Date.parse(inv.dueGameTime + ':00Z') - Date.parse('2000-01-01T00:00:00Z')) / 86400000) + 1 + 2;
  S = await api('/status', 'POST', { day: dueDay, time: '09:00' });
  const paid = S.invoices.find((i) => i.id === inv.id);
  ok('paid', paid.status === 'Paid', paid.status);
  const toYou = S.transfers.find((t) => t.kind === 'ToYou');
  ok('the rate is yours to move out of Broker holding into your account', toYou && toYou.amount === k.rate && toYou.from === 'Broker holding' && toYou.to === 'Your account',
    JSON.stringify(toYou && { a: toYou.amount, f: toYou.from, t: toYou.to }));
  ok('which does not wait for the game', toYou.needsGameClosed === false);
  ok('and it says the rest is the broker\'s share, left in holding', /broker's share/.test(toYou.reason), toYou.reason);
  ok('nothing else to move', !S.transfers.some((t) => t.status === 'Pending' && t.id !== toYou.id));
  ok('yours to move out is the rate', S.holding.yoursToMove === k.rate);
  S = await api(`/transfers/${toYou.id}/done`, 'POST');
  ok('moved: holding keeps the broker\'s share', Math.abs(S.holding.balance - (k.gamePay - k.rate)) < 0.01 && Math.abs(S.holding.brokersShare - (k.gamePay - k.rate)) < 0.01,
    `${S.holding.balance} ${S.holding.brokersShare}`);
  ok('the game bank is untouched by it', S.gameBank.estimate === 5000);
  ok('nothing owed now', S.owedToYou === 0);

  head('5. Late');
  await api('/board/add-many', 'POST', [
    { cargo: 'Beans', destCity: 'Wichita', destState: 'KS', loadedMiles: 30, gameRevenue: 300, deadlineHours: 5 },
    { cargo: 'Corn', destCity: 'Wichita', destState: 'KS', loadedMiles: 35, gameRevenue: 320, deadlineHours: 5 },
  ]);
  r = await bookOne(S);
  const late = r.snapshot.booking;
  r = await api('/deliver', 'POST', { day: dueDay + 1, time: '09:00' });
  S = r.snapshot;
  ok('a delivery past the window is late', S.bookings.find((b) => b.id === late.id).late === true);
  ok('and the record shows it', S.record.loads === 2 && S.record.onTimePct === 50, JSON.stringify(S.record));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
