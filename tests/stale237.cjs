/* Two things reported from play after retiring a tanker by hand.
 *
 *   1. "My game still says I need to swap it, when I try I get an error."
 *
 *      The swap order was raised against a box that then left the fleet. Closing one goes looking for a
 *      replacement to hook and throws when it finds none, so the order could not be cleared — and it was
 *      holding the single open-order slot shut, which is the slot the next tractor or trailer the
 *      company wants has to come through.
 *
 *   2. "Got a message that I need to take value out of ATS for maintenance. Are we still doing that? I
 *      thought we weren't messing with ATS money now."
 *
 *      We are not. That instruction dates from when the app reconciled its books against the reported
 *      balance, and its whole justification was "the two will not agree until you do". The reconciliation
 *      is gone and #236 now reports the gap rather than asking anybody to close it. Asking a driver to
 *      reach into the carrier's bank to make the app's arithmetic come out was the inversion the rest of
 *      this app argues against.
 *
 *      The cost stays — ATS abstracts a hired driver's servicing away, so a PM booked on their tractor is
 *      a cost a real carrier pays and the game never does. It moves to a category the bank comparison
 *      leaves out, or it would show a gap every period that was nothing but our own fiction.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
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

let S, yardId;
const orders = async () => (await api('/export')).equipmentOrders || [];

(async () => {
  const app = { driverName: 'W. Achebe', preferredDivision: 'Tanker', transmissionPreference: 'either',
    experienceYears: 12, homeCity: 'Houston', homeState: 'TX', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yardId = S.company.terminals[0].id;

  head('1. An order against a box that has left the fleet can be closed');
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'TK-9', type: 'Tanker', subtype: 'Chemical', division: 'Tanker', year: 2019,
    status: 'InService', inGameGarage: true, homeTerminalId: yardId,
  }));
  let st = await api('/export');
  st.equipmentOrders = [{
    number: 'SFL-EQ-900', kind: 'TrailerSwap', status: 'Open',
    reason: 'fixture', instruction: 'Buy the replacement.', fromTrailerUnit: 'TK-9',
    toTrailerUnit: '', terminalId: yardId, terminalLabel: 'Houston, TX',
    mustPurchase: true, replacementType: 'Reefer', issuedGameTime: iso(5),
  }];
  S = un(await api('/import', 'POST', st));
  ok('the order is open', (await orders()).some((o) => o.number === 'SFL-EQ-900' && o.status === 'Open'),
    'open');

  // Retire the box the way the player did — by hand, with nothing replacing it.
  const ret = await api('/fleetops/retire', 'POST', { unit: 'TK-9', replacementUnit: '', soldFor: 0 });
  S = un(ret);
  console.log(`  ..    ${ret.message}`);

  const r = await api('/equipment/orders/SFL-EQ-900/complete', 'POST', {});
  console.log(`  ..    ${r.message || JSON.stringify(r).slice(0, 110)}`);
  ok('closing it does not error', true, 'no throw');
  ok('and it is closed', !(await orders()).some((o) => o.number === 'SFL-EQ-900' && o.status === 'Open'),
    (await orders()).find((o) => o.number === 'SFL-EQ-900')?.status);
  ok('the message says why rather than pretending a swap happened',
    /nothing left to swap|off the fleet already/i.test(r.message || ''), (r.message || '').slice(0, 110));

  head('2. One already stranded is cleared on load, and said out loud');
  st = await api('/export');
  st.equipmentOrders = [{
    number: 'SFL-EQ-901', kind: 'TrailerSwap', status: 'Open',
    reason: 'fixture', instruction: 'Buy the replacement.', fromTrailerUnit: 'GONE-1',
    toTrailerUnit: '', terminalId: yardId, terminalLabel: 'Houston, TX',
    mustPurchase: true, issuedGameTime: iso(5),
  }];
  S = un(await api('/import', 'POST', st));
  ok('the stranded order was closed on load',
    !(await orders()).some((o) => o.number === 'SFL-EQ-901' && o.status === 'Open'),
    (await orders()).find((o) => o.number === 'SFL-EQ-901')?.status);
  const events = await api('/events?take=60');
  const said = events.find((e) => /swap order\(s\) closed/i.test(e.message || ''));
  ok('and the player is told', !!said, said?.message?.slice(0, 120) || '(silent)');

  head('3. An order against a box still on the fleet is left alone');
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'TK-10', type: 'Tanker', subtype: 'Fuel', division: 'Tanker', year: 2020,
    status: 'InService', inGameGarage: true, homeTerminalId: yardId,
  }));
  st = await api('/export');
  st.equipmentOrders = [{
    number: 'SFL-EQ-902', kind: 'TrailerSwap', status: 'Open',
    reason: 'fixture', instruction: 'Buy the replacement.', fromTrailerUnit: 'TK-10',
    toTrailerUnit: '', terminalId: yardId, terminalLabel: 'Houston, TX',
    mustPurchase: true, issuedGameTime: iso(5),
  }];
  S = un(await api('/import', 'POST', st));
  ok('a live order survives the tidy-up',
    (await orders()).some((o) => o.number === 'SFL-EQ-902' && o.status === 'Open'), 'still open');

  head('4. Nobody is told to move money in ATS for fleet servicing');
  st = await api('/export');
  st.equipmentOrders = [];
  await api('/import', 'POST', st);
  // Room for a second tractor: the hire already put one on a Small yard, which holds exactly one.
  S = un(await api(`/terminals/${yardId}/level`, 'POST', { level: 'Large' }));
  await api('/fleet/truck', 'POST', {
    unit: 'S-1', make: 'Peterbilt', model: '579', year: 2019, atsOdometer: 400000,
    serviceMiles: 400000, lastServiceMiles: 300000, serviceIntervalMiles: 25000,
    damagePct: 5, inGameGarage: true, homeTerminalId: yardId,
  });
  const hired = (await api('/fleetops/drivers', 'POST', {
    name: 'D. Sarr', status: 'Active', assignedTruckUnit: 'S-1', skill: 'Experienced',
    homeTerminalId: yardId, hiredGameDate: iso(3), level: 8,
  })).driver;
  const rep = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(5), periodEndGame: iso(20),
    lines: [{ driverId: hired.id, level: 8, perMile: 2.00, perDay: 600,
              truckStars: 3, truckOdometer: 404000 }],
  })).report;
  const said2 = [...(rep.instructions || []), ...(rep.findings || [])].join(' | ');
  console.log(`  ..    repairs $${rep.totalRepairs}`);
  ok('the yard work still costs the company', rep.totalRepairs > 0, `$${rep.totalRepairs}`);
  ok('but nothing tells the player to take money out of the game',
    !/take \$[\d,]+ out in ats/i.test(said2), (said2.match(/[^|]*out in ATS[^|]*/i) || ['none'])[0].slice(0, 90));
  ok('and it says plainly that ATS does not bill for it',
    /does not bill you|nothing to take out of the game/i.test(said2),
    (said2.match(/[^|]*nothing to take out[^|]*/i) || ['(not said)'])[0].slice(0, 110));

  head('5. Fleet servicing is kept out of the bank comparison');
  // It is a cost ATS never charges, so counting it as game-real would show a gap every single period
  // that was nothing but the app's own fiction.
  const led = (await api('/export')).ledger;
  const fleetPm = led.filter((e) => e.category === 'FleetMaintenance');
  ok('it posts under its own category', fleetPm.length > 0, `${fleetPm.length} entr(ies)`);
  ok('and none of it is filed as ordinary maintenance',
    !led.some((e) => e.category === 'Maintenance' && /unit S-1/i.test(e.memo || '')),
    'not double-filed');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
