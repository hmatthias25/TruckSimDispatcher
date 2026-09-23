/* Ordering the run home, and being told when to be back on the truck.
 *
 * Two things reported from play after a night in Junction City KS:
 *
 *   "I chose to run back to terminal, and a reposition job was created which was correct, but I did not
 *    get the trailer position and how much time I'd take off form to decide if I'd be told to switch
 *    trailers when I got back."
 *
 * The form was never missing — it lived on the decision panel, and ordering the empty move cleared the
 * panel, so it went with it. It is a popup now, raised at the same moment, where clearing the board
 * behind it cannot take it away. It has to be asked HERE rather than at the yard: the whole value of the
 * answer is that a parked box can be marked as your own in ATS before you pull out.
 *
 *   "use the time the person is off when we are back to the terminal, tell the player 'based on your
 *    time off entered you need to be ready to run on day <when time off is over> at 7AM'"
 *
 * They are asked how many days they are taking so the changeover can price a box that is out — and then
 * the answer went into that decision and nowhere the driver could see it. It is said back on arrival,
 * and pushed out where the box they are waiting on lands later than their days off do.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5998}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
const fs = require('fs'), path = require('path');
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const iso = (d, hm = '08:00') => {
  const x = new Date(Date.UTC(2000, 0, 1) + (d - 1) * 86400000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}T${hm}`;
};
const dayOf = (v) => Math.round((Date.parse(v + ':00Z') - Date.UTC(2000, 0, 1)) / 86400000) + 1;

let S, yard;

/** Park at the home yard on the given day and hand back the arrival brief. */
async function comeHome(day) {
  await api('/status', 'POST', {
    locationCity: 'Amarillo', locationState: 'TX', locationKind: 'TruckStop', gameTime: iso(day - 1),
    fuelPct: 60, atsOdometer: 9_000, truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty',
  });
  S = un(await api('/status', 'POST', {
    locationCity: yard.city, locationState: yard.state, locationKind: 'Terminal', gameTime: iso(day),
    fuelPct: 70, atsOdometer: 9_600, truckDamagePct: 4, trailerDamagePct: 2, dutyStatus: 'OffDuty',
  }));
  return S.views.lastArrival || S.driver?.lastArrivalBrief || {};
}

