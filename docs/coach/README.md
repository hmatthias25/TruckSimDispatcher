# TruckSim Coach Driver 0.1 (alpha)

A companion app for the **Coaches DLC** in Euro Truck Simulator 2. You play an employed coach driver:
hired by a coach company, given your duties from the jobs the game offers, judged on keeping the
timetable at every stop and on how your passengers felt, paid by the hour, and working up from
probation and the night lines to excursions and multi-day tours.

The full guide is **TruckSim-Coach-Driver-Manual.pdf**, in this zip.

## What you need

- Euro Truck Simulator 2 with the Coaches DLC.
- Windows 10 or 11. Nothing to install: no .NET, no internet connection.
- Optional: an Anthropic API key, to read screenshots of the game's job menus. Without one, jobs are
  typed in.

## Starting

1. Put `TruckSimCoach.exe` in a folder of its own, or beside TruckSim Dispatcher and
   TruckSim Owner-Operator if you play them.
2. Run it. A console window opens and the app opens in your browser at http://127.0.0.1:5373.
   Close the console window to stop it.
3. Fill in the first screen: your name, the game's day and time, your coach level and coach skills,
   and a company with a home depot. A rookie starts at a budget company.
4. Buy the coach model the company assigns you in the game (Contract Jobs need one of your own),
   and say so on the Today tab. Buy the large garage at your home depot too, and open it.
5. Open the game's Contract Jobs and Tourist Jobs menus, and read them into the Today tab: paste
   screenshots with Ctrl+V (up to 24 at a time, both menus together), or type each job in. The
   company assigns you a duty. The menu names only where a line starts and ends: if it has 3 stops
   or more, you are asked once for the cities it calls at, off the job's route in the game.
6. Drive it, and log each stop on the Run tab: when you arrived and left, the passengers on and off,
   and the satisfaction the game shows (the % and the four groups). Close it out at the last stop.

## Your career file

Kept in a folder called `coach-data` beside the exe, with dated backups in `coach-data\backups`.
The app never reads or writes the other two apps' careers. Your API key, if you add one, is kept in
the career file and never shown back.

## Good to know

- Be on time, and never leave a stop early: an early departure is worse than arriving late.
- Lateness caused by the road, the game or the coach can be put down to it at the close-out, and is
  not held against you.
- Breaks (45 minutes after 4h30 at the wheel) are off by default, because the game's lines leave no
  room for them. Switch them on in Settings if you want them.
- Give the coach's damage after every run, from the game. From 10% it carries no passengers beyond
  the run home until it is repaired; the service and the safety inspections are done in the
  company's own garage. All of it is on the Coach tab.
- Every job you read in is kept in the route library (the Routes tab), so the company can plan your
  way home. The more boards you read in, the better it plans.

## Alpha

This is the first release, built in the DLC's first days. Everything works and is tested, but the
numbers (pay rates, grades, promotion bars) are first guesses, to be tuned by playing. If something
feels too harsh or too soft, or the game shows something the app does not expect, that is worth
reporting.
