/* Owner-Operator 0.9: the phone rings near the end of a run, with a lane.
 *
 *   - once loaded and close to empty, a broker who works the destination rings with a lane out of a discovered city
 *   - the lane reaches only as far as the driver can: the Long Distance limit, and a restart first on a low cycle
 *   - answering and taking it books a rate per mile; letting it ring lets it go
 *   - at the pickup, the jobs that fit are marked, and taking one books it at the lane rate, never above the game's pay
 *   - nothing fits: the broker cancels, and a broker good for it pays a TONU
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5995}/api`;
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
const hrs = (a, b) => (Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600000;

async function bookAndLoad(S, day) {
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 72, gameRevenue: 390, deadlineHours: 30 },
  ]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  await api('/run/at-shipper', 'POST', { day, time: '07:00' });
  r = await api('/run/loaded', 'POST', { day, time: '07:40', odometer: r.snapshot.status.odometer });
  return r.snapshot;
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'L. Ane', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });

  head('1. The phone rings');
  S = await bookAndLoad(S, 3);
  ok('a broker is calling', S.call && S.call.status === 'Ringing' && S.call.inbound, JSON.stringify(S.call && { s: S.call.status, b: S.call.broker }));
  const lane = S.call.lane;
  ok('about a lane out of a discovered city near the drop', lane && ['Topeka', 'Kansas City'].includes(lane.pickupCity), lane && lane.pickupCity);
  ok('within Long Distance 1', lane.maxMiles <= 400 && lane.minMiles > 0, `${lane.minMiles}-${lane.maxMiles}`);
  ok('picking up after the truck is empty', lane.pickupFromGameTime > S.status.gameTime);
  ok('priced off what the game pays', S.call.offer > 0 && S.call.offer < S.payPerMile * (lane.minMiles + lane.maxMiles) / 2, `${S.call.offer} vs ${S.payPerMile}/mi`);

  head('2. Answer, and take it');
  let why = '';
  try { await api(`/calls/${S.call.id}/answer`, 'POST', {}); } catch (e) { why = e.message; }
  ok('answering means telling them your clocks', /Tell them your clocks/.test(why), why);
  let r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: CLOCKS });
  ok('answered', r.call.status === 'Open');
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  ok('the lane is booked at a rate per mile', S.lane && S.lane.status === 'Booked' && S.lane.ratePerMile > 0, JSON.stringify(S.lane && { n: S.lane.number, r: S.lane.ratePerMile }));
  ok('and the load on the truck is still the one to deliver', S.booking && S.booking.status === 'Booked');

  head('3. At the pickup');
  r = await api('/deliver', 'POST', { day: 3, time: '10:00', odometer: S.status.odometer + 70 });
  S = await api('/status', 'POST', { locationCity: S.lane.pickupCity, locationState: S.lane.pickupState, day: 3, time: '18:00' });
  const inBand = Math.round((S.lane.minMiles + S.lane.maxMiles) / 2);
  r = await api('/board/add-many', 'POST', [
    { cargo: 'Fits', destCity: 'Tulsa', destState: 'OK', loadedMiles: inBand, gameRevenue: 1100, deadlineHours: 40 },
    { cargo: 'TooShort', destCity: 'Tulsa', destState: 'OK', loadedMiles: 40, gameRevenue: 300, deadlineHours: 40 },
    { cargo: 'WrongWay', destCity: 'Des Moines', destState: 'IA', loadedMiles: inBand, gameRevenue: 1100, deadlineHours: 40 },
  ]);
  S = r.snapshot;
  const fits = S.board.filter((v) => S.laneFits.includes(v.load.id)).map((v) => v.load.cargo);
  ok('only the job in the region and the band fits', fits.length === 1 && fits[0] === 'Fits', fits.join(','));
  const job = S.board.find((v) => v.load.cargo === 'Fits');
  r = await api('/lane/take', 'POST', { loadId: job.load.id });
  S = r.snapshot;
  const expect = Math.min(job.gamePay, Math.round(S.bookings[0].rate * 100) / 100);
  ok('booked at the lane rate on its miles', Math.abs(r.booking.rate - Math.min(job.gamePay, Math.round(r.booking.rate * 100) / 100)) < 0.01 && r.booking.rate <= job.gamePay, `${r.booking.rate} of ${job.gamePay}`);
  ok('and the run opens', S.trip && S.trip.number === r.booking.number);
  ok('the lane is matched', !S.lane);

  head('4. A low cycle reaches no further than a restart');
  r = await api('/deliver', 'POST', { day: 4, time: '06:00', odometer: S.status.odometer + inBand });
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 5, time: '06:00' });
  S = await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 6 });
  S = await bookAndLoad(S, 5);
  const low = S.call && S.call.lane;
  ok('a call still comes', !!low, JSON.stringify(S.call && S.call.status));
  if (low) ok('with the pickup after a 34-hour restart', hrs(S.status.gameTime, low.pickupFromGameTime) >= 34, `${S.status.gameTime} -> ${low.pickupFromGameTime}`);

  head('5. Nothing fits');
  // Rung off a cycle of six: the lane waits for a restart. Answered with a full cycle (it was a misread), it does not.
  r = await api(`/calls/${S.call.id}/answer`, 'POST', { clocks: { ...CLOCKS, cycleRemaining: 60 } });
  ok('answered with a full cycle: the broker plans it again, sooner', /With those clocks/.test(r.call.turns.at(-1).text)
    && hrs(r.snapshot.status.gameTime, r.snapshot.call.lane.pickupFromGameTime) < 34, r.call.turns.at(-1).text);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  const broker = S.directory.find((x) => x.name === S.lane.brokerName);
  r = await api('/deliver', 'POST', { day: 5, time: '12:00', odometer: S.status.odometer + 70 });
  r = await api('/lane/nothing-fits', 'POST');
  S = r.snapshot;
  ok('the broker cancels the lane', !S.lane && /cancelled/.test(r.said), r.said);
  if (broker.credit === 'A' || broker.credit === 'B')
    ok('and, good for it, pays a TONU', S.invoices.some((i) => i.amount === 150 && i.gamePay === 0), r.said);
  else
    ok('and, not good for it, pays nothing', /not paying/.test(r.said), r.said);

  head('6. Letting it ring');
  S = await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 60 });
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 8, time: '06:00' });
  S = await bookAndLoad(S, 8);
  ok('another call', S.call && S.call.status === 'Ringing', JSON.stringify(S.call && S.call.status));
  r = await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' });
  ok('let it ring: the lane goes', r.call.status === 'Declined' && !r.snapshot.lane);

  head('7. Ringing for the next load yourself');
  S = r.snapshot;
  const destBroker = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  why = '';
  try { await api('/calls', 'POST', { brokerId: destBroker.id }); } catch (e) { why = e.message; }
  ok('not from the wheel', /Pull over/.test(why), why);
  S = await api('/run/event', 'POST', { kind: 'Break', day: 8, time: '08:30', hours: 0.5 });
  why = '';
  try { await api('/calls', 'POST', { brokerId: destBroker.id }); } catch (e) { why = e.message; }
  ok('and telling them your clocks', /Tell them your clocks/.test(why), why);
  r = await api('/calls', 'POST', { brokerId: destBroker.id, clocks: CLOCKS });
  ok('from a break: a lane out of where the run ends', r.call.status === 'Open' && r.call.lane && r.call.lane.pickupCity,
    JSON.stringify({ s: r.call.status, lane: r.call.lane && r.call.lane.pickupCity, said: r.call.turns.at(-1)?.text }));
  ok('not tied to any board', r.call.lane && r.call.lane.minMiles > 0 && !r.call.load?.destCity);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  ok('booked as the next lane', r.snapshot.lane && r.snapshot.lane.status === 'Booked' && r.snapshot.booking);

  head('8. Calling it off');
  const before = r.snapshot.directory.find((b) => b.id === destBroker.id).standing;
  r = await api('/lane/cancel', 'POST', { why: 'changed plans' });
  ok('the lane is off, and the broker remembers', !r.snapshot.lane && r.snapshot.directory.find((b) => b.id === destBroker.id).standing === before - 10,
    `${before} -> ${r.snapshot.directory.find((b) => b.id === destBroker.id).standing}`);
  S = await api('/booking/handback', 'POST', { why: 'truck trouble' });
  ok('a booked load handed back for any reason is a cancellation on the record', S.bookings[0].status === 'Cancelled' && S.bookings[0].onCarrier && !S.booking);

  head('9. The game lost the job');
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 9, time: '06:00' });
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  const b9 = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);
  r = await api('/calls', 'POST', { brokerId: b9.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  const standing9 = r.snapshot.directory.find((b) => b.id === b9.id).standing;
  const claims9 = r.snapshot.record.claims;
  S = await api('/booking/handback', 'POST', { why: 'game reset', gameLost: true });
  const k9 = S.bookings.find((k) => k.brokerName === b9.name && k.status === 'Cancelled' && !k.onCarrier);
  ok('cancelled, and not on the record', !!k9 && !S.booking && S.record.claims === claims9, `claims ${claims9} -> ${S.record.claims}`);
  ok('and the broker holds nothing against you', S.directory.find((b) => b.id === b9.id).standing === standing9);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
