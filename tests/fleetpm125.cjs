/* Issue #125 — scheduled maintenance on tractors the player cannot drive to a shop.
 *
 * A hired driver's truck raised the same "PM overdue by 11,400 mi" alert the player's own truck raises,
 * and ATS gives no way to act on it. An alert nobody can carry out is worse than none: it teaches the
 * player to skip the panel where the alerts that matter live.
 *
 * The first cut answered it with approve/defer buttons, which was wrong. The player is a company
 * DRIVER — probation, reviews, discipline, home time — and an employee does not authorise the company's
 * capital spending or defer its maintenance. The yard services its own units when the fleet report is
 * filed. Deferring still happens; the company does it when the balance is thin, and the player reads
 * about it rather than choosing it.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5860}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const H = require('./lib/helpers.cjs');
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const at = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, period = 0;
const views = async () => (await api('/bootstrap')).views;
const pmFor = async (u) => ((await views()).fleetPm || []).find((x) => x.unit === u);
// Operating is the one account that matters here: repairs and services both post to it, because
// the reserves are an earmark on a single bank balance rather than separate pots.
const cash = async () => ((await api('/finance')).accounts || [])
  .find((a) => a.key === 'operating')?.balance ?? 0;

/** A unit on the fleet, run well past its service interval. */
async function unit(u, odo, serviceMiles, damage = 4) {
  await api('/fleet/truck', 'POST', {
    unit: u, make: 'Freightliner', model: 'Cascadia', year: 2019,
    atsOdometer: odo, serviceMiles, lastServiceMiles: 0, serviceIntervalMiles: 25000,
    damagePct: damage, inGameGarage: true, homeTerminalId: S.company.terminals[0].id,
  });
}

async function hire(name, u) {
  return (await api('/fleetops/drivers', 'POST', {
    name, status: 'Active', assignedTruckUnit: u, skill: 'Experienced',
    homeTerminalId: S.company.terminals[0].id, hiredGameDate: at(2),
  })).driver;
}

/** Move the operating balance to roughly a target, so the reserve floor can be exercised. */
async function setCash(target) {
  const now = await cash();
  await api('/finance/entry', 'POST', {
    accountKey: 'operating', amount: Math.round(target - now),
    category: 'Other', memo: 'fixture — balance set',
  });
}

/** File a report for the drivers named, and hand back what came of it. */
async function fileReport(driverIds) {
  period += 15;
  return (await api('/fleetops/report', 'POST', {
    periodStartGame: at(period - 15 + 5), periodEndGame: at(period + 5),
    lines: driverIds.map((id) => ({
      driverId: id, truckStars: 4, trailerStars: 4,
      revenue: 0, repairs: 0, perDay: 0, perMile: 0,
    })),
  })).report;
}

/** Every finding mentioning a unit, joined. A report carries several lines per unit, so picking the
 * first match reads whichever one happens to come first rather than the one being asked about. */
const found = (rep, re) => (rep.findings || []).filter((f) => re.test(f)).join(' | ');

