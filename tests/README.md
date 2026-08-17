# Tests

Integration suites. Each one starts a real server on its own port with its own career file and drives
it through the HTTP API — the same API the UI uses. Nothing is mocked, so a suite passing means the
behaviour actually works end to end.

## Running them

```powershell
.\tests\run.ps1                 # everything, quietly — one line per suite
.\tests\run.ps1 -Only shop,odo  # just those
.\tests\run.ps1 -Full           # every assertion, not only failures
.\tests\run.ps1 -SkipBuild      # reuse the current binaries
```

Requires `node` on the PATH. Nothing else — no test framework, no `npm install`.

The runner builds first, because a stale binary is the one failure mode that reports success while
testing old code. It kills any running server before building, since a live one holds the DLL and the
build fails quietly.

Servers start with `-NoNewWindow`, so no console windows open. Career files and server logs go to
`%TEMP%\tsd-tests\<suite>\` and are wiped at the start of every run; the path is printed when
something fails.

## The suites

| Suite | What it covers |
|---|---|
| `t` | Hire, first day, fuel stops, clocks at delivery, carry-forward, city discovery, reset-keeps-settings |
| `t2` | Yard capacity tiers, stocking a fleet, unit numbering, backdrop equipment |
| `t3` | Home time: arrangements, routing, taking it, work orders, trip lifecycle |
| `bal` | ATS bank balance reconciliation, and never inventing a variance |
| `ded` | Dedicated accounts, off-account exceptions, changing employer |
| `disc` | Progressive discipline, acknowledgement, management override |
| `equip` | Carrier equipment standards, transmission preference, domicile swap |
| `facility` | Loading, unloading and detention derived from Begin/End pairs |
| `fleetlife` | Hired drivers, termination cases, resignations, truck retirement |
| `forgive` | Incidents ageing off, early review, what counts against hiring |
| `local` | Dock board vs city board, and when to reposition |
| `odo` | Miles derived from the odometer, and warnings on a bad reading |
| `payroll` | Friday settlements, pay stubs, tax withholding, dock-time learning, out-of-hours boards |
| `reassign` | Trailer reassignment at home, waiting on a hired driver |
| `shop` | Repair quotes, the 10% dispatch stop, run-home, mileage-scaled write-offs |

## Adding one

Copy the top of any existing suite — the `api` helper, `ok`, `head` — and read the port from the
environment so the runner can assign it:

```js
const B = `http://127.0.0.1:${process.env.TSD_PORT || 5599}/api`;
```

Print `PASS` / `FAIL` at the start of a line; that is all the runner counts. Exit non-zero on failure.
Drop the file in this folder and it is picked up automatically.

Assert on behaviour rather than on exact wording where you can. Copy changes; a suite that breaks
every time a sentence is reworded stops being useful. Where the wording *is* the feature — the app
telling the driver to sit a 34, say — assert on the phrase that carries the meaning.
