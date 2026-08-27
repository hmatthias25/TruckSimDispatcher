/* Issue #3: Dedicated means one customer, and the board is filtered to them. */
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5433}/api`;
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) { const e = new Error(j?.error || t.slice(0, 300)); e.status = r.status; throw e; }
  return j;
}
const un = (r) => r.snapshot || r;
let pass = 0, fail = 0;
const ok = (l, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${l}${d ? ' -- ' + d : ''}`); } else { fail++; console.log(`  FAIL  ${l}${d ? ' -- ' + d : ''}`); } };
const money = (n) => '$' + (+n || 0).toFixed(2);
const head = (t) => console.log(`\n=== ${t} ===`);

let S;
const addLoad = (o) => api('/board/add', 'POST', {
  cargo: 'Palletised Goods', trailerType: '', originCity: 'Denver', originState: 'CO',
  destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 500, deadheadMiles: 0,
  gameRevenue: 2400, deadlineHours: 60, weightLbs: 40000, atLocation: false, ...o,
});

(async () => {
  const app = { driverName: 'Ded Tester', preferredDivision: 'Dry Van', transmissionPreference: 'automatic',
    experienceYears: 8, homeCity: 'Denver', homeState: 'CO', acceptsProbation: true, homeTimePreference: 'monthly' };
  await api('/onboarding/market', 'POST', app);
  // Schneider runs a Dedicated division.
  S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: '2000-01-01T06:00', code: 'SNI' }));
  ok('carrier runs dedicated', S.views.dedicated.carrierRuns === true,
    S.company.divisions.join(', '));
  ok('starts on open board', S.views.dedicated.onDedicated === false);

  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-01T06:00',
    fuelPct: 95, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0, dutyStatus: 'OnDuty', atsBankBalance: 50000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });

  head('Going on dedicated without naming the customer');
  S = un(await api('/career/dedicated', 'POST', { onDedicated: true, account: '' }));
  ok('flagged as awaiting the account', S.views.dedicated.awaitingAccount === true);
  await api('/board/clear', 'POST', {});
  let dec = await addLoad({ shipper: 'Walmart DC' });
  ok('dispatch asks who the customer is', dec.infoNeeded.some((n) => /dedicated/i.test(n)),
    dec.infoNeeded.find((n) => /dedicated/i.test(n)) || '(none)');
  ok('and will not commit freight', !dec.authorizedLoadId, dec.headline);

  head('Naming the customer');
  const r = await api('/career/dedicated', 'POST', { onDedicated: true, account: 'Walmart' });
  S = r.snapshot;
  ok('account set', S.views.dedicated.dedicatedAccount === 'Walmart');
  ok('message explains the rule', /only assign you their freight/i.test(r.message), r.message);

  head('A board with a mix: only the account is eligible');
  await api('/board/clear', 'POST', {});
  await addLoad({ shipper: 'Walmart DC', destCity: 'Salt Lake City', destState: 'UT', gameRevenue: 2200 });
  await addLoad({ shipper: 'Sunny Fields Foods', destCity: 'Phoenix', destState: 'AZ', gameRevenue: 4200 });
  dec = await addLoad({ shipper: 'Trameri Group', destCity: 'Las Vegas', destState: 'NV', gameRevenue: 3900 });

  const walmart = dec.evaluations.find((e) => /Walmart/.test(e.load.shipper));
  const others = dec.evaluations.filter((e) => !/Walmart/.test(e.load.shipper));
  ok('the account load is authorized', dec.authorizedLoadId === walmart.load.id,
    `${dec.headline}`);
  ok('better-paying off-account loads are rejected', others.every((e) => e.recommendation === 'Reject'),
    others.map((e) => `${e.load.shipper}:${e.recommendation}`).join(', '));
  ok('rejected with the right reason', others.every((e) => e.hardFails.some((h) => /Not your account/.test(h))),
    others[0].hardFails.find((h) => /account/i.test(h)) || '(none)');
  ok('dispatch says how the board reads', dec.dispatchNotes.some((n) => /Dedicated to Walmart/.test(n)),
    dec.dispatchNotes.find((n) => /Dedicated/.test(n)) || '(none)');
  console.log(`     account load $${walmart.load.gameRevenue} beat off-account $${Math.max(...others.map((e) => e.load.gameRevenue))}`);

  head('Loose matching: "Walmart DC" is still Walmart');
  await api('/board/clear', 'POST', {});
  dec = await addLoad({ shipper: 'Walmart Distribution Center', receiver: '' });
  ok('matched', !!dec.authorizedLoadId, dec.headline);

  head('Matching on the receiver end too');
  await api('/board/clear', 'POST', {});
  dec = await addLoad({ shipper: 'Generic Farms', receiver: 'Walmart RDC' });
  ok('matched on receiver', !!dec.authorizedLoadId, dec.headline);

  head('Account runs dry — the exception is allowed and recorded');
  await api('/board/clear', 'POST', {});
  dec = await addLoad({ shipper: 'Sunny Fields Foods', destCity: 'Phoenix', destState: 'AZ', gameRevenue: 3000 });
  ok('authorized as an exception', !!dec.authorizedLoadId, dec.headline);
  const only = dec.evaluations[0];
  ok('flagged as off-account in the cons', only.cons.some((c) => /Off-account/i.test(c)),
    only.cons.find((c) => /Off-account/i.test(c)) || '(none)');
  const auth = await api('/dispatch/authorize', 'POST', { loadId: only.load.id });
  S = auth.snapshot;
  ok('counted as an off-account run', S.views.dedicated.offAccountLoads === 1,
    `${S.views.dedicated.offAccountLoads}`);
  ok('the trip says so', /Off-account exception/.test(auth.trip.notes), auth.trip.notes);

  head('An unnamed shipper is asked for, not guessed');
  await api(`/trips/${auth.trip.id}/cancel`, 'POST', { reason: 'test', fault: 'Dispatcher', chargeCompany: false });
  await api('/board/clear', 'POST', {});
  dec = await addLoad({ shipper: '', receiver: '', broker: '' });
  ok('dispatch asks who it belongs to', dec.infoNeeded.some((n) => /belongs to/i.test(n)),
    dec.infoNeeded.find((n) => /belongs to/i.test(n)) || '(none)');

  head('Coming off dedicated');
  const off = await api('/career/dedicated', 'POST', { onDedicated: false, account: '' });
  S = off.snapshot;
  ok('back on open board', S.views.dedicated.onDedicated === false);
  await api('/board/clear', 'POST', {});
  dec = await addLoad({ shipper: 'Anyone At All', gameRevenue: 3000 });
  ok('anything is assignable again', !!dec.authorizedLoadId, dec.headline);

  head('A carrier without a dedicated division refuses the arrangement');
  let refused = null;
  // Changing employer settles the old one automatically now — nothing to press first.
  const moved = await api('/market/apply', 'POST', { code: 'MEL', reason: 'flatbed' });  // Melton: flatbed only
  ok('leaving paid out the old employer', !!moved.finalPay,
    moved.finalPay ? `${moved.finalPay.number} ${money(moved.finalPay.gross)}` : '(nothing owed)');
  try {
    await api('/career/dedicated', 'POST', { onDedicated: true, account: 'Walmart' });
  } catch (e) { refused = e.message; }
  ok('refused with a reason', /does not run a dedicated division/i.test(refused || ''), refused || '(allowed!)');
  head('#119 The account is matched on whole words, not on fragments');
  // IsOnAccount matches loosely on purpose — "Walmart DC 6094" and "Walmart" are the same customer. It
  // used to do that with a two-way Contains, so anything whose name sat INSIDE the account counted as
  // the account's freight: "Art" is inside "Walmart".
  //
  // The mislabel was the smaller half. With the app believing there was on-account work on the board,
  // CanRunOffAccount withheld the off-account escape and hard-failed every other load — so the driver
  // was pushed onto freight that was not theirs AND refused the freight they could have run.
  //
  // Stands itself up: by this point the suite has left dedicated and changed employer to one that does
  // not run it.
  async function accountReads(account, shipper) {
    await api('/career/dedicated', 'POST', { onDedicated: true, account });
    await api('/board/clear', 'POST', {});
    const one = await api('/board/add', 'POST', {
      cargo: 'Palletised Goods', trailerType: '', atLocation: true,
      originCity: S.status.locationCity, originState: S.status.locationState,
      shipper, receiver: shipper,
      destCity: 'Salt Lake City', destState: 'UT', loadedMiles: 380, deadheadMiles: 0,
      gameRevenue: 1100, deadlineHours: 60, weightLbs: 34000,
    });
    // The board note is the reliable read: when nothing is on-account the escape lifts and NOTHING is
    // hard-failed, so an empty hard-fail list means the opposite of what it looks like.
    const note = (one.dispatchNotes || []).find((x) => /Dedicated to/i.test(x)) || '';
    return { ours: /load\(s\) on this board are yours/i.test(note), note };
  }

  await api('/reset', 'POST', { confirm: 'RESET', keepSettings: true });
  await api('/onboarding/market', 'POST', app);
  S = un(await api('/onboarding/hire', 'POST',
    { application: app, force: true, gameTime: '2000-01-01T06:00', code: 'SNI' }));
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });
  S = un(await api('/status', 'POST', {
    locationCity: 'Denver', locationState: 'CO', locationKind: 'Shipper', gameTime: '2000-01-03T06:00',
    fuelPct: 95, atsOdometer: 0, truckDamagePct: 0, trailerDamagePct: 0,
    dutyStatus: 'OnDuty', atsBankBalance: 50000,
  }));
  await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
  await api('/career/clear-probation', 'POST', { force: true, note: 'fixture' });

  for (const [account, shipper, shouldBeOurs, why] of [
    ['Walmart', 'Walmart DC 6094',         true,  'a depot number does not stop it being Walmart'],
    ['Walmart', 'Walmart Supercenter #22', true,  'nor does the store format'],
    ['Walmart', 'WALMART',                 true,  'case does not matter'],
    ['Walmart', 'Art Supplies Inc',        false, 'a shipper called Art is not Walmart'],
    ['Walmart', 'Art',                     false, 'even on its own'],
    ['Walmart', 'Mart Foods',              false, 'nor a fragment at the other end'],
    ['Walmart', 'Acme Steel',              false, 'and an unrelated name is still unrelated'],
    ['BP',      'BP Fuel Terminal',        true,  'a short account matches as a whole word'],
    ['BP',      'Superb Products',         false, 'but not a name that merely contains the letters'],
    ['US Foods', 'US Foods Chicago',       true,  'a two-word account matches on the word that identifies it'],
  ]) {
    const r = await accountReads(account, shipper);
    ok(why, r.ours === shouldBeOurs,
      `${account} vs ${shipper} -> ${r.ours ? 'ours' : 'not ours'}`);
  }


  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