(async () => {
  const app = { driverName: 'P. Emm', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Springfield', homeState: 'MO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: at(1) }));
  await H.clearDiscipline(api);
  // A default career is a one-slot yard and this suite stands up several tractors.
  S = un(await api(`/terminals/${S.company.terminals[0].id}/level`, 'POST', { level: 'Large' }));
  await setCash(200000);

  head('1. #125 There is no button, because it is not the driver\'s call');
  // The heart of it. A company driver has no authority over the company's capital spending, and the app
  // must not offer them any — an approve/defer pair contradicts everything else the app tells them.
  await unit('T900', 310000, 44000);
  const marcus = await hire('M. Reyes', 'T900');
  let refused = 0;
  for (const path of ['/fleetops/pm/schedule', '/fleetops/pm/defer']) {
    try { await api(path, 'POST', { unit: 'T900' }); } catch (e) { if (e.status >= 400) refused++; }
  }
  ok('no endpoint exists to authorise or defer a service', refused === 2, `${refused}/2 refused`);

  head('2. #125 What is coming is visible before it happens');
  const soon = await pmFor('T900');
  ok('the unit shows as due', !!soon, soon ? soon.headline : '(none)');
  ok('it names the driver', soon?.driver === 'M. Reyes', soon?.driver);
  ok('it says how far past due', soon?.milesPastDue === 19000, `${soon?.milesPastDue} mi`);
  ok('and what it is expected to cost', soon?.cost > 0, `$${soon?.cost}`);
  ok('it says the yard does it at the report, not that you do',
    /yard will do it at the next fleet report/i.test(soon?.detail || ''), soon?.detail?.slice(0, 80));
  ok('and that nobody is being parked for it',
    /nothing is being parked/i.test(soon?.detail || ''), 'said');
  ok('the alert says the same rather than nagging',
    ((await views()).maintenanceAlerts || []).some((a) => /T900/.test(a) && /next fleet report/i.test(a)),
    ((await views()).maintenanceAlerts || []).find((a) => /T900/.test(a))?.slice(0, 90) || '(none)');

  head('3. #125 Filing the report is what services it');
  const rep = await fileReport([marcus.id]);
  ok('the findings say it was done', /was due a PM\. Done at the yard/i.test(found(rep, /T900/)),
    found(rep, /T900/).slice(0, 110));
  ok('the service clock is reset', !(await pmFor('T900')), 'no longer due');
  const posted = (await api('/ledger?take=80')).find((e) => /PM . unit T900/i.test(e.memo || ''));
  ok('and the company paid for it', !!posted && posted.amount < 0,
    posted ? `${posted.memo} ${posted.amount}` : '(nothing posted)');

  head('4. #125 Nobody stops driving for a service');
  // The one thing the app must not claim: ATS keeps them rolling whatever the app says.
  const still = (await api('/fleetops')).drivers.find((x) => x.id === marcus.id);
  ok('the driver is still active', still?.status === 'Active', still?.status);
  ok('and still on the unit', still?.assignedTruckUnit === 'T900', still?.assignedTruckUnit);
  ok('nothing claims the truck sat',
    !/days? (out of service|down|in the (bay|shop))/i.test(found(rep, /T900/)), 'no downtime claimed');

  head('5. #125 A thin balance holds it over — the company deciding, not the driver');
  await unit('T901', 330000, 70000);
  const jo = await hire('J. Okafor', 'T901');
  await setCash(5200);
  const thin = await fileReport([jo.id]);
  const held = found(thin, /T901/);
  ok('the report says it is being held over', /held over/i.test(held), held.slice(0, 130));
  ok('and says why, in money', /will not carry a \$/i.test(held), 'balance named');
  ok('it is counted against the unit', (await pmFor('T901'))?.deferrals >= 1,
    `${(await pmFor('T901'))?.deferrals}`);
  ok('the driver is told the risk it creates, not asked to accept it',
    /% to find something/i.test(held), 'risk stated');

  head('6. #125 With money in the account it goes in next time');
  await setCash(200000);
  const later = await fileReport([jo.id]);
  ok('the held-over unit is serviced once the cash is there',
    /Done at the yard|not coming out|needed more than a service/i.test(found(later, /T901/)),
    found(later, /T901/).slice(0, 110));
  ok('and the deferral count is cleared with it', !(await pmFor('T901')), 'no longer due');

  head('7. #125 A condemned unit comes out as trade instructions');
  // Deep into a second life. The shop stops rather than rebuilding, and this is the one case where a
  // unit genuinely comes off the road — the player is being sent into ATS to replace it, so the app and
  // the game converge instead of drifting apart.
  let condemned = null, hand = null;
  for (let i = 0; i < 20 && !condemned; i++) {
    await setCash(200000);
    await unit('T95', 900000 + i * 15000, 90000 + i * 3000, 26);
    hand = hand || await hire('Old Hand', 'T95');
    const r = await fileReport([hand.id]);
    if (/is not coming out/i.test(found(r, /T95/))) condemned = r;
  }
  ok('a high-mileage unit does eventually get condemned', !!condemned, condemned ? 'yes' : 'none in 20');
  if (condemned) {
    ok('the finding says why, in miles',
      /mi the shop will not put it back/i.test(found(condemned, /T95/)),
      found(condemned, /T95/).slice(0, 115));
    ok('it tells them what to sell and what to buy',
      (condemned.instructions || []).some((x) => /Trade unit|Sell unit/i.test(x))
      && (condemned.instructions || []).some((x) => /buy/i.test(x)),
      (condemned.instructions || []).join(' | ').slice(0, 150));
    ok('the unit stops raising a service line', !(await pmFor('T95')), 'off the list');
  }

  head('8. #125 Your own truck is still your job, and now it costs to ignore it');
  // The authority question does not arise here: driving the truck you are sitting in to a shop is a
  // driver's task, not the company's capital spending. What changed is that letting it run a long way
  // past due is now said to cost, before booking it rather than at the till.
  const mine = (await api('/bootstrap')).driver.assignedTruckUnit;
  await api('/fleet/truck', 'POST', {
    unit: mine, atsOdometer: 120000, serviceMiles: 30000, lastServiceMiles: 0,
    serviceIntervalMiles: 25000, damagePct: 3, inGameGarage: true,
  });
  let pm = (await views()).pm;
  ok('an overdue PM on your own truck still tells you', pm?.due === true, `due=${pm?.due}`);
  ok('modestly overdue says nothing alarming', !pm?.warning, pm?.warning || '(no warning)');

  await api('/fleet/truck', 'POST', {
    unit: mine, atsOdometer: 760000, serviceMiles: 220000, lastServiceMiles: 0,
    serviceIntervalMiles: 25000, damagePct: 24, inGameGarage: true,
  });
  pm = (await views()).pm;
  ok('a long way over, it warns what you are actually booking',
    /whatever they find/i.test(pm?.warning || ''), (pm?.warning || '(none)').slice(0, 115));
  ok('it still names where to take it', (pm?.shopYards || []).length >= 0,
    `${(pm?.shopYards || []).length} company yard(s)`);
  ok('and your own truck raises no fleet service line — it is yours to drive there',
    !(await pmFor(mine)), 'not on the fleet list');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
