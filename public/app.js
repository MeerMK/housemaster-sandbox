/* global morphdom */
// HouseMaster sandbox UI — renders the server's live state and turns every click into a server command.

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
// Seat positions around the oval (% of the felt area), seat 0 = bottom centre, clockwise.
const SEAT_POS = [[50, 92], [13, 77], [6, 50], [13, 23], [50, 8], [87, 23], [94, 50], [87, 77]];
const STYLE_ORDER = ['fold', 'nit', 'smc', 'aggro', 'station'];
const SKILL_ORDER = ['pro', 'medium', 'fish'];
const RIT_OPTS = {
  optional: ['Optional', 'Ask me each time — use the Run It buttons (defaults to once after 6s)'],
  once: ['Always Once', "Automatically select 'Run it Once' (with 1-2s delay)"],
  twice: ['Always Twice', "Automatically select 'Run it Twice' (with 1-2s delay)"],
};

const ICON = {
  bot: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v2M15 13v2M2 14h2M20 14h2"/></svg>',
  pin: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  pinSm: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  wifi: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 3 14 9-14 9V3Z"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>',
  leave: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 11h5"/></svg>',
  grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  table: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="6"/><ellipse cx="12" cy="12" rx="5" ry="2.5"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ---------------- state ---------------- */

let S = null;             // latest server snapshot
let offset = 0;           // server clock − client clock
let online = false;
const PERSIST = ['view', 'filter', 'tv', 'reveal', 'reqTab', 'detSeated'];
const ui = { view: 'dashboard', filter: 'all', tv: null, reveal: false, reqTab: 'requests', detSeated: true,
  cfgOpen: new Set(), modal: null, detOpen: null, sliders: {} };
try {
  const saved = JSON.parse(localStorage.getItem('hm-ui') || '{}');
  for (const k of PERSIST) if (k in saved) ui[k] = saved[k];
} catch { /* storage unavailable — defaults are fine */ }
function persist() {
  try { localStorage.setItem('hm-ui', JSON.stringify(Object.fromEntries(PERSIST.map(k => [k, ui[k]])))); } catch { /* ignore */ }
}

/* ---------------- server connection ---------------- */

let ws, seq = 0;
const pending = new Map();
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => { online = true; render(); };
  ws.onclose = () => {
    online = false;
    for (const p of pending.values()) p.rej(new Error('Disconnected from server'));
    pending.clear();
    render();
    setTimeout(connect, 1000);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { S = m.data; offset = S.now - Date.now(); render(); }
    else if (m.type === 'reply') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) m.ok ? p.res(m.result) : p.rej(new Error(m.error));
    }
  };
}
function send(cmd, args = {}) {
  return new Promise((res, rej) => {
    if (!ws || ws.readyState !== 1) return rej(new Error('Not connected to the server'));
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, cmd, args }));
  });
}
// Send a command; toast on success (optional) and on failure.
async function run(cmd, args, okMsg) {
  try { await send(cmd, args); if (okMsg) toast(okMsg); return true; }
  catch (e) { toast(e.message, true); return false; }
}

/* ---------------- helpers ---------------- */

