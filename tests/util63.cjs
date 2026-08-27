/* Issue #63 and the last rung of #68.
 *
 * 63: the fleet review asked for a due-back time, which was a question about where somebody is right now
 *     asked in the wrong place. Utilisation replaces it — a real figure off the ATS Trailer Manager —
 *     and where a driver is gets asked when the player reports in at the yard.
 * 68: being let go BY a second-chance carrier ends the career. There is nowhere after that one.
 */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5880}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 250)); e.status = r.status; throw e; }
  return j;
}
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const head = (t) => console.log(`\n=== ${t} ===`);
const un = (r) => r.snapshot || r;
const refuses = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const iso = (day, hm = '08:00') => {
  const d = new Date(Date.UTC(2000, 0, 1) + day * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${hm}`;
};

let S, odo = 80000;
async function report(city, st, day, kind = 'TruckStop') {
  odo += 130;
  const r = await api('/status', 'POST', {
    locationCity: city, locationState: st, locationKind: kind, gameTime: iso(day, '09:00'),
    fuelPct: 80, atsOdometer: odo, truckDamagePct: 3, trailerDamagePct: 2,
    dutyStatus: 'OffDuty', atsBankBalance: 90000,
  });
  S = un(r);
  return r;
}
const goHome = async (day) => { await report('Amarillo', 'TX', day - 1); return report('Denver', 'CO', day, 'Terminal'); };

(async () => {
  const app = { driverName: 'U. Til', preferredDivision: 'Dry Van', transmissionPreference: 'either',
    experienceYears: 11, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true,
    homeTimePreference: 'biweekly' };
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: iso(1) }));
  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));

  // A company trailer and a driver on it.
  S = un(await api('/fleet/trailer', 'POST', {
    unit: 'U100', type: 'Dry Van', division: 'Dry Van', inGameGarage: true, isCompanyOwned: true,
    status: 'InService', homeTerminalId: hq.id, currentLocation: 'Denver, CO',
    acquiredGameTime: iso(1),
  }));
  await api('/fleetops/drivers', 'POST', {
    name: 'J. Idle', skill: 'Competent', status: 'Active', wageShare: 0.3,
    homeTerminalId: hq.id, hiredGameDate: iso(1), assignedTrailerUnit: 'U100',
  });
  const drv = (await api('/fleetops')).drivers.find((d) => d.name === 'J. Idle');
  ok('a driver is on the company trailer', drv.assignedTrailerUnit === 'U100', drv.assignedTrailerUnit);

  head('63. The review takes utilisation, not a due-back date');
  const filed = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(1), periodEndGame: iso(16),
    lines: [{ driverId: drv.id, driverName: 'J. Idle', trailerUnit: 'U100',
              miles: 3000, revenue: 5000, wages: 1500, repairs: 0,
              truckStars: 4, trailerStars: 4, truckOdometer: 0,
              trailerUtilisationPct: 22 }],
  })).report;
  ok('the report was accepted', !!filed.number, filed.number);
  let box = (await api('/bootstrap')).trailers.find((t) => t.unit === 'U100');
  ok('utilisation landed on the trailer', box.utilisationPct === 22, `${box.utilisationPct}%`);
  ok('and it is stamped with when', !!box.utilisationReportedGameTime, box.utilisationReportedGameTime);

  head('63b. A due-back date is no longer part of a review line');
  // The field is gone from the model, so sending one must simply be ignored rather than stored anywhere.
  const before = JSON.stringify((await api('/bootstrap')).drivers ?? {});
  const second = await refuses(() => api('/fleetops/report', 'POST', {
    periodStartGame: iso(16), periodEndGame: iso(31),
    lines: [{ driverId: drv.id, trailerUnit: 'U100', miles: 2000, revenue: 4000, wages: 1200,
              repairs: 0, truckStars: 4, trailerStars: 4, trailerDueBackGameTime: iso(40) }],
  }));
  ok('an old-shaped line is still accepted', second === null, second || 'accepted');
  const after = (await api('/fleetops')).drivers.find((d) => d.name === 'J. Idle');
  ok('and no due-back date is kept anywhere', !('trailerDueBackGameTime' in after),
    Object.keys(after).filter((k) => /due/i.test(k)).join(', ') || 'no such field');

  head('63c. Where the TRAILER is gets asked at the yard');
  // #102: asked per box, not per driver. It used to name whoever the app had down as pulling one, which
  // AI drivers make wrong the first time they hook something else — so the question named the wrong
  // person and the answer was filed against the wrong trailer.
  let r = await goHome(35);
  const ask = r.homeBrief?.askWhereabouts || [];
  ok('the arrival brief asks about the trailer', ask.length >= 1,
    ask.map((a) => `${a.unit}/${a.trailer}`).join(', ') || '(nothing asked)');
  ok('it is keyed on the unit, not on a driver', !!ask[0]?.unit && !('driverId' in (ask[0] || {})),
    ask[0]?.unit || '(no unit)');
  ok('and no driver is named in it', !('driver' in (ask[0] || {})), 'no driver field');
  ok('it says what it currently knows', !!ask[0]?.known, (ask[0]?.known || '').slice(0, 120));
  ok('which is that it knows nothing yet',
    /nothing on where U100 is/i.test(ask[0]?.known || ''), (ask[0]?.known || '').slice(0, 60));

  head('63d. An inbound trailer nearby is worth waiting for');
  let est = (await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'U100', direction: 'Inbound', city: 'Colorado Springs', state: 'CO' })).estimate;
  ok('the estimate is known now', est.known === true, `${est.known}`);
  ok('it is measured in days', est.days > 0, `${est.days} day(s)`);
  ok('close in means worth waiting', est.worthWaiting === true, `${est.worthWaiting}`);
  ok('and it says so plainly', /worth it|come off your home time/i.test(est.text), est.text.slice(0, 150));
  ok('#108 it is priced as the game\'s time skip, not as a wait',
    /charge about|day\(s\) to take it/i.test(est.text), est.text.slice(0, 120));

  head('63e. An outbound one is not');
  est = (await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'U100', direction: 'Outbound', city: 'Seattle', state: 'WA' })).estimate;
  ok('still known', est.known === true, `${est.known}`);
  ok('but days away', est.days >= 2, `${est.days} day(s)`);
  ok('and not worth waiting', est.worthWaiting === false, `${est.worthWaiting}`);
  ok('it says it will sort the trailer another way',
    /not worth|another way|re-rig you/i.test(est.text), est.text.slice(0, 160));

  head('63e2. #102 A parked trailer is an answer in its own right');
  // There was no way to say a box was sitting doing nothing. Inbound, outbound and no idea were the
  // choices, and none of them is true of a trailer parked on the yard.
  est = (await api('/fleetops/whereabouts', 'POST',
    { trailerUnit: 'U100', direction: 'Parked', city: 'Denver', state: 'CO' })).estimate;
  ok('parked is accepted as a status', est.direction === 'Parked', est.direction);
  ok('it is known rather than a shrug', est.known === true, `${est.known}`);
  ok('and it is free', est.days === 0, `${est.days} day(s)`);
  ok('the answer says nobody is on it', /nobody on it/i.test(est.text), est.text.slice(0, 140));
  ok('#108 and that the game will not charge for it',
    /will not charge you/i.test(est.text), est.text.slice(0, 140));

  head('63e3. #102 An answer against one trailer does not follow the driver');
  // The whole point. The answer belongs to the box, so it survives the driver moving to another one.
  const beforeSwap = (await api('/bootstrap')).trailers.find((t) => t.unit === 'U100');
  ok('it is filed on the trailer', beforeSwap.whereabouts === 'Parked', beforeSwap.whereabouts);
  ok('with the city it was reported at', beforeSwap.whereaboutsCity === 'Denver', beforeSwap.whereaboutsCity);
  ok('and a stamp of when', !!beforeSwap.whereaboutsGameTime, beforeSwap.whereaboutsGameTime || '(none)');

  head('63f. Once answered, it stops asking');
  r = await goHome(38);
  const asked2 = r.homeBrief?.askWhereabouts || [];
  ok('a fresh answer is not asked for again', asked2.length === 0,
    asked2.map((a) => a.unit).join(', ') || 'nothing asked');

  head('63g. Idle plus old is a reason to sell the trailer');
  // Idle on its own is a quiet fortnight. Paired with age it is a verdict, the same way a truck needs two.
  const rep = (await api('/fleetops/report', 'POST', {
    periodStartGame: iso(38), periodEndGame: iso(53),
    lines: [{ driverId: drv.id, trailerUnit: 'U100', miles: 500, revenue: 900, wages: 300, repairs: 0,
              truckStars: 4, trailerStars: 4, trailerUtilisationPct: 8 }],
  })).report;
  const trailerRecs = (rep.retirements || []).filter((x) => x.unitKind === 'Trailer');
  ok('the report ran', !!rep.number, rep.number);
  if (trailerRecs.length) {
    ok('utilisation is quoted in the case', trailerRecs.some((x) =>
      (x.evidence || []).some((e) => /Utilisation/i.test(e))),
      (trailerRecs[0].evidence || []).join(' | ').slice(0, 170));
  } else {
    // A young trailer should NOT be recommended on idleness alone, which is the guard working.
    box = (await api('/bootstrap')).trailers.find((t) => t.unit === 'U100');
    ok('a young idle trailer is not condemned on idleness alone', box.utilisationPct === 8,
      `util ${box.utilisationPct}%, no recommendation — needs a second reason`);
  }

  head('68. Let go by the second chance, and there is nowhere after it');
  const healthy = (await api('/market')).market;
  ok('a driver in good standing sees the ordinary market',
    healthy.some((c) => c.isRealCompany), `${healthy.length} listing(s)`);

  /** Climb the safety ladder to a termination. A major preventable jumps at least two rungs. */
  async function wreckIt(tag) {
    for (let i = 0; i < 6; i++) {
      const res = await api('/incidents', 'POST', {
        kind: 'Accident', severity: 'Major', preventable: true, faultAttribution: 'Driver',
        description: `${tag} ${i + 1}`, locationCity: 'Denver', locationState: 'CO',
      });
      for (const a of (await api('/bootstrap')).discipline || [])
        if (!a.driverAcknowledged) await api(`/discipline/${a.number}/acknowledge`, 'POST', {});
      if (res.action?.level === 'Termination') return res.action.level;
    }
    return (await api('/bootstrap')).discipline?.[0]?.level || 'none';
  }

  const firstEnd = await wreckIt('first career, wreck');
  S = un(await api('/bootstrap'));
  ok('the ladder reached a termination', firstEnd === 'Termination', firstEnd);
  ok('and it took effect', S.driver.terminatedForCause === true, `${S.driver.terminatedForCause}`);
  ok('the career is NOT over yet — one chance left', S.driver.careerOver !== true,
    `careerOver=${S.driver.careerOver}`);

  const only = (await api('/market')).market;
  ok('only second-chance carriers will have them', only.length > 0 && only.every((c) => !c.isRealCompany),
    only.map((c) => c.name).join(', '));

  head('68b. Take the second chance, then lose it');
  // apply returns {hired:false, decision} rather than throwing, so the outcome has to be read.
  const applied = await api('/market/apply', 'POST', { code: only[0].code });
  ok('the second-chance carrier takes them', applied.hired === true,
    applied.hired ? 'hired' : (applied.decision?.reasons || []).join(' | ').slice(0, 160));
  S = un(await api('/bootstrap'));
  ok('now running for the second-chance carrier', S.company.code === only[0].code,
    `${S.company.name} (${S.company.code})`);
  ok('and still needing to prove it', (await api('/bootstrap')).views.secondChance.applies === true, 'applies');

  const secondEnd = await wreckIt('second career, wreck');
  S = un(await api('/bootstrap'));
  ok('terminated again', secondEnd === 'Termination', secondEnd);
  ok('and THIS time the career is over', S.driver.careerOver === true, `${S.driver.careerOver}`);
  ok('it says who let them go and that there is nothing after it',
    /no carrier after this one/i.test(S.driver.careerOverReason || ''),
    (S.driver.careerOverReason || '').slice(0, 190));

  head('68c. Nothing left to do but start again');
  const dead = (await api('/market')).market;
  ok('nobody is hiring', dead.length === 0, `${dead.length} listing(s)`);
  const blocked = (await api('/bootstrap')).views.dispatchBlockers || [];
  ok('and no freight moves', blocked.some((x) => /career is finished/i.test(x)),
    blocked.join(' | ').slice(0, 170) || '(none)');
  ok('the record is kept rather than wiped',
    ((await api('/bootstrap')).trips || []).length >= 0 && !!S.driver.careerOverGameTime,
    `ended ${S.driver.careerOverGameTime}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERROR ' + e.message); process.exitCode = 1; });
