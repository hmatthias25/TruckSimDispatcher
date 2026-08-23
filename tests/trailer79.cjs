/* Issue #79: operations decides which trailers go and what replaces them.
 *
 * The fleet report used to flag a trailer as old and under-utilised and then leave the driver to work
 * out whether it really needed replacing and what with — "replace with the same one, or re-rig for
 * whatever the lane is actually offering". A company driver does not decide fleet composition, and the
 * utilisation figures for the whole fleet are not theirs to weigh.
 *
 * So: a decision, a named replacement type chosen off utilisation across the fleet, a numbered order to
 * close out, and a watch line for the trailers that are only on the radar.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5996}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(j?.error || t.slice(0, 300));
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);

let S, day = 1;
const gt = () => `2000-${String(Math.floor((day - 1) / 28) + 1).padStart(2, '0')}-${String(((day - 1) % 28) + 1).padStart(2, '0')}T08:00`;

async function setTime() {
  S = un(await api('/status', 'POST', {
    locationCity: 'Springfield', locationState: 'MO', locationKind: 'Terminal', gameTime: gt(),
    fuelPct: 90, atsOdometer: 5000, truckDamagePct: 2, trailerDamagePct: 1,
    dutyStatus: 'OnDuty', atsBankBalance: 500000,
  }));
}

async function fileReport(lines) {
  const start = gt();
  day += 15;
  await setTime();
  const r = await api('/fleetops/report', 'POST', { periodStartGame: start, periodEndGame: gt(), notes: '', lines });
  S = r.snapshot;
  return r.report;
}

const line = (d, over) => ({
  driverId: d.id, truckUnit: d.assignedTruckUnit, trailerUnit: d.assignedTrailerUnit,
  level: 6, rating: 9.0, perMile: 1.80, perDay: 700, revenue: 11000, miles: 6200,
  truckStars: 5, truckOdometer: 180000, trailerStars: 5, ...over,
});

(async () => {
  const app = { driverName: 'F. Manager', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 9, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  // Werner runs dry van and reefer, so a type switch between them is a real option.
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: gt(), code: 'WER' }));
  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  const stock = await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'automatic', addTrailers: true,
  });
  S = stock.snapshot;
  const units = stock.result.trucks;

  // Stocking the yard buys equipment; somebody still has to be put in it.
  const mk = async (name, unit, trailer) => (await api('/fleetops/drivers', 'POST',
    { name, assignedTruckUnit: unit, assignedTrailerUnit: trailer, skill: 'Competent', status: 'Active',
      wageShare: 0.3, homeTerminalId: hq.id })).snapshot;
  const spare = S.trailers.filter((t) => t.unit !== S.driver.assignedTrailerUnit).map((t) => t.unit);
  S = await mk('A. One', units[0], spare[0]);
  S = await mk('B. Two', units[1], spare[1]);

  const drivers = ((await api('/fleetops')).drivers || [])
    .filter((d) => d.status === 'Active' && d.assignedTrailerUnit);
  ok('there are hired drivers pulling company trailers', drivers.length >= 2,
    drivers.map((d) => `${d.name}:${d.assignedTrailerUnit}`).join(' '));
  if (drivers.length < 2) { console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = 1; return; }

  const typeOf = (unit) => (S.trailers.find((t) => t.unit === unit) || {}).type || '?';
  console.log(`     trailer types in play: ${drivers.map((d) => `${d.assignedTrailerUnit}=${typeOf(d.assignedTrailerUnit)}`).join(' ')}`);

  head('0. A second trailer type on the property, so a switch is a real option');
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'R900', type: 'Reefer', stars: 5, terminalId: hq.id, inGameGarage: true,
    acquiredGameTime: gt(), utilisationPct: 12,
  }));
  const reefer = S.trailers.find((x) => x.unit === 'R900');
  ok('a reefer is on the books', !!reefer, reefer ? `${reefer.unit} ${reefer.type}` : 'not added');

  head('1. A trailer that is only quiet gets watched, not condemned');
  // Low utilisation, good stars, not old: one soft reason, which is a quiet fortnight not a verdict.
  let rep = await fileReport(drivers.map((d, i) => line(d, {
    trailerStars: 5, trailerUtilisationPct: i === 0 ? 18 : 80,
  })));
  const watch = rep.watching || [];
  ok('it is on a watch list', watch.length >= 1,
    watch.map((w) => w.unit).join(', ') || 'nothing watched');
  ok('the note names the utilisation', /%/.test(watch[0]?.note || ''), watch[0]?.note || '');
  ok('and says there is nothing to do',
    /nothing for you to do/i.test(watch[0]?.note || ''), watch[0]?.note || '');
  ok('no replacement was decided on one soft reason',
    !(rep.retirements || []).some((r) => r.unitKind === 'Trailer' && r.unit === watch[0]?.unit),
    (rep.retirements || []).filter((r) => r.unitKind === 'Trailer').map((r) => r.unit).join(', ') || 'none');

  head('2. A trailer at the condition line IS replaced, and the company says with what');
  const doomed = drivers[0];
  const doomedType = typeOf(doomed.assignedTrailerUnit);
  rep = await fileReport(drivers.map((d, i) => line(d, {
    trailerStars: i === 0 ? 2 : 5,
    trailerUtilisationPct: i === 0 ? 15 : 85,
  })));
  const ret = (rep.retirements || []).filter((r) => r.unitKind === 'Trailer');
  ok('a replacement is decided', ret.length >= 1, ret.map((r) => r.unit).join(', ') || 'none');
  const ev = (ret[0]?.evidence || []).join(' | ');
  ok('the headline is a decision, not a suggestion',
    /we are replacing it with/i.test(ret[0]?.headline || ''), ret[0]?.headline || '');
  ok('the headline names the replacement type',
    /(dry van|reefer|flatbed|step deck|tanker|lowboy)/i.test((ret[0]?.headline || '').split('with a')[1] || ''),
    (ret[0]?.headline || '').slice(-60));
  ok('the reasoning is on file', /like for like|going to a/i.test(ev), ev.slice(0, 140));

  head('3. Nothing is left for the driver to work out');
  ok('no re-rig-it-yourself line', !/re-rig for whatever|or re-rig/i.test(ev), ev.slice(0, 140));
  ok('nobody is asked to decide if it really needs doing',
    !/if it really|figure out|worth replacing|recommend replacing/i.test(ret[0]?.headline + ' | ' + ev), '');

  head('4. It arrives as a numbered order, like a wrecked tractor does');
  ok('the evidence names the order', /is raised for it|once the equipment order/i.test(ev),
    (ev.match(/[^|]*(raised for it|equipment order)[^|]*/i) || ['(none)'])[0].trim().slice(0, 130));
  const order = (await api('/equipment')).openOrder;
  if (order) {
    ok('an equipment order is open', !!order.number, order.number);
    ok('it is a trailer swap', order.kind === 'TrailerSwap', `${order.kind}`);
    ok('it must be purchased, since the yard has none spare', order.mustPurchase === true, `${order.mustPurchase}`);
    ok('it names the trailer coming off', order.fromTrailerUnit === doomed.assignedTrailerUnit,
      `${order.fromTrailerUnit} against ${doomed.assignedTrailerUnit}`);
    ok('and tells the driver to buy it and close the order',
      /buy the replacement in ATS/i.test(order.instruction || '') && /mark this order complete/i.test(order.instruction || ''),
      (order.instruction || '').slice(0, 120));
  } else {
    ok('the report explains why no order yet', /once the equipment order/i.test(ev), ev.slice(-110));
  }

  head('5. The type is chosen off utilisation, not off a coin toss');
  const switched = /going to a/i.test(ev);
  const util = (S.trailers || []).filter((t) => t.utilisationPct >= 0)
    .map((t) => `${t.type} ${t.utilisationPct}%`).join(', ');
  console.log(`     utilisation on file: ${util || '(none reported)'}`);
  if (switched) {
    ok('a type switch cites both figures', /\d+(\.\d+)?% against \d+(\.\d+)?%/.test(ev),
      (ev.match(/[^|]*against[^|]*/i) || [''])[0].trim().slice(0, 130));
    ok('and it moves away from the retiring type',
      !new RegExp(`with a ${doomedType}`, 'i').test(ret[0]?.headline || ''), ret[0]?.headline || '');
  } else {
    ok('like for like is stated as the decision', /like for like/i.test(ev),
      (ev.match(/[^|]*[Ll]ike for like[^|]*/) || [''])[0].trim().slice(0, 110));
    ok('and it replaces the same type',
      new RegExp(doomedType, 'i').test(ret[0]?.headline || ''),
      `${doomedType} -> ${(ret[0]?.headline || '').slice(-40)}`);
  }

  head('6. A decisive utilisation gap moves the replacement to the better type');
  if (reefer) {
    S = un(await api('/fleetops/drivers', 'POST', {
      id: drivers[1].id, name: drivers[1].name, assignedTruckUnit: drivers[1].assignedTruckUnit,
      assignedTrailerUnit: 'R900', skill: 'Competent', status: 'Active', wageShare: 0.3,
      homeTerminalId: hq.id,
    }));
    const roster = (await api('/fleetops')).drivers || [];
    const onReefer = roster.find((d) => d.assignedTrailerUnit === 'R900');
    const onVan = roster.find((d) => d.assignedTrailerUnit && d.assignedTrailerUnit !== 'R900');
    if (onReefer && onVan) {
      const rep6 = await fileReport([
        line(onVan, { trailerStars: 5, trailerUtilisationPct: 90 }),
        line(onReefer, { trailerStars: 2, trailerUtilisationPct: 10 }),
      ]);
      const r6 = (rep6.retirements || []).find((x) => x.unit === 'R900');
      const ev6 = (r6 && r6.evidence ? r6.evidence : []).join(' | ');
      ok('the reefer is the one being replaced', !!r6, (r6 && r6.headline) || 'not flagged');
      ok('and it is NOT replaced with another reefer',
        !/with a reefer/i.test((r6 && r6.headline) || ''), (r6 && r6.headline) || '');
      // Must match the SWITCH line, not the generic "against the 35% we want to see" evidence.
      ok('the switch cites both utilisation figures',
        /running at [\d.]+% against [\d.]+%/i.test(ev6),
        (ev6.match(/[^|]*running at[^|]*/i) || ['(no switch figures)'])[0].trim().slice(0, 140));
      ok('and says that is where the freight is',
        /where the freight is/i.test(ev6),
        (ev6.match(/[^|]*freight is[^|]*/i) || [''])[0].trim().slice(0, 90));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