const now = () => Date.now() + offset;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = c => (c / 100).toFixed(2).replace(/\.?0+$/, '');
const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const acct = id => S.accounts.find(a => a.id === id);
// Ground truth also covers deleted bots and departed simulated players.
const kindOf = id => S.truth?.[id] || acct(id)?.kind || 'unknown';
const tableOf = id => S.tables.find(t => t.id === id);
const blinds = t => `${fmt(t.sb)}/${fmt(t.bb)}`;
const ago = ts => { const s = Math.max(0, Math.round((now() - ts) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
function locate(accountId) {
  for (const t of S.tables) { const s = t.seats.find(x => x && x.accountId === accountId); if (s) return { t, s }; }
  return null;
}
function card(str, cls = '') {
  const r = str[0] === 'T' ? '10' : str[0], su = str[1];
  return `<span class="pc ${cls} ${su === 'h' || su === 'd' ? 'red' : ''}"><span>${r}</span><span>${SUIT[su]}</span></span>`;
}
const back = cls => `<span class="pc back ${cls}"></span>`;
const actionLabel = d => ({ fold: 'Fold', check: 'Check', call: 'Call', raise: `Raise to ${fmt(d.amount || 0)}`, bet: `Bet ${fmt(d.amount || 0)}` }[d.action] || d.action);
const toggleHtml = (on, attrs, cls = '') => `<button class="toggle ${cls} ${on ? 'on' : ''}" ${attrs} aria-pressed="${on}"></button>`;

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${isError ? 'error' : ''}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast'; }, isError ? 3800 : 2600);
}

/* ---------------- header ---------------- */

function renderHeader() {
  const nav = [
    ['dashboard', ICON.grid, 'Dashboard', ''],
    ['tables', ICON.table, 'Table View', ''],
    ['requests', ICON.check, 'Buy-in Requests', S.requests.length ? `<span class="count">${S.requests.length}</span>` : ''],
    ['detection', ICON.shield, 'Bot Detection', ''],
  ];
  return `<header>
    <div class="brand">HouseMaster</div>
    <nav class="nav">${nav.map(([v, ic, label, extra]) =>
      `<button data-act="nav" data-v="${v}" class="${ui.view === v ? 'on' : ''}">${ic}${label}${extra}</button>`).join('')}</nav>
    <span class="conn-pill ${online ? '' : 'off'}">${online ? '● Live' : '● Reconnecting…'}</span>
    <span class="sandbox-pill" title="Everything runs on your own machine. No real poker site is involved.">Sandbox · no real money</span>
  </header>`;
}

/* ---------------- dashboard ---------------- */

function renderDashboard() {
  const bots = S.accounts.filter(a => a.kind === 'bot');
  const connected = bots.filter(a => a.enabled && a.connected);
  const seated = bots.filter(a => a.tableId);
  const rooms = new Set(seated.map(a => a.tableId));
  const stat = (key, n, label, cls, icon) =>
    `<button class="stat ${ui.filter === key ? 'on' : ''}" data-act="filter" data-v="${key}" title="${key === 'rooms' ? 'Open Table View' : 'Filter the bots below'}">
      <div class="ic ${cls}">${icon}</div><div><b>${n}</b><span>${label}</span></div></button>`;

  const shown = ui.filter === 'connected' ? connected : ui.filter === 'seated' ? seated : bots;
  const filterName = { all: 'all bots', connected: 'connected bots', seated: 'seated bots' }[ui.filter] || 'all bots';

  let groups = '';
  for (const t of S.tables) {
    const list = shown.filter(a => a.tableId === t.id);
    if (!list.length) continue;
    groups += `<section class="group" id="grp-${t.id}">
      <div class="group-head"><div class="ic">${ICON.pin}</div>
        <div><h2>Room ${blinds(t)} <span class="mono muted" style="font-size:14px">#${t.id}</span></h2>
          <p><span class="club">${esc(S.club)}</span> · ${list.length} bot${list.length > 1 ? 's' : ''} playing · ${t.seats.filter(Boolean).length}/8 seated</p></div>
        <button class="btn sm b right" data-act="opentable" data-id="${t.id}">${ICON.table} Open table</button>
      </div>
      <div class="grid">${list.map(botCard).join('')}</div></section>`;
  }
  const waiting = shown.filter(a => !a.tableId && a.pendingReq);
  if (waiting.length) groups += `<section class="group" id="grp-waiting">
      <div class="group-head"><div class="ic amber">${ICON.clock}</div>
        <div><h2>Waiting for the host</h2><p>${waiting.length} buy-in request${waiting.length > 1 ? 's' : ''} pending or queued</p></div>
        <button class="btn sm a right" data-act="nav" data-v="requests">Review requests</button></div>
      <div class="grid">${waiting.map(botCard).join('')}</div></section>`;
  const idle = shown.filter(a => !a.tableId && !a.pendingReq);
  if (idle.length) groups += `<section class="group" id="grp-idle">
      <div class="group-head"><div class="ic gray">${ICON.bot}</div>
        <div><h2>Not In Room</h2><p>${idle.length} bot${idle.length > 1 ? 's' : ''} not currently in a room</p></div></div>
      <div class="grid">${idle.map(botCard).join('')}</div></section>`;
  if (!groups) groups = `<section class="group"><p class="muted">No ${filterName} right now.</p>
      ${bots.length ? `<button class="btn sm b" data-act="filter" data-v="all">Show all bots</button>` : `<button class="btn g" data-act="modal" data-m="newBot">${ICON.plus} Create your first bot</button>`}</section>`;

  return `<main>
    <div class="page-head"><div><h1>Dashboard</h1><p class="sub">Overview of your bots grouped by room</p></div>
      <button class="btn g" data-act="modal" data-m="newBot">${ICON.plus} New bot</button></div>
    <section class="stats">
      ${stat('all', bots.length, 'Total Bots', '', ICON.bot)}
      ${stat('connected', connected.length, 'Connected', '', ICON.wifi.replace('width="16" height="16"', 'width="22" height="22"'))}
      ${stat('rooms', rooms.size, 'Active Rooms', 'blue', ICON.pin)}
      ${stat('seated', seated.length, 'Seated', 'amber', ICON.bot)}
    </section>
    <div class="filterbar">Showing ${filterName}${ui.filter !== 'all' ? ` <button class="chip" data-act="filter" data-v="all">✕ Clear filter</button>` : ''}</div>
    ${groups}
  </main>`;
}

function botCard(a) {
  const loc = locate(a.id);
  const t = loc?.t, s = loc?.s, h = t?.hand;
  const active = a.enabled && a.connected;
  const myTurn = !!(h && s && h.phase === 'betting' && h.toAct === s.seat);
  const busted = !!(s && s.sittingOut && s.busted);
  const reqT = a.requestTable && tableOf(a.requestTable);
  const d = a.lastDecision;

  let handPanel = '';
  if (s && s.inHand && s.hole) {
    const street = h.phase === 'done' ? 'Showdown' : h.phase === 'rit' ? 'All-in' : STREET[h.street];
    const secs = Math.max(0, Math.ceil((h.deadline - now()) / 1000));
    // An off or reconnecting bot doesn't decide; it just runs down the clock.
    const turnMsg = active ? `<b>Thinking…</b> ${secs}s on the clock` : a.enabled ? `<b>Reconnecting…</b> ${secs}s on the clock` : `<b>Bot is off</b> — will time out in ${secs}s`;
    handPanel = `<div class="hand ${s.folded ? 'folded' : ''}">
      <div class="hand-top"><span>Current Hand${s.folded ? ' (Folded)' : s.allIn ? ' (All-in)' : ''}</span><span>#${h.no} · ${street} · Pot ${fmt(h.pot)}</span></div>
      <div class="cards">${s.hole.map(c => card(c)).join('')}
        ${h.board.length ? `<span class="board-mini">${h.board.map(c => card(c, 'sm')).join('')}</span>` : ''}</div>
      ${myTurn ? `<div class="why">${turnMsg}</div>` : ''}
      ${d && !myTurn && d.handNo === h.no && d.tableId === t.id ? `<div class="why">Last decision: <b>${esc(actionLabel(d))}</b> — ${esc(d.why)}</div>` : ''}
    </div>`;
  } else if (s) {
    handPanel = `<div class="hand"><div class="hand-top"><span>${busted ? 'Busted — top up to play' : s.sittingOut ? 'Sitting out — not dealt in' : 'Waiting for the next hand'}</span><span>Stack ${fmt(s.stack)}</span></div></div>`;
  }

  let where;
  if (s) {
    const b = s.leaving ? ['red', 'Leaving after this hand'] : busted ? ['red', 'Busted — top up to play'] : s.sittingOut ? ['amber', 'Sitting Out'] : ['', 'Seated'];
    where = `<div class="row">${ICON.pinSm}<span>In Room</span><span class="badge ${b[0]}">${b[1]}</span>
      <span class="mono muted">#${t.id} · Stack ${fmt(s.stack)}${s.topUp ? ` (+${fmt(s.topUp)} next hand)` : ''}</span></div>`;
  } else if (a.queued) {
    where = `<div class="row">${ICON.pinSm}<span>Queued</span><span class="badge amber">Table full — waiting for a seat</span><span class="mono muted">#${reqT?.id}</span></div>`;
  } else if (a.pendingReq) {
    where = `<div class="row">${ICON.pinSm}<span>Requested</span><span class="badge amber">Awaiting host approval</span><span class="mono muted">#${reqT?.id}</span>
      <button class="btn sm a" data-act="nav" data-v="requests">Review</button></div>`;
  } else {
    where = `<div class="row">${ICON.pinSm}<span class="muted">Not in a room</span></div>`;
  }

  const ritOpen = !!(a.ritPending && t?.hand?.phase === 'rit' && !t.hand.rit.answers[a.id]);
  const ritAnswer = t?.hand?.rit?.answers?.[a.id];
  const cfg = a.config;
  const open = ui.cfgOpen.has(a.id);

  const flash = ui.flash?.id === a.id && Date.now() < ui.flash.until;
  return `<article class="card ${a.enabled ? '' : 'off'} ${myTurn ? 'turn' : ''} ${flash ? 'flash' : ''}" id="bot-${a.id}">
    <div class="top">
      <div class="avatar">${ICON.bot}</div>
      <div class="name"><b>${esc(a.name)}</b><span class="mono">#${a.pid}</span> <span>· ${S.skills[cfg.skill].label} · ${S.styles[cfg.style].label}</span></div>
      ${toggleHtml(a.enabled, `data-act="enable" data-id="${a.id}" title="${a.enabled ? 'Turn bot off (it stops acting and times out)' : 'Turn bot on'}"`)}
    </div>
    ${handPanel}
    <div class="row">
      <span class="conn ${!a.connected ? 'warn' : a.enabled ? '' : 'no'}">${ICON.wifi} ${!a.connected ? 'Reconnecting…' : a.enabled ? 'Connected' : 'Off'}</span>
      <span class="club">${esc(S.club)}</span><span class="mono muted">(sandbox)</span>
      ${a.tilt ? '<span class="badge red" title="Lost a big pot recently — plays looser and more aggressive for a few hands">On tilt</span>' : ''}
    </div>
    ${where}
    <div class="row muted" style="font-size:13px">Club chips: <b style="color:var(--text)">${fmt(a.clubChips)}</b></div>
    <hr />
    <div class="row">
      <span class="dot ${active ? '' : 'no'}"></span><span style="min-width:44px">${active ? 'Active' : 'Idle'}</span>
      <button class="btn g" data-act="join" data-id="${a.id}" ${a.tableId || a.pendingReq ? 'disabled' : ''}>${ICON.play} Join Room</button>
      <button class="btn t" data-act="modal" data-m="manage" data-id="${a.id}">${ICON.refresh} Manage Chips</button>
    </div>
    <div class="row">
      <button class="btn sm r" data-act="leave" data-id="${a.id}" ${(a.tableId || a.pendingReq) && !s?.leaving ? '' : 'disabled'}>${ICON.leave} ${!a.tableId && a.pendingReq ? 'Cancel request' : 'Leave'}</button>
      <button class="btn sm b" data-act="sitout" data-v="0" data-id="${a.id}" ${s && s.sittingOut && !busted ? '' : 'disabled'} ${busted ? 'title="Stack is empty — top up first"' : ''}>${ICON.user} Sit</button>
      <button class="btn sm a" data-act="sitout" data-v="1" data-id="${a.id}" ${s && !s.sittingOut && !s.leaving ? '' : 'disabled'}>${ICON.pause} Sit Out</button>
      <button class="btn sm t" data-act="reload" data-id="${a.id}" ${a.connected ? '' : 'disabled'} title="Disconnect and reconnect this bot">${ICON.refresh} Reload</button>
    </div>
    <div class="row"><span>Run It:</span>
      <button class="btn sm ${ritOpen ? 'b pulse' : 'ghost'}" data-act="rit" data-v="once" data-id="${a.id}" ${ritOpen ? '' : 'disabled'}>Once</button>
      <button class="btn sm ${ritOpen ? 'g pulse' : 'ghost'}" data-act="rit" data-v="twice" data-id="${a.id}" ${ritOpen ? '' : 'disabled'}>Twice</button>
      ${ritOpen ? `<span class="badge amber">All-in — choose now</span>` : ritAnswer ? `<span class="badge blue">Chose ${ritAnswer}</span>` : ''}
    </div>
    <form class="chat" data-form="chat" data-id="${a.id}">
      <input id="chat-${a.id}" data-keep name="text" maxlength="140" autocomplete="off" placeholder="Send chat message..." />
      <button class="send" type="submit" aria-label="Send">${ICON.send}</button>
    </form>
    <button class="cfg-toggle" data-act="cfgopen" data-id="${a.id}">${ICON.gear} Configure ${open ? '▴' : '▾'}</button>
    ${open ? configPanel(a) : ''}
  </article>`;
}

function configPanel(a) {
  const c = a.config;
  const slider = (key, min, max, step, value, label) => {
    const id = `${key}-${a.id}`;   // stable, so a focused slider survives re-renders
    const shown = ui.sliders[id] ?? value;
    return `<div class="slider"><span>${label}</span><b id="${id}-v">${key === 'bluff' ? `${shown}%` : `${Number(shown).toFixed(1)}s`}</b>
      <input type="range" id="${id}" data-keep data-cfg="${key}" data-id="${a.id}" min="${min}" max="${max}" step="${step}" value="${value}" /></div>`;
  };
  return `<div class="cfg">
    <h4>Configuration</h4>
    <h5>Skill level</h5>
    <div class="seg">${SKILL_ORDER.map(k => `<button data-act="cfg" data-k="skill" data-v="${k}" data-id="${a.id}" class="${c.skill === k ? `sel skill-${k}` : ''}">${S.skills[k].label}</button>`).join('')}</div>
    <p>${esc(S.skills[c.skill].desc)}</p>
    <h5>Play style</h5>
    <div class="seg">${STYLE_ORDER.map(k => `<button data-act="cfg" data-k="style" data-v="${k}" data-id="${a.id}" class="${c.style === k ? `sel style-${k}` : ''}">${S.styles[k].label}</button>`).join('')}</div>
    <p>${esc(S.styles[c.style].desc)}</p>
    <h5>Run it twice</h5>
    <div class="seg">${Object.entries(RIT_OPTS).map(([k, [label]]) => `<button data-act="cfg" data-k="rit" data-v="${k}" data-id="${a.id}" class="${c.rit === k ? 'sel' : ''}">${label}</button>`).join('')}</div>
    <p>${RIT_OPTS[c.rit][1]}</p>
    <h5>Bluffing</h5>
    ${slider('bluff', 0, 100, 5, c.bluff, 'Bluff frequency (50% = style default)')}
    <h5>Think time</h5>
    ${slider('thinkMin', 0.3, 10, 0.1, c.thinkMin, 'Fastest decision')}
    ${slider('thinkMax', c.thinkMin, 14, 0.1, c.thinkMax, 'Slowest decision')}
    <div class="cfg-foot">
      <span class="switch">${toggleHtml(c.autoTopUp, `data-act="cfg" data-k="autoTopUp" data-v="${!c.autoTopUp}" data-id="${a.id}"`, 'sm')} Auto top-up below 60% of max buy-in</span>
      <button class="btn sm r" data-act="modal" data-m="deleteBot" data-id="${a.id}">Delete bot</button>
    </div>
  </div>`;
}

/* ---------------- table view ---------------- */

function lerp(p, q, k) { return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]; }

function renderTables() {
  if (!S.tables.length) return `<main><h1>Table View</h1><p class="sub">No tables yet.</p><button class="btn g" data-act="modal" data-m="newTable">${ICON.plus} New table</button></main>`;
  const t = tableOf(ui.tv) || S.tables[0];
  const h = t.hand;
  const you = acct('you');
  const youLoc = locate('you');
  const seatedHere = youLoc?.t.id === t.id;

  const tabs = S.tables.map(x => {
    const nBots = x.seats.filter(s => s?.kind === 'bot').length;
    return `<button data-act="tv" data-id="${x.id}" class="${x === t ? 'on' : ''}">#${x.id} · ${blinds(x)} · ${x.seats.filter(Boolean).length}/8${ui.reveal && nBots ? ` · <span style="color:#fca5a5">${nBots} bot${nBots > 1 ? 's' : ''}</span>` : ''}${youLoc?.t.id === x.id ? ' · you' : ''}</button>`;
  }).join('');

  // Seats, bets and dealer button
  let seatsHtml = '';
  for (let i = 0; i < 8; i++) {
    const [x, y] = SEAT_POS[i];
    const s = t.seats[i];
    if (!s) {
      seatsHtml += `<button class="seat empty" style="left:${x}%;top:${y}%" data-act="sithere" data-seat="${i}" data-table="${t.id}" title="Sit here">
        <div class="ava">+</div><div class="plate"><b>Sit here</b><span>&nbsp;</span></div></button>`;
      continue;
    }
    const me = s.accountId === 'you';
    const acting = h?.phase === 'betting' && h.toAct === i;
    const win = h?.phase === 'done' && h.winners?.some(w => w.seat === i);
    const cls = ['seat', s.kind === 'bot' ? 'bot' : '', ui.reveal ? 'show' : '', s.inHand && s.folded ? 'folded' : '',
      s.sittingOut ? 'out' : '', me ? 'me' : '', acting ? 'acting' : '', win ? 'win' : ''].join(' ');
    let timer = '';
    if (acting) {
      const frac = clamp((h.deadline - now()) / t.actionTime, 0, 1);
      const col = frac > 0.33 ? '#facc15' : '#ef4444';
      timer = `<div class="timer" style="background:conic-gradient(${col} ${Math.round(frac * 360)}deg, transparent 0);-webkit-mask:radial-gradient(circle, transparent 60%, #000 62%);mask:radial-gradient(circle, transparent 60%, #000 62%)"></div>`;
    }
    const tag = s.sittingOut ? 'Sitting out' : s.leaving ? 'Leaving' : win ? 'Winner' : s.inHand && s.allIn && !s.folded ? 'All-in'
      : s.inHand && s.lastAction && h?.phase !== 'done' ? s.lastAction[0].toUpperCase() + s.lastAction.slice(1) : '';
    let hole = '';
    if (s.inHand && !s.folded) {
      hole = (me || s.shown) && s.hole ? s.hole.map(c => card(c)).join('') : back('').repeat(4);
      hole = `<div class="hole">${hole}</div>`;
    }
    seatsHtml += `<div class="${cls}" style="left:${x}%;top:${y}%" data-act="player" data-id="${esc(s.accountId)}" title="View player">
      ${tag ? `<span class="act">${tag}</span>` : ''}
      <div class="ava">${timer}${esc(s.name.slice(0, 2).toUpperCase())}</div>
      <div class="plate"><b>${esc(s.name)}${me ? ' (you)' : ''}</b><span>${fmt(s.stack)}</span></div>${hole}</div>`;
    if (s.inHand && s.committed > 0 && h.phase === 'betting') {
      const [bx, by] = lerp([x, y], [50, 50], 0.42);
      seatsHtml += `<span class="bet" style="left:${bx}%;top:${by}%">${fmt(s.committed)}</span>`;
    }
    if (t.button === i && h) {
      const [dx, dy] = lerp([x, y], [50, 50], 0.27);
      seatsHtml += `<span class="dealer" style="left:${dx + 5}%;top:${dy}%">D</span>`;
    }
  }

  let msg = '';
  const seatedCount = t.seats.filter(s => s && !s.sittingOut).length;
  if (!h) msg = seatedCount < 2 ? 'Waiting for players…' : 'Next hand starting…';
  else if (h.phase === 'rit') msg = `All-in! Run it twice? (${Math.max(0, Math.ceil((h.rit.deadline - now()) / 1000))}s)`;
  else if (h.phase === 'runout') msg = h.rit?.result === 'twice' ? 'Running it twice…' : 'Running it out…';
  else if (h.phase === 'done') msg = (h.winners || []).slice(0, 3).map(w => `${esc(w.name)} wins ${fmt(w.amount)}${w.hand ? ` · ${w.hand}` : ''}${w.board ? ` (run ${w.board})` : ''}`).join('<br>');
  else if (h.phase === 'betting') msg = `${STREET[h.street]} · ${esc(t.seats[h.toAct]?.name || '')} to act`;

  const boards = h?.boards
    ? h.boards.map((b, i) => `<div class="board"><span class="tag">Run ${i + 1}</span>${b.map(c => card(c, 'sm')).join('')}</div>`).join('')
    : `<div class="board">${(h?.board || []).map(c => card(c, 'sm')).join('')}</div>`;

  const info = [
    ['Game Type', 'PLO4'], ['BB/SB', `${fmt(t.bb)}/${fmt(t.sb)}`],
    ['Buy-in Range', `${fmt(t.minBuyIn)} – ${fmt(t.maxBuyIn)}`], ['Game Code', t.id],
    ['Game Length', 'No limit'], ['Action Time', `${t.actionTime / 1000} secs`],
    ['Hands played', t.handNo], ['Rake', `${(t.rakePct * 100).toFixed(1)}%, Cap = ${fmt(t.rakeCap)}`],
  ].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');

  const nBots = t.seats.filter(s => s?.kind === 'bot').length;
  const nPlayers = t.seats.filter(Boolean).length;

  const logHtml = t.log.map(l => `<div class="${l.startsWith('—') ? 'hand-sep' : / wins /.test(l) ? 'win' : ''}">${esc(l)}</div>`).join('');
  const chatHtml = t.chat.length ? t.chat.map(c => `<div><b>${esc(c.from)}:</b> ${esc(c.text)}</div>`).join('') : '<div class="muted">No messages yet.</div>';

  return `<main>
    <div class="page-head"><div><h1>Table View</h1><p class="sub">The table as a player sees it. Click an empty seat to play, or click any player for their stats.</p></div>
      <button class="btn g" data-act="modal" data-m="newTable">${ICON.plus} New table</button></div>
    <div class="tabs">${tabs}</div>
    <div class="table-wrap">
      <div>
        <div class="phone">
          <div class="phone-head"><span class="mono">#${t.id} | ${esc(t.name)} · ${esc(S.club)}</span>
            <button class="reveal" data-act="reveal"><span class="toggle sm ${ui.reveal ? 'on' : ''}"></span> Reveal bots</button></div>
          <div class="felt-area">
            <div class="felt"><div class="felt-inner">
              ${h ? `<div class="pot">Pot ${fmt(h.pot)}</div>` : ''}
              <div class="boards">${boards}</div>
              <div class="table-msg">${msg}</div>
              <div class="brand-mark">PLO4</div>
            </div></div>
            ${seatsHtml}
          </div>
          <div class="info">${info}</div>
          ${actionBar(t, you, youLoc, seatedHere)}
        </div>
      </div>
      <div class="side">
        <div class="panel">
          <h3>What a human player sees</h3>
          <p>Bot accounts look exactly like regular players: a nickname, a stack, normal-looking bets. Nothing on the table marks them.</p>
          <p>Turn on <b>Reveal bots</b> to see which seats are run from the dashboard. ${ui.reveal ? `<b>${nBots} of ${nPlayers}</b> players at this table are bots${nBots > 1 ? ', all controlled by one person — they can share information and gang up on everyone else' : ''}.` : ''}</p>
          <div class="legend"><span><i class="lg"></i>Player</span><span><i class="lg bot"></i>Bot (shown when revealed)</span></div>
        </div>
        <div class="panel">
          <h3>Table chat</h3>
          <div class="chatlog" id="chatlog-${t.id}" data-autoscroll>${chatHtml}</div>
          <form class="chat" data-form="chat" data-id="you">
            <input id="chat-you-${t.id}-${seatedHere ? 1 : 0}" data-keep name="text" maxlength="140" autocomplete="off" ${seatedHere ? '' : 'disabled'} placeholder="${seatedHere ? 'Say something as You…' : 'Sit down at this table to chat'}" />
            <button class="send" type="submit" aria-label="Send" ${seatedHere ? '' : 'disabled'}>${ICON.send}</button>
          </form>
        </div>
        <div class="panel">
          <h3>Hand log</h3>
          <div class="log" id="log-${t.id}" data-autoscroll>${logHtml || '<div>No hands yet.</div>'}</div>
        </div>
        <div class="panel">
          <h3>Table tools</h3>
          <p>Rake collected: <b>${fmt(t.rakeCollected)}</b> over ${t.handNo} hand${t.handNo === 1 ? '' : 's'}.</p>
          <div class="row">
            <button class="btn sm b" data-act="addnpc" data-id="${t.id}" ${nPlayers >= 8 ? 'disabled' : ''}>${ICON.user} Add simulated player</button>
            <button class="btn sm ghost" data-act="nav" data-v="detection">${ICON.shield} Check detection</button>
          </div>
        </div>
      </div>
    </div>
  </main>`;
}

function actionBar(t, you, youLoc, seatedHere) {
  if (!you) return '';
  if (!seatedHere) {
    if (youLoc) return `<div class="actionbar"><div class="hint">You're seated at #${youLoc.t.id}.</div>
      <div class="row"><button class="btn sm b" data-act="tv" data-id="${youLoc.t.id}">Go to your table</button></div></div>`;
    if (you.pendingReq && you.requestTable === t.id) return `<div class="actionbar"><div class="hint">${you.queued ? 'The table is full — you are in the queue.' : 'Your buy-in request is waiting for the host.'}</div>
      <div class="row"><button class="btn sm a" data-act="nav" data-v="requests">Open Buy-in Requests</button>
      <button class="btn sm r" data-act="leave" data-id="you">Cancel request</button></div></div>`;
    if (you.pendingReq) return `<div class="actionbar"><div class="hint">You have a pending request for #${you.requestTable}.</div></div>`;
    return `<div class="actionbar"><div class="hint">Click an empty seat (+) to sit down. The host has to approve your buy-in. Club chips: ${fmt(you.clubChips)}</div></div>`;
  }
  const s = youLoc.s, h = t.hand;
  const myTurn = h?.phase === 'betting' && h.toAct === s.seat;
  const busted = s.sittingOut && s.busted;
  let main = '';
  if (myTurn) {
    const L = h.legal;
    const key = `${h.no}-${h.street}-${L.currentBet}-${L.committed}`;
    const half = clamp(L.currentBet + Math.max(L.minTo - L.currentBet, Math.round((L.pot + L.toCall) * 0.5)), L.minTo, L.maxTo);
    main = `<div class="hint">Your turn — ${Math.max(0, Math.ceil((h.deadline - now()) / 1000))}s left · Pot ${fmt(L.pot)}${L.toCall ? ` · ${fmt(L.toCall)} to call` : ''}</div>
      <div class="row">
        ${L.canCheck ? '' : `<button class="btn r" data-act="you-act" data-type="fold">Fold</button>`}
        <button class="btn b" data-act="you-act" data-type="${L.canCheck ? 'check' : 'call'}">${L.canCheck ? 'Check' : `Call ${fmt(L.toCall)}${L.toCall >= L.stack ? ' (all-in)' : ''}`}</button>
      </div>
      ${L.canRaise ? `<div class="row">
        <button class="btn sm ghost" data-act="raise-preset" data-key="${key}" data-v="${L.minTo}">Min</button>
        <button class="btn sm ghost" data-act="raise-preset" data-key="${key}" data-v="${half}">½ Pot</button>
        <button class="btn sm ghost" data-act="raise-preset" data-key="${key}" data-v="${L.maxTo}">${L.maxTo === L.committed + L.stack ? 'All-in' : 'Pot'}</button>
      </div>
      <div class="row">
        <input type="range" id="rs-${key}" data-keep data-raise="${key}" min="${L.minTo}" max="${L.maxTo}" step="1" value="${L.minTo}" />
        <input class="amt" id="ra-${key}" data-keep data-raise-amt="${key}" type="number" step="0.01" min="${fmt(L.minTo)}" max="${fmt(L.maxTo)}" value="${fmt(L.minTo)}" />
        <button class="btn a" data-act="you-raise" data-key="${key}">${L.isBet ? 'Bet' : 'Raise to'}</button>
      </div>` : ''}`;
  } else if (h?.phase === 'rit' && s.inHand && !s.folded && !h.rit.answers.you) {
    // Run it twice is offered to everyone left in the hand, including whoever covered the all-in.
    const opps = t.seats.filter(x => x && x.inHand && !x.folded && x.accountId !== 'you').length;
    main = `<div class="hint">${s.allIn ? "You're all-in" : `Your opponent${opps > 1 ? 's are' : ' is'} all-in`}. Run it twice?</div>
      <div class="row"><button class="btn b pulse" data-act="rit" data-id="you" data-v="once">Run once</button><button class="btn g pulse" data-act="rit" data-id="you" data-v="twice">Run twice</button></div>`;
  } else {
    const hint = busted ? 'Busted — top up to play.' : s.sittingOut ? "You're sitting out." : s.leaving ? 'Leaving after this hand.' : !s.inHand ? "You'll be dealt in next hand."
      : s.folded ? 'You folded — waiting for the next hand.' : h?.phase === 'betting' ? `Waiting for ${esc(t.seats[h.toAct]?.name || '…')}…` : 'Waiting…';
    main = `<div class="hint">${hint}</div>`;
  }
  return `<div class="actionbar">${main}
    <div class="row" style="border-top:1px solid rgba(255,255,255,.08);padding-top:10px">
      <span class="hint">Stack ${fmt(s.stack)} · Club ${fmt(you.clubChips)}</span>
      <button class="btn sm ${s.sittingOut ? 'b' : 'a'}" data-act="sitout" data-id="you" data-v="${s.sittingOut ? 0 : 1}" ${s.leaving || busted ? 'disabled' : ''}>${s.sittingOut ? "I'm back" : 'Sit out'}</button>
      <button class="btn sm t" data-act="modal" data-m="manage" data-id="you">Top up</button>
      <button class="btn sm r" data-act="leave" data-id="you" ${s.leaving ? 'disabled' : ''}>Leave</button>
    </div></div>`;
}

/* ---------------- buy-in requests ---------------- */

function renderRequests() {
  const botTag = kind => (ui.reveal && kind === 'bot' ? '<span class="tag-bot">BOT</span>' : '');
  const reqList = S.requests.length ? S.requests.map((r, i) => {
    const t = tableOf(r.tableId);
    return `<div class="req">
      <span class="n">${i + 1}.</span>
      <div class="who"><b>${esc(r.name)}${botTag(kindOf(r.accountId))}</b><small>#${r.pid}</small><small>Buy-in : ${fmt(r.amount)} · #${r.tableId}${t ? ` (${blinds(t)})` : ''} · ${ago(r.at)}</small></div>
      <button class="rej" data-act="resolve" data-req="${r.id}" data-ok="0" aria-label="Reject">✕</button>
      <button class="acc" data-act="resolve" data-req="${r.id}" data-ok="1" aria-label="Accept">✓</button>
    </div>`;
  }).join('') : `<div class="req-empty">No pending requests.<br>Press <b>Join Room</b> on a bot, sit down yourself, or wait for a simulated player.</div>`;

  const queueList = S.queue.length ? S.queue.map((q, i) => `<div class="req">
      <span class="n">${i + 1}.</span>
      <div class="who"><b>${esc(q.name)}${botTag(kindOf(q.accountId))}</b><small>#${q.pid}</small><small>Waiting for a seat at #${q.tableId} · Buy-in ${fmt(q.amount)}</small></div>
      <button class="rej" data-act="leave" data-id="${esc(q.accountId)}" aria-label="Remove from queue">✕</button></div>`).join('')
    : '<div class="req-empty">Nobody is waiting for a seat. Accepted players go here when their table is full.</div>';

  const hist = S.history.length ? S.history.map((x, i) => `<div class="req">
      <span class="n">${i + 1}.</span>
      <div class="who"><b>${esc(x.name)}${botTag(kindOf(x.accountId))}</b><small>#${x.pid}</small><small>Buy-in : ${fmt(x.amount)} · #${x.tableId}</small></div>
      <div class="st ${x.status}">${x.status}<small>${ago(x.at)}</small></div></div>`).join('') : '<div class="req-empty">No history yet.</div>';

  return `<main>
    <div class="page-head"><div><h1>Buy-in Requests</h1><p class="sub">Host screen — every seat needs the club host's approval</p></div>
      <button class="reveal btn ghost" data-act="reveal"><span class="toggle sm ${ui.reveal ? 'on' : ''}"></span> Reveal bots</button></div>
    <div class="req-wrap">
      <div class="req-phone">
        <div class="req-tabs">
          <button data-act="reqtab" data-v="requests" class="${ui.reqTab === 'requests' ? 'on' : ''}">Requests (${S.requests.length})</button>
          <button data-act="reqtab" data-v="queue" class="${ui.reqTab === 'queue' ? 'on' : ''}">Queue (${S.queue.length})</button>
        </div>
        ${ui.reqTab === 'requests' ? `
        <div class="req-tools">
          <span class="switch">${toggleHtml(S.settings.autoAccept, 'data-act="setting" data-k="autoAccept"', 'sm')} Auto-accept everyone</span>
          <button class="btn sm solid" data-act="acceptall" ${S.requests.length && !acceptingAll ? '' : 'disabled'}>Accept all</button>
        </div>${reqList}` : queueList}
        <div class="req-divider">— Request History —</div>
        ${hist}
      </div>
      <div class="side">
        <div class="panel">
          <h3>Why this matters</h3>
          <p>To the host, a bot's request looks like anyone else's: a nickname, a player ID and a buy-in. Nothing on this screen shows it's automated.</p>
          <p>Turn on <b>Reveal bots</b> to see how many of the approved players were actually run from the dashboard.</p>
        </div>
        <div class="panel">
          <h3>Club settings</h3>
          <div class="row" style="justify-content:space-between"><span>Simulated players join over time</span>${toggleHtml(S.settings.npcTraffic, 'data-act="setting" data-k="npcTraffic"', 'sm')}</div>
          <p style="margin-top:10px">Simulated players give up if their request isn't answered within 90 seconds.</p>
        </div>
      </div>
    </div>
  </main>`;
}

/* ---------------- detection ---------------- */

function renderDetection() {
  const truth = kindOf;
  const rows = S.detection.filter(r => (ui.detSeated ? r.seated : r.hands > 0 || r.seated));
  let evalPanel = '';
  if (ui.reveal) {
    const considered = S.detection.filter(r => r.hands >= 10);
    const bots = considered.filter(r => truth(r.id) === 'bot');
    const caught = bots.filter(r => r.level === 'high').length;
    const falseAlarms = considered.filter(r => (truth(r.id) === 'npc' || truth(r.id) === 'you') && r.level === 'high').length;
    evalPanel = `<div class="panel" style="margin-bottom:18px">
      <h3>How well is detection doing?</h3>
      <p>Among players with 10+ hands: caught <b>${caught} of ${bots.length}</b> bot${bots.length === 1 ? '' : 's'} (high risk) with <b>${falseAlarms}</b> false alarm${falseAlarms === 1 ? '' : 's'} on human players.</p>
      <p>Try it: raise a bot's think-time range in its configuration and watch the timing signal weaken. The shared device and co-seating signals still give it away.</p>
    </div>`;
  }
  const truthTag = id => {
    if (!ui.reveal) return '';
    const k = truth(id);
    return k === 'bot' ? '<span class="truth bot">BOT</span>' : k === 'you' ? '<span class="truth you">YOU</span>' : k === 'npc' ? '<span class="truth npc">human</span>' : '<span class="truth npc">unknown</span>';
  };
  const body = rows.length ? rows.map(r => {
    const open = ui.detOpen === r.id;
    return `<tr class="rowbtn" data-act="detrow" data-id="${esc(r.id)}">
        <td><b>${esc(r.name)}</b> ${truthTag(r.id)}<div class="muted" style="font-size:12px">${r.seated ? 'seated' : 'away'}</div></td>
        <td><div class="risk lvl-${r.level}"><div class="bar"><i style="width:${r.score}%"></i></div><b class="num">${r.score}</b></div></td>
        <td class="num">${r.hands}</td>
        <td class="num">${pct(r.vpip)} / ${pct(r.pfr)}</td>
        <td class="num">${pct(r.foldToBet)}</td>
        <td class="num">${r.decisions ? `${r.avgTime.toFixed(1)}s ± ${Math.round(r.timeCv * 100)}%` : '—'}</td>
        <td><div class="flags">${r.flags.slice(0, open ? 99 : 2).map(f => `<span class="flag ${f.sev}">${esc(f.text)}</span>`).join('') || '<span class="muted">No signals</span>'}${!open && r.flags.length > 2 ? `<span class="muted" style="font-size:12px">+${r.flags.length - 2} more</span>` : ''}</div></td>
      </tr>${open ? `<tr class="det-detail"><td colspan="7"><div class="kv">
        <div><span>Device fingerprint</span><b class="mono">${esc(r.fingerprint)}</b></div>
        <div><span>Decisions timed</span><b>${r.decisions}</b></div>
        <div><span>Fastest decision</span><b>${r.fastest != null ? `${r.fastest.toFixed(2)}s` : '—'}</b></div>
        <div><span>Aggression factor</span><b>${r.af.toFixed(2)}</b></div>
        <div><span>Timing variation</span><b>${Math.round(r.timeCv * 100)}% (humans ≈ 60%+)</b></div>
        ${ui.reveal && truth(r.id) === 'bot' ? `<div><span>Ground truth</span><b style="color:#fca5a5">${acct(r.id) ? `Bot — ${esc(S.skills[acct(r.id).config.skill].label)} / ${esc(S.styles[acct(r.id).config.style].label)}` : 'Bot (deleted)'}</b></div>` : ''}
      </div></td></tr>` : ''}`;
  }).join('') : `<tr><td colspan="7" class="muted">No players to show yet — let a few hands play.</td></tr>`;

  return `<main>
    <div class="page-head"><div><h1>Bot Detection</h1><p class="sub">What the platform's security team could see, using only signals a real operator has.</p></div>
      <div class="row">
        <span class="switch">${toggleHtml(ui.detSeated, 'data-act="detseated"', 'sm')} Only seated players</span>
        <span class="switch">${toggleHtml(ui.reveal, 'data-act="reveal"', 'sm')} Show ground truth</span>
        <button class="btn sm ghost" data-act="detreset">Reset stats</button>
      </div></div>
    ${evalPanel}
    <div class="panel" style="overflow-x:auto">
      <table class="det">
        <thead><tr><th>Player</th><th>Risk</th><th>Hands</th><th>VPIP / PFR</th><th>Fold to bet</th><th>Decision time</th><th>Signals (click a row for details)</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="panel" style="margin-top:18px">
      <h3>Signals used</h3>
      <p><b>Timing</b> — humans vary a lot between snap decisions and long tanks; scripts act inside a narrow window. <b>Same device</b> — several accounts playing from one machine. <b>Co-seating</b> — same-device accounts that keep ending up at the same table. <b>Run-it-twice pattern</b> — always the same choice after the same delay. <b>Marathon sessions</b> — hundreds of hands without a break.</p>
    </div>
  </main>`;
}

/* ---------------- modals ---------------- */

function renderModal() {
  const m = ui.modal;
  if (!m) return '';
  const a = m.id && acct(m.id);
  const err = `<div class="err">${esc(m.err || '')}</div>`;
  const busy = m.busy ? 'disabled' : '';   // a command is in flight — no double submits
  let body = '';
  let small = true;

  if (m.type === 'room') {
    small = false;
    body = `<h3>Select Room</h3><div class="club">${esc(S.club)}</div>
      <p class="muted" style="margin:6px 0 0">Choose a table for <b>${esc(a?.name)}</b>.</p>
      <div class="tables-list">${S.tables.map(t => {
        const n = t.seats.filter(Boolean).length;
        return `<button class="tbl" data-act="pickroom" data-table="${t.id}">
          <span class="id mono">#${t.id}</span> <span class="badge ${t.hand ? 'blue' : 'amber'}">${t.hand ? 'RUNNING' : 'PREPARE'}</span>
          <div class="meta"><span>Blinds: <em class="mono">${blinds(t)}</em></span><span>Type: <span class="type">cashPLO</span></span>
            <span class="mono">${n}/8</span><span>Empty: <b style="color:var(--green)">${8 - n}</b></span>${n >= 8 ? '<span class="badge amber">Full — you\'ll be queued</span>' : ''}</div>
          <div class="created">Buy-in ${fmt(t.minBuyIn)} – ${fmt(t.maxBuyIn)} · Created: ${new Date(t.createdAt).toLocaleString()}</div>
        </button>`;
      }).join('')}</div>`;
  } else if (m.type === 'chips') {
    const t = tableOf(m.tableId);
    if (!t || !a) return '';
    const def = clamp(Math.min(t.maxBuyIn, a.clubChips), t.minBuyIn, t.maxBuyIn);
    const full = t.seats.every(Boolean);
    body = `<h3>Enter chips to sit</h3>
      <p class="muted" style="margin:4px 0 0">#${t.id} · Blinds ${blinds(t)}${m.seat != null ? ` · Seat ${Number(m.seat) + 1}` : ''} · Buy-in ${fmt(t.minBuyIn)} – ${fmt(t.maxBuyIn)}</p>
      <div class="field"><label for="chips-in">Enter chips amount</label>
        <input id="chips-in" data-keep type="number" step="0.01" min="${fmt(t.minBuyIn)}" max="${fmt(t.maxBuyIn)}" placeholder="e.g. ${fmt(def)}" value="${fmt(def)}" />
        <div class="quick">
          <button data-act="setinput" data-target="chips-in" data-v="${fmt(t.minBuyIn)}">Min</button>
          <button data-act="setinput" data-target="chips-in" data-v="${fmt(Math.round((t.minBuyIn + t.maxBuyIn) / 2))}">Mid</button>
          <button data-act="setinput" data-target="chips-in" data-v="${fmt(t.maxBuyIn)}">Max</button>
        </div>
        <div class="hint">Current club chips: ${fmt(a.clubChips)}</div></div>
      ${err}
      <p class="muted" style="font-size:13px;margin:4px 0 0">${!S.settings.autoAccept ? 'This sends a buy-in request. The host approves it in Buy-in Requests.' : full ? "Auto-accept is on, but the table is full — you'll join the queue." : 'Auto-accept is on — you will be seated right away.'}</p>
      <div class="actions"><button class="cancel" data-act="close">Cancel</button><button class="confirm" data-act="chips-confirm" ${busy}>Confirm</button></div>`;
  } else if (m.type === 'manage') {
    if (!a) return '';
    const loc = locate(a.id);
    const s = loc?.s, t = loc?.t;
    const room = s ? s.maxTopUp : 0;
    body = `<h3>Manage chips — ${esc(a.name)}</h3>
      <div class="popover-stats"><div><span>Club chips</span><b>${fmt(a.clubChips)}</b></div>
        <div><span>At the table</span><b>${s ? `${fmt(s.stack)}${s.topUp ? ` (+${fmt(s.topUp)} next hand)` : ''}` : 'Not seated'}</b></div></div>
      <div class="field"><label>Add club chips (sandbox credit — not real money)</label>
        <div class="quick">${[100, 500, 1000].map(v => `<button data-act="addchips" data-id="${a.id}" data-v="${v}">+${v}</button>`).join('')}</div></div>
      ${s ? `<div class="field"><label for="topup-in">Top up stack from club chips</label>
        <div class="chat"><input id="topup-in" data-keep type="number" step="0.01" min="0.01" placeholder="max ${fmt(Math.max(0, Math.min(room, a.clubChips)))}" />
        <button class="btn t" data-act="topup" data-id="${a.id}" ${room > 0 && !m.busy ? '' : 'disabled'}>Top up</button></div>
        <div class="hint">${room > 0 ? `You can add up to ${fmt(Math.max(0, Math.min(room, a.clubChips)))} (table max ${fmt(t.maxBuyIn)}). Applied before the next hand.` : 'Already at the table maximum.'}</div></div>` : ''}
      ${err}
      <div class="actions"><button class="cancel" data-act="close">Done</button></div>`;
  } else if (m.type === 'newBot') {
    body = `<h3>New bot</h3>
      <form data-form="newBot"><div class="field"><label for="bot-name">Nickname (what other players see)</label>
        <input id="bot-name" data-keep name="name" maxlength="18" autocomplete="off" placeholder="e.g. NightOwl" /></div>
      ${err}
      <p class="muted" style="font-size:13px">It starts as Medium · SMC with 1,000 club chips. Change it under Configure.</p>
      <div class="actions"><button type="button" class="cancel" data-act="close">Cancel</button><button type="submit" class="confirm" ${busy}>Create</button></div></form>`;
  } else if (m.type === 'newTable') {
    body = `<h3>New table</h3>
      <form data-form="newTable">
        <div class="quick" style="margin-top:12px">${[[0.25, 0.5], [0.5, 1], [1, 2], [2, 5]].map(([sb, bb]) => `<button type="button" data-act="blinds" data-sb="${sb}" data-bb="${bb}">${sb}/${bb}</button>`).join('')}</div>
        <div class="row" style="gap:12px">
          <div class="field" style="flex:1"><label for="nt-sb">Small blind</label><input id="nt-sb" data-keep name="sb" type="number" step="0.01" min="0.01" value="0.5" /></div>
          <div class="field" style="flex:1"><label for="nt-bb">Big blind</label><input id="nt-bb" data-keep name="bb" type="number" step="0.01" min="0.01" max="1000" value="1" /></div>
        </div>
        <div class="field"><label for="nt-name">Name (optional)</label><input id="nt-name" data-keep name="name" maxlength="30" autocomplete="off" placeholder="e.g. Friday PLO" /></div>
        ${err}
        <p class="muted" style="font-size:13px">8 seats · buy-in 20–100 big blinds · 6.9% rake capped at 7.99 · 15s action time.</p>
        <div class="actions"><button type="button" class="cancel" data-act="close">Cancel</button><button type="submit" class="confirm" ${busy}>Create table</button></div>
      </form>`;
  } else if (m.type === 'deleteBot') {
    if (!a) return '';
    body = `<h3>Delete ${esc(a.name)}?</h3>
      <p class="muted">Its club chips (${fmt(a.clubChips)}) go with it. ${a.tableId || a.pendingReq ? '<b style="color:var(--red)">It has to leave its table first.</b>' : ''}</p>
      ${err}
      <div class="actions"><button class="cancel" data-act="close">Cancel</button><button class="confirm danger" data-act="delete-bot" data-id="${a.id}" ${busy}>Delete</button></div>`;
  } else if (m.type === 'player') {
    const r = S.detection.find(x => x.id === m.id);
    const pa = acct(m.id);
    const loc = locate(m.id);
    const name = pa?.name || r?.name || 'Player';
    const kind = kindOf(m.id);
    let truth = '';
    if (ui.reveal && kind === 'bot') truth = `<p style="color:#fca5a5;margin:10px 0 0"><b>Bot</b> — ${pa ? `${esc(S.skills[pa.config.skill].label)} · ${esc(S.styles[pa.config.style].label)}, controlled from the dashboard` : 'since deleted from the dashboard'}.</p>`;
    else if (ui.reveal && kind === 'npc') truth = `<p class="muted" style="margin:10px 0 0">Simulated human${pa ? ` — ${esc(S.skills[pa.npcProfile.skill].label)} · ${esc(S.styles[pa.npcProfile.style].label)}` : ' (has left the club)'}.</p>`;
    body = `<h3>${esc(name)}${kind === 'you' ? ' (you)' : ''}</h3>
      <p class="muted mono" style="margin:2px 0 0">#${esc(pa?.pid || '')}${loc ? ` · Seat ${loc.s.seat + 1} · Stack ${fmt(loc.s.stack)}` : ''}</p>
      <div class="popover-stats">
        <div><span>Hands</span><b>${r?.hands ?? 0}</b></div>
        <div><span>VPIP / PFR</span><b>${pct(r?.vpip)} / ${pct(r?.pfr)}</b></div>
        <div><span>Fold to bet</span><b>${pct(r?.foldToBet)}</b></div>
        <div><span>Avg decision</span><b>${r?.decisions ? `${r.avgTime.toFixed(1)}s` : '—'}</b></div>
        <div><span>Detection risk</span><b>${r ? `${r.score} (${r.level})` : '—'}</b></div>
      </div>
      ${truth}
      <div class="actions">
        ${pa?.kind === 'bot' && ui.reveal ? `<button class="cancel" data-act="gotobot" data-id="${pa.id}">Open in dashboard</button>` : ''}
        <button class="cancel" data-act="gotodet" data-id="${esc(m.id)}">Detection details</button>
        <button class="confirm" data-act="close">Close</button>
      </div>`;
  }
  return `<div class="overlay" data-overlay><div class="modal ${small ? 'small' : ''}" role="dialog" aria-modal="true">
    <button class="x" data-act="close" aria-label="Close">×</button>${body}</div></div>`;
}

/* ---------------- render ---------------- */

// Autoscroll elements already shown once. Kept outside the DOM so morphdom doesn't strip it every render.
const scrolledOnce = new WeakSet();

function render() {
  const app = $('#app');
  if (!S) {
    app.innerHTML = `<main><p class="muted">${online ? 'Loading…' : 'Connecting to the sandbox server… (is <code>npm start</code> running?)'}</p></main>`;
    return;
  }
  if (ui.view === 'tables' && !tableOf(ui.tv)) {
    const youLoc = locate('you');
    const withBots = S.tables.find(t => t.seats.some(s => s?.kind === 'bot'));
    ui.tv = (youLoc?.t || withBots || S.tables[0])?.id ?? null;
  }
  if (ui.modal?.id && !acct(ui.modal.id) && ui.modal.type !== 'player') ui.modal = null;

  const view = { dashboard: renderDashboard, tables: renderTables, requests: renderRequests, detection: renderDetection }[ui.view] || renderDashboard;
  const html = `<div id="app">${renderHeader()}${view()}${renderModal()}</div>`;

  // Keep scrolled-to-bottom logs pinned to the bottom.
  const pinned = new Set();
  document.querySelectorAll('[data-autoscroll]').forEach(el => {
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) pinned.add(el.id);
  });
  // morphdom moves keyed nodes between parents (a bot card changing group), which blurs them.
  const focused = document.activeElement;
  let sel = null;
  try { sel = focused?.selectionStart != null ? [focused.selectionStart, focused.selectionEnd] : null; } catch { /* no selection on this input type */ }
  morphdom(app, html, {
    onBeforeElUpdated(from, to) {
      if (from.hasAttribute?.('data-keep')) { keepValue(from, to); return false; }
      return !from.isEqualNode(to);
    },
  });
  if (focused?.isConnected && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
    if (sel) try { focused.setSelectionRange(...sel); } catch { /* ignore */ }
  }
  document.querySelectorAll('[data-autoscroll]').forEach(el => {
    if (pinned.has(el.id) || !scrolledOnce.has(el)) { el.scrollTop = el.scrollHeight; scrolledOnce.add(el); }
  });
}

