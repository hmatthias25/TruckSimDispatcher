/* Owner-Operator 0.91: financial health.
 *
 * Asked for from play, decided 2026-10-21: a Financial health tab; a check of the game bank every game Monday, finding
 * what went out that nothing logged; fuel logged at every fill, on a load or not, counted once; and the cost factor worked
 * out again after each check from fuel and that spending per mile, plus the monthly bills spread over the miles driven.
 * No migration: the factor stays as it is until the first game Monday after tracking begins.
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
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'F. Inance', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  const startFactor = S.settings.costPerMile;

  head('1. Tracking starts this week; no check until the next game Monday');
  ok('the tab is there', S.finance && Array.isArray(S.finance.weeks), JSON.stringify(Object.keys(S.finance || {})));
  ok('no check due on Day 3 (a Wednesday)', S.mondayCheck === null);
  ok('the next check is Day 8, a Monday', S.finance.nextCheck === 8, String(S.finance.nextCheck));

  head('2. Fuel off a load');
  S = await api('/bank', 'POST', { balance: 10000 });
  S = await api('/fuel', 'POST', { day: 3, time: '06:30', gallons: 100, pricePerGal: 4, odometer: 5000, fuelPct: 100 });
  ok('logged: 100 gal at $4', S.finance.fuel.all.fills === 1 && near(S.finance.fuel.all.spent, 400), JSON.stringify(S.finance.fuel.all));
  ok('and paid out of the game bank', near(S.gameBank.estimate, 9600), String(S.gameBank.estimate));

  head('3. A load, with a fill on the trip log');
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 900, deadlineHours: 30 }]);
  const starter = S.directory.find((b) => b.tier === 'Starter' && b.worksHere);
  let r = await api('/calls', 'POST', { brokerId: starter.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  const k = r.snapshot.booking;
  await api('/run/at-shipper', 'POST', { day: 3, time: '07:00' });
  await api('/run/loaded', 'POST', { day: 3, time: '07:30', odometer: 5001 });
  S = await api('/fuel', 'POST', { day: 3, time: '09:00', gallons: 50, pricePerGal: 4, odometer: 5120 });
  ok('a fill on a load: once on the books', S.finance.fuel.all.fills === 2 && near(S.finance.fuel.all.spent, 600), JSON.stringify(S.finance.fuel.all));
  ok('and on the trip log', S.trip.events.some((e) => e.kind === 'Fuel'), S.trip.events.map((e) => e.kind).join(','));
  r = await api('/deliver', 'POST', { day: 3, time: '11:00', odometer: 5201, driveRemaining: 7, shiftRemaining: 9, breakRemaining: 4, cycleRemaining: 60 });
  S = r.snapshot;
  const toHold = S.transfers.find((t) => t.kind === 'ToHolding' && t.status === 'Pending');
  S = await api(`/transfers/${toHold.id}/done`, 'POST');
  // Drive on, empty, to have miles to work a factor from.
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 4, time: '10:00', odometer: 5600 });
  S = await api('/fuel', 'POST', { day: 4, time: '10:00', gallons: 60, pricePerGal: 4, odometer: 5600 });
  ok('real MPG off the odometer at the fills', near(S.finance.fuel.all.mpg, Math.round(600 / 110 * 100) / 100), String(S.finance.fuel.all.mpg));

  head('4. This week on the tab');
  const w = S.finance.weeks[0];
  ok('the load and its miles', w.loads === 1 && w.miles > 190, JSON.stringify(w));
  ok('earned is the booked rate', near(w.earned, k.rate), `${w.earned} vs ${k.rate}`);
  ok("the week's miles off the odometer, empty ones too", near(w.miles, 600, 1), String(w.miles));
  ok('and what was not on a load is empty', w.emptyPct >= 60, `${w.emptyPct}%`);
  ok('fuel is the week\'s fills', near(w.fuel, 840), String(w.fuel));
  ok('net is earned less fees, fuel and other', near(w.net, w.earned - w.fees - w.fuel - w.other), JSON.stringify(w));
  ok('the load in the per-load list, with the broker\'s cut', S.finance.loads.length === 1 && S.finance.loads[0].number === k.number
    && near(S.finance.loads[0].brokerCutPct, Math.round((1 - k.rate / k.gamePay) * 1000) / 10, 0.11), JSON.stringify(S.finance.loads[0]));
  ok('and the broker owes the invoice', S.finance.brokers.aging.total > 0, JSON.stringify(S.finance.brokers.aging));

  head('5. The bills');
  S = await api('/finance/bills', 'POST', { truckPayment: 2000, insurance: 800, maintenance: 200, other: 0 });
  ok('saved', S.finance.factor.billsTotal === 3000);
  ok('the factor does not move until Monday', S.settings.costPerMile === startFactor, String(S.settings.costPerMile));

  head('6. The game\'s Monday: the check');
  S = await api('/status', 'POST', { day: 8, time: '08:00' });
  ok('due now', S.mondayCheck && S.mondayCheck.week === 8, JSON.stringify(S.mondayCheck));
  const expected = S.mondayCheck.expected;
  ok('expected: the reading, the pay in, the moves out, the fuel', near(expected, 10000 - 840 + k.gamePay - k.gamePay), String(expected));
  // $150 went on tolls and a ticket nothing logged; $500 was moved in from the player's own account.
  r = await api('/finance/check', 'POST', { balance: expected + 500 - 150, movedIn: 500 });
  S = r.snapshot;
  ok('finds what went out unseen', /\$150\.00 went out/.test(r.said), r.said);
  ok('as other spending in the week', near(S.finance.weeks[0].other, 150), String(S.finance.weeks[0].other));
  ok('moved in is not income', !S.finance.weeks.some((x) => x.earned >= 500 && x.loads === 0));
  const step = S.finance.factor.history[0];
  const miles = 5600 - 5000;
  const days = 7 + 8 / 24;   // tracking began Monday Day 1, 00:00; checked Day 8, 08:00
  const measured = Math.round((840 + 150) / miles * 1000) / 1000;
  const fixed = Math.round(3000 * 12 / 365 * days / miles * 1000) / 1000;
  ok('the factor: fuel and other per mile', near(step.measured, measured, 0.002), `${step.measured} vs ${measured}`);
  ok('plus the bills over the miles driven', near(step.fixed, fixed, 0.002), `${step.fixed} vs ${fixed} (${days} d)`);
  ok('and loads are ranked on it now', near(S.settings.costPerMile, Math.round((measured + fixed) * 1000) / 1000, 0.003), `${S.settings.costPerMile}`);
  ok('no second check this week', S.mondayCheck === null);
  ok('the next is Day 15', S.finance.nextCheck === 15, String(S.finance.nextCheck));

  head('7. A reading on the Money tab finds unseen spending too');
  S = await api('/status', 'POST', { day: 9, time: '08:00' });
  S = await api('/bank', 'POST', { balance: S.gameBank.estimate - 40 });
  ok('$40 more of other spending', near(S.finance.weeks[0].other, 190), String(S.finance.weeks[0].other));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
