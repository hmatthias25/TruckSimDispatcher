/* Owner-Operator 0.92: brokers come and go, and the player hears of it every Friday.
 *
 *   - a broker can be rung while waiting at the shipper, before pulling away; brokers still ring once you pull away
 *   - asking a broker for a load going somewhere: out of this state, by button or in words
 *   - above the starters, a new carrier is sometimes turned away, decided once a day; a good name in the region helps
 *   - Friday evening: a broker goes bankrupt (what they owe is frozen), one closes (still pays, takes no calls), one
 *     opens on poor credit, grades move; the report covers only the regions reached
 *   - a settlement claim on a bankrupt broker pays a small share, weeks later
 *   - every region keeps a broker who takes new authorities
 *   - the Monday check takes money moved out of the game bank, as a minus
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
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
const REGION = 'Plains & Southwest';
const door = (b) => b.kind === 'Broker' && b.specialty === 'General' && /Takes new authorities/.test(b.requirement);

/** Decline whatever is ringing or open, so the next call starts clean. */
async function hangUp(S) {
  if (S.call) { try { S = (await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' })).snapshot; } catch {} }
  return S;
}

(async () => {
  let S = await api('/start', 'POST', { game: 'ATS', driverName: 'M. Arket', homeCity: 'Kansas City', homeState: 'KS', day: 1, time: '06:00',
    level: 0, longDistance: 2, highValue: 0, fragile: 0, justInTime: 0, adr: [], odometer: 5000, preset: 'Normal' });
  S = (await api('/bank', 'POST', { balance: 20000 })).snapshot;
  const starters = S.directory.filter((b) => b.tier === 'Starter' && b.regions.includes(REGION));
  ok('three starters at home', starters.length === 3, starters.map((b) => b.name).join(', '));
  for (const b of starters) await api('/test/broker', 'POST', { id: b.id, credit: 'A' });
  const [s1, s2, s3] = starters;
  const est = S.directory.find((b) => b.tier === 'Established' && b.specialty === 'General' && b.regions.includes(REGION));
  S = await api('/test/broker', 'POST', { id: est.id, open: true });

  head('1. Turned away, now and then, by a broker above the starters');
  let e1 = S.directory.find((b) => b.id === est.id);
  ok('the odds are on the directory: 30% of days for an established broker and a new carrier', e1.takesYou && e1.refusalPct === 30, `${e1.refusalPct}`);
  ok('a starter never turns a new carrier away', S.directory.find((b) => b.id === s1.id).refusalPct === 0);
  const outcome = async () => {
    const r = await api('/calls', 'POST', { brokerId: est.id });
    S = r.snapshot;
    return r.call;
  };
  let first = await outcome(), again = await outcome();
  ok('decided once a day: ringing back the same day gets the same answer', (first.status === 'Refused') === (again.status === 'Refused'),
    `${first.status} / ${again.status}`);
  if (first.status === 'Refused')
    ok('and said as it is in the trade', /more experienced|longer record|known for years/.test(first.turns.at(-1).text), first.turns.at(-1).text);

  head('2. Ringing a broker while waiting at the shipper');
  await api('/board/add-many', 'POST', [
    { cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 },
    { cargo: 'Corn', destCity: 'Topeka', destState: 'KS', loadedMiles: 72, gameRevenue: 390, deadlineHours: 30 },
  ]);
  let r = await api('/calls', 'POST', { brokerId: s1.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = r.snapshot;
  ok('booked with a starter', S.booking && S.booking.brokerId === s1.id, S.booking && S.booking.brokerName);
  S = (await api('/run/at-shipper', 'POST', { day: 1, time: '07:00' })).snapshot || S;
  r = await api('/calls', 'POST', { brokerId: s2.id, clocks: CLOCKS });
  ok('at the shipper, not yet pulled away: the call goes through', r.call && r.call.turns.length > 0 && !/Pull over/.test(r.call.turns.at(-1).text),
    `${r.call.status}: ${r.call.turns.at(-1).text.slice(0, 90)}`);
  ok('about the next load, out of where this one ends', !!r.call.lane, JSON.stringify(r.call.lane && r.call.lane.pickupCity));
  S = await hangUp(r.snapshot);
  r = await api('/run/loaded', 'POST', { day: 1, time: '07:40', odometer: 5000 });
  S = r.snapshot;
  ok('and a broker still rings once you pull away', S.call && S.call.status === 'Ringing' && S.call.inbound, JSON.stringify(S.call && S.call.status));
  S = await hangUp(S);
  r = await api('/deliver', 'POST', { day: 1, time: '10:00', odometer: 5070 });
  S = r.snapshot;
  const inv1 = S.invoices.find((i) => i.brokerId === s1.id);
  ok('delivered: an invoice to the first starter', inv1 && inv1.status === 'Open', inv1 && inv1.status);

  // The load only begun in the trip log, "I am at the shipper" never pressed: still at the shipper.
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 1, time: '12:00' });
  await api('/board/add-many', 'POST', [{ cargo: 'Paper', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 380, deadlineHours: 30 }]);
  r = await api('/calls', 'POST', { brokerId: s2.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'accept' });
  S = await api('/run/event', 'POST', { kind: 'BeginLoad', day: 1, time: '12:30' });
  const why = await refused(() => api('/calls', 'POST', { brokerId: s3.id, clocks: CLOCKS }));
  ok('a load begun in the trip log counts as at the shipper too', !/Pull over/.test(why), why || 'went through');
  S = await hangUp((await api('/run/loaded', 'POST', { day: 1, time: '13:00', odometer: 5070 })).snapshot);
  S = (await api('/deliver', 'POST', { day: 1, time: '15:00', odometer: 5140 })).snapshot;
  const inv2 = S.invoices.find((i) => i.brokerId === s2.id);
  ok('an invoice to the second starter', inv2 && inv2.status === 'Open');

  head('3. A load going somewhere');
  S = await api('/status', 'POST', { locationCity: 'Kansas City', locationState: 'KS', day: 2, time: '06:00' });
  await api('/board/add-many', 'POST', [
    { cargo: 'Low1', destCity: 'Topeka', destState: 'KS', loadedMiles: 70, gameRevenue: 200, deadlineHours: 40 },
    { cargo: 'Low2', destCity: 'Omaha', destState: 'NE', loadedMiles: 190, gameRevenue: 470, deadlineHours: 40 },
    { cargo: 'Low3', destCity: 'Tulsa', destState: 'OK', loadedMiles: 250, gameRevenue: 600, deadlineHours: 40 },
    { cargo: 'Hi1', destCity: 'Wichita', destState: 'KS', loadedMiles: 200, gameRevenue: 1400, deadlineHours: 40 },
    { cargo: 'Hi2', destCity: 'Salina', destState: 'KS', loadedMiles: 180, gameRevenue: 1300, deadlineHours: 40 },
    { cargo: 'Hi3', destCity: 'Emporia', destState: 'KS', loadedMiles: 110, gameRevenue: 1000, deadlineHours: 40 },
  ]);
  r = await api('/calls', 'POST', { brokerId: s3.id });
  ok('the broker makes an offer', r.call.status === 'Open' && r.call.load, r.call.turns.at(-1).text);
  const before = r.call.load && r.call.load.id;
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'where', where: 'out' });
  ok('asked for a load out of Kansas: one that leaves it', r.call.load && r.call.load.destState !== 'KS' && r.call.load.id !== before,
    `${r.call.load && r.call.load.destCity}, ${r.call.load && r.call.load.destState}: ${r.call.turns.at(-1).text}`);
  ok('and the broker says so', /out of Kansas/i.test(r.call.turns.at(-1).text), r.call.turns.at(-1).text);
  S = await hangUp(r.snapshot);
  r = await api('/calls', 'POST', { brokerId: s3.id });
  r = await api(`/calls/${r.call.id}/say`, 'POST', { text: "I'd like a load out of Kansas, fuel's cheaper elsewhere" });
  ok('in words too, without the model', r.call.load && r.call.load.destState !== 'KS' && /out of Kansas/i.test(r.call.turns.at(-1).text),
    r.call.turns.at(-1).text);
  r = await api(`/calls/${r.call.id}/say`, 'POST', { kind: 'where', where: 'Northeast' });
  ok('nothing going there: the broker says so, and the offer stands', /Nothing|no freight/i.test(r.call.turns.at(-1).text) && r.call.status === 'Open',
    r.call.turns.at(-1).text);
  S = await hangUp(r.snapshot);

  head('4. A good name in the region');
  const rep = S.market.reputation.find((x) => x.region === REGION);
  ok('two loads on time out of it: known there now', rep && rep.words !== 'Unknown' && rep.score > 0, JSON.stringify(rep));
  e1 = S.directory.find((b) => b.id === est.id);
  ok('and the established broker turns you away less', e1.refusalPct < 30, `${e1.refusalPct}`);

  head('5. Friday evening');
  await api('/test/market', 'POST', { target: s1.id, kind: 'Bankrupt' });
  await api('/test/market', 'POST', { target: s2.id, kind: 'Closed' });
  await api('/test/market', 'POST', { target: est.id, kind: 'Down' });
  await api('/test/market', 'POST', { target: REGION, kind: 'New' });
  // A broker nobody here has heard of, in a region not reached: it happens, but no word of it.
  await api('/test/market', 'POST', { target: 'B12', kind: 'Bankrupt' });
  S = await api('/status', 'POST', { day: 5, time: '17:00' });
  ok('not before the evening', !S.market.unseen.length && S.market.lastFriday < 5, `${S.market.lastFriday}`);
  S = await api('/status', 'POST', { day: 5, time: '19:00' });
  const report = S.market.unseen.find((x) => x.day === 5);
  ok('a report for Friday Day 5', !!report, JSON.stringify(S.market.unseen.map((x) => x.day)));
  const kinds = (report ? report.news : []).map((n) => `${n.kind}:${n.brokerId}`);
  ok('the first starter went bankrupt', kinds.includes(`Bankrupt:${s1.id}`), kinds.join(' '));
  ok('the second closed its doors', kinds.includes(`Closed:${s2.id}`), kinds.join(' '));
  ok('the established broker\'s credit went down', kinds.includes(`Down:${est.id}`), kinds.join(' '));
  const opened = report && report.news.find((n) => n.kind === 'New' && n.region === REGION);
  ok('a new broker opened at home', !!opened, kinds.join(' '));
  const nb = opened && S.directory.find((b) => b.id === opened.brokerId);
  ok('a starter on C or D credit, taking new authorities', nb && nb.tier === 'Starter' && ['C', 'D'].includes(nb.credit) && nb.takesYou,
    nb && `${nb.tier} ${nb.credit} ${nb.requirement}`);
  ok('in the directory straight away', nb && nb.trading);
  ok('nothing said of a region not reached', !report.news.some((n) => n.region === 'Northeast' || n.brokerId === 'B12'),
    report.news.map((n) => n.region).join(', '));
  ok('the report says what to do about money owed', /settlement/.test(report.news.find((n) => n.kind === 'Bankrupt').said));

  head('6. What it means');
  const inv1b = S.invoices.find((i) => i.id === inv1.id);
  ok('the bankrupt broker\'s invoice is frozen', inv1b.status === 'Bankrupt', inv1b.status);
  ok('and counted apart from what is owed', S.owedBankrupt >= inv1b.amount, `${S.owedBankrupt}`);
  ok('the closed broker\'s invoice still stands', S.invoices.find((i) => i.id === inv2.id).status === 'Open');
  ok('a bankrupt broker cannot be rung', /bankrupt/.test(await refused(() => api('/calls', 'POST', { brokerId: s1.id }))));
  ok('nor one that has closed', /closed its doors/.test(await refused(() => api('/calls', 'POST', { brokerId: s2.id }))));
  ok('both off the "works here" list', !S.directory.find((b) => b.id === s1.id).worksHere && !S.directory.find((b) => b.id === s2.id).worksHere);
  ok('a factor will not touch it', /Only an unpaid invoice/.test(await refused(() => api(`/invoices/${inv1.id}/factor`, 'POST'))));
  S = await api('/brokers/news/seen', 'POST');
  ok('read: the popup is done with', S.market.unseen.length === 0);
  ok('and the news stays on the Brokers tab', S.market.recent.some((x) => x.day === 5));

  head('7. The Monday check, with money moved out');
  S = await api('/status', 'POST', { day: 8, time: '08:00' });
  ok('a check is due', !!S.mondayCheck, JSON.stringify(S.mondayCheck));
  const expected = S.mondayCheck.expected;
  ok('a negative balance is still refused', /game bank/.test(await refused(() => api('/finance/check', 'POST', { balance: -5, movedIn: 0 }))));
  r = await api('/finance/check', 'POST', { balance: expected - 10000, movedIn: -10000 });
  ok('$10,000 taken out to the companion account is not a loss', /just as expected/.test(r.said), r.said);
  ok('and is on the record as a minus', r.snapshot.finance.checks.at(-1).movedIn === -10000, `${r.snapshot.finance.checks.at(-1).movedIn}`);

  head('8. A settlement');
  r = await api(`/invoices/${inv1.id}/settle`, 'POST');
  ok('claimed', /claim filed/.test(r.said), r.said);
  const claimed = r.snapshot.invoices.find((i) => i.id === inv1.id);
  ok('a share of five to twenty cents on the dollar, in two to four weeks', claimed.status === 'Claimed'
    && claimed.settlementShare >= 0.05 && claimed.settlementShare <= 0.2, `${claimed.settlementShare} ${claimed.paysGameTime}`);
  ok('once only', /Only an invoice on a bankrupt broker/.test(await refused(() => api(`/invoices/${inv1.id}/settle`, 'POST'))));

  head('9. Every region keeps a door open');
  S = await api('/status', 'POST', { day: 9, time: '08:00' });
  const doors = S.directory.filter((b) => b.trading && b.regions.includes(REGION) && door(b));
  for (const b of doors) await api('/test/market', 'POST', { target: b.id, kind: 'Bankrupt' });
  S = await api('/status', 'POST', { day: 12, time: '19:00' });
  const left = S.directory.filter((b) => b.trading && b.regions.includes(REGION) && door(b));
  ok(`all ${doors.length} told to fail: one is spared`, left.length >= 1, left.map((b) => b.name).join(', '));
  S = await api('/brokers/news/seen', 'POST');

  head('10. Weeks later');
  S = await api('/status', 'POST', { day: 50, time: '12:00' });
  const settled = S.invoices.find((i) => i.id === inv1.id);
  ok('the settlement paid', settled.status === 'Settled', settled.status);
  const move = S.transfers.find((t) => t.reference === inv1.number && t.from === 'Broker holding');
  ok('a little of it, to move out of Broker holding', move && move.amount > 0 && move.amount <= inv1.amount * 0.2 + 0.01,
    move && `${move.amount} of ${inv1.amount}`);
  ok('the closed broker paid in full', S.invoices.find((i) => i.id === inv2.id).status === 'Paid', S.invoices.find((i) => i.id === inv2.id).status);
  ok('one report a Friday, quiet ones included', S.market.lastFriday === 47, `${S.market.lastFriday}`);
  const quiet = S.market.unseen.filter((x) => x.news.length === 0);
  ok('a quiet week is still reported, for the popup to say so', quiet.length > 0 && S.market.unseen.length === 5,
    S.market.unseen.map((x) => `${x.day}:${x.news.length}`).join(' '));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
