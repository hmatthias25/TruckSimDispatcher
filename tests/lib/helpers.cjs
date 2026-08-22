/* Shared test helpers.
 *
 * Two patterns kept biting, each time as a fresh debugging session, so they live here now.
 *
 * 1. THE OPERATIONAL 34. Operations parks a driver for thirty-four hours of its own accord roughly one
 *    close-out in twenty-five, with clean clocks, and holds dispatch until it is sat. It is seeded, so it
 *    turns up unpredictably in any suite that runs a long string of loads — and a suite that does not
 *    expect it dies on "that load is not on the current board", a message that says nothing about what
 *    actually blocked it. Three suites learned to sit it independently before this existed.
 *
 * 2. NAMING A HIRED DRIVER. Hired drivers resign on their own, seeded per career, so an assertion pinned
 *    to "R. Vance" passes or fails depending on which career the run happened to get. Ask for whoever is
 *    active instead.
 *
 * Every function takes the suite's own `api` so nothing here needs to know about ports or state.
 */

/**
 * Sits an open restart order if there is one, so a blocked dispatch can proceed.
 *
 * Returns the order it sat, or null when nothing was ordered. `advanceTo` is called with the number of
 * game days to skip and must return the ISO game time to report — the suites all number their days
 * differently, so they own that arithmetic.
 */
async function sitRestartIfOrdered(api, advanceTo, { fullCycle = 70 } = {}) {
  const order = (await api('/bootstrap')).views.restart?.order;
  if (!order) return null;

  await api('/restart/arrived', 'POST', {
    gameTime: advanceTo(0),
    city: order.targetCity || undefined,
    state: order.targetState || undefined,
  });
  // Thirty-four hours plus a margin, and the cycle back, which completion checks for.
  await api('/hos', 'POST', {
    driveRemaining: 11, shiftRemaining: 14, breakRemaining: 8, cycleRemaining: fullCycle,
  });
  await api('/restart/complete', 'POST', { gameTime: advanceTo(2) });
  return order;
}

/**
 * Authorises a load, sitting a restart first if one is in the way.
 *
 * `addLoad` must add the load and return the board decision, and is called again after a restart because
 * holding dispatch clears the board — the evaluation handed back beforehand names a load that is gone.
 */
async function authorize(api, addLoad, advanceTo, extra = {}) {
  const board = await addLoad();
  if (!board.evaluations?.[0]) {
    throw new Error(`board came back empty: ${(board.dispatchNotes || []).join(' ; ').slice(0, 200)}`);
  }
  try {
    return await api('/dispatch/authorize', 'POST', { loadId: board.evaluations[0].load.id, ...extra });
  } catch (e) {
    const sat = await sitRestartIfOrdered(api, advanceTo);
    if (!sat) {
      const v = (await api('/bootstrap')).views;
      throw new Error(`${e.message} | blockers: ${(v.dispatchBlockers || []).join(' ; ').slice(0, 260) || 'none'}`);
    }
    const again = await addLoad();
    if (!again.evaluations?.[0]) throw new Error(`still no freight after sitting ${sat.number}`);
    return api('/dispatch/authorize', 'POST', { loadId: again.evaluations[0].load.id, ...extra });
  }
}

/** Hired drivers still on the roster, newest state. Use these rather than naming anybody. */
async function activeDrivers(api) {
  return ((await api('/fleetops')).drivers || []).filter((d) => d.status === 'Active');
}

/** Whether a named driver is still employed — for suites that have to name one. */
async function isActive(api, name) {
  return (await activeDrivers(api)).some((d) => d.name === name);
}

/** Acknowledges any outstanding discipline, which otherwise holds dispatch. */
async function clearDiscipline(api) {
  const actions = (await api('/bootstrap')).discipline || [];
  for (const a of actions) {
    if (!a.driverAcknowledged) await api(`/discipline/${a.number}/acknowledge`, 'POST', {});
  }
  return actions.length;
}

module.exports = {
  sitRestartIfOrdered, authorize, activeDrivers, isActive, clearDiscipline,
};
