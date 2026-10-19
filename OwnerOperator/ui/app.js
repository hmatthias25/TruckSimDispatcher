/* TruckSim Owner-Operator — the page. Plain script, no build step, like the company-driver app. */
'use strict';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (h) => { if (h == null) return '--'; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };
const num = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const badge = (kind, text) => `<span class="badge ${kind}">${esc(text)}</span>`;

/* ---- the game clock, kept the way the company-driver app keeps it.
   The wire format is an ISO stamp from a fixed epoch. The player reads and types a day number and a time of day, with
   the weekday beside the day: a day number cannot be checked by eye, a weekday can. Day 1 is a Monday. */
const EPOCH = Date.UTC(2000, 0, 1);
const DAY_MS = 86400000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isoUtc = (iso) => (!iso ? '' : /[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z');
const dayOf = (iso) => { const t = Date.parse(isoUtc(iso)); return isNaN(t) ? 0 : Math.floor((t - EPOCH) / DAY_MS) + 1; };
const timeOf = (iso) => {
  const t = Date.parse(isoUtc(iso));
  if (isNaN(t)) return '00:00';
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};
const dowForDay = (day) => { const n = Number(day); return Number.isFinite(n) && n >= 1 ? DOW[((Math.floor(n) % 7) + 7) % 7] : '—'; };
const gapHours = (a, b) => { const x = Date.parse(isoUtc(a)), y = Date.parse(isoUtc(b)); return Number.isFinite(x) && Number.isFinite(y) ? (y - x) / 3600000 : null; };

/* Times of day as typed. ATS shows AM and PM, so that is how they are shown; "18:30", "6:30 pm", "1830" and "6pm" are
   all read whichever way they come, and sent as 24-hour. The same rules as the company-driver app. */
const fmtTod = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t || '';
  const h = +m[1];
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
/** Any typed time of day to "HH:mm", or '' if it is not one. */
const parseTod = (raw) => {
  const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return '';
  const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(a|p)?\.?m?\.?$/);
  if (!m) return '';
  let h = +m[1]; const min = m[2] ? +m[2] : 0;
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${pad2(h)}:${pad2(min)}`;
};
/** Day number and a time of day back into the wire format. */
function toIso(day, tod) {
  const d = Math.max(1, parseInt(day, 10) || 1);
  const [h, m] = String(parseTod(tod) || '00:00').split(':').map((x) => parseInt(x, 10) || 0);
  return new Date(EPOCH + (d - 1) * DAY_MS + h * 3600000 + m * 60000).toISOString().slice(0, 16);
}
/** A game moment as the player reads it: "Mon · Day 3 · 6:30 PM". */
const gt = (v) => (!v ? '—' : isNaN(Date.parse(isoUtc(v))) ? String(v)
  : `${dowForDay(dayOf(v))} · Day ${dayOf(v)} · ${fmtTod(timeOf(v))}`);

/* Hours as h:mm, the way the game's clocks read. A decimal typed anyway is taken. Blank is blank, never zero. */
const hoursOf = (raw) => {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  if (t.includes(':')) { const [h, m] = t.split(':'); return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60; }
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
};
const hvn = (id) => hoursOf($(id)?.value);
const hin = (h) => (h == null ? '' : hhmm(h));

/** A game day and a time of day, with the weekday the day works out to, updated as it is typed. */
function dayTimeInput(p, iso, label) {
  const day = iso ? dayOf(iso) : dayOf(S.status.gameTime) || 1;
  return `<label>${esc(label)}
    <span style="display:flex;gap:6px;align-items:center">
      <input id="${p}-day" type="number" min="1" step="1" class="spin" style="flex:0 0 84px" data-dow="${p}-dow" value="${day}" title="Game day">
      <span id="${p}-dow" class="badge info" style="flex:0 0 auto" title="Day 1 is a Monday. Check it against the game.">${dowForDay(day)}</span>
      <input id="${p}-tod" inputmode="text" maxlength="8" style="flex:1 1 auto;min-width:84px" placeholder="6:30 PM"
        value="${fmtTod(iso ? timeOf(iso) : timeOf(S.status.gameTime))}" title="Time of day: 6:30 PM or 18:30, either works">
    </span></label>`;
}
/** The day and time from a dayTimeInput, checked: { day, time (24-hour), iso }. */
function readWhen(p, what = 'The time') {
  const day = Number($(`${p}-day`)?.value);
  const time = parseTod($(`${p}-tod`)?.value);
  if (!(day >= 1)) throw new Error(`${what}: the game day.`);
  if (!time) throw new Error(`${what}: a time of day as the game shows it, 6:30 PM or 18:30.`);
  return { day, time, iso: toIso(day, time) };
}
document.addEventListener('input', (e) => {
  const d = e.target.dataset && e.target.dataset.dow;
  if (d && $(d)) $(d).textContent = dowForDay(e.target.value);
});

/* ---- the clocks: drive, shift, break and cycle left, as h:mm, as the game's HOS display shows them. */
function clockFields(p, h, blank = false) {
  const box = (k, label, v) => `<label>${label}<input id="${p}-${k}" inputmode="numeric" placeholder="${blank && v != null ? 'was ' + hhmm(v) : 'h:mm'}"
    value="${blank ? '' : hin(v)}"></label>`;
  return `<div class="grid4">
    ${box('drive', 'Drive left', h?.drive)}${box('shift', 'Shift left', h?.shift)}
    ${box('brk', 'Break clock', h?.brk)}${box('cycle', 'Cycle left', h?.cycle)}</div>`;
}
/** The four clocks off a clockFields, or null when all are blank. Half filled in is a mistake, and said. */
function readClockFields(p, required) {
  const v = ['drive', 'shift', 'brk', 'cycle'].map((k) => hvn(`${p}-${k}`));
  if (v.every((x) => x == null)) {
    if (required) throw new Error('Your clocks: drive, shift, break and cycle left, as h:mm off the HOS display.');
    return null;
  }
  if (v.some((x) => x == null)) throw new Error('All four clocks, or none: drive, shift, break and cycle left.');
  return { driveRemaining: v[0], shiftRemaining: v[1], breakRemaining: v[2], cycleRemaining: v[3] };
}
/** "8:00 in 1, 10:30 in 2": hours coming back on the recap, as the company-driver app reads it. */
const parseRecap = (raw) => String(raw || '').split(',').map((part) => {
  const m = part.match(/(\d+)\s*:\s*(\d+)\s*in\s*(\d+)/i);
  if (m) return { hours: (+m[1]) + (+m[2]) / 60, inDays: parseInt(m[3], 10) };
  const dec = part.match(/([\d.]+)\s*in\s*(\d+)/i);
  return dec ? { hours: parseFloat(dec[1]), inDays: parseInt(dec[2], 10) } : null;
}).filter(Boolean);

/* ---- a window over the page, for what has to be read before anything else: a dock's answer, a close-out. */
function modal(html) { $('modal-body').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal' || (e.target.closest && e.target.closest('[data-close]'))) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/**
 * Asking for the clocks before a call: a broker plans the next load off how much time you have. On the road, where and
 * when you are as well, because the rest of this run is planned from there: how far is left, and what it costs your clocks.
 */
function clocksPrompt(title, sub, go) {
  const onRun = !!S.booking;
  modal(`<div class="panel-head"><h2>${esc(title)}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Cancel</button></div>
    <p>${esc(sub)}${onRun ? ' On a run, where and when you are as well: the rest of this one is planned from there.' : ''}</p>
    ${onRun ? `<div class="grid4">${dayTimeInput('pc-time', S.status.gameTime, 'Game day and time')}
      <label>City<input id="pc-city" value="${esc(S.status.city)}"></label>
      <label>State<input id="pc-state" class="up" maxlength="2" value="${esc(S.status.state)}"></label>
      <label>Odometer now<input id="pc-odo" type="number" placeholder="optional, last: ${S.status.odometer}"></label></div>` : ''}
    ${clockFields('pc', S.hos, true)}
    <p class="hint">Off your HOS display, as it reads now. Telling a broker your hours is how they know how far they can plan you.</p>
    <div class="row-actions"><div class="spacer"></div><button class="btn primary" id="pc-go">Tell them</button></div>`);
  ($('pc-city') || $('pc-drive')).focus();
  $('pc-go').onclick = async () => {
    try {
      const clocks = readClockFields('pc', true);
      if (onRun) {
        const at = readWhen('pc-time');
        await api('/status', 'POST', { locationCity: $('pc-city').value, locationState: $('pc-state').value, day: at.day, time: at.time,
          odometer: Number($('pc-odo').value) || null });
      }
      closeModal(); await go(clocks);
    } catch (e) { toast(e.message, 'bad'); }
  };
}

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(json?.error || text || `Request failed (${r.status})`);
  return json;
}

function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

let S = null;          // the last snapshot
let tab = 'board';
let shots = [];        // screenshots staged for one read: {mediaType, dataBase64, thumb, name}
let preview = null;    // the last read, waiting to be checked: {ok, error, notes, loads}
let reading = false;

const ADR = ['Explosives', 'Gases', 'Flammable liquids', 'Flammable solids', 'Toxic', 'Corrosive'];
const PRESETS = {
  Easy: 'A mid-age truck and a generous nest egg. Room to learn.',
  Normal: 'An older truck and a nest egg sized to cash flow. The intended game.',
  Hard: 'An older truck and the legal minimum. Every load counts.',
};

// ---------------------------------------------------------------- first screen

async function showStart() {
  $('boot').classList.add('hidden');
  $('app').classList.add('hidden');
  $('start').classList.remove('hidden');
  $('st-adr').innerHTML = ADR.map((a) => `<label><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join('');
  $('st-preset').innerHTML = Object.keys(PRESETS).map((p) =>
    `<label><input type="radio" name="preset" value="${p}" ${p === 'Normal' ? 'checked' : ''}> ${p}</label>`).join('');
  const hint = () => { $('st-preset-hint').textContent = PRESETS[document.querySelector('input[name=preset]:checked').value]; };
  document.querySelectorAll('input[name=preset]').forEach((r) => r.addEventListener('change', hint));
  hint();
  try {
    const cities = await api('/cities');
    $('st-cities').innerHTML = cities.map((c) => `<option value="${esc(c.city)}, ${esc(c.state)}">`).join('');
  } catch { /* typing still works */ }
  $('st-go').onclick = startCareer;
}

async function startCareer() {
  const home = $('st-home').value.split(',').map((x) => x.trim());
  const body = {
    game: 'ATS',
    driverName: $('st-name').value,
    homeCity: home[0] || '',
    homeState: home[1] || '',
    day: Number($('st-day').value),
    time: parseTod($('st-time').value),
    level: Number($('st-level').value),
    longDistance: Number($('st-ld').value),
    highValue: Number($('st-hv').value),
    fragile: Number($('st-fr').value),
    justInTime: Number($('st-jit').value),
    adr: [...document.querySelectorAll('#st-adr input:checked')].map((i) => i.value),
    odometer: Number($('st-odo').value),
    preset: document.querySelector('input[name=preset]:checked').value,
  };
  if (!body.time) { $('st-error').textContent = 'The time of day as the game shows it: 8:00 AM, or 08:00.'; $('st-error').classList.remove('hidden'); return; }
  try {
    S = await api('/start', 'POST', body);
    $('start').classList.add('hidden');
    showApp();
  } catch (e) {
    $('st-error').textContent = e.message;
    $('st-error').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------- app shell

const TABS = [['board', 'Board'], ['active', 'Active Load'], ['brokers', 'Brokers'], ['money', 'Money'], ['home', 'Home'], ['truck', 'Truck & clocks'], ['settings', 'Settings'], ['log', 'Log']];

function showApp() {
  $('boot').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
}

function render() {
  $('brand-name').textContent = S.profile.driverName;
  $('brand-sub').textContent = `Home: ${S.profile.homeCity}, ${S.profile.homeState} · ${S.profile.preset}`;
  $('ver').textContent = `v${S.version}`;
  const h = S.hos;
  const stat = (k, v, cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;
  $('stats').innerHTML = phoneStat() +
    stat('Where', `${S.status.city}, ${S.status.state}`) +
    stat('Clock', S.status.pretty) +
    stat('Drive', hhmm(h.drive), h.drive < 1 ? 'warn' : 'ok') +
    stat('Shift', hhmm(h.shift), h.shift < 1 ? 'warn' : 'ok') +
    stat('Cycle', hhmm(h.cycle), h.cycle < 11 ? 'warn' : 'ok') +
    stat('Cost', `${money(S.settings.costPerMile)}/${S.settings.distanceUnit}`) +
    stat('Can spend', S.gameBank.allowedToSpend == null ? '--' : money(S.gameBank.allowedToSpend), S.gameBank.notYours > 0 ? 'warn' : '') +
    stat('Home life', `${S.home.score} ${S.home.band}`, S.home.score >= 70 ? 'ok' : S.home.score >= 40 ? 'warn' : 'bad');
  phoneAlert();
  $('tabs').innerHTML = TABS.map(([id, name]) => `<button class="${id === tab ? 'on' : ''}" data-tab="${id}">${name}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
  const views = { board: boardView, active: activeView, brokers: brokersView, money: moneyView, home: homeView, truck: truckView, settings: settingsView, log: logView };
  $('view').innerHTML = homeBanner() + views[tab]();
  ({ board: wireBoard, active: wireActive, brokers: wireBrokers, money: wireMoney, home: wireHome, truck: wireTruck, settings: wireSettings, log: () => {} })[tab]();
  wireHomeBanner();
  document.querySelectorAll('[data-goto]').forEach((a) => a.onclick = (e) => { e.preventDefault(); tab = a.dataset.goto; render(); });
  const at = $('tabs').querySelector('[data-tab=active]');
  if (S.trip && at) at.innerHTML += ' <span class="pip amber">1</span>';
  const pending = (S.transfers || []).filter((t) => t.status === 'Pending').length;
  const mt = $('tabs').querySelector('[data-tab=money]');
  if (pending && mt) mt.innerHTML += ` <span class="pip amber">${pending}</span>`;
}

// ---------------------------------------------------------------- the phone, wherever you are in the app

/** Who is on the line: a broker ringing, or home. Neither goes away until it is answered or let go. */
function ringing() {
  if (S.call && S.call.status === 'Ringing') return { id: S.call.id, who: `${S.call.rep} at ${S.call.broker}`, what: `a load out of ${S.call.lane?.pickupCity || ''}` };
  if (S.home && S.home.call) return { id: 'home-' + S.home.call.beHomeByGameTime, who: 'Home', what: S.home.call.reason };
  return null;
}

function phoneStat() {
  const r = ringing();
  return `<div class="stat ${r ? 'bad ringing' : ''}" ${r ? 'id="phone-stat" title="Click to answer"' : ''}><div class="k">Phone</div><div class="v">${r ? '☎ Ringing' : 'Quiet'}</div></div>`;
}

let alerted = '';
/** Once per call: the tab title, a ring, and a desktop notification if the driver turned them on. */
function phoneAlert() {
  const r = ringing();
  document.title = r ? `☎ ${r.who} calling · TruckSim Owner-Operator` : 'TruckSim Owner-Operator';
  const ps = $('phone-stat');
  if (ps) ps.onclick = () => { tab = S.call && S.call.status === 'Ringing' ? 'board' : 'home'; render(); window.scrollTo(0, 0); };
  if (!r || alerted === r.id) return;
  alerted = r.id;
  try {
    const a = new AudioContext(), g = a.createGain();
    g.connect(a.destination); g.gain.value = 0.08;
    [0, 0.45].forEach((t) => { const o = a.createOscillator(); o.frequency.value = 480; o.connect(g); o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.3); });
  } catch { /* no sound is fine */ }
  try {
    if ('Notification' in window && Notification.permission === 'granted')
      new Notification(`☎ ${r.who} is calling`, { body: r.what, tag: r.id });
  } catch { /* the title and the top bar still say it */ }
}

// ---------------------------------------------------------------- board

function firstLoadWalkthrough() {
  const hasBoard = (S.board || []).length > 0;
  const called = !!S.lastCall;
  const step = !hasBoard ? 1 : !called ? 3 : 4;
  const li = (n, html) => `<li class="${n < step ? 'done' : n === step ? 'now' : ''}">${html}</li>`;
  return `<div class="panel"><div class="panel-head"><h2>Your first load</h2></div>
    <ol class="walk">
      ${li(1, S.trailer && !S.trailer.powerOnly
        ? `<b>In the game</b>, at your home garage in ${esc(S.profile.homeCity)}, open the <b>Cargo Market</b> (you have your own ${esc(S.trailer.type.toLowerCase())}) and take a screenshot of the board.`
        : `<b>In the game</b>, at your home garage in ${esc(S.profile.homeCity)}, open the <b>Freight Market</b> and
        take a screenshot of the board. With no trailer of your own it is the Freight Market, not the Cargo Market.`)}
      ${li(2, '<b>Paste every page of it below</b> (Ctrl+V for each), press <b>Make them a board</b>, check what was read, and add it.')}
      ${li(3, `<b>Call a starter broker</b> on the <a href="#" class="lnk" data-goto="brokers">Brokers</a> tab. The broker reads the board
        and makes the offer: which job, and at what rate. New authorities get the leftovers.`)}
      ${li(4, '<b>Negotiate, take it, or try another broker.</b> The ranked board below is your own view of what is really on offer.')}
      ${li(5, '<b>Take that job in the game</b>, at the rate you booked.')}
    </ol></div>`;
}

function laneBanner() {
  const l = S.lane;
  if (!l) return '';
  const fits = (S.laneFits || []).length;
  return `<div class="callout info"><h4>Lane ${esc(l.number)} with ${esc(l.brokerName)}</h4>
    <p>Pick up in <b>${esc(l.pickupCity)}, ${esc(l.pickupState)}</b> from ${esc(gt(l.pickupFromGameTime))} to
      ${esc(gt(l.pickupToGameTime))}, delivering into the <b>${esc(l.destRegion)}</b>, ${l.minMiles}-${l.maxMiles} mi,
      at <b>${money(l.ratePerMile)}/mi</b> (never above the game's pay).</p>
    <p>${S.booking ? 'Deliver the load you are on first.' : fits ? `${fits} job(s) on the board fit it: take one below.`
      : `At ${esc(l.pickupCity)}, paste that city's Freight Market board and the app marks the jobs that fit.`}</p>
    <div class="row-actions">${!S.booking ? '<button class="btn danger" id="ln-none">Nothing fits</button>' : ''}
      <button class="btn tiny ghost" id="ln-cancel">Call it off</button></div></div>`;
}

function bookingBanner() {
  const k = S.booking;
  if (!k) return '';
  const l = k.load;
  return `<div class="callout ok"><h4>Booked: ${esc(k.number)} with ${esc(k.brokerName)}</h4>
    <p style="margin:0">${esc(l.cargo)} to ${esc(l.destCity)}, ${esc(l.destState)} at ${money(k.rate)}. The run, the clocks and the close-out
      are on <a href="#" class="lnk" data-goto="active">Active Load</a>.</p></div>`;
}

function boardView() {
  const loads = S.board || [];
  const intro = (S.bookings || []).length === 0 ? firstLoadWalkthrough() : '';
  return bookingBanner() + laneBanner() + intro + `
    <div class="panel">
      <div class="panel-head"><h2>Add from screenshots</h2><span class="sub">The ${esc(S.trailer?.market || 'Freight Market')} board</span></div>
      <div id="shotzone"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Add by hand</h2></div>
      <div class="grid2">
        <label>Cargo<input id="ad-cargo"></label>
        <label>Destination<input id="ad-dest" placeholder="City, ST"></label>
        <label>Loaded ${esc(S.settings.distanceUnit)}<input id="ad-miles" type="number" min="1"></label>
        <label>Pay<input id="ad-pay" type="number" min="0"></label>
        <label class="span2">Delivery window<input id="ad-window" placeholder="as listed, e.g. Sat 5:48 am - Sat 12:28 pm CDT"></label>
      </div>
      <div class="row-actions"><button class="btn" id="ad-go">Add to board</button></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>The board, ranked</h2><span class="sub">${loads.length} load(s) at ${esc(S.status.city)}</span>
        <span class="spacer"></span>${loads.length ? '<button class="btn tiny ghost" id="bd-clear">Clear</button>' : ''}</div>
      ${loads.length ? loads.map(loadCard).join('') : '<div class="empty">Nothing on the board yet.</div>'}
    </div>`;
}

function loadCard(v) {
  const f = v.feasibility, l = v.load;
  const verdict = f.verdict === 'Feasible' ? 'ok' : f.verdict === 'Tight' ? 'warn' : 'bad';
  const notes = [...(v.skillNotes || []), ...(f.blockers || []), ...(f.warnings || []), ...(v.notes || [])];
  return `<div class="loadcard">
    <div class="loadcard-head">
      <span class="badge mute">#${v.rank}</span>
      <b>${esc(l.cargo)}</b> to <b>${esc(l.destCity)}, ${esc(l.destState)}</b>
      <span class="badge ${verdict}">${esc(f.verdict)}</span>
      ${v.trade && v.trade !== 'General' ? `<span class="badge info">${esc(v.trade)}</span>` : ''}
      <span class="spacer"></span>
      ${(S.laneFits || []).includes(l.id) && !S.booking ? `<span class="badge info">Fits ${esc(S.lane.number)}</span>
        <button class="btn tiny primary" data-take="${esc(l.id)}">Take for the lane</button>` : ''}
      <button class="btn tiny ghost" data-del="${esc(l.id)}">Remove</button>
    </div>
    <div class="figs">
      <div><div class="k">Game pay</div><div class="money">${money(v.gamePay)}</div></div>
      <div><div class="k">Cost</div><div class="money">${money(v.cost)}</div></div>
      <div><div class="k">Leaves</div><div class="money ${v.netAtGamePay >= 0 ? 'pos' : 'neg'}">${money(v.netAtGamePay)}</div></div>
      <div><div class="k">Per day</div><div class="money ${v.netPerDay >= 0 ? 'pos' : 'neg'}">${money(v.netPerDay)}</div></div>
      <div><div class="k">Distance</div><div class="money">${Math.round(v.miles)} ${esc(S.settings.distanceUnit)}</div></div>
      <div><div class="k">Days</div><div class="money">${v.days}</div></div>
      <div><div class="k">Slack</div><div class="money">${f.slackHours != null ? hhmm(f.slackHours) : '--'}</div></div>
    </div>
    ${notes.length ? `<ul class="reasons">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- screenshots: stage several, read them as one board

/** Downscaled to a long edge that stays legible without burning image tokens, as the company-driver app does. */
const MAX_EDGE = 2000;

function stageImage(file) {
  if (!file || !/^image\/(png|jpe?g)$/.test(file.type)) return;
  if (shots.length >= 24) { toast('Twenty-four screenshots is the limit per read.', 'bad'); return; }
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const draw = (cw, ch) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; c.getContext('2d').drawImage(img, 0, 0, cw, ch); return c; };
      // PNG keeps the game's text crisp; the thumbnail is only for the strip.
      const t = Math.min(1, 320 / Math.max(w, h));
      shots.push({
        mediaType: 'image/png',
        dataBase64: draw(w, h).toDataURL('image/png').split(',')[1],
        thumb: draw(Math.round(w * t), Math.round(h * t)).toDataURL('image/png').split(',')[1],
        name: file.name && file.name !== 'image.png' ? file.name : `page ${shots.length + 1}`,
      });
      renderShots();
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

/** The same job already on the board: pasting overlapping pages of one board is ordinary, and nobody de-dupes by hand. */
const onBoard = (l) => (S.board || []).some(({ load: b }) =>
  (b.cargo || '').toLowerCase() === (l.cargo || '').toLowerCase()
  && (b.destCity || '').toLowerCase() === (l.destCity || '').toLowerCase()
  && (b.destState || '').toLowerCase() === (l.destState || '').toLowerCase()
  && Math.abs((b.loadedMiles || 0) - (l.loadedMiles || 0)) < 1
  && Math.abs((b.gameRevenue || 0) - (l.gameRevenue || 0)) < 1);

function shotsHtml() {
  const key = S.settings.hasApiKey;
  const strip = shots.length ? `<div class="shots">${shots.map((x, i) => `<figure class="shot">
      <img src="data:${x.mediaType};base64,${x.thumb}" alt="screenshot ${i + 1}">
      <figcaption>${esc(x.name)} <button class="btn tiny ghost" data-shot-del="${i}">✕</button></figcaption></figure>`).join('')}</div>
    <div class="row-actions">
      <button class="btn primary" id="sh-read" ${key && !reading ? '' : 'disabled'}>${reading ? 'Reading…' : `Make ${shots.length === 1 ? 'it' : `these ${shots.length}`} a board`}</button>
      <button class="btn ghost" id="sh-clear" ${reading ? 'disabled' : ''}>Clear</button>
      ${key ? '' : '<span class="hint">Reading needs an Anthropic API key in Settings. Without one, type the jobs in below.</span>'}</div>` : '';
  return `<div class="dropzone" id="drop" tabindex="0">
      <b>Ctrl+V to paste a screenshot</b>
      <span>or drop image files here, or <label class="lnk" for="shot-file">browse</label></span>
      <input type="file" id="shot-file" accept="image/png,image/jpeg" multiple class="offscreen">
      <span class="hint">The board shows about ten jobs at a time: screenshot every page, paste them all, then make them a board.
        They are read together, and a job on two pages counts once.</span>
    </div>${strip}${previewHtml()}`;
}

function previewHtml() {
  if (!preview) return '';
  if (!preview.ok) return `<div class="callout bad"><h4>Could not read the screenshots</h4><p>${esc(preview.error)}</p></div>`;
  const rows = preview.loads || [];
  if (!rows.length) return `<div class="callout warn"><h4>No jobs found</h4><p>${esc(preview.notes || 'Nothing legible in those images.')}</p></div>`;
  const cell = (i, f, v, w) => `<input id="pv-${f}-${i}" value="${esc(v ?? '')}" style="min-width:${w};padding:4px 6px;margin:0;font-size:12px">`;
  return `<div class="callout warn"><h4>Check what was read</h4>
      <p>Nothing is on the board yet. A misread figure would mislead every plan and every offer, so correct anything wrong and untick
        anything that is not a job.${preview.notes ? ` <b>Reader notes:</b> ${esc(preview.notes)}` : ''}</p></div>
    <div class="tablewrap"><table class="grid"><thead><tr><th></th><th>Cargo</th><th>Destination</th><th>ST</th>
      <th>Loaded ${esc(S.settings.distanceUnit)}</th><th>Pay</th><th>Delivery window, as listed</th><th></th></tr></thead>
      <tbody>${rows.map((l, i) => { const dup = onBoard(l); return `<tr>
        <td><input type="checkbox" id="pv-use-${i}" ${dup ? '' : 'checked'} style="margin:0"></td>
        <td>${cell(i, 'cargo', l.cargo, '130px')}</td><td>${cell(i, 'city', l.destCity, '120px')}</td><td>${cell(i, 'state', l.destState, '44px')}</td>
        <td>${cell(i, 'miles', l.loadedMiles ? Math.round(l.loadedMiles) : '', '70px')}</td><td>${cell(i, 'pay', l.gameRevenue || '', '80px')}</td>
        <td>${cell(i, 'window', l.windowText, '190px')}</td>
        <td>${dup ? '<span class="badge mute">on the board</span>' : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="row-actions"><button class="btn go" id="pv-add">Add ticked jobs to the board</button>
      <button class="btn ghost" id="pv-drop">Discard</button></div>`;
}

function renderShots() {
  const z = $('shotzone');
  if (!z) return;
  z.innerHTML = shotsHtml();
  wireShots();
}

function wireShots() {
  const drop = $('drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); [...e.dataTransfer.files].forEach(stageImage); };
  $('shot-file').onchange = (e) => { [...e.target.files].forEach(stageImage); };
  document.querySelectorAll('[data-shot-del]').forEach((b) => b.onclick = () => { shots.splice(+b.dataset.shotDel, 1); renderShots(); });
  const clear = $('sh-clear');
  if (clear) clear.onclick = () => { shots = []; preview = null; renderShots(); };
  const read = $('sh-read');
  if (read) read.onclick = async () => {
    reading = true; renderShots();
    try {
      preview = await api('/board/extract', 'POST', { images: shots.map((x) => ({ mediaType: x.mediaType, dataBase64: x.dataBase64 })) });
      if (preview.ok) toast(`Read ${preview.loads.length} job(s). Check them, then add them.`);
    } catch (e) { preview = { ok: false, error: e.message, loads: [] }; }
    reading = false; renderShots();
  };
  const add = $('pv-add');
  if (add) add.onclick = async () => {
    const v = (f, i) => ($(`pv-${f}-${i}`)?.value || '').trim();
    const picked = [], skipped = [];
    preview.loads.forEach((l, i) => {
      if (!$(`pv-use-${i}`).checked) return;
      const row = { ...l, cargo: v('cargo', i) || 'Freight', destCity: v('city', i), destState: v('state', i).toUpperCase(),
        loadedMiles: Number(v('miles', i)) || 0, gameRevenue: Number(v('pay', i)) || 0, windowText: v('window', i) };
      // A row the planner cannot judge is held back rather than sent: a blank pay would read as free freight.
      if (!row.destCity || row.loadedMiles <= 0 || row.gameRevenue <= 0 || (!row.windowText && !(row.deadlineHours > 0))) skipped.push(row.cargo);
      else picked.push(row);
    });
    if (!picked.length) { toast(skipped.length ? `Nothing added: ${skipped.join(', ')} still need a destination, miles, pay or a window.` : 'Nothing ticked.', 'bad'); return; }
    try {
      const r = await api('/board/add-many', 'POST', picked);
      S = r.snapshot; shots = []; preview = null;
      toast(`${r.added} job(s) on the board.${skipped.length ? ` Skipped, incomplete: ${skipped.join(', ')}.` : ''}`);
      (r.refused || []).forEach((x) => toast(`${x.cargo} to ${x.destCity}: ${x.reason}`, 'warn'));
      render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const dropBtn = $('pv-drop');
  if (dropBtn) dropBtn.onclick = () => { preview = null; renderShots(); };
}

// Pasting anywhere on the Board tab stages the image. The clocks drop zone stops its own pastes before they get here.
document.addEventListener('paste', (e) => {
  if (!S || tab !== 'board' || $('app').classList.contains('hidden')) return;
  const files = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (!files.length) return;
  e.preventDefault();
  files.forEach(stageImage);
  toast(`${files.length} screenshot(s) added. Paste the rest, then make them a board.`);
});

function wireBoard() {
  document.querySelectorAll('[data-take]').forEach((b) => b.onclick = async () => {
    try { const r = await api('/lane/take', 'POST', { loadId: b.dataset.take }); S = r.snapshot; toast(`${r.booking.number} booked off the lane.`); render(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  const lc = $('ln-cancel');
  if (lc) lc.onclick = async () => {
    const why = prompt('Why are you calling off the lane? (the broker will remember)');
    if (why === null) return;
    try { const r = await api('/lane/cancel', 'POST', { why }); S = r.snapshot; toast(r.said); render(); } catch (e) { toast(e.message, 'bad'); }
  };
  const none = $('ln-none');
  if (none) none.onclick = async () => {
    if (!confirm('Tell the broker nothing on the board fits? They cancel the lane.')) return;
    try { const r = await api('/lane/nothing-fits', 'POST'); S = r.snapshot; toast(r.said); render(); } catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-goto]').forEach((a) => a.onclick = (e) => { e.preventDefault(); tab = a.dataset.goto; render(); });
  renderShots();
  $('ad-go').onclick = async () => {
    const dest = $('ad-dest').value.split(',').map((x) => x.trim());
    try {
      const r = await api('/board/add-many', 'POST', [{
        cargo: $('ad-cargo').value, destCity: dest[0] || '', destState: dest[1] || '',
        loadedMiles: Number($('ad-miles').value), gameRevenue: Number($('ad-pay').value),
        windowText: $('ad-window').value, notes: 'Typed in',
      }]);
      S = r.snapshot;
      (r.refused || []).forEach((x) => toast(x.reason, 'warn'));
      render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const clear = $('bd-clear');
  if (clear) clear.onclick = async () => { S = await api('/board/clear', 'POST'); render(); };
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    S = await api(`/board/${b.dataset.del}`, 'DELETE'); render();
  });
}

// ---------------------------------------------------------------- active load
/* The run, laid out as the company-driver app's Active Load tab: the load and its appointment, the plan it was booked on,
   the plan from here, the trip log, the dock arrivals and the close-out. Less of it: no pay, fuel bills or damage to
   the truck, which are the Companion App's. */

let LAST_AUDIT = null;   // what the last close-out said, until it is dismissed

const isDropHook = (t) => ((t && t.trailerType) || '').trim().toLowerCase() === 'drop & hook';

/* What the close-out treats as the arrival: the earliest the log shows, the arrival stamp or a Begin unload. It is what
   the appointment is judged against, so it is not the moment the load is being closed out. */
function arrivedFromLog(t) {
  const hit = ((t && t.events) || []).filter((e) => e.kind === 'BeginUnload').map((e) => e.gameTime).filter(Boolean);
  if (t && t.arrivedGameTime) hit.push(t.arrivedGameTime);
  return hit.sort()[0] || '';
}

/* The stops you sit through, which get an end time. A break and a rest open at their standard lengths. */
const SPAN_EVENTS = new Set(['Rest', 'Break', 'Delay', 'Breakdown']);
function defaultSpanEnd(kind, beganIso) {
  const hours = kind === 'Break' ? S.rules.breakLength : kind === 'Rest' ? S.rules.offDutyReset : 0;
  const t = Date.parse(isoUtc(beganIso));
  if (!(hours > 0) || !Number.isFinite(t)) return beganIso;
  return new Date(t + hours * 3600000).toISOString().slice(0, 16);
}
function eventNote(kind) {
  switch (kind) {
    case 'BeginLoad': case 'BeginUnload':
      return 'The clock going onto the dock. This and its End are the pair dock time and detention are measured from.';
    case 'EndLoad': case 'EndUnload':
      return 'The clock coming off the dock: how long they actually held you, and what this facility gets remembered for.';
    case 'Fuel': return 'Gallons and price below, if you want them on the log.';
    case 'Break': return 'The required thirty. The end is filled in for you; change it if you sat longer.';
    case 'Rest': return 'A reset in the bunk. The end time is the one thing the app cannot work out for itself: a ten-hour reset and a '
      + 'night waiting for a shipper to open look identical from here.';
    case 'Delay': return 'Time the run lost that was not driving, a rest or a break, and NOT at a dock: traffic, a closed road, weather. '
      + 'Waiting to be let onto a dock is already measured from I have arrived, so it does not go here as well.';
    case 'Breakdown': return 'Sat with the truck down. Say when you rolled again: without it the planner reads the whole wait as driving.';
    case 'Scale': return 'A weigh station. A moment, not a stop: log the detail if something came of it.';
    case 'Note': return 'Anything worth reading back later that is not one of the above.';
    default: return '';
  }
}

/** A dock's answer when the truck pulled in, shipper or receiver: an instruction to carry out in the game first. */
function callModal(call, fallback) {
  if (!call) {
    return modal(`<div class="panel-head"><h2>${esc(fallback || 'Straight in')}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Close</button></div>
      <div class="callout go"><p style="margin:0">${isDropHook(S.trip) ? 'Nothing to wait for: drop it and close the load out.'
        : 'Nothing to wait for. Log Begin unload now and get it off.'}</p></div>`);
  }
  const waits = call.workStartsGameTime && call.workStartsGameTime !== call.arrivedGameTime;
  return modal(`<div class="panel-head"><h2>${esc(call.headline)}</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Close</button></div>
    <div class="callout ${call.kind === 'TakenEarly' || call.kind === 'StraightIn' ? 'go' : 'warn'}">
      <p style="margin:0">${esc(call.instruction)}</p></div>
    ${waits ? `<div class="kv"><span>set the clock to <b>${esc(gt(call.workStartsGameTime))}</b></span>
      <span>waiting <b>${hhmm(call.waitHours)}</b></span>
      ${call.position ? `<span>place in line <b>#${call.position}</b></span>` : ''}</div>` : ''}`);
}

/** Where the clocks the plan runs on came from: a call, a close-out, a screenshot, or typed in. */
function clocksFrom(h) {
  const when = gt(h.asOf);
  if (h.carriedForwardFrom) return `Updated ${when} from your close-out of ${h.carriedForwardFrom}`;
  if ((h.source || '').startsWith('Told ')) return `Updated ${when} from your call: you told ${h.source.slice(5)} your clocks and where you were`;
  if (h.source === 'GDC Companion') return `Updated ${when} from a GDC recap screenshot`;
  return `Updated ${when} from the clocks you reported`;
}

function fromHereView(f) {
  const cls = f.verdict === 'Feasible' ? 'ok' : f.verdict === 'Tight' ? 'warn' : 'bad';
  const msgs = [...(f.blockers || []), ...(f.warnings || [])];
  return `<div class="callout ${cls}"><h4>From here: ${esc(f.verdict)}</h4>
    <p>At the gate ${esc(gt(f.projectedDockStartGameTime || f.projectedArrivalGameTime))}, window shuts
      ${esc(gt(f.dueGameTime))}: ${f.slackHours >= 0 ? hhmm(f.slackHours) + ' to spare' : '<b>' + hhmm(-f.slackHours) + ' late</b>'}.
      ${f.restsRequired ? `${f.restsRequired} rest(s) still to take.` : ''}</p>
    ${msgs.length ? `<ul class="reasons">${msgs.slice(0, 4).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
    <details><summary>The plan</summary>${timelineHtml(f)}</details>
  </div>`;
}

function timelineHtml(f) {
  if (!(f.timeline || []).length) return '';
  return `<div class="tablewrap"><table class="tl">
    <thead><tr><th>Segment</th><th>From</th><th>To</th><th class="num">Time</th><th class="num">Miles</th>
      <th class="num">Drive</th><th class="num">Shift</th><th class="num">Break</th><th class="num">Cycle</th></tr></thead>
    <tbody>${f.timeline.map((x) => `<tr class="${esc(x.kind || '')}">
      <td>${esc(x.label)}</td><td>${esc(gt(x.startGameTime))}</td><td>${esc(gt(x.endGameTime))}</td>
      <td class="num">${hhmm(x.hours)}</td><td class="num">${x.miles ? num(x.miles) : ''}</td>
      <td class="num">${hhmm(x.driveRemainingAfter)}</td><td class="num">${hhmm(x.shiftRemainingAfter)}</td>
      <td class="num">${hhmm(x.breakRemainingAfter)}</td><td class="num">${hhmm(x.cycleRemainingAfter)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* Dock time and detention, worked out from the trip log the way the close-out bills it, so the figure read before the
   button is the figure on the invoice. The free time is Core's, the rate the broker's. */
function facilityHtml(t, k) {
  if (isDropHook(t)) return dropHookGatesHtml(t, k);
  const at = (kind) => { const hit = (t.events || []).filter((e) => e.kind === kind).map((e) => e.gameTime).filter(Boolean).sort(); return hit.length ? hit[0] : null; };
  const span = (a, b) => { const x = at(a), y = at(b); if (!x || !y) return null; const h = gapHours(x, y); return h >= 0 ? h : null; };
  const load = span('BeginLoad', 'EndLoad');
  const unload = span('BeginUnload', 'EndUnload');
  const free = S.rules.detentionFreeHours || 0;
  const queueFree = S.rules.queueFreeHours || 0;
  const arrivedAt = t.arrivedGameTime || at('BeginUnload');
  const dueAt = t.appointmentGameTime || t.appointmentOpensGameTime;
  const startAt = dueAt && arrivedAt && Date.parse(isoUtc(dueAt)) > Date.parse(isoUtc(arrivedAt)) ? dueAt : arrivedAt;
  let onProperty = null, waiting = 0;
  if (startAt) {
    const tookYou = t.workStartsGameTime || at('BeginUnload');
    const endedAt = at('EndUnload');
    const w = tookYou ? gapHours(startAt, tookYou) : null;
    if (endedAt) { onProperty = gapHours(startAt, endedAt); if (w !== null && w > 0) waiting = Math.min(w, onProperty); }
    else if (w !== null && w >= 0) { waiting = w; onProperty = w + (unload ?? t.unloadingHours ?? 0); }
    if (onProperty !== null && onProperty < 0) onProperty = null;
  }
  const held = onProperty !== null && onProperty > (unload ?? 0) ? onProperty : null;
  const billable = (total, waited) => {
    const wait = Math.min(Math.max(waited, 0), Math.max(total, 0));
    return Math.max(0, (total - wait) - free) + Math.max(0, wait - queueFree);
  };
  const det = load === null && unload === null && held === null ? null
    : Math.max(0, (load ?? 0) - free) + billable(held ?? unload ?? 0, held === null ? 0 : waiting);
  const named = { BeginLoad: 'Begin load', EndLoad: 'End load', BeginUnload: 'Begin unload', EndUnload: 'End unload' };
  const line = (label, hours, a, b) => hours === null
    ? `<tr><td>${label}</td><td colspan="2" class="sub">not logged: log <b>${named[a]}</b> and <b>${named[b]}</b>, or type it below</td></tr>`
    : `<tr><td>${label}</td><td class="num"><b>${hhmm(hours)}</b></td><td class="sub">${esc(gt(at(a)))} → ${esc(gt(at(b)))}</td></tr>`;
  const agreed = k.detentionPerHour > 0;
  return `<fieldset><legend>Dock time and detention, from your trip log</legend>
    <div class="tablewrap"><table><tbody>
      ${line('Loading', load, 'BeginLoad', 'EndLoad')}
      ${line('Unloading', unload, 'BeginUnload', 'EndUnload')}
      ${held === null ? '' : `<tr><td>On their property</td><td class="num"><b>${hhmm(held)}</b></td>
        <td class="sub">their clock from ${esc(gt(startAt))}${dueAt && startAt === dueAt ? ', your slot, not when you rolled in' : ''}</td></tr>`}
      ${det === null ? '' : `<tr><td><b>Detention</b></td>
        <td class="num"><b style="color:${det > 0 && agreed ? 'var(--amber2)' : 'var(--ink3)'}">${hhmm(det)}</b></td>
        <td class="sub">${!agreed ? 'no detention agreed on this load, so nothing is billed: the dock times still teach the planner'
          : det > 0 ? `past ${hhmm(free)} free at each stop: billed at ${money(k.detentionPerHour)}/h, ${money(det * k.detentionPerHour)}`
          : `inside the ${hhmm(free)} free at each stop`}</td></tr>`}
    </tbody></table></div>
    ${t.workStartsGameTime && t.arrivedGameTime && t.workStartsGameTime > t.arrivedGameTime ? `
    <div class="callout info" style="margin:8px 0">
      <p style="margin:0 0 6px">You arrived <b>${esc(gt(t.arrivedGameTime))}</b> and I told you at the gate they would take you at
        <b>${esc(gt(t.workStartsGameTime))}</b>. That was <b>my estimate</b>, not something the game measured. If they took you at a
        different time, put it here and I will use yours.</p>
      <label style="max-width:16rem">They actually took you at
        <input id="c-tookyou" placeholder="6:30 PM" value="${esc(fmtTod(timeOf(t.workStartsGameTime)))}"></label></div>` : ''}
    ${load === null || unload === null ? `<div class="grid3" style="margin-top:8px">
      <label>Loading<input id="c-load" inputmode="numeric" placeholder="h:mm" value="${hin(t.loadingHours)}"></label>
      <label>Unloading<input id="c-unload" inputmode="numeric" placeholder="h:mm" value="${hin(t.unloadingHours)}"></label>
      <label>Detention<input id="c-det" inputmode="numeric" placeholder="h:mm" value="0:00"></label>
      <label class="chk" title="ATS finishes the unload the moment you take a load from this location, so the clock has already moved.">
        <input id="c-unloadran" type="checkbox"> Unload already ran (took the next job off this facility's board)</label>
      <label>Clock when you were finished and away<input id="c-released" placeholder="6:30 PM, optional: beats a duration"></label>
    </div>
    <p class="hint">Fallback for what you did not log. Log the pairs next time and this works itself out.</p>`
    : '<p class="hint">Off the log, so there is nothing to type. The summary shows the times it used.</p>'}
  </fieldset>`;
}

/* Drop and hook, as in the company-driver app: you back under what is there and drop at the other end, so there is no dock
   time to log and no Begin or End pair to ask for. What a gate held you for is already on the run, from I am at the shipper
   and I have arrived, and that is what detention is worked out from. */
function dropHookGatesHtml(t, k) {
  const waited = (from, to) => (from && to && to > from ? gapHours(from, to) : 0);
  const atShipper = waited(t.shipperArrivedGameTime, t.loadStartsGameTime);
  const atReceiver = waited(t.arrivedGameTime, t.workStartsGameTime);
  const row = (label, from, hours, stamp) => !from
    ? `<tr><td>${label}</td><td colspan="2" class="sub">not reported: press <b>${stamp}</b> when you pull in</td></tr>`
    : `<tr><td>${label}</td><td class="num"><b>${hhmm(hours)}</b></td><td class="sub">${hours > 0.01 ? 'held at the gate from ' + esc(gt(from)) : 'straight in, ' + esc(gt(from))}</td></tr>`;
  return `<fieldset><legend>Drop and hook: waiting at the gates</legend>
    <div class="tablewrap"><table><tbody>
      ${row('At the shipper', t.shipperArrivedGameTime, atShipper, 'I am at the shipper')}
      ${row('At the receiver', t.arrivedGameTime, atReceiver, 'I have arrived')}
    </tbody></table></div>
    <p class="hint">Nothing to log at the docks on drop and hook: you back under what is there and drop it at the other end.
      ${k.detentionPerHour ? `Detention is worked out from the time a gate held you, past the free time, and billed at ${money(k.detentionPerHour)}/h:
        the summary shows it.` : 'No detention was agreed on this load, so a wait is only time.'}</p>
    ${t.workStartsGameTime && t.arrivedGameTime && t.workStartsGameTime > t.arrivedGameTime ? `
    <div class="callout info" style="margin:8px 0">
      <p style="margin:0 0 6px">You arrived <b>${esc(gt(t.arrivedGameTime))}</b> and I told you at the gate they would take you at
        <b>${esc(gt(t.workStartsGameTime))}</b>. That was <b>my estimate</b>. If they took you at a different time, put it here and I will use yours.</p>
      <label style="max-width:16rem">They actually took you at
        <input id="c-tookyou" placeholder="6:30 PM" value="${esc(fmtTod(timeOf(t.workStartsGameTime)))}"></label></div>` : ''}
  </fieldset>`;
}

/** A time of day typed at the close-out, on the delivery day unless it reads earlier than the arrival (past midnight). */
function dayOfDelivery(id, allowSameMoment) {
  const tod = parseTod($(id)?.value);
  if (!tod) return '';
  const arrived = readWhen('c-time', 'Arrived').iso;
  const day = dayOf(arrived);
  const same = toIso(day, tod);
  return (allowSameMoment ? same >= arrived : same > arrived) ? same : toIso(day + 1, tod);
}

function activeView() {
  const t = S.trip, k = S.booking, v = S.tripViews || {};
  if (!t || !k) return `<div class="panel"><div class="empty">No load booked. Call a broker on the Brokers tab, or take a job for
      your lane on the Board.</div>
    <div class="row-actions" style="justify-content:center"><button class="btn" data-goto="board">Go to the Board</button></div></div>
    ${LAST_AUDIT ? auditHtml(LAST_AUDIT) : ''}`;
  const f = t.feasibilityAtDispatch, pk = v.receiverParking, sh = v.receiverSiteHours, isSite = v.receiverIsSite, l = k.load;
  const fh = v.fromHere;
  const placeOf = (co, city) => (co ? `${esc(co)} in ` : '') + esc(city);
  return `
  <div class="panel">
    <div class="panel-head"><h2>${esc(t.number)}: ${esc(t.cargo)}</h2>
      ${badge(t.status === 'InTransit' ? 'info' : 'warn', t.status === 'InTransit' ? 'in transit' : 'booked')}
      <div class="spacer"></div><span class="sub">with ${esc(k.brokerName)}</span></div>
    <div class="callout ok"><p style="margin:0"><b>Take this job in the game:</b> ${esc(l.cargo)} from ${placeOf(l.shipper, l.originCity)}
      to ${placeOf(l.receiver, l.destCity)}, ${esc(l.destState)}.</p></div>
    <dl class="kvlist">
      <dt>Lane</dt><dd>${esc(t.originCity)}, ${esc(t.originState)} → ${esc(t.destCity)}, ${esc(t.destState)}</dd>
      <dt>Distance</dt><dd>${num(t.dispatchedMiles)} mi loaded${t.deadheadMiles ? ` + ${num(t.deadheadMiles)} to the shipper` : ''}</dd>
      <dt>Pay</dt><dd><b>${money(k.rate)}</b> from ${esc(k.brokerName)}${k.quickPay ? ' on quick pay' : `, net ${k.daysToPay}`}
        <div class="sub">The game pays ${money(k.gamePay)} at delivery: the shipper's money, which goes to Broker holding.</div></dd>
      ${k.detentionPerHour ? `<dt>Detention</dt><dd>${money(k.detentionPerHour)}/h after ${hhmm(k.detentionAfterHours)} at either ${isDropHook(t) ? 'gate' : 'dock'}
        <div class="sub">${isDropHook(t) ? 'Drop and hook: billed off the time a gate holds you. Press I am at the shipper and I have arrived as you pull in.'
          : 'Billed off the dock times you log: Begin and End at each.'}</div></dd>` : ''}
      <dt>Booked</dt><dd>${esc(gt(t.dispatchedGameTime))}</dd>
      ${t.appointmentOpensGameTime
        ? `<dt>Window</dt><dd>${esc(gt(t.appointmentOpensGameTime))} → <b>${esc(gt(t.dueGameTime))}</b>
            <div class="sub">${!t.receiverTakesEarly ? 'They will not take it before the window opens.'
              : isSite ? 'They will not take it before the window opens: a site gate does not go up early. No slot inside it, though.'
              : 'They will not take it before the window opens. After that, any hour works: no slot to sit for.'}</div></dd>`
        : `<dt>Due</dt><dd>${esc(gt(t.dueGameTime))}</dd>`}
      ${t.receiverTakesEarly && isSite
        ? `<dt>Appointment</dt><dd>${badge('info', 'no slot: take your turn')}
            <div class="sub">Nobody booked you in, so there is no time to hit. It is a gate rather than a door: turn up before they open
              and you wait, and when they open you are behind whoever queued.</div></dd>`
        : t.receiverTakesEarly
        ? `<dt>Appointment</dt><dd>${badge('ok', 'taking it early')}
            <div class="sub">No slot to keep, so anything you save inside their window is yours to reload against.</div></dd>`
        : t.appointmentGameTime
          ? `<dt>Appointment</dt><dd><b>${esc(gt(t.appointmentGameTime))}</b>
              <div class="sub">Aim for the slot. Past it you have ${num(S.rules.appointmentGraceHours, 1)} h of grace before it counts
                against you, even with the window open.</div></dd>`
          : ''}
      ${t.weightLbs ? `<dt>Weight</dt><dd>${num(t.weightLbs)} lb</dd>` : ''}
      ${pk ? `<dt>Parking</dt><dd>${badge(pk.allowed ? 'ok' : 'warn', pk.headline)}<div class="sub">${esc(pk.detail)}</div></dd>` : ''}
      ${sh ? `<dt>Their hours</dt><dd>${badge('info', sh.headline)}<div class="sub">${esc(sh.detail)}</div></dd>` : ''}
      ${t.shipperArrivedGameTime ? `<dt>At the shipper</dt><dd>${badge(
          t.loadStartsGameTime && t.loadStartsGameTime !== t.shipperArrivedGameTime ? 'warn' : 'ok',
          t.loadStartsGameTime && t.loadStartsGameTime !== t.shipperArrivedGameTime
            ? `${isDropHook(t) ? 'hook' : 'load'} at ${gt(t.loadStartsGameTime)}` : 'ready')}
          <div class="sub">${esc(t.shipperCallNote)}</div></dd>` : ''}
      ${t.arrivedGameTime ? `<dt>At the receiver</dt><dd>${badge(
          t.receiverCallKind === 'TakenEarly' || t.receiverCallKind === 'StraightIn' ? 'ok' : 'warn',
          t.workStartsGameTime && t.workStartsGameTime !== t.arrivedGameTime ? `start at ${gt(t.workStartsGameTime)}` : 'straight in')}
          <div class="sub">${esc(t.receiverCallNote || (isDropHook(t) ? 'Nothing to wait for: drop it and close the load out.' : 'Nothing to wait for. Log Begin unload now.'))}</div></dd>` : ''}
    </dl>
    ${f ? `<h3 class="sect">The plan it was booked on</h3>
      <div class="callout ${f.verdict === 'Feasible' ? 'go' : 'warn'}">
        <p><b>${esc(f.verdict)}</b>: ${hhmm(f.slackHours)} slack against a ${hhmm(f.requiredBufferHours)} buffer.
          ${f.restsRequired} rest(s), ${f.breaksRequired} break(s), ${f.fuelStopsRequired} fuel stop(s), ${hhmm(f.driveHours)} driving
          over ${num(f.totalMiles)} mi.</p>
        ${(f.warnings || []).length ? `<ul>${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      </div>
      ${f.dockAdvice ? `<p class="hint" style="margin:8px 0 0">${f.dockAdvice}</p>` : ''}
      <details class="score"><summary>Full HOS timeline</summary>${timelineHtml(f)}</details>` : ''}
    <div class="row-actions"><button class="btn tiny danger" id="bk-cancel">Hand it back</button>
      <span class="hint">A cancellation on your record with ${esc(k.brokerName)}. Cancel the job in the game too.</span></div>
    <div class="row-actions"><button class="btn tiny ghost" id="bk-lost">The game lost it</button>
      <span class="hint">The job vanished in the game (a reset, a crash, a reload) and you could not stop it. Cancelled, but not on your record.</span></div>
  </div>

  <div class="panel" id="fromhere">
    <div class="panel-head"><h2>From here</h2><span class="sub">The rest of this run, off your latest clocks and position</span></div>
    ${fh ? fromHereView(fh) : `<p class="hint">${t.arrivedGameTime ? 'At the receiver: nothing left to plan.' : 'Nothing to plan from yet: your clocks are needed.'}</p>`}
    ${S.hos.asOf ? `<p class="hint">${esc(clocksFrom(S.hos))}. Calling a broker, or answering one, updates this too: nothing else to do.</p>` : ''}
    ${!S.lane && t.loadedReported ? `<p class="hint">To line up the next load: log a break or a rest in the trip log below, then ring a broker on the
      <a href="#" class="lnk" data-goto="brokers">Brokers</a> tab straight away. They offer a lane out of where this one ends.</p>` : ''}
    <details ${fh && fh.verdict !== 'Feasible' ? 'open' : ''}><summary>Running late? Check it from here</summary>
      <p class="hint">Lost time to a closure, a breakdown or a slow dock? Say where you are and what your clocks read, and the box above
        says whether you still make the window, and what it costs.</p>
      <div class="grid3">${dayTimeInput('ck-time', S.status.gameTime, 'Game day and time')}
        <label>City<input id="ck-city" value="${esc(S.status.city)}"></label>
        <label>State<input id="ck-state" class="up" maxlength="2" value="${esc(S.status.state)}"></label></div>
      <label style="max-width:20rem">Odometer now<input id="ck-odo" type="number" placeholder="last: ${S.status.odometer}">
        <span class="hint">Optional. With it, the miles left come off the odometer; without it, from where you are on the map.</span></label>
      ${clockFields('ck', S.hos)}
      <div class="row-actions"><button class="btn primary" id="ck-save">Save, and re-plan from here</button></div>
      <div class="dropzone" id="ck-drop" tabindex="0">Or paste or drop a GDC recap screenshot here${S.settings.hasApiKey ? '' : ' (needs an API key in Settings)'}</div>
    </details>
  </div>

  ${!t.loadedReported && (t.shipperArrivedGameTime || (t.events || []).some((e) => e.kind === 'BeginLoad' || e.kind === 'EndLoad')) ? `<div class="panel">
    <div class="panel-head"><h2>${isDropHook(t) ? 'Report after hooking' : 'Report after loading'}</h2>
      <span class="sub">The odometer here starts the loaded leg.</span></div>
    <div class="grid3">${dayTimeInput('ld-time', S.status.gameTime, 'Pulled out at')}
      <label>Odometer now<input id="ld-odo" type="number" placeholder="last: ${S.status.odometer}"></label>
      <label>Weight (lb)<input id="ld-wt" type="number" placeholder="optional"></label></div>
    <p class="hint">Type the odometer as it reads now: the road from here to the receiver is learned off it. Blank, and nothing is
      learned from this run.</p>
    <div class="row-actions"><button class="btn primary" id="ld-go">Loaded, pulling out</button></div>
  </div>` : ''}

  <div class="cols">
   <div style="display:flex;flex-direction:column;gap:15px">
    <div class="panel">
      <div class="panel-head"><h2>Trip log</h2><span class="sub">Log events as they happen.</span></div>
      <div class="grid2">
        ${dayTimeInput('ev-time', S.status.gameTime, 'Game time')}
        <label>Event<select id="ev-kind">${[
          ...(isDropHook(t) ? [] : [['BeginLoad', 'Begin load'], ['EndLoad', 'End load'], ['BeginUnload', 'Begin unload'], ['EndUnload', 'End unload']]),
          ['Fuel', 'Fuel'], ['Break', 'Break'], ['Rest', 'Rest'], ['Scale', 'Scale'], ['Delay', 'Delay'], ['Breakdown', 'Breakdown'], ['Note', 'Note'],
        ].map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}</select></label>
      </div>
      <p class="hint" id="ev-kind-note">${esc(eventNote(isDropHook(t) ? 'Fuel' : 'BeginLoad'))}</p>
      <div id="ev-endwrap" class="hidden">
        <div class="grid2">${dayTimeInput('ev-end', S.status.gameTime, 'Rolled again at')}
          <div><p class="hint" style="margin-top:22px">A break and a rest open at their standard lengths and follow the start time; type
            over either if you sat longer. On a delay or a breakdown, leaving it alone means you would rather not say.</p></div></div>
        <div class="callout info"><p style="margin:0"><b>Put the time you rolled again, and the app's clock moves there with you.</b>
          Without it the extra hours count as driving, and the run teaches the planner that the map is slower than it is.</p></div>
      </div>
      <label>Detail <span class="sub">optional</span><input id="ev-detail" placeholder="only if there is something worth noting"></label>
      <fieldset><legend>If this is a fuel stop</legend>
        <div class="grid4">
          <label>Gallons<input id="ev-gal" type="number" step="0.1" placeholder="0"></label>
          <label>$/gal<input id="ev-price" type="number" step="0.001" placeholder="0.000"></label>
          <label>City<input id="ev-city" placeholder="${esc(S.status.city)}"></label>
          <label>State<input id="ev-state" class="up" maxlength="2" placeholder="${esc(S.status.state)}"></label>
        </div>
        <p class="hint">On the log only: what fuel costs is the Companion App's to keep.</p>
      </fieldset>
      <div class="row-actions"><button class="btn primary" id="ev-go">Add to log</button></div>
      ${(t.events || []).length ? `<div class="log" style="margin-top:12px">${t.events.slice().reverse().map((e) =>
        `<div><span class="badge mute">${esc(e.kind)}</span> <span>${esc(gt(e.gameTime))}${e.endGameTime
          ? ` → ${esc(gt(e.endGameTime))} <b>(${hhmm(gapHours(e.gameTime, e.endGameTime))})</b>`
          : e.kind === 'Rest' ? ' <span class="badge warn">no end time</span>' : ''} ${e.detail && e.detail !== e.kind ? '· ' + esc(e.detail) : ''}${
          e.gallons ? ` <b>${num(e.gallons, 1)} gal</b>` : ''}
          <button class="btn tiny ghost" data-fix="${esc(e.id)}" title="Correct or drop this entry">fix</button></span></div>`).join('')}</div>
        <p class="hint">Typed a stamp wrong? <b>fix</b> it here. One AM/PM slip otherwise teaches the planner a dock time that never happened.</p>` : ''}
    </div>

    ${t.windowWarning ? `<div class="panel">
      <div class="panel-head"><h2>Check this load's delivery window</h2>${badge('warn', 'not confirmed')}</div>
      <p>${esc(t.windowWarning)}</p>
      <p class="hint">Due ${esc(gt(t.dueGameTime))} as it stands. Read the time to deliver off the job screen and correct it here.</p>
      <div class="grid3">
        <label>Time to deliver<input id="wf-hours" inputmode="numeric" placeholder="h:mm from the job screen"></label>
        <label>Note<input id="wf-note" placeholder="e.g. window reads 6:15 AM to 12:55 PM"></label>
        <div class="row-actions" style="align-self:end"><button class="btn go" id="wf-go">Correct the window</button></div>
      </div></div>` : ''}
   </div>

   <div style="display:flex;flex-direction:column;gap:15px">
    ${!t.shipperArrivedGameTime && !t.loadedReported && !(t.events || []).some((e) => e.kind === 'BeginLoad' || e.kind === 'EndLoad') ? `<div class="panel">
      <div class="panel-head"><h2>At the shipper?</h2><span class="sub">Say when you got there and I will tell you when the freight is ready.</span></div>
      <div class="grid2">${dayTimeInput('shp-time', S.status.gameTime, 'Game time you pulled in')}
        <div class="row-actions" style="align-items:end"><button class="btn" id="shp-go">I am at the shipper</button></div></div>
      <p class="hint">Do this before you ${isDropHook(t) ? 'hook the trailer' : 'load'} in the game. If it is not ready I will give you a time to
        set the clock to and the reason. Waiting on their property counts toward detention.</p>
    </div>` : ''}
    ${!t.arrivedGameTime ? `<div class="panel">
      <div class="panel-head"><h2>At the receiver?</h2><span class="sub">Say when you got there and I will tell you when they will actually take it.</span></div>
      <div class="grid2">${dayTimeInput('arr-time', S.status.gameTime, 'Game time you pulled in')}
        <div class="row-actions" style="align-items:end"><button class="btn" id="arr-go">I have arrived</button></div></div>
      <p class="hint">Do this before you unload in the game. If they cannot take you yet I will give you a time to set the clock to and the
        reason, so the waiting lands on your hours where it really went.</p>
    </div>` : ''}
    <div class="panel">
      <div class="panel-head"><h2>Close the load out</h2><span class="sub">Once it is delivered in the game.</span></div>
      ${t.workStartsGameTime && t.arrivedGameTime && t.workStartsGameTime > t.arrivedGameTime
        ? `<div class="callout info"><p style="margin:0">You arrived <b>${esc(gt(t.arrivedGameTime))}</b> and they would not take you until
             <b>${esc(gt(t.workStartsGameTime))}</b>. The box below is your <b>arrival</b>, which is right: that is what the window is judged
             on, and the wait for their door is theirs. The clock moves to when they took you when you close out.</p></div>` : ''}
      <div class="grid2">
        ${dayTimeInput('c-time', arrivedFromLog(t) || S.status.gameTime, 'Arrived at the receiver (game)')}
        <label>Ending odometer<input id="c-odo" type="number" placeholder="last: ${S.status.odometer}"></label>
        <label>Cargo damage %<input id="c-cargo" type="number" step="0.1" min="0" max="100" value="0"></label>
        <label>Fuel % now<input id="c-fuelpct" type="number" step="1" min="0" max="100" value="${S.status.fuelPct}"></label>
      </div>
      <p class="hint">${arrivedFromLog(t) ? 'Arrival is off your log, not the clock as it stands now: the window is judged on when you got there.'
        : `This is when you <em>arrived</em>, which is what the window is judged on, not when you are filling this in. ${isDropHook(t)
          ? 'Press I have arrived when you pull in and it fills itself.' : 'Log Begin unload when you back in and it fills itself.'}`}</p>
      <fieldset><legend>Clocks as you arrived: read them when you pull in, before you ${isDropHook(t) ? 'drop the trailer' : 'unload'}</legend>
        ${clockFields('c', S.hos, true)}
        <p class="hint">The last moment you and the game agree. Whatever the dock then costs comes off these, and the next broker plans you on
          them. Leave them blank and the clocks on file are marked as needing a re-read.</p>
      </fieldset>
      ${facilityHtml(t, k)}
      <label>If anything delayed you, what happened?<input id="c-delay" placeholder="e.g. closed for construction east of Ely"></label>
      <label>Whose fault was it?
        <select id="c-fault">
          <option value="">Let it be worked out from the log and what you wrote</option>
          <option value="Driver">Mine</option>
          <option value="Unavoidable">Nobody's: traffic, weather, a dock that held me</option>
          <option value="Mechanical">The truck</option>
          <option value="GameLimitation">The game: a crash, a bug, a reload</option>
        </select></label>
      <p class="hint">Honour system, and it settles it: anything other than <b>Mine</b>, and a late is not held against you with the broker.</p>
      <label>Notes<input id="c-notes" placeholder="optional"></label>
      <div class="row-actions"><button class="btn go" id="c-go">Delivered: close it out</button></div>
    </div>
   </div>
  </div>
  ${LAST_AUDIT ? auditHtml(LAST_AUDIT) : ''}`;
}

const auditSection = (title, items) => items && items.length
  ? `<h3 class="sect">${title}</h3><ul class="reasons">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

/** What the close-out said: the summary the company-driver app gives, less pay and the fleet. */
function auditModal(a) {
  const late = a.trip.serviceResult === 'Late';
  modal(`<div class="panel-head"><h2>${esc(a.trip.number)} closed out</h2>
      ${badge(late ? 'bad' : 'ok', late ? 'late' : 'on time')}<div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Close</button></div>
    <div class="callout ${late ? (a.faultAttribution === 'Driver' ? 'stop' : 'warn') : 'go'}">
      <h4>${esc(a.headline)}</h4>${a.faultRationale ? `<p>${esc(a.faultRationale)}</p>` : ''}</div>
    ${(a.warnings || []).length ? `<div class="callout warn"><h4>Check these numbers</h4>
      ${a.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}
    <div class="cols"><div>${auditSection('Service', a.serviceFindings)}${auditSection('Mileage', a.mileageFindings)}</div>
      <div>${auditSection('Money', a.moneyFindings)}${auditSection('The load', a.equipmentFindings)}
        ${auditSection(`Carried forward${a.clocksReported ? ', clocks included' : ''}`, a.carriedForward)}</div></div>
    <div class="row-actions"><div class="spacer"></div><button class="btn primary" data-close>Got it</button></div>`);
}

function auditHtml(a) {
  const late = a.trip.serviceResult === 'Late';
  return `<div class="panel">
    <div class="panel-head"><h2>Last close-out: ${esc(a.trip.number)}</h2>${badge(late ? 'bad' : 'ok', late ? 'late' : 'on time')}</div>
    <div class="callout ${late ? (a.faultAttribution === 'Driver' ? 'stop' : 'warn') : 'go'}">
      <h4>${esc(a.headline)}</h4>${a.faultRationale ? `<p>${esc(a.faultRationale)}</p>` : ''}</div>
    ${auditSection('Service', a.serviceFindings)}${auditSection('Mileage', a.mileageFindings)}
    ${auditSection('Money', a.moneyFindings)}${auditSection('The load', a.equipmentFindings)}
    ${a.carriedForward && a.carriedForward.length ? `<div class="callout go" style="margin-top:14px">
      <h4>Carried forward${a.clocksReported ? ', clocks included' : ''}</h4>
      <ul>${a.carriedForward.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="row-actions"><button class="btn ghost" id="audit-dismiss">Dismiss</button></div>
  </div>`;
}

/** Correcting a stamp already logged: an AM/PM slip would otherwise teach the planner a dock time that never happened. */
function amendEventModal(evId) {
  const t = S.trip;
  const ev = ((t && t.events) || []).find((x) => x.id === evId);
  if (!ev) return toast('That entry is not on the run any more.', 'bad');
  modal(`<div class="panel-head"><h2>Correct the ${esc(ev.kind)}</h2>${badge('mute', gt(ev.gameTime))}<div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Cancel</button></div>
    <p>Logged at <b>${esc(gt(ev.gameTime))}</b>. Put in what it should have said.</p>
    ${dayTimeInput('ae-time', ev.gameTime, 'Game day and time')}
    ${SPAN_EVENTS.has(ev.kind) ? dayTimeInput('ae-end', ev.endGameTime || ev.gameTime, 'Rolled again at') : ''}
    <label>Note<input id="ae-detail" value="${esc(ev.detail || '')}" placeholder="optional"></label>
    <div class="row-actions">
      <button class="btn danger" id="ae-drop">Drop this entry</button><div class="spacer"></div>
      <button class="btn primary" id="ae-save">Correct it</button></div>`);
  const send = async (remove) => {
    try {
      const at = readWhen('ae-time', 'When');
      const end = SPAN_EVENTS.has(ev.kind) ? readWhen('ae-end', 'Rolled again') : null;
      const r = await api(`/run/event/${encodeURIComponent(evId)}`, 'POST', {
        day: at.day, time: at.time, endDay: end && end.iso !== at.iso ? end.day : null, endTime: end && end.iso !== at.iso ? end.time : null,
        detail: $('ae-detail').value, remove,
      });
      closeModal(); S = r.snapshot; toast(r.said); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('ae-save').onclick = () => send(false);
  $('ae-drop').onclick = () => send(true);
}

/** The close-out, read off the form: the day and time, the odometer, and whatever else was given. */
function closeOutBody() {
  const at = readWhen('c-time', 'Arrived');
  const odo = Number($('c-odo').value);
  if (!(odo > 0)) throw new Error('The odometer as it reads now: the run is measured off it.');
  const clocks = readClockFields('c', false);
  const hoursIf = (id) => ($(id) ? hvn(id) : null);
  return {
    day: at.day, time: at.time, odometer: odo, arrived: at.iso,
    drive: clocks?.driveRemaining ?? null, shift: clocks?.shiftRemaining ?? null,
    break: clocks?.breakRemaining ?? null, cycle: clocks?.cycleRemaining ?? null,
    tookYou: $('c-tookyou') ? dayOfDelivery('c-tookyou', true) || null : null,
    released: $('c-released') ? dayOfDelivery('c-released', false) || null : null,
    unloadAlreadyRan: $('c-unloadran') ? $('c-unloadran').checked : null,
    loadingHours: hoursIf('c-load'), unloadingHours: hoursIf('c-unload'), detentionHours: hoursIf('c-det'),
    delayReason: $('c-delay').value, fault: $('c-fault').value || null,
    cargoDamagePct: Number($('c-cargo').value) || 0, fuelPct: Number($('c-fuelpct').value),
    notes: $('c-notes').value,
  };
}

/** Before it goes: what is about to be filed, read back, as the company-driver app asks before its close-out. */
function confirmCloseOut() {
  const t = S.trip;
  let b;
  try { b = closeOutBody(); } catch (e) { return toast(e.message, 'bad'); }
  const startOdo = t.loadedReported && t.startOdometer > 0 ? t.startOdometer : null;
  const faults = { Driver: 'Mine', Unavoidable: "Nobody's", Mechanical: 'The truck', GameLimitation: 'The game' };
  modal(`<div class="panel-head"><h2>Close ${esc(t.number)} out?</h2><div class="spacer"></div>
      <button class="btn tiny ghost" data-close>Not yet</button></div>
    <p>Only once it is delivered in the game. This is what goes on the run:</p>
    <dl class="kvlist">
      <dt>Arrived</dt><dd>${esc(gt(b.arrived))}</dd>
      <dt>Odometer</dt><dd>${num(b.odometer)}${startOdo ? ` <span class="sub">(${num(b.odometer - startOdo)} mi since you pulled out)</span>` : ''}</dd>
      <dt>Clocks</dt><dd>${b.drive != null ? `drive ${hhmm(b.drive)} · shift ${hhmm(b.shift)} · break ${hhmm(b.break)} · cycle ${hhmm(b.cycle)}`
        : '<span class="badge warn">not given</span> <span class="sub">the ones on file get marked as needing a re-read</span>'}</dd>
      ${b.cargoDamagePct >= 1 ? `<dt>Cargo damage</dt><dd>${num(b.cargoDamagePct, 1)}% <span class="sub">a claim on your record</span></dd>` : ''}
      ${b.fault ? `<dt>A late, if any, is</dt><dd>${esc(faults[b.fault] || b.fault)}</dd>` : ''}
      ${b.delayReason ? `<dt>What happened</dt><dd>${esc(b.delayReason)}</dd>` : ''}
    </dl>
    <div class="row-actions"><button class="btn ghost" data-close>Not yet</button><div class="spacer"></div>
      <button class="btn go" id="c-confirm">Yes, it is delivered</button></div>`);
  $('c-confirm').onclick = async () => {
    try {
      const r = await api('/deliver', 'POST', b);
      closeModal();
      S = r.snapshot;
      LAST_AUDIT = r.audit;
      render();
      if (r.audit) auditModal(r.audit);
      else toast(`${r.invoice.number} raised: ${money(r.invoice.amount)} due from ${r.invoice.brokerName}.`);
    } catch (e) { toast(e.message, 'bad'); }
  };
}

function wireActive() {
  const t = S.trip;
  const dismiss = $('audit-dismiss');
  if (dismiss) dismiss.onclick = () => { LAST_AUDIT = null; render(); };
  if (!t) return;
  const post = async (path, body, after) => {
    try { const r = await api(path, 'POST', body); S = r.snapshot || r; render(); if (after) after(r); }
    catch (e) { toast(e.message, 'bad'); }
  };
  $('bk-cancel').onclick = async () => {
    const why = prompt('Why are you handing it back? (it goes on your record)');
    if (why === null) return;
    post('/booking/handback', { why }, () => toast('Handed back.'));
  };
  $('bk-lost').onclick = async () => {
    const why = prompt('What happened in the game? (not held against you)', 'game reset');
    if (why === null) return;
    post('/booking/handback', { why, gameLost: true }, () => toast('Cancelled. Not on your record.'));
  };
  $('ck-save').onclick = async () => {
    try {
      const at = readWhen('ck-time');
      const clocks = readClockFields('ck', true);
      await api('/status', 'POST', { locationCity: $('ck-city').value, locationState: $('ck-state').value, day: at.day, time: at.time,
        odometer: Number($('ck-odo').value) || null });
      S = await api('/hos', 'POST', clocks);
      toast('Clocks and position saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  wireRecapDrop($('ck-drop'));
  const ld = $('ld-go');
  if (ld) ld.onclick = () => {
    try {
      const at = readWhen('ld-time', 'Pulled out');
      post('/run/loaded', { day: at.day, time: at.time, odometer: Number($('ld-odo').value) || null, weightLbs: Number($('ld-wt').value) || null },
        (r) => { if (r.said) toast(r.said); });
    } catch (e) { toast(e.message, 'bad'); }
  };
  const shp = $('shp-go');
  if (shp) shp.onclick = () => {
    try { const at = readWhen('shp-time'); post('/run/at-shipper', { day: at.day, time: at.time }, (r) => callModal(r.call, 'At the shipper')); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const arr = $('arr-go');
  if (arr) arr.onclick = () => {
    try { const at = readWhen('arr-time'); post('/run/arrived', { day: at.day, time: at.time }, (r) => callModal(r.call, 'At the receiver: straight in')); }
    catch (e) { toast(e.message, 'bad'); }
  };

  // The trip log: the end box opens for the stops you sit through, at the standard length for a break or a rest.
  const kind = $('ev-kind');
  const syncEnd = () => {
    $('ev-kind-note').textContent = eventNote(kind.value);
    const span = SPAN_EVENTS.has(kind.value);
    $('ev-endwrap').classList.toggle('hidden', !span);
    if (!span) return;
    try {
      const began = readWhen('ev-time').iso;
      const end = defaultSpanEnd(kind.value, began);
      $('ev-end-day').value = dayOf(end);
      $('ev-end-dow').textContent = dowForDay(dayOf(end));
      $('ev-end-tod').value = fmtTod(timeOf(end));
    } catch { /* the start is still being typed */ }
  };
  kind.onchange = syncEnd;
  $('ev-time-day').addEventListener('change', syncEnd);
  $('ev-time-tod').addEventListener('change', syncEnd);
  $('ev-go').onclick = () => {
    try {
      const at = readWhen('ev-time');
      const span = SPAN_EVENTS.has(kind.value);
      const end = span ? readWhen('ev-end', 'Rolled again') : null;
      post('/run/event', {
        kind: kind.value, day: at.day, time: at.time,
        endDay: end && end.iso !== at.iso ? end.day : null, endTime: end && end.iso !== at.iso ? end.time : null,
        detail: $('ev-detail').value, city: $('ev-city').value, state: $('ev-state').value,
        gallons: Number($('ev-gal').value) || null, pricePerGal: Number($('ev-price').value) || null,
      }, () => toast(`${kind.options[kind.selectedIndex].text} logged.`));
    } catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => amendEventModal(b.dataset.fix));
  const wf = $('wf-go');
  if (wf) wf.onclick = () => post('/run/window', { deadlineHours: hvn('wf-hours') || 0, note: $('wf-note').value }, (r) => toast(r.said));
  $('c-go').onclick = confirmCloseOut;
}

// ---------------------------------------------------------------- brokers and the phone

let brokerFilter = 'here';

function brokersView() {
  const dir = S.directory || [];
  const shown = dir
    .filter((b) => brokerFilter === 'all' || (brokerFilter === 'here' ? b.worksHere : b.takesYou))
    .sort((a, b) => (b.takesYou - a.takesYou) || ['Starter', 'Established', 'Premium'].indexOf(a.tier) - ['Starter', 'Established', 'Premium'].indexOf(b.tier));
  const r = S.record;
  const tierBadge = (t) => `<span class="badge ${t === 'Starter' ? 'mute' : t === 'Established' ? 'info' : 'violet'}">${esc(t)}</span>`;
  return phoneView() + `<div class="panel">
    <div class="panel-head"><h2>Broker directory</h2>
      <span class="sub">Your record: ${r.loads} load(s), ${r.onTimePct}% on time, ${r.daysWithAuthority} day(s) with your authority</span>
      <span class="spacer"></span>
      <select id="br-filter">
        <option value="here" ${brokerFilter === 'here' ? 'selected' : ''}>Work ${esc(S.status.state)}'s region</option>
        <option value="takes" ${brokerFilter === 'takes' ? 'selected' : ''}>Will take my call</option>
        <option value="all" ${brokerFilter === 'all' ? 'selected' : ''}>Everyone I know</option>
      </select></div>
    ${shown.length ? `<div class="tablewrap"><table class="grid"><thead><tr>
        <th>Broker</th><th>Tier</th><th>Based</th><th>Works</th><th>Pays</th><th>Credit</th><th>Requirement</th><th>Notes</th><th></th>
      </tr></thead><tbody>${shown.map((b) => `<tr>
        <td><b>${esc(b.name)}</b>${b.kind === 'Shipper' ? ' <span class="badge violet">Company</span>' : ''}
          <div class="hint">${esc(b.rep)} · ${esc(b.specialty)}${b.loadsBooked ? ` · ${b.loadsBooked} load(s) with you` : ''}</div></td>
        <td>${tierBadge(b.tier)}</td>
        <td>${esc(b.city)}, ${esc(b.state)}</td>
        <td>${esc(b.regions.join(', '))}</td>
        <td>net ${b.daysToPay}<div class="hint">quick pay ${b.quickPayFeePct}%</div></td>
        <td>${esc(b.credit)}</td>
        <td>${b.takesYou ? '<span class="badge ok">Will take you</span>' : `<span class="hint">${esc(b.requirement)}</span>`}</td>
        <td class="hint">${esc((b.notes || []).join(' '))}</td>
        <td><button class="btn tiny ${b.takesYou && b.worksHere ? 'primary' : ''}" data-call="${esc(b.id)}">Call</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nobody in this view yet.</div>'}
  </div>`;
}

function phoneView() {
  const c = S.call || (S.lastCall && S.lastCall.status !== 'Open' ? S.lastCall : null);
  if (!c) return '';
  const open = c.status === 'Open';
  const view = (S.board || []).find((v) => c.load && v.load.id === c.load.id);
  const net = view ? c.offer - view.cost : null;
  const turns = (c.turns || []).map((t) => `<div class="turn ${t.who}"><b>${t.who === 'broker' ? esc(c.rep) : 'You'}:</b> ${esc(t.text)}</div>`).join('');
  return `<div class="panel phone">
    <div class="panel-head"><h2>On the phone: ${esc(c.rep)}, ${esc(c.broker)}</h2>
      <span class="badge ${open ? 'warn' : c.status === 'Booked' ? 'ok' : 'mute'}">${open ? esc(c.mood) : esc(c.status)}</span></div>
    ${c.lane && open ? `<div class="figs">
      <div><div class="k">Offer</div><div class="money">${money(c.offer)}</div></div>
      <div><div class="k">Pick up</div><div class="money">${esc(c.lane.pickupCity)}, ${esc(c.lane.pickupState)}</div></div>
      <div><div class="k">From</div><div class="money">${esc(gt(c.lane.pickupFromGameTime))}</div></div>
      <div><div class="k">Into</div><div class="money">${esc(c.lane.destRegion)}</div></div>
      <div><div class="k">Distance</div><div class="money">${c.lane.minMiles}-${c.lane.maxMiles} mi</div></div>
      <div><div class="k">At your cost</div><div class="money">${money(c.offer - S.settings.costPerMile * (c.lane.minMiles + c.lane.maxMiles) / 2)}</div></div>
    </div><p class="hint">A lane: the offer is for the middle of the band, booked as a rate per mile. The game supplies the job at the pickup.</p>` : ''}
    ${c.load && !c.lane && open ? `<div class="figs">
      <div><div class="k">Offer</div><div class="money">${money(c.offer)}</div></div>
      <div><div class="k">The load</div><div class="money">${esc(c.load.cargo)} to ${esc(c.load.destCity)}, ${esc(c.load.destState)}</div></div>
      ${view ? `<div><div class="k">Your cost</div><div class="money">${money(view.cost)}</div></div>
      <div><div class="k">Leaves you</div><div class="money ${net >= 0 ? 'pos' : 'neg'}">${money(net)}</div></div>
      <div><div class="k">Verdict</div><div class="money">${esc(view.feasibility.verdict)}</div></div>` : ''}
    </div>` : ''}
    <div class="transcript">${turns}</div>
    ${open ? `<div class="sayrow">
        <input id="ph-text" placeholder="${S.aiPhone ? 'Say something, e.g. 2,150 and you pay detention, Lyon is dead this week' : 'Type a figure, or use the buttons'}">
        <button class="btn primary" id="ph-say">Say</button></div>
      <div class="row-actions">
        <button class="btn go" data-move="accept">Take it at ${money(c.offer)}</button>
        <label class="inline">Counter <input id="ph-amount" type="number" step="5" value="${Math.round(c.offer * 1.1 / 5) * 5}"></label>
        <span class="chkrow" id="ph-args">
          <label><input type="checkbox" value="deadMarket"> Dead market</label>
          <label><input type="checkbox" value="deadhead"> Deadhead</label>
          <label><input type="checkbox" value="tight"> Tight window</label>
          <label><input type="checkbox" value="record"> My record</label>
          <label><input type="checkbox" value="walk"> Or I walk</label>
        </span>
        <button class="btn" data-move="counter">Counter</button>
        ${c.listingLeftHours != null ? `<button class="btn warn" data-move="toolate" title="No penalty: the listing running out is nobody's fault">Can't make it in time (${hhmm(c.listingLeftHours)} left)</button>` : ''}
        <button class="btn ghost" data-move="better">Anything better?</button>
        <button class="btn ghost" data-move="quickpay">Quick pay?</button>
        <button class="btn ghost" data-move="detention">Detention?</button>
        <button class="btn danger" data-move="decline">Pass</button>
      </div>` : ''}
  </div>`;
}

async function say(body) {
  const c = S.call;
  try {
    const r = await api(`/calls/${c.id}/say`, 'POST', body);
    S = r.snapshot;
    if (r.call.status === 'Booked') toast('Booked. Take the job in the game.');
    render();
  } catch (e) { toast(e.message, 'bad'); }
}

function wireBrokers() {
  const f = $('br-filter');
  if (f) f.onchange = () => { brokerFilter = f.value; render(); };
  const ring = async (brokerId, clocks) => {
    try {
      const r = await api('/calls', 'POST', { brokerId, clocks });
      S = r.snapshot;
      if (!S.call) S.lastCall = r.call;
      render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-call]').forEach((b) => b.onclick = () => {
    // On the road, the call is about the next load, and the broker plans it off how much time you have left.
    if (!S.booking) return ring(b.dataset.call);
    const who = (S.directory || []).find((x) => x.id === b.dataset.call);
    clocksPrompt(`Ringing ${who ? who.name : 'a broker'}`, 'Tell them your clocks: they plan the next load off how much time you have.',
      (clocks) => ring(b.dataset.call, clocks));
  });
  const text = $('ph-text');
  if (text) {
    const go = () => { if (text.value.trim()) say({ text: text.value.trim() }); };
    $('ph-say').onclick = go;
    text.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }
  document.querySelectorAll('[data-move]').forEach((b) => b.onclick = () => {
    const m = b.dataset.move;
    if (m === 'counter') {
      say({ kind: 'counter', amount: Number($('ph-amount').value),
        arguments: [...document.querySelectorAll('#ph-args input:checked')].map((i) => i.value) });
    } else if (m === 'quickpay' || m === 'detention') say({ kind: 'terms', term: m });
    else say({ kind: m });
  });
}

// ---------------------------------------------------------------- money

function moneyView() {
  const tr = S.transfers || [], inv = S.invoices || [], g = S.gameBank, h = S.holding;
  const pending = tr.filter((t) => t.status === 'Pending'), done = tr.filter((t) => t.status === 'Done');
  return `<div class="panel"><div class="panel-head"><h2>Game bank</h2>
      <span class="sub">Only money you are allowed to spend should stay in it.</span></div>
    <div class="figs">
      <div><div class="k">Allowed to spend</div><div class="money big ${g.allowedToSpend == null ? '' : 'pos'}">${g.allowedToSpend == null ? 'Report it below' : money(g.allowedToSpend)}</div></div>
      <div><div class="k">In the game bank</div><div class="money">${g.estimate == null ? '--' : money(g.estimate)}</div></div>
      <div><div class="k">Not yours: to move</div><div class="money ${g.notYours > 0 ? 'neg' : ''}">${money(g.notYours)}</div></div>
    </div>
    <p class="hint">${g.reported == null ? 'Tell the app what the game bank shows, and it keeps track from there.'
      : `Read ${esc(gt(g.reportedGameTime))} at ${money(g.reported)}, kept current since by deliveries and the moves you mark done. Spending in the game is not seen: read it again after you spend.`}</p>
    <div class="sayrow"><input id="gb-bal" type="number" step="0.01" placeholder="Game bank balance, as the game shows it">
      <button class="btn" id="gb-save">Update</button></div>
  </div>
  <div class="panel"><div class="panel-head"><h2>Transfers to make</h2>
      <span class="sub">In the GDC Companion App. This app never moves money: it says what, which way and when.</span></div>
    ${pending.some((t) => t.needsGameClosed) ? `<p class="hint">Moves out of the game bank need the game closed: the Companion App
      cannot reach it while ATS runs. Mark each one when it is done.</p>` : ''}
    ${pending.length ? pending.map((t) => `<div class="loadcard">
        <div class="loadcard-head"><b>${money(t.amount)}</b>&nbsp;${esc(t.from)} → ${esc(t.to)}
          ${t.needsGameClosed ? '<span class="badge warn">game closed</span>' : ''}<span class="spacer"></span>
          <button class="btn tiny go" data-done="${esc(t.id)}">I've moved it</button></div>
        <p class="hint">${esc(t.reason)}</p></div>`).join('') : '<div class="empty">Nothing to move.</div>'}
  </div>
  <div class="panel"><div class="panel-head"><h2>Broker holding</h2><span class="sub">The Companion App account delivery pay waits in</span></div>
    <div class="figs">
      <div><div class="k">Should hold</div><div class="money">${money(h.balance)}</div></div>
      <div><div class="k">Waiting on brokers</div><div class="money">${money(h.waitingOnBrokers)}</div></div>
      <div><div class="k">Brokers' share</div><div class="money">${money(h.brokersShare)}</div></div>
      <div><div class="k">Yours to move out</div><div class="money ${h.yoursToMove > 0 ? 'pos' : ''}">${money(h.yoursToMove)}</div></div>
    </div>
    <p class="hint">The game's pay for every load goes in. When a broker pays, your rate comes out to your account; the rest of
      that load's pay is the broker's share and stays.</p></div>
  <div class="panel"><div class="panel-head"><h2>Owed to you</h2><span class="sub">${money(S.owedToYou)} outstanding</span></div>
    ${inv.length ? `<div class="tablewrap"><table class="grid"><thead><tr><th>Invoice</th><th>Load</th><th>Broker</th><th>Rate</th><th>Detention</th><th>Game paid</th><th>Due</th><th>Status</th><th></th></tr></thead>
      <tbody>${inv.map((i) => `<tr><td>${esc(i.number)}</td><td>${esc(i.bookingNumber)}</td><td>${esc(i.brokerName)} <span class="hint">${esc(i.credit)}</span></td>
        <td>${money(i.amount)}</td>
        <td>${i.detentionAmount ? `${money(i.detentionAmount)} <span class="hint">${esc(i.detentionStatus)}</span>` : ''}</td>
        <td>${money(i.gamePay)}</td><td>${esc(gt(i.dueGameTime))}</td>
        <td><span class="badge ${i.status === 'Paid' ? 'ok' : i.status === 'WrittenOff' ? 'bad' : 'warn'}">${esc(i.status)}</span></td>
        <td>${['Open', 'Overdue'].includes(i.status) ? `<button class="btn tiny" data-inv="factor" data-id="${esc(i.id)}">Factor</button>` : ''}
          ${i.status === 'Overdue' ? `<button class="btn tiny" data-inv="chase" data-id="${esc(i.id)}">Chase</button>` : ''}
          ${['Overdue', 'Collections'].includes(i.status) ? `<button class="btn tiny danger" data-inv="writeoff" data-id="${esc(i.id)}">Write off</button>` : ''}
          ${i.detentionStatus === 'Disputed' ? `<button class="btn tiny" data-inv="argue" data-id="${esc(i.id)}">Argue detention</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No invoices yet. Deliver a booked load and the broker owes you.</div>'}
  </div>
  ${done.length ? `<div class="panel"><div class="panel-head"><h2>Moved</h2></div>
    ${done.map((t) => `<div class="hint">${money(t.amount)} ${esc(t.from)} → ${esc(t.to)} (${esc(t.reference)})</div>`).join('')}</div>` : ''}`;
}

function wireMoney() {
  document.querySelectorAll('[data-inv]').forEach((b) => b.onclick = async () => {
    if (b.dataset.inv === 'writeoff' && !confirm('Write it off? The money is gone.')) return;
    try { const r = await api(`/invoices/${b.dataset.id}/${b.dataset.inv}`, 'POST'); S = r.snapshot; toast(r.said); render(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  $('gb-save').onclick = async () => {
    try { S = await api('/bank', 'POST', { balance: Number($('gb-bal').value) }); toast('Game bank updated.'); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  document.querySelectorAll('[data-done]').forEach((b) => b.onclick = async () => {
    try { S = await api(`/transfers/${b.dataset.done}/done`, 'POST'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
}

// ---------------------------------------------------------------- home

function ringBanner() {
  const c = S.call;
  if (!c || c.status !== 'Ringing') return '';
  return `<div class="callout warn ring"><h4>Phone: ${esc(c.rep)} at ${esc(c.broker)} is calling</h4>
    <p>About a load out of ${esc(c.lane?.pickupCity || '')}, ${esc(c.lane?.pickupState || '')}.</p>
    <div class="row-actions"><button class="btn primary" id="ring-answer">Answer</button>
      <button class="btn ghost" id="ring-ignore">Let it ring</button></div></div>`;
}

function homeBanner() {
  const h = S.home;
  if (!h) return ringBanner();
  const ring = ringBanner();
  if (ring) return ring;
  if (h.bottomUntil) return `<div class="callout bad"><h4>Home life has hit bottom</h4>
    <p>Go home. No broker will book you until ${esc(gt(h.bottomUntil))}, and the truck's costs keep running.</p></div>`;
  if (h.call) return `<div class="callout bad"><h4>Home called</h4><p>${esc(h.call.reason)} Be home by
    ${esc(gt(h.call.beHomeByGameTime))}.</p>
    ${S.booking ? `<p>You are booked on ${esc(S.booking.number)}. Deliver it on the way if you can, or hand it back: that is a
      cancellation on your record with ${esc(S.booking.brokerName)}.</p>
      <div class="row-actions"><button class="btn danger" id="hb-go">Hand ${esc(S.booking.number)} back</button></div>` : ''}</div>`;
  if (h.holiday) return `<div class="callout"><p><b>${esc(h.holiday)}.</b> Freight is quiet and brokers keep more of it. A good time to be home: days at home count double.</p></div>`;
  return '';
}

function wireHomeBanner() {
  const ans = $('ring-answer');
  if (ans) ans.onclick = async () => {
    const c = S.call;
    clocksPrompt(`${c.rep} at ${c.broker}`, 'Tell them your clocks: they plan the load off how much time you have.', async (clocks) => {
      try { const r = await api(`/calls/${c.id}/answer`, 'POST', { clocks }); S = r.snapshot; tab = 'brokers'; render(); }
      catch (e) { toast(e.message, 'bad'); }
    });
  };
  const ign = $('ring-ignore');
  if (ign) ign.onclick = async () => {
    try { const r = await api(`/calls/${S.call.id}/say`, 'POST', { kind: 'decline' }); S = r.snapshot; render(); } catch (e) { toast(e.message, 'bad'); }
  };
  const hb = $('hb-go');
  if (hb) hb.onclick = async () => {
    if (!confirm('Hand the load back? It goes on your record as a cancellation.')) return;
    try { S = await api('/booking/handback', 'POST', { why: 'needed at home' }); render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

function homeView() {
  const h = S.home;
  return `<div class="panel"><div class="panel-head"><h2>Home life</h2><span class="sub">${h.score} of 100: ${esc(h.band)}</span></div>
      <div class="lifebar"><div class="fill" style="width:${h.score}%"></div></div>
      <p>${h.atHome ? `You are home in ${esc(S.profile.homeCity)}.` : `Out ${h.daysOut} day(s). ${h.dueHomeInDays >= 0
        ? `Due home in ${h.dueHomeInDays} day(s).` : `<b>${-h.dueHomeInDays} day(s) past your promise.</b>`}`}</p>
      <p class="hint">It drops a little each day out, faster past your promise, and recovers at home. A full home time as promised
        counts for more. Below 40, home starts to call; at 0 you go home for a week whatever is booked.</p></div>
    <div class="panel"><div class="panel-head"><h2>Dates at home</h2></div>
      ${h.dates.length ? h.dates.map((d) => `<div><b>Day ${d.day}</b>: ${esc(d.title)}</div>`).join('') : '<div class="empty">Nothing on the calendar.</div>'}
      ${h.recent.length ? `<p class="hint">${h.recent.map((d) => `Day ${d.day}, ${esc(d.title)}: ${d.status === 'Made' ? 'made it' : 'missed'}`).join(' · ')}</p>` : ''}</div>
    <div class="panel"><div class="panel-head"><h2>Your promise</h2></div>
      <div class="grid2">
        <label>Home every (days)<input id="hp-every" type="number" min="5" max="42" value="${h.everyDays}"></label>
        <label>For (days)<input id="hp-for" type="number" min="1" max="10" value="${h.homeDays}"></label>
      </div>
      <p class="hint">Change it if you need to, but not every week: each change costs a little.</p>
      <div class="row-actions"><button class="btn primary" id="hp-save">Save</button></div></div>`;
}

function wireHome() {
  $('hp-save').onclick = async () => {
    try {
      S = await api('/home/promise', 'POST', { everyDays: Number($('hp-every').value), homeDays: Number($('hp-for').value) });
      toast('Promise saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------------------------------------------------------- truck & clocks

function truckView() {
  const st = S.status, h = S.hos;
  return `<div class="panel"><div class="panel-head"><h2>Where and when</h2></div>
      <div class="grid3">
        <label>City<input id="tr-city" value="${esc(st.city)}"></label>
        <label>State<input id="tr-state" class="up" maxlength="2" value="${esc(st.state)}"></label>
        ${dayTimeInput('tr-time', st.gameTime, 'Game day and time')}
        <label>Odometer<input id="tr-odo" type="number" value="${st.odometer}"></label>
        <label>Fuel %<input id="tr-fuel" type="number" min="0" max="100" value="${st.fuelPct}"></label>
      </div>
      <div class="row-actions"><button class="btn primary" id="tr-save">Save</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Hours of service</h2>
        ${h.confirmed === false ? badge('warn', 'not confirmed') : ''}<div class="spacer"></div>
        <span class="sub">Your HOS display is authoritative. Type what it says.</span></div>
      ${h.carriedForwardFrom && h.confirmed !== false ? `<div class="callout go"><p style="margin:0">Clocks came off your HOS display when you
          closed <b>${esc(h.carriedForwardFrom)}</b> out at ${esc(gt(h.asOf))}. Still good if you have not driven since.</p></div>`
        : h.projected ? `<div class="callout warn"><p style="margin:0"><b>These clocks were worked out, not read.</b> They were carried across
          the unload at ${esc(gt(h.asOf))}: on-duty time off your shift and cycle, the drive clock untouched. Check them against your
          display; anything you type replaces them.</p></div>`
        : h.confirmed === false ? `<div class="callout warn"><p style="margin:0">These clocks were last read at ${esc(gt(h.asOf))} and a load
          has run since. Re-read your HOS display before a broker plans anything off them.</p></div>`
        : h.asOf ? `<p class="hint">Read ${esc(gt(h.asOf))}${h.source ? ` (${esc(h.source.toLowerCase())})` : ''}.</p>` : ''}
      ${clockFields('hs', h)}
      <p class="hint">Break clock = hours of <em>driving</em> left before the ${hhmm(S.rules.breakLength)} break is required. It is not
        available driving time.</p>
      <label>Hours coming back (recap)
        <input id="hs-recap" placeholder="8:00 in 1, 10:30 in 2"
          value="${esc((h.recap || []).map((r) => `${hhmm(r.hours)} in ${r.inDays}`).join(', '))}"></label>
      <div class="dropzone" id="hs-drop" tabindex="0">Or paste or drop a GDC recap screenshot here${S.settings.hasApiKey ? '' : ' (needs an API key in Settings)'}</div>
      <div class="row-actions"><button class="btn primary" id="hs-save">Report clocks</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Truck</h2></div>
      ${S.truck ? `<p>${esc(S.truck.year)} ${esc(S.truck.make)} ${esc(S.truck.model)}, ${S.truck.avgMpg} mpg.</p>` : ''}</div>
    <div class="panel"><div class="panel-head"><h2>Trailer</h2>
      <span class="sub">${S.trailer?.powerOnly ? 'Power-only: the shipper\'s trailer, off the Freight Market' : `Your own ${esc(S.trailer?.type || '')}: the Cargo Market`}</span></div>
      <p class="hint">Bought a trailer in the game? Put it here. It goes behind the truck: the Cargo Market opens, dock times follow it,
        and specialist brokers for its trade will talk to you.</p>
      <div class="grid4">
        <label>Kind<select id="tl-type">${(S.ownableTrailers || []).map((t) => `<option ${S.ownedTrailer?.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Plate / ID in the game<input id="tl-id" value="${esc(S.ownedTrailer?.ref || '')}"></label>
        <label>Year<input id="tl-year" type="number" value="${S.ownedTrailer?.year || ''}"></label>
      </div>
      <div class="row-actions"><button class="btn primary" id="tl-save">I own this trailer</button>
        ${S.trailer && !S.trailer.powerOnly ? '<button class="btn ghost" id="tl-po">Run power-only</button>' : ''}
        ${S.trailer?.powerOnly && S.ownedTrailer ? '<button class="btn ghost" id="tl-hook">Hook my trailer</button>' : ''}</div></div>`;
}

/** Clocks off a GDC Companion recap screenshot, pasted or dropped on the zone. */
async function readRecapShot(files, zone) {
  const images = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const b64 = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.readAsDataURL(f); });
    images.push({ mediaType: f.type, dataBase64: b64 });
  }
  if (!images.length) return;
  zone.textContent = 'Reading…';
  try {
    const r = await api('/hos/extract', 'POST', { images });
    if (!r.ok) throw new Error(r.error);
    S = r.snapshot; toast('Clocks read and saved.'); render();
  } catch (e) { toast(e.message, 'bad'); zone.textContent = 'Paste or drop a GDC recap screenshot here'; }
}
function wireRecapDrop(zone) {
  if (!zone) return;
  zone.ondragover = (e) => e.preventDefault();
  zone.ondrop = (e) => { e.preventDefault(); readRecapShot([...e.dataTransfer.files], zone); };
  zone.onpaste = (e) => { e.stopPropagation(); const f = [...(e.clipboardData?.files || [])]; if (f.length) readRecapShot(f, zone); };
}

function wireTruck() {
  $('tl-save').onclick = async () => {
    try { S = await api('/trailer', 'POST', { type: $('tl-type').value, gameId: $('tl-id').value, year: Number($('tl-year').value) || null }); toast('Trailer saved.'); render(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const po = $('tl-po');
  if (po) po.onclick = async () => { try { S = await api('/trailer/power-only', 'POST'); render(); } catch (e) { toast(e.message, 'bad'); } };
  const hk = $('tl-hook');
  if (hk) hk.onclick = async () => { try { S = await api('/trailer', 'POST', { type: S.ownedTrailer.type, gameId: S.ownedTrailer.ref, year: S.ownedTrailer.year }); render(); } catch (e) { toast(e.message, 'bad'); } };
  $('tr-save').onclick = async () => {
    try {
      const at = readWhen('tr-time');
      S = await api('/status', 'POST', {
        locationCity: $('tr-city').value, locationState: $('tr-state').value, day: at.day, time: at.time,
        odometer: Number($('tr-odo').value), fuelPct: Number($('tr-fuel').value),
      });
      toast('Saved.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('hs-save').onclick = async () => {
    try {
      S = await api('/hos', 'POST', { ...readClockFields('hs', true), recap: parseRecap($('hs-recap').value) });
      toast('Clocks recorded.'); render();
    } catch (e) { toast(e.message, 'bad'); }
  };
  wireRecapDrop($('hs-drop'));
}

// ---------------------------------------------------------------- settings

function settingsView() {
  const k = S.profile.skills, lim = S.settings.longDistanceLimits;
  return `<div class="panel"><div class="panel-head"><h2>Costs</h2></div>
      <label>All-in cost per ${esc(S.settings.distanceUnit)}<input id="se-cpm" type="number" step="0.01" value="${S.settings.costPerMile}">
        <span class="hint">Fuel, tolls, the truck note, insurance, maintenance and living on the road. Typed in until
          the GDC Companion App link supplies it.</span></label>
      <div class="row-actions"><button class="btn primary" id="se-cpm-save">Save</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Skills</h2></div>
      <div class="skillgrid">
        <label>Long Distance<input id="sk-ld" type="number" min="0" max="6" value="${k.longDistance}"></label>
        <label>High Value<input id="sk-hv" type="number" min="0" max="6" value="${k.highValue}"></label>
        <label>Fragile<input id="sk-fr" type="number" min="0" max="6" value="${k.fragile}"></label>
        <label>Just-In-Time<input id="sk-jit" type="number" min="0" max="6" value="${k.justInTime}"></label>
      </div>
      <div class="chkrow" id="sk-adr">${ADR.map((a) => `<label><input type="checkbox" value="${esc(a)}" ${k.adr.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div>
      <div class="row-actions"><button class="btn primary" id="sk-save">Save skills</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Long Distance limits</h2><span class="sub">Longest job at each level, in ${esc(S.settings.distanceUnit)}. Blank is anywhere.</span></div>
      <p class="hint">The vanilla game's figures. Economy mods (GDC's among them) change these: set them to match yours.</p>
      <div class="skillgrid">${lim.map((v, i) => `<label>Level ${i}<input data-ld="${i}" type="number" min="1" value="${v ?? ''}"></label>`).join('')}</div>
      <div class="row-actions"><button class="btn primary" id="ld-save">Save limits</button>
        <button class="btn ghost" id="ld-reset">Back to the game's defaults</button></div></div>
    <div class="panel"><div class="panel-head"><h2>Phone alerts</h2></div>
      <p class="hint">A call waits until you answer it or let it ring, so none is ever missed. It shows in the top bar on every tab
        and in the browser tab's title. Turn on desktop alerts to see it with the app on another screen.</p>
      <div class="row-actions"><button class="btn" id="se-notify">${'Notification' in window && Notification.permission === 'granted'
        ? 'Desktop alerts are on' : 'Turn on desktop alerts'}</button></div></div>
    <div class="panel"><div class="panel-head"><h2>AI</h2></div>
      <label>Anthropic API key<input id="se-key" type="password" placeholder="${S.settings.hasApiKey ? 'A key is saved. Paste a new one to replace it.' : 'sk-ant-...'}">
        <span class="hint">Reads screenshots, and will voice the brokers on the phone. Stored in your career file on this PC only.</span></label>
      <div class="row-actions"><button class="btn primary" id="se-key-save">Save key</button></div></div>`;
}

function wireSettings() {
  const save = async (body, msg) => {
    try { S = await api('/settings', 'POST', body); toast(msg); render(); } catch (e) { toast(e.message, 'bad'); }
  };
  $('se-cpm-save').onclick = () => save({ costPerMile: Number($('se-cpm').value) }, 'Cost saved.');
  $('sk-save').onclick = () => save({ skills: {
    longDistance: Number($('sk-ld').value), highValue: Number($('sk-hv').value),
    fragile: Number($('sk-fr').value), justInTime: Number($('sk-jit').value),
    adr: [...document.querySelectorAll('#sk-adr input:checked')].map((i) => i.value),
  } }, 'Skills saved.');
  $('ld-save').onclick = () => save({ longDistanceLimits: [...document.querySelectorAll('[data-ld]')]
    .map((i) => (i.value === '' ? null : Number(i.value))) }, 'Limits saved.');
  $('ld-reset').onclick = () => save({ resetLongDistance: true }, 'Back to the game defaults.');
  $('se-key-save').onclick = () => save({ anthropicApiKey: $('se-key').value }, 'Key saved.');
  $('se-notify').onclick = async () => {
    if (!('Notification' in window)) return toast('This browser cannot show desktop alerts.', 'bad');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Desktop alerts on.' : 'The browser said no. Allow notifications for this page in its site settings.', p === 'granted' ? 'ok' : 'bad');
    render();
  };
}

// ---------------------------------------------------------------- log

function logView() {
  const ev = S.events || [];
  return `<div class="panel"><div class="panel-head"><h2>Log</h2></div>
    ${ev.length ? `<div class="log">${ev.map((e) => `<div><span class="badge mute">${esc(e.channel)}</span> ${esc(e.message)}</div>`).join('')}</div>`
                : '<div class="empty">Nothing yet.</div>'}</div>`;
}

// ---------------------------------------------------------------- boot

(async () => {
  try {
    S = await api('/bootstrap');
    if (S.started) showApp(); else showStart();
  } catch (e) {
    $('boot').textContent = `Could not reach the app: ${e.message}`;
  }
})();
