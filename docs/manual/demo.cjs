/* Builds a realistic career for the user-manual screenshots: a driver a couple of weeks into the job
   with trips behind them, a fuel history, a second yard, an open work order and home time coming due. */
const B = 'http://127.0.0.1:5311/api';
async function api(p, m = 'GET', b) {
  const r = await fetch(B + p, { method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`${m} ${p}: ${j?.error || t.slice(0, 200)}`);
  return j;
}
const day = (n, hhmm = '06:00') => `2000-01-${String(n).padStart(2, '0')}T${hhmm}`;
const un = (r) => r.snapshot || r;

(async () => {
  const app = {
    driverName: 'R. Calloway', preferredDivision: 'Reefer', secondDivision: 'Dry Van',
    transmissionPreference: 'manual', experienceYears: 4, freightExperience: ['Dry Van', 'Refrigerated'],
    preferredTripLength: 'long', homeTimePreference: 'biweekly',
    homeCity: 'Denver', homeState: 'CO', willNotHaul: ['Livestock'],
    acceptsProbation: true, hasHazmat: true, hasTanker: false, hasDoublesTriples: false,
    notes: 'Looking for steady reefer freight out of the Front Range.',
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1) }));
  console.log(`hired at ${S.company.name} (${S.company.code}), yard ${S.company.terminals[0].city}`);

  // Settings that reflect a modded install, so the screenshots show the realistic setup.
  const st = JSON.parse(JSON.stringify(S.settings));
  st.hos.requireBreak = false;
  st.usesHosMod = true; st.hosModName = 'Realistic HOS';
  st.usesEconomyMod = true;
  st.mapMods = ['Coast to Coast', 'More American Cities'];
  st.mods = ['Realistic HOS', 'Realistic Economy', 'Coast to Coast', 'More American Cities'];
  st.fuelPricePerGal = 4.05; st.overheadPerLoad = 20;
  S = await api('/settings', 'POST', st);

  // Upgrade the home yard and put a small fleet in it — shows the "stock a yard" outcome.
  const hq = S.company.terminals[0];
  S = await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' });
  S = un(await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'manual', addTrailers: true,
  }));

  async function runLoad({ d, origin, oState, dest, dState, cargo, miles, rev, deadline, fuel, dmg, odo, late }) {
    S = un(await api('/status', 'POST', {
      locationCity: origin, locationState: oState, locationKind: 'Shipper',
      gameTime: day(d, '06:00'), fuelPct: 95, atsOdometer: odo,
      truckDamagePct: dmg, trailerDamagePct: Math.max(0, dmg - 2),
      dutyStatus: 'OnDuty', atsBankBalance: 24000 + d * 900,
    }));
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    const board = await api('/board/add', 'POST', {
      cargo, trailerType: 'Reefer', originCity: origin, originState: oState,
      destCity: dest, destState: dState, loadedMiles: miles, deadheadMiles: 0,
      gameRevenue: rev, deadlineHours: deadline, weightLbs: 41200,
      shipper: 'Cold Chain Foods', receiver: 'Regional DC',
    });
    const pick = board.evaluations[0];
    const auth = await api('/dispatch/authorize', 'POST', { loadId: pick.load.id });
    const trip = auth.trip;
    await api(`/trips/${trip.id}/event`, 'POST', {
      gameTime: day(d, '07:15'), kind: 'Loaded', detail: `Loaded ${(41200).toLocaleString()} lb`, gallons: 0,
    });
    await api(`/trips/${trip.id}/event`, 'POST', {
      gameTime: day(d, '12:40'), kind: 'Fuel', detail: '', city: fuel.city, state: fuel.state,
      gallons: fuel.gal, pricePerGal: fuel.price, cost: 0,
    });
    const done = await api(`/trips/${trip.id}/complete`, 'POST', {
      deliveredGameTime: day(d + 1, late ? '19:20' : '14:10'),
      actualMiles: miles + 14, endOdometer: odo + miles + 14, actualRevenue: rev,
      fuelStops: [
        { gallons: fuel.gal, pricePerGal: fuel.price, city: fuel.city, state: fuel.state },
        { gallons: 72, pricePerGal: 4.21, city: dest, state: dState },
      ],
      tolls: 18, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: dmg + 1.5, trailerDamageAfter: Math.max(0, dmg - 0.5), cargoDamagePct: 0,
      loadingHours: 1, unloadingHours: 1, detentionHours: late ? 2.5 : 0,
      layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
      delayReason: late ? 'Receiver had one dock working, sat 2.5 h' : '',
      damageCause: '', notes: '',
      locationCity: dest, locationState: dState, locationKind: 'Receiver',
      fuelPct: 48, gameTime: day(d + 1, late ? '19:20' : '14:10'),
      hosDriveRemaining: 4.5, hosShiftRemaining: 6.75, hosBreakRemaining: 1.5, hosCycleRemaining: 58,
    });
    console.log(`  ${done.audit.trip.number}: ${origin} -> ${dest}  ${done.audit.trip.serviceResult}`);
    return done;
  }

  await runLoad({ d: 1, origin: 'Denver', oState: 'CO', dest: 'Salt Lake City', dState: 'UT', cargo: 'Frozen Foods', miles: 520, rev: 1980, deadline: 40, fuel: { city: 'Grand Junction', state: 'CO', gal: 96, price: 3.94 }, dmg: 0, odo: 0 });
  await runLoad({ d: 4, origin: 'Salt Lake City', oState: 'UT', dest: 'Las Vegas', dState: 'NV', cargo: 'Dairy Products', miles: 420, rev: 1640, deadline: 34, fuel: { city: 'Cedar City', state: 'UT', gal: 88, price: 4.08 }, dmg: 1.5, odo: 534 });
  await runLoad({ d: 7, origin: 'Las Vegas', oState: 'NV', dest: 'Phoenix', dState: 'AZ', cargo: 'Produce', miles: 300, rev: 1290, deadline: 26, fuel: { city: 'Kingman', state: 'AZ', gal: 64, price: 4.32 }, dmg: 3, odo: 968, late: true });
  await runLoad({ d: 10, origin: 'Phoenix', oState: 'AZ', dest: 'Albuquerque', dState: 'NM', cargo: 'Frozen Foods', miles: 420, rev: 1710, deadline: 32, fuel: { city: 'Flagstaff', state: 'AZ', gal: 90, price: 4.11 }, dmg: 4.5, odo: 1282 });

  // Settle the period so Payroll has something in it.
  const settle = await api('/settlements/run', 'POST', { notes: 'Week 1-2' });
  console.log(`  settlement ${un(settle).settlements?.[0]?.number || ''} issued`);

  // A second yard the driver discovered, plus an open work order.
  const t2 = await api('/terminals', 'POST', {
    city: 'Albuquerque', state: 'NM', level: 'Medium', truckCapacity: 3,
    hasFuel: true, hasShop: true, hasParking: true, hasTrailerDrop: true, fuelPricePerGal: 3.72,
    shopLabourDiscount: 0.2, monthlyCost: 2400,
  });
  S = un(t2);
  S = un(await api('/maintenance/workorder', 'POST', {
    unit: S.driver.assignedTruckUnit, unitKind: 'Truck', kind: 'Repair',
    description: 'Passenger step and fairing scuffed at a dock', vendor: 'Speedco',
    locationCity: 'Albuquerque', locationState: 'NM',
    cost: 640, damageBefore: 6, damageAfter: 6, odometerAtService: 1716,
    paidBy: 'Company', status: 'Open',
  }));

  // Park the truck 13 days out so home time reads "due soon" — the state worth documenting.
  S = un(await api('/status', 'POST', {
    locationCity: 'Albuquerque', locationState: 'NM', locationKind: 'TruckStop',
    locationDetail: 'TA on I-40', gameTime: day(13, '07:30'),
    fuelPct: 52, atsOdometer: 1716, truckDamagePct: 6, trailerDamagePct: 4,
    dutyStatus: 'OffDuty', atsBankBalance: 38650,
  }));
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 44,
    source: 'Realistic HOS mod ELD', notes: '',
  });

  // A live board so the Dispatch screenshot shows a real decision, including the ride home.
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Frozen Foods', trailerType: 'Reefer', originCity: 'Albuquerque', originState: 'NM',
    destCity: 'Denver', destState: 'CO', loadedMiles: 450, deadheadMiles: 0,
    gameRevenue: 1820, deadlineHours: 44, weightLbs: 40100, shipper: 'Rio Grande Cold', receiver: 'Front Range DC',
  });
  await api('/board/add', 'POST', {
    cargo: 'Produce', trailerType: 'Reefer', originCity: 'Albuquerque', originState: 'NM',
    destCity: 'Houston', destState: 'TX', loadedMiles: 890, deadheadMiles: 12,
    gameRevenue: 3950, deadlineHours: 60, weightLbs: 42000, shipper: 'Mesa Produce', receiver: 'Gulf Foods',
  });
  const finalDec = await api('/board/add', 'POST', {
    cargo: 'Ice Cream', trailerType: 'Reefer', originCity: 'Albuquerque', originState: 'NM',
    destCity: 'Amarillo', destState: 'TX', loadedMiles: 290, deadheadMiles: 6,
    gameRevenue: 690, deadlineHours: 14, weightLbs: 38000, shipper: 'Creamery Co', receiver: 'Panhandle Foods', isUrgent: true,
  });

  const bs = await api('/bootstrap');
  console.log('\n--- demo career ready ---');
  console.log(`driver     : ${bs.driver.name} (${bs.driver.rankTitle})`);
  console.log(`company    : ${bs.company.name}`);
  console.log(`yards      : ${bs.company.terminals.map((t) => `${t.city} (${t.level})`).join(', ')}`);
  console.log(`fleet      : ${bs.trucks.length} tractors, ${bs.trailers.length} trailers`);
  console.log(`trips      : ${bs.trips.length}`);
  console.log(`board      : ${bs.board.length} loads`);
  console.log(`home time  : ${bs.views.homeTime.headline}`);
  console.log(`recommends : ${finalDec.headline}`);
  console.log(`discovered : ${bs.discovered.map((d) => d.city).join(', ')}`);
  process.exit(0);
})().catch((e) => { console.error('DEMO ERROR:', e.message); process.exit(1); });
