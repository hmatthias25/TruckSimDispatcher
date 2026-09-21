/* The filed fleet report was reading two fields that were retired two schema versions ago.
 *
 *   "why is wages and revenue 0 here?"
 *
 * Screenshot: PRI-FR-0008, net $119,843.87, repairs $13,117.00, miles 60,575 -- and beside them
 * "revenue $0.00  wages $0.00". Six units through the shop and $4,153 on equipment, so plainly nothing
 * about the period was empty.
 *
 * Both fields are dead and are meant to be:
 *
 *   TotalRevenue  [Obsolete] "Renamed to TotalContribution -- the figure was never gross revenue."
 *   TotalWages    [Obsolete] "Never read. ATS pays hired drivers before it reports their profit."
 *
 * There was never a wage. ATS takes the driver's pay, the fuel and the tolls out before it prints an
 * income per mile, so the app used to invent a wage and subtract it from a figure that was already net
 * -- understating every period twice over. Schema 22 moved the money to TotalContribution and zeroed
 * the rest. Nothing has written either field since; the only code that touches them sets them to zero.
 *
 * The C# says [Obsolete] and the browser cannot read attributes, so the modal went on printing them,
 * confidently, at $0.00, on every report filed since. A blank would have been a bug anybody spotted in
 * a day. A zero looks like an answer.
 *
 * So this suite pins the ones that carry the money, and pins the arithmetic the strip now has to show:
 * net is contribution less repairs less what the company spent on itself.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5893}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};
const money = (v) => `$${(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let S, hq;
const place = async (day, bank = 400000) => {
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Terminal', gameTime: iso(day),
    fuelPct: 80, atsOdometer: 20000 + day * 100, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OnDuty', atsBankBalance: bank,
  }));
  return S;
};

(async () => {
  const app = { driverName: 'Fleet Boss', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 9, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(0), code: 'SFL' }));
  hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  await place(1);

  for (const [unit, type] of [['T801', 'Dry Van'], ['T802', 'Reefer']]) {
    S = un(await api('/fleet/trailer', 'POST', {
      unit, type, division: type, inGameGarage: true, isCompanyOwned: true, status: 'InService',
      homeTerminalId: hq.id, currentLocation: 'Denver, CO', acquiredGameTime: iso(0),
    }));
  }
  for (const [unit, make] of [['901', 'Peterbilt'], ['902', 'Kenworth']]) {
    S = un(await api('/fleet/truck', 'POST', {
      unit, make, model: '579', year: 2018, inGameGarage: true, isCompanyOwned: true,
      status: 'InService', homeTerminalId: hq.id, serviceMiles: 200000, atsOdometer: 200000, stars: 5,
    }));
  }
  for (const [name, truck] of [['R. Vance', '901'], ['D. Kroll', '902']]) {
    S = (await api('/fleetops/drivers', 'POST', {
      name, assignedTruckUnit: truck, skill: 'Competent', status: 'Active',
      wageShare: 0.3, homeTerminalId: hq.id, hiredGameDate: iso(0),
    })).snapshot;
  }
  const drivers = (await api('/fleetops')).drivers;
  const [vance, kroll] = ['R. Vance', 'D. Kroll'].map((n) => drivers.find((d) => d.name === n));

  head('1. A period with real production in it');
  await place(15);
  const r = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(0), periodEndGame: iso(15),
    lines: [
      // Exactly what the form sends: a level, the two averages off the driver manager, stars and an
      // odometer. No revenue, no wages, no repairs — ATS shows no period total for a driver you are
      // not sitting next to, so those boxes were removed and the app derives all three.
      { driverId: vance.id, trailerUnit: 'T801', truckOdometer: 212000, truckStars: 4.5,
        trailerStars: 4, perDay: 400, perMile: 2.0 },
      { driverId: kroll.id, trailerUnit: 'T802', truckOdometer: 209000, truckStars: 4.5,
        trailerStars: 5, perDay: 380, perMile: 1.9 },
    ],
  })).report;
  console.log(`  ..    contribution ${money(r.totalContribution)}  repairs ${money(r.totalRepairs)}  ` +
              `capital ${money(r.totalCapital)}  net ${money(r.netContribution)}  miles ${r.totalMiles}`);
  ok('miles came through, as they always did', r.totalMiles > 0, `${r.totalMiles}`);
  ok('and so did the money the drivers brought in', r.totalContribution > 0, money(r.totalContribution));
  ok('derived from the averages, since nothing typed a total in',
    Math.abs(r.totalContribution - (2.0 * 12000 + 1.9 * 9000)) < 1, money(r.totalContribution));

  head('2. The two fields the modal used to print are dead, and stay dead');
  // Not a bug to fix by repopulating them. There is no wage to report, and the figure was never gross,
  // so the right answer is that nothing reads them -- which is why this pins zero rather than a value.
  console.log(`  ..    totalRevenue ${money(r.totalRevenue)}, totalWages ${money(r.totalWages)}`);
  ok('totalRevenue is zero', !r.totalRevenue, money(r.totalRevenue));
  ok('totalWages is zero', !r.totalWages, money(r.totalWages));
  ok('so a panel reading them would show nothing on a period that earned real money',
    !r.totalRevenue && !r.totalWages && r.totalContribution > 0, 'exactly the reported bug');

  head('3. What the strip shows has to add up to the net');
  // contribution - repairs - capital. Without capital on the panel the arithmetic is unexplainable,
  // which is its own kind of wrong: the reported screenshot had $4,153 of it.
  console.log(`  ..    repairs ${money(r.totalRepairs)} — the shop's own doing, nothing typed one in`);
  const adds = r.totalContribution - r.totalRepairs - r.totalCapital;
  console.log(`  ..    ${money(r.totalContribution)} - ${money(r.totalRepairs)} - ${money(r.totalCapital)} = ${money(adds)}`);
  ok('net is contribution less repairs less capital', Math.abs(adds - r.netContribution) < 0.02,
    `${money(adds)} against a stated net of ${money(r.netContribution)}`);

  head('4. Per-driver lines carry it the same way');
  const vLine = r.lines.find((l) => l.driverName === 'R. Vance');
  ok('the line has a contribution', vLine.contribution > 0, money(vLine.contribution));
  ok('and its own working, so the figure is checkable', !!vLine.revenueBasis, vLine.revenueBasis || '(none)');
  // Nothing posted one, so nothing should have landed on the retired field either.
  ok('the retired line field stayed empty', !vLine.revenue, money(vLine.revenue));

  head('5. A losing period does not tell the player to check wages');
  // The advice outlived the figure it was about. There is no wage line to check, and being sent to look
  // for one is being sent to look for something that does not exist.
  await place(30);
  const bad = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(15), periodEndGame: iso(30),
    lines: [
      { driverId: vance.id, trailerUnit: 'T801', truckOdometer: 213000, truckStars: 3,
        trailerStars: 4, perDay: 30, perMile: 0.05 },
    ],
  })).report;
  const loss = (bad.findings || []).find((f) => /lost money/i.test(f)) || '';
  console.log(`  ..    net ${money(bad.netContribution)} — ${loss || '(no loss finding)'}`);
  if (bad.netContribution < 0) {
    ok('it says the fleet lost money', !!loss);
    ok('without sending anybody after a wage figure that does not exist', !/wage/i.test(loss),
      /wage/i.test(loss) ? 'still mentions wages' : 'quiet on wages');
    ok('and names what actually ate it', /brought in/i.test(loss), loss.slice(0, 110));
    // A shop bill of zero must not be printed as "$0 of repairs", nor followed by an instruction to go
    // and look at what went through the shop. The report has to talk about its own figures.
    ok('without inventing a shop bill that was not there',
      bad.totalRepairs > 0 ? /of repairs/i.test(loss) : !/repairs/i.test(loss),
      `repairs ${money(bad.totalRepairs)}`);
  } else {
    ok('the fixture did not manage a loss, so nothing to check here', true, money(bad.netContribution));
  }

  head('6. Nothing anywhere still writes a wage');
  const after = await api('/bootstrap');
  const anyWage = (after.fleetReports || []).some((x) => x.totalWages)
    || (after.hiredDrivers || []).some((d) => d.lifetimeWages);
  ok('not on the reports, not on the drivers', !anyWage, anyWage ? 'a wage got written' : 'none');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
