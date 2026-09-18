/* The fleet report records the ATS bank balance, and says what the books could not see.
 *
 * Raised from play: "the fleet report should ALSO include an entry for current money in ATS."
 *
 * Everything else on that report is an estimate — a profit rate off the driver manager times an
 * odometer delta, less derived repairs and capital. The bank balance is the only figure on it that is
 * not. One balance is a snapshot; two are a measurement, because the difference between them is
 * exactly what the company's cash did as the game saw it, tolls and ferries and fines included.
 *
 * NOT a reconciliation. The app used to compute this variance, call it a mismatch and post an entry to
 * force agreement — LedgerService.Position argues at length about why that was removed. Nothing here
 * adjusts anything. It says what the bank did, what the books expected, and names the difference.
 *
 * What this suite holds:
 *   1. the balance is recorded, and the first report has nothing to compare against
 *   2. the second differences against the first and reports the gap
 *   3. app-only categories are kept out of the comparison, or the gap would be permanent fiction
 *   4. a blank balance skips the comparison without complaint
 *   5. nothing is ever adjusted
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5897}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};

let S, hired, yardId, odo = 100000;

/** File a period. Contribution comes out at $2.00/mi over whatever the odometer moved. */
async function file(startDay, endDay, miles, bank) {
  odo += miles;
  const body = {
    periodStartGame: iso(startDay), periodEndGame: iso(endDay),
    lines: [{ driverId: hired.id, level: 8, perMile: 2.00, perDay: 600,
              truckStars: 4, truckOdometer: odo }],
  };
  if (bank !== undefined) body.bankBalance = bank;
  return (await api('/fleetops/report', 'POST', body)).report;
}

(async () => {
  const app = { driverName: 'E. Vasquez', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Phoenix', homeState: 'AZ', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));
  await api('/fleet/truck', 'POST', {
    unit: 'B-100', make: 'Volvo', model: 'VNL', year: 2021, atsOdometer: odo,
    serviceMiles: odo, lastServiceMiles: odo, serviceIntervalMiles: 25000,
    damagePct: 3, inGameGarage: true, homeTerminalId: yardId,
  });
  hired = (await api('/fleetops/drivers', 'POST', {
    name: 'R. Duval', status: 'Active', assignedTruckUnit: 'B-100', skill: 'Experienced',
    homeTerminalId: yardId, hiredGameDate: iso(3), level: 8,
  })).driver;

  head('1. The first balance is recorded, with nothing to hold it against');
  const r1 = await file(5, 20, 5000, 200000);
  console.log(`  ..    ${(r1.findings || []).find((f) => /Bank/.test(f)) || '(nothing said)'}`);
  ok('the balance is on the report', r1.bankBalance === 200000, `$${r1.bankBalance}`);
  ok('nothing is compared yet', !(r1.bankMoved !== 0), `moved ${r1.bankMoved}`);
  ok('and it says so rather than staying silent',
    (r1.findings || []).some((f) => /Nothing to compare/i.test(f)),
    (r1.findings || []).find((f) => /Bank/.test(f))?.slice(0, 90));

  head('2. The second differences against the first');
  // Contribution this period is $2.00 x 4,000 = $8,000, which the books post as game-real money.
  // The bank is told it went up $6,500 — so $1,500 went out that the app never saw.
  const r2 = await file(21, 36, 4000, 206500);
  console.log(`  ..    moved $${r2.bankMoved} · books $${r2.booksExpected} · unseen $${r2.unseen}`);
  ok('the bank movement is the difference of the two readings',
    r2.bankMoved === 6500, `$${r2.bankMoved}`);
  ok('the books expected the contribution', r2.booksExpected === 8000, `$${r2.booksExpected}`);
  ok('and the gap is named', r2.unseen === -1500, `$${r2.unseen}`);
  ok('it is reported in words the player can act on',
    (r2.findings || []).some((f) => /never saw/i.test(f)),
    (r2.findings || []).find((f) => /never saw/i.test(f))?.slice(0, 110));

  head('3. Money the app invents is kept out of the comparison');
  // Yard upkeep is the app's own figure — ATS charges no rent on a garage — and the player's own
  // settlement is money the game never pays, because in ATS they are the owner. Counting either would
  // show a gap every period that was nothing but the app's own fiction.
  const ledger = (await api('/export')).ledger;
  const appOnly = ledger.filter((e) => ['YardUpkeep', 'Payroll', 'Overhead', 'Cancellation'].includes(e.category));
  console.log(`  ..    ${appOnly.length} app-only entr(ies) on the books`);
  const r3 = await file(37, 52, 4000, 206500 + 8000);
  console.log(`  ..    moved $${r3.bankMoved} · books $${r3.booksExpected} · unseen $${r3.unseen}`);
  ok('a period with no real-world spending reads as agreeing',
    Math.abs(r3.unseen) < 1, `$${r3.unseen}`);
  ok('and says the books and the bank agree',
    (r3.findings || []).some((f) => /They agree/i.test(f)),
    (r3.findings || []).find((f) => /Bank went/.test(f))?.slice(0, 110));

  head('4. A blank balance skips the comparison and says nothing about it');
  const r4 = await file(53, 68, 4000);
  ok('no balance recorded', !(r4.bankBalance > 0), `$${r4.bankBalance}`);
  ok('nothing compared', r4.bankMoved === 0 && r4.unseen === 0, `${r4.bankMoved}/${r4.unseen}`);
  ok('and no complaint about it',
    !(r4.findings || []).some((f) => /Bank/i.test(f)),
    (r4.findings || []).filter((f) => /Bank/i.test(f)).join(' ') || 'silent');

  head('5. The next report with a balance picks up from the last one that had one');
  // r4 had none, so this must difference against r3 and not against nothing.
  const r5 = await file(69, 84, 4000, 206500 + 8000 + 8000);
  console.log(`  ..    moved $${r5.bankMoved} against the last reading that existed`);
  ok('it found the earlier reading', r5.bankMoved === 8000, `$${r5.bankMoved}`);

  head('6. Nothing was ever adjusted');
  // The whole point. The old code posted an entry to force the books to agree with the game.
  const adj = (await api('/export')).ledger.filter((e) => e.isAdjustment || e.category === 'Adjustment');
  ok('no adjusting entry was posted', adj.length === 0, `${adj.length} adjustment(s)`);
  ok('and the books still say what they said',
    (await api('/finance')).fleetContribution > 0, 'books intact');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