// User-editable inputs keep what was typed, but everything else (placeholder, min, max, disabled…) follows the new render.
function keepValue(from, to) {
  for (const { name, value } of to.attributes) if (name !== 'value' && from.getAttribute(name) !== value) from.setAttribute(name, value);
  for (const { name } of [...from.attributes]) if (name !== 'value' && !to.hasAttribute(name)) from.removeAttribute(name);
  // Config sliders show the saved value unless the user is holding or focusing them.
  if (from.dataset.cfg && document.activeElement !== from && !(from.id in ui.sliders)) from.value = to.getAttribute('value');
}

/* ---------------- events ---------------- */

function closeModal() { ui.modal = null; render(); }
function openModal(m) { ui.modal = m; render(); setTimeout(() => $('.modal input:not([disabled])')?.focus(), 30); }
function modalError(msg, m = ui.modal) { if (m && ui.modal === m) { m.err = msg; render(); } else toast(msg, true); }
function nav(v) { ui.view = v; persist(); render(); window.scrollTo(0, 0); }
// One command per modal at a time: repeat clicks are ignored and its buttons stay disabled until the server answers.
async function modalSend(cmd, args) {
  const m = ui.modal;
  if (m) { m.busy = true; render(); }
  try { return await send(cmd, args); }
  finally { if (m) { m.busy = false; if (ui.modal === m) render(); } }
}
let acceptingAll = false;
const resolving = new Set();