(async () => {
  const app = { driverName: 'R. Vance', preferredDivision: 'Dry Van', experienceYears: 7,
    homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(2) }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  yard = S.company.terminals[0];

  head('1. The days off are said back, at seven in the morning');
  {
    const st = await api('/export');
    st.status.gameTime = iso(40);
    st.driver.lastHomeGameTime = iso(4);        // well past a fortnightly arrangement
    st.driver.homeDaysPlanned = 4;
    st.driver.changeoverWaitDays = null;
    await api('/import', 'POST', st);

    const brief = await comeHome(41);
    console.log(`  ..    home day ${dayOf(iso(41))}, 4 days off → ready ${brief.readyToRunGameTime}`);
    ok('the brief says when to be ready', !!brief.readyToRunGameTime, brief.readyToRunGameTime || '(none)');
    ok('and it is the days off after parking',
      dayOf(brief.readyToRunGameTime) === dayOf(iso(41)) + 4,
      `${dayOf(brief.readyToRunGameTime)} against ${dayOf(iso(41))} + 4`);
    ok('at seven in the morning', /T07:00$/.test(brief.readyToRunGameTime || ''),
      brief.readyToRunGameTime);
    ok('and it says where the figure came from', /4 day\(s\) off/i.test(brief.readyToRunNote || ''),
      brief.readyToRunNote || '(silent)');
    ok('it is on the parking list too, not only in its own field',
      (brief.parking || []).some((x) => /Be ready to run/i.test(x)),
      (brief.parking || []).find((x) => /ready to run/i.test(x))?.slice(0, 80) || '(not listed)');
  }

  head('2. A box that lands later than the days off pushes it out');
  // Being ready to run before the trailer turns up is not being ready to run.
  {
    const st = await api('/export');
    st.status.gameTime = iso(60);
    st.driver.lastHomeGameTime = iso(24);
    st.driver.homeDaysPlanned = 3;
    st.driver.changeoverUnit = 'T-900';
    st.driver.changeoverWaitDays = 6;           // out longer than the driver is home
    st.trailers.push({
      unit: 'T-900', type: 'Reefer', division: 'Reefer', year: 2021, length: "53'",
      status: 'InService', inGameGarage: true, homeTerminalId: yard.id,
    });
    await api('/import', 'POST', st);

    const brief = await comeHome(61);
    console.log(`  ..    3 days off but the box is 6 out → ready ${brief.readyToRunGameTime}`);
    console.log(`  ..    ${brief.readyToRunNote}`);
    ok('the wait wins over the calendar',
      dayOf(brief.readyToRunGameTime) === dayOf(iso(61)) + 6,
      `${dayOf(brief.readyToRunGameTime)} against ${dayOf(iso(61))} + 6`);
    ok('and it says the trailer is why', /does not land until then/i.test(brief.readyToRunNote || ''),
      brief.readyToRunNote || '(silent)');
    ok('naming the box being waited on', /T-900/.test(brief.readyToRunNote || ''), 'named');
  }

  head('3. A box that lands sooner than the days off does not');
  // The other way round the calendar wins, and nothing should mention the trailer at all.
  {
    const st = await api('/export');
    st.status.gameTime = iso(80);
    st.driver.lastHomeGameTime = iso(44);
    st.driver.homeDaysPlanned = 5;
    st.driver.changeoverUnit = 'T-900';
    st.driver.changeoverWaitDays = 1;
    await api('/import', 'POST', st);

    const brief = await comeHome(81);
    console.log(`  ..    5 days off, box 1 day out → ready ${brief.readyToRunGameTime}`);
    ok('the days off decide it', dayOf(brief.readyToRunGameTime) === dayOf(iso(81)) + 5,
      `${dayOf(brief.readyToRunGameTime)} against ${dayOf(iso(81))} + 5`);
    ok('and the note is about the days, not the box',
      /day\(s\) off/i.test(brief.readyToRunNote || '') && !/does not land/i.test(brief.readyToRunNote || ''),
      brief.readyToRunNote || '(silent)');
  }

  head('4. Saying nothing about the days off says nothing about being ready');
  // The app does not invent a figure it was never given.
  {
    const st = await api('/export');
    st.status.gameTime = iso(100);
    st.driver.lastHomeGameTime = iso(64);
    st.driver.homeDaysPlanned = 0;
    st.driver.changeoverWaitDays = null;
    await api('/import', 'POST', st);

    const brief = await comeHome(101);
    ok('no days off, no ready time', !brief.readyToRunGameTime,
      brief.readyToRunGameTime || 'silent');
    ok('and nothing on the parking list about it',
      !(brief.parking || []).some((x) => /Be ready to run/i.test(x)), 'silent');
  }

  head('5. Ordering the run home raises the trailer question where it cannot be cleared');
  const js = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const rep = js.slice(js.indexOf("case 'reposition':"), js.indexOf("case 'reposition':") + 1400);
  // The form was on the decision panel and `DECISION = null` took it away the instant the move was
  // authorized. Held first, then raised as a modal.
  ok('the run-home button says it is the run home', /data-home="\$\{o\.isHomeRun/.test(js), 'flagged');
  ok('the question is captured before the panel is cleared',
    rep.indexOf('askWhereabouts') < rep.indexOf('DECISION = null'), 'held first');
  ok('and raised as a popup after the move is authorized',
    /whereaboutsModal\(ask\)/.test(rep), 'raised');
  ok('only on the run home, not on a reposition to another market',
    /d\.home === '1'/.test(rep), 'gated');
  ok('and the popup carries the same form as the panel did',
    /function whereaboutsModal[\s\S]{0,700}whereaboutsHtml\(\{ askWhereabouts: ask \}\)/.test(js),
    'same form');
  ok('the brief puts the ready time in front of the driver',
    /readyToRunGameTime \? `<div class="callout warn">/.test(js), 'shown');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
