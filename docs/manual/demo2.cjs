/* Demo career for the manual: a driver deep enough in to show home time coming due, a hired fleet
   with a report filed, a dedicated account, a preventable on the record and a load in flight. */
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
    acceptsProbation: true, hasHazmat: true,
  };
  await api('/onboarding/market', 'POST', app);
  let S = un(await api('/onboarding/hire', 'POST', { application: app, force: true, gameTime: day(1), code: 'PRI' }));
  console.log(`hired: ${S.company.name} (${S.company.equipmentStars}★ equipment), yard ${S.company.terminals[0].city}`);
  console.log(`truck: ${S.trucks[0].year} ${S.trucks[0].make} ${S.trucks[0].model}, ${Math.round(S.trucks[0].serviceMiles).toLocaleString()} mi`);

  const st = JSON.parse(JSON.stringify(S.settings));
  st.hos.requireBreak = false;
  st.usesHosMod = true; st.hosModName = 'Realistic HOS';
  st.usesEconomyMod = true;
  st.mapMods = ['Coast to Coast', 'More American Cities'];
  st.mods = ['Realistic HOS', 'Realistic Economy', 'Coast to Coast', 'More American Cities'];
  st.fuelPricePerGal = 4.05; st.overheadPerLoad = 20;
  S = await api('/settings', 'POST', st);

  const hq = S.company.terminals[0];
  S = un(await api(`/terminals/${hq.id}/level`, 'POST', { level: 'Large' }));
  const stock = un(await api('/fleet/stock', 'POST', {
    terminalId: hq.id, count: 3, alreadyBought: true, transmissionPreference: 'manual', addTrailers: true,
  }));
  S = stock;

  async function runLoad({ d, origin, oState, dest, dState, cargo, miles, rev, deadline, fuel, dmg, odo, shipper, late }) {
    S = un(await api('/status', 'POST', {
      locationCity: origin, locationState: oState, locationKind: 'Shipper',
      gameTime: day(d, '06:00'), fuelPct: 95, atsOdometer: odo,
      truckDamagePct: dmg, trailerDamagePct: Math.max(0, dmg - 2),
      dutyStatus: 'OnDuty', atsBankBalance: 61000 + d * 1400,
    }));
    await api('/hos', 'POST', { driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 70 });
    await api('/board/clear', 'POST', {});
    const board = await api('/board/add', 'POST', {
      cargo, trailerType: 'Reefer', originCity: origin, originState: oState,
      destCity: dest, destState: dState, loadedMiles: miles, deadheadMiles: 0,
      gameRevenue: rev, deadlineHours: deadline, weightLbs: 41200,
      shipper, receiver: 'Regional DC', atLocation: true,
    });
    const auth = await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id });
    const trip = auth.trip;
    await api(`/trips/${trip.id}/event`, 'POST', { gameTime: day(d, '06:30'), kind: 'BeginLoad', detail: 'At the dock' });
    await api(`/trips/${trip.id}/event`, 'POST', { gameTime: day(d, '10:00'), kind: 'EndLoad', detail: `Loaded 41,200 lb` });
    await api(`/trips/${trip.id}/event`, 'POST', {
      gameTime: day(d, '12:40'), kind: 'Fuel', detail: '', city: fuel.city, state: fuel.state,
      gallons: fuel.gal, pricePerGal: fuel.price,
    });
    await api(`/trips/${trip.id}/event`, 'POST', { gameTime: day(d + 1, late ? '08:00' : '10:00'), kind: 'BeginUnload', detail: 'Checked in' });
    await api(`/trips/${trip.id}/event`, 'POST', { gameTime: day(d + 1, late ? '15:30' : '13:40'), kind: 'EndUnload', detail: 'Empty' });
    const done = await api(`/trips/${trip.id}/complete`, 'POST', {
      deliveredGameTime: day(d + 1, late ? '15:30' : '13:40'),
      actualMiles: miles + 14, endOdometer: odo + miles + 14, actualRevenue: rev,
      fuelStops: [
        { gallons: fuel.gal, pricePerGal: fuel.price, city: fuel.city, state: fuel.state },
        { gallons: 72, pricePerGal: 4.21, city: dest, state: dState },
      ],
      tolls: 18, repairCost: 0, fines: 0, otherExpense: 0,
      truckDamageAfter: dmg + 1.5, trailerDamageAfter: Math.max(0, dmg - 0.5), cargoDamagePct: 0,
      layoverDays: 0, breakdownDays: 0, extraStops: 0, tarpsUsed: 0,
      delayReason: late ? 'One dock working at the receiver' : '', damageCause: '', notes: '',
      locationCity: dest, locationState: dState, locationKind: 'Receiver',
      fuelPct: 48, gameTime: day(d + 1, late ? '15:30' : '13:40'),
      hosDriveRemaining: 4.5, hosShiftRemaining: 6.75, hosCycleRemaining: 58,
    });
    console.log(`  ${done.audit.trip.number}: ${origin} -> ${dest}  ${done.audit.trip.serviceResult}  det ${done.audit.trip.detentionHours}h`);
    return done;
  }

  await runLoad({ d: 1, origin: 'Springfield', oState: 'MO', dest: 'Oklahoma City', dState: 'OK', cargo: 'Frozen Foods', miles: 500, rev: 2050, deadline: 40, fuel: { city: 'Joplin', state: 'MO', gal: 92, price: 3.94 }, dmg: 0, odo: 0, shipper: 'Cold Chain Foods' });
  await runLoad({ d: 4, origin: 'Oklahoma City', oState: 'OK', dest: 'Denver', dState: 'CO', cargo: 'Dairy Products', miles: 620, rev: 2380, deadline: 44, fuel: { city: 'Amarillo', state: 'TX', gal: 96, price: 4.08 }, dmg: 1.5, odo: 514, shipper: 'Prairie Dairy' });
  await runLoad({ d: 7, origin: 'Denver', oState: 'CO', dest: 'Salt Lake City', dState: 'UT', cargo: 'Produce', miles: 520, rev: 1990, deadline: 38, fuel: { city: 'Grand Junction', state: 'CO', gal: 88, price: 4.32 }, dmg: 3, odo: 1148, shipper: 'Front Range Produce', late: true });
  await runLoad({ d: 10, origin: 'Salt Lake City', oState: 'UT', dest: 'Las Vegas', dState: 'NV', cargo: 'Frozen Foods', miles: 420, rev: 1720, deadline: 34, fuel: { city: 'Cedar City', state: 'UT', gal: 84, price: 4.11 }, dmg: 4.5, odo: 1682, shipper: 'Cold Chain Foods' });

  // A preventable on the record, so the standing table has something in it.
  await api('/incidents', 'POST', {
    kind: 'Damage', severity: 'Minor', faultAttribution: 'Driver', preventable: true,
    cost: 420, tripNumber: '', description: 'Clipped a dock post backing in at Las Vegas',
  });


  // Hired drivers and a filed report, so the fleet screens are populated.
  const units = S.trucks.filter((t) => t.unit !== S.driver.assignedTruckUnit).map((t) => t.unit);
  for (const [i, name] of ['M. Torres', 'D. Whitfield', 'K. Amari'].entries()) {
    if (!units[i]) break;
    S = un(await api('/fleetops/drivers', 'POST', {
      name, assignedTruckUnit: units[i], skill: i === 0 ? 'Experienced' : 'Competent',
      status: 'Active', wageShare: 0.3,
    }));
  }
  const roster = (await api('/fleetops')).drivers;
  await api('/status', 'POST', {
    locationCity: 'Las Vegas', locationState: 'NV', locationKind: 'TruckStop',
    gameTime: day(12, '07:00'), fuelPct: 52, atsOdometer: 2116,
    truckDamagePct: 6, trailerDamagePct: 4, dutyStatus: 'OffDuty', atsBankBalance: 78400,
  });
  const fr = await api('/fleetops/report', 'POST', {
    periodStartGame: day(1), periodEndGame: day(12, '07:00'), notes: 'First fleet period',
    lines: roster.map((d, i) => ({
      driverId: d.id, truckUnit: d.assignedTruckUnit, trailerUnit: d.assignedTrailerUnit,
      revenue: [7400, 6100, 4200][i], miles: [4300, 3800, 3100][i],
      damagePctAfter: [4, 9, 17][i], repairs: [0, 0, 1250][i],
    })),
  });
  console.log(`  ${fr.report.number}: net ${fr.report.netContribution}, findings ${fr.report.findings.length}, repairs flagged ${fr.report.repairsNeeded.length}`);
  S = fr.snapshot;

  // Home time due, sitting away from Springfield.
  await api('/status', 'POST', {
    locationCity: 'Las Vegas', locationState: 'NV', locationKind: 'TruckStop',
    locationDetail: 'TA on I-15', gameTime: day(13, '07:30'),
    fuelPct: 52, atsOdometer: 2116, truckDamagePct: 6, trailerDamagePct: 4,
    dutyStatus: 'OffDuty', atsBankBalance: 78400,
  });
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: 46,
    source: 'Realistic HOS mod ELD',
  });

  // A live board: the ride home against a better-paying run the wrong way.
  await api('/board/clear', 'POST', {});
  await api('/board/add', 'POST', {
    cargo: 'Frozen Foods', trailerType: 'Reefer', atLocation: true,
    originCity: 'Las Vegas', originState: 'NV', destCity: 'Springfield', destState: 'MO',
    loadedMiles: 1180, deadheadMiles: 0, gameRevenue: 4250, deadlineHours: 72,
    weightLbs: 40100, shipper: 'Cold Chain Foods', receiver: 'Ozark Cold Storage',
  });
  await api('/board/add', 'POST', {
    cargo: 'Produce', trailerType: 'Reefer', atLocation: true,
    originCity: 'Las Vegas', originState: 'NV', destCity: 'Seattle', destState: 'WA',
    loadedMiles: 1210, deadheadMiles: 0, gameRevenue: 5100, deadlineHours: 70,
    weightLbs: 42000, shipper: 'Desert Fresh', receiver: 'Puget Foods',
  });
  const dec = await api('/board/add', 'POST', {
    cargo: 'Ice Cream', trailerType: 'Reefer', atLocation: true,
    originCity: 'Las Vegas', originState: 'NV', destCity: 'Phoenix', destState: 'AZ',
    loadedMiles: 300, deadheadMiles: 0, gameRevenue: 720, deadlineHours: 14,
    weightLbs: 38000, shipper: 'Creamery Co', receiver: 'Valley Foods', isUrgent: true,
  });

  const bs = await api('/bootstrap');
  console.log('\n--- demo ready ---');
  console.log(`company    : ${bs.company.name} (${bs.company.equipmentStars}★)`);
  console.log(`yards      : ${bs.company.terminals.map((t) => `${t.city} (${t.level})`).join(', ')}`);
  console.log(`fleet      : ${bs.trucks.length} tractors`);
  console.log(`home time  : ${bs.views.homeTime.headline}`);
  console.log(`decision   : ${dec.headline}`);
  console.log(`safety     : ${bs.views.countingFaults} counting fault(s), ${bs.views.unacknowledged.length} to acknowledge`);
  console.log(`discovered : ${bs.discovered.length} cities`);
  process.exit(0);
})().catch((e) => { console.error('DEMO ERROR:', e.message); process.exit(1); });
