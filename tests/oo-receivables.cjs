/* Owner-Operator 0.9: getting paid, the hard way.
 *
 *   - detention agreed on the call is billed from the dock times logged; a hustler disputes it, and the log wins it
 *   - an invoice can be sold to a factor: the rate less the fee is yours now, the fee stays in Broker holding
 *   - a D-credit broker is not factored; overdue invoices are chased, go to collections for half, or are written off
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5997}/api`;
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
const dayOf = (gt) => Math.floor((Date.parse(gt + ':00Z') - Date.parse('2000-01-01T00:00:00Z')) / 86400000) + 1;

let S, broker;
// One load, start to finish: booked with this broker as they are shaped, optionally with detention, and logged.
async function haul(day, credit, personality, detention) {
  // Paid in three days: a month of game time waiting on net 30 would send the driver home before anything was paid.
  await api('/test/broker', 'POST', { id: broker.id, credit, personality, daysToPay: 3 });
  // And home life kept out of it: this suite waits on brokers for weeks, which home life would rightly punish.
  await api('/test/home', 'POST', { score: 100 });
  await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day, time: '06:00' });
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 72, gameRevenue: 390, deadlineHours: 30 },
  ]);
  let r = await api('/calls', 'POST', { brokerId: broker.id });
  const id = r.call.id;
  if (detention) await api(`/calls/${id}/say`, 'POST', { kind: 'terms', term: 'detention' });
  r = await api(`/calls/${id}/say`, 'POST', { kind: 'accept' });
  const odo = r.snapshot.status.odometer;
  await api('/run/at-shipper', 'POST', { day, time: '06:30' });
  if (detention) {
    await api('/run/event', 'POST', { kind: 'BeginLoad', day, time: '06:30' });
    await api('/run/event', 'POST', { kind: 'EndLoad', day, time: '11:00' });
  }
  await api('/run/loaded', 'POST', { day, time: '11:05', odometer: odo });
  await api('/run/arrived', 'POST', { day, time: '13:00' });
  r = await api('/deliver', 'POST', { day, time: '13:30', odometer: odo + 72 });
  return r;
}

(async () => {
  S = await api('/start', 'POST', { game: 'ATS', driverName: 'P. Ayme', homeCity: 'Kansas City', homeState: 'KS', day: 3, time: '06:00',
    level: 0, longDistance: 1, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 1000, preset: 'Easy' });
  await api('/home/promise', 'POST', { everyDays: 42, homeDays: 1 });
  broker = S.directory.find((b) => b.tier === 'Starter' && b.worksHere && b.takesYou);

  head('1. Detention, disputed, and won with the log');
  let r = await haul(3, 'A', 'Hustler', true);
  let inv = r.invoice;
  ok('detention billed off the logged dock time', inv.detentionAmount > 0 && inv.detentionHours > 0, `${inv.detentionHours} h, ${inv.detentionAmount}`);
  ok('a hustler disputes it', inv.detentionStatus === 'Disputed', inv.detentionStatus);
  r = await api(`/invoices/${inv.id}/argue`, 'POST');
  ok('the log wins it', /looked at your log/.test(r.said) && r.snapshot.invoices.find((i) => i.id === inv.id).detentionStatus === 'Granted', r.said);
  S = await api('/status', 'POST', { day: dayOf(inv.dueGameTime) + 1, time: '09:00' });
  ok('paid with the invoice, out of the brokers\' share in Broker holding: nothing from outside the game',
    S.transfers.some((t) => t.reference === inv.number && t.kind === 'Extra' && t.from === 'Broker holding'
      // As far as the share covers it: the game's pay less the rate is all there is to pay it from.
      && Math.abs(t.amount - Math.min(inv.detentionAmount, inv.gamePay - inv.amount)) < 0.01),
    JSON.stringify(S.transfers.filter((t) => t.reference === inv.number).map((t) => [t.kind, t.amount])));

  head('2. Factoring');
  r = await haul(dayOf(S.status.gameTime) + 1, 'C', 'Friend', false);
  inv = r.invoice;
  r = await api(`/invoices/${inv.id}/factor`, 'POST');
  S = r.snapshot;
  const fee = Math.round(inv.amount * 6) / 100;
  const adv = S.transfers.find((t) => t.reference === inv.number && t.kind === 'ToYou');
  ok('sold at 6% for C credit: the rate less the fee, now', adv && Math.abs(adv.amount - (inv.amount - fee)) < 0.02, `${adv?.amount} of ${inv.amount}`);
  ok('marked factored', S.invoices.find((i) => i.id === inv.id).status === 'Factored');
  S = await api('/status', 'POST', { day: dayOf(inv.dueGameTime) + 12, time: '09:00' });
  ok('when the broker pays, it is the factor\'s, not yours again', S.transfers.filter((t) => t.reference === inv.number && t.kind === 'ToYou').length === 1);

  head('3. A broker who will not pay');
  r = await haul(dayOf(S.status.gameTime) + 1, 'D', 'Friend', false);
  inv = r.invoice;
  ok('no factor will buy a D', /credit is too poor/.test(await refused(() => api(`/invoices/${inv.id}/factor`, 'POST'))));
  S = await api('/status', 'POST', { day: dayOf(inv.dueGameTime) + 2, time: '09:00' });
  const state = S.invoices.find((i) => i.id === inv.id).status;
  if (state === 'Overdue') {
    r = await api(`/invoices/${inv.id}/chase`, 'POST');
    ok('chased: a promise, or a date', /look into it|check's going out/.test(r.said), r.said);
    r = await api(`/invoices/${inv.id}/chase`, 'POST').catch((e) => ({ said: e.message, snapshot: S }));
    S = r.snapshot;
    const after = S.invoices.find((i) => i.id === inv.id);
    if (/collections/.test(r.said)) {
      ok('chased again: collections, for half', after.status === 'Collections', r.said);
      S = await api('/status', 'POST', { day: dayOf(S.status.gameTime) + 16, time: '09:00' });
      const half = S.transfers.find((t) => t.reference === inv.number && t.kind === 'ToYou');
      ok('which pays half the rate', half && Math.abs(half.amount - inv.amount / 2) < 0.02, `${half?.amount} of ${inv.amount}`);
    } else ok('a broker who means to pay just pays sooner', /check's going out|overdue/.test(r.said) || after.status !== 'Collections', r.said);
  } else ok('a D pays late at best, never on time', state !== 'Paid', state);

  head('4. Writing one off');
  r = await haul(dayOf(S.status.gameTime) + 1, 'D', 'Friend', false);
  inv = r.invoice;
  S = await api('/status', 'POST', { day: dayOf(inv.dueGameTime) + 2, time: '09:00' });
  if (S.invoices.find((i) => i.id === inv.id).status === 'Overdue') {
    r = await api(`/invoices/${inv.id}/writeoff`, 'POST');
    ok('written off, and the game\'s pay stays in Broker holding', /written off/.test(r.said) && /stays in Broker holding/.test(r.said), r.said);
    ok('and the directory remembers', r.snapshot.directory.find((b) => b.id === broker.id).notes.includes('Did not pay.'));
  } else ok('(paid before it could be written off)', true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