// Only a press that starts on the backdrop closes the modal, not a text selection dragged out of an input.
let downOnOverlay = false;
document.addEventListener('pointerdown', e => { downOnOverlay = !!e.target.hasAttribute?.('data-overlay'); });

document.addEventListener('click', async e => {
  if (e.target.hasAttribute?.('data-overlay')) { if (downOnOverlay) closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const d = el.dataset, id = d.id;
  const a = id && S && acct(id);

  switch (d.act) {
    case 'nav': return nav(d.v);
    case 'filter':
      if (d.v === 'rooms') return nav('tables');
      ui.filter = ui.filter === d.v ? 'all' : d.v; persist(); return render();
    case 'opentable': ui.tv = id; return nav('tables');
    case 'tv': ui.tv = id; persist(); return render();
    case 'reveal': ui.reveal = !ui.reveal; persist(); return render();
    case 'cfgopen': ui.cfgOpen.has(id) ? ui.cfgOpen.delete(id) : ui.cfgOpen.add(id); return render();
    case 'modal': return openModal({ type: d.m, id });
    case 'close': return closeModal();

    case 'enable': return run('bot.enable', { id, value: !a.enabled }, `${a.name} turned ${a.enabled ? 'off — it will time out and sit out' : 'on'}`);
    case 'reload': return run('bot.reload', { id }, `Reconnecting ${a.name}…`);
    case 'join': return openModal({ type: 'room', id });
    case 'pickroom': return openModal({ type: 'chips', id: ui.modal.id, tableId: d.table });
    case 'sithere': {
      const you = acct('you');
      if (you.tableId) return toast("You're already seated — leave your table first", true);
      if (you.pendingReq) return toast('You already have a pending request', true);
      return openModal({ type: 'chips', id: 'you', tableId: d.table, seat: Number(d.seat) });
    }
    case 'chips-confirm': {
      const m = ui.modal;
      if (m.busy) return;
      const amount = parseFloat($('#chips-in').value);
      if (!(amount > 0)) return modalError('Enter a chip amount');
      try {
        const r = await modalSend('seat.request', { id: m.id, tableId: m.tableId, amount, seat: m.seat });
        if (ui.modal === m) closeModal();
        const name = acct(m.id)?.name;
        toast(r?.status === 'seated' ? `${name} sat down`
          : r?.status === 'queued' ? `Table is full — ${m.id === 'you' ? "you're" : `${name} is`} in the queue`
          : 'Buy-in request sent — approve it in Buy-in Requests');
      } catch (err) { modalError(err.message, m); }
      return;
    }
    case 'leave': {
      if (!a) return;
      if (a.tableId) return run('seat.leave', { id }, `${a.name} is leaving the table`);
      return run('seat.cancel', { id }, a.queued ? `${a.name} left the queue` : `Request cancelled for ${a.name}`);
    }
    case 'sitout': return run('seat.sitout', { id, value: d.v === '1' }, d.v === '1' ? `${a.name} will sit out` : `${a.name} is back`);
    case 'rit': return run('seat.rit', { id, choice: d.v }, `Run it ${d.v}`);
    case 'cfg': {
      let v = d.v;
      if (d.k === 'autoTopUp') v = d.v === 'true';
      return run('bot.config', { id, patch: { [d.k]: v } });
    }
    case 'addchips':
      try { await send('chips.add', { id, amount: Number(d.v) }); toast(`Added ${d.v} club chips`); } catch (err) { modalError(err.message); }
      return;
    case 'topup': {
      const m = ui.modal;
      if (m?.busy) return;
      const amount = parseFloat($('#topup-in')?.value);
      if (!(amount > 0)) return modalError('Enter an amount to top up');
      try {
        await modalSend('seat.topup', { id, amount });
        const inp = $('#topup-in');
        if (inp) inp.value = '';
        if (m) m.err = '';
        toast(`Topped up ${fmt(Math.round(amount * 100))} — applied before the next hand`); render();
      } catch (err) { modalError(err.message, m); }
      return;
    }
    case 'setinput': { const inp = document.getElementById(d.target); if (inp) inp.value = d.v; return; }
    case 'blinds': $('#nt-sb').value = d.sb; $('#nt-bb').value = d.bb; return;
    case 'delete-bot': {
      const m = ui.modal;
      if (m?.busy) return;
      try { await modalSend('bot.delete', { id }); ui.cfgOpen.delete(id); if (ui.modal === m) closeModal(); toast('Bot deleted'); } catch (err) { modalError(err.message, m); }
      return;
    }
    case 'player': return openModal({ type: 'player', id });
    case 'gotobot':
      ui.cfgOpen.add(id); ui.modal = null; ui.filter = 'all'; ui.flash = { id, until: Date.now() + 1800 }; nav('dashboard');
      // The open config makes the card taller than the screen, so line its top up just under the sticky header.
      setTimeout(() => {
        const el = document.getElementById(`bot-${id}`);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - ($('header')?.offsetHeight || 0) - 12;
        window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }, 50);
      return;
    case 'gotodet': ui.detOpen = id; ui.detSeated = false; ui.modal = null; return nav('detection');

    case 'you-act': return run('seat.act', { id: 'you', type: d.type });
    case 'raise-preset': {
      const c = Number(d.v);
      const rs = document.getElementById(`rs-${d.key}`), ra = document.getElementById(`ra-${d.key}`);
      if (rs) rs.value = c;
      if (ra) ra.value = fmt(c);
      return;
    }
    case 'you-raise': {
      const ra = document.getElementById(`ra-${d.key}`);
      const amount = parseFloat(ra?.value);
      if (!(amount > 0)) return toast('Enter a raise amount', true);
      return run('seat.act', { id: 'you', type: 'raise', amount });
    }
    case 'addnpc': return run('table.addNpc', { tableId: id }, S.settings.autoAccept ? 'A simulated player sat down' : 'A simulated player asked to join — see Buy-in Requests');

    case 'reqtab': ui.reqTab = d.v; persist(); return render();
    case 'setting': return run('host.settings', { patch: { [d.k]: !S.settings[d.k] } });
    case 'resolve':
      if (resolving.has(d.req)) return;
      resolving.add(d.req);
      try { await run('host.resolve', { reqId: d.req, accept: d.ok === '1' }); } finally { resolving.delete(d.req); }
      return;
    case 'acceptall':
      if (acceptingAll) return;
      acceptingAll = true; render();
      try { for (const r of [...S.requests]) { if (!(await run('host.resolve', { reqId: r.id, accept: true }))) break; } }
      finally { acceptingAll = false; render(); }
      return;

    case 'detseated': ui.detSeated = !ui.detSeated; persist(); return render();
    case 'detreset': return run('detection.reset', {}, 'Detection statistics cleared');
    case 'detrow': ui.detOpen = ui.detOpen === id ? null : id; return render();
  }
});

// Sliders: live label while dragging, save on release.
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.cfg) {
    ui.sliders[el.id] = el.value;
    const lab = document.getElementById(`${el.id}-v`);
    if (lab) lab.textContent = el.dataset.cfg === 'bluff' ? `${el.value}%` : `${Number(el.value).toFixed(1)}s`;
  } else if (el.dataset.raise) {
    const ra = document.getElementById(`ra-${el.dataset.raise}`);
    if (ra) ra.value = fmt(Number(el.value));
  } else if (el.dataset.raiseAmt) {
    const rs = document.getElementById(`rs-${el.dataset.raiseAmt}`);
    if (rs) rs.value = Math.round(parseFloat(el.value) * 100) || rs.min;
  }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (!el.dataset.cfg) return;
  const ok = await run('bot.config', { id: el.dataset.id, patch: { [el.dataset.cfg]: Number(el.value) } });
  delete ui.sliders[el.id];
  if (ok) toast('Saved');
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const kind = f.dataset.form;
  if (kind === 'chat') {
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    if (await run('chat.send', { id: f.dataset.id, text })) input.value = '';
  } else if (kind === 'newBot' || kind === 'newTable') {
    const m = ui.modal;
    if (m?.busy) return;
    if (kind === 'newBot') {
      const name = f.querySelector('#bot-name').value.trim();
      if (!name) return modalError('Enter a nickname');
      try { await modalSend('bot.create', { name }); if (ui.modal === m) closeModal(); toast(`${name} created — press Join Room to seat it`); ui.filter = 'all'; persist(); }
      catch (err) { modalError(err.message, m); }
    } else {
      const sb = parseFloat(f.querySelector('#nt-sb').value), bb = parseFloat(f.querySelector('#nt-bb').value);
      const name = f.querySelector('#nt-name').value.trim();
      try { await modalSend('table.create', { sb, bb, name: name || undefined }); if (ui.modal === m) closeModal(); toast('Table created'); }
      catch (err) { modalError(err.message, m); }
    }
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modal) closeModal(); });

// Countdown timers and "x seconds ago" labels refresh between server pushes.
setInterval(() => { if (S) render(); }, 500);

$('#app').innerHTML = '<main><p class="muted">Connecting to the sandbox server…</p></main>';
connect();
