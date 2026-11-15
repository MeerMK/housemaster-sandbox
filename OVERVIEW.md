# Project overview: HouseMaster Sandbox

## What it is
HouseMaster Sandbox is a final-year project (FYP) about the risks of bots in online poker. It is a complete, self-contained pot-limit Omaha (PLO4) poker club that runs entirely on one machine. It includes:
- a real game server
- automated "bot" players with configurable skill and style
- simulated human players
- a host screen where every buy-in must be approved
- a bot-detection module that flags suspicious accounts

The goal is to show, hands-on, how bot accounts can sit at a table looking like normal players, and which signals a poker platform could use to catch them.

Scope: the sandbox never connects to any real poker site or app, and no real money is involved. All players, tables and chips exist only inside the local server.

Background: the UI was rebuilt from screenshots of an older dashboard ("HouseMaster") whose source code was lost. The old version's backend appears to have been Python. This new version was written from scratch in JavaScript.

## Tech stack
- **Runtime:** Node.js (ES modules), no framework. Tested on Node 26; needs Node 18 or newer.
- **Dependencies (only two):**
  - `ws`: WebSocket server
  - `morphdom`: efficient DOM updates in the browser
- **Frontend:** plain HTML, CSS and vanilla JavaScript. No build step. Fonts: Inter and JetBrains Mono (Google Fonts).
- **Server ↔ UI protocol:** WebSocket with JSON messages.
  - The browser sends commands: `{ id, cmd, args }`.
  - The server replies with `{ ok | error }` and broadcasts the full live state (up to ~8 times per second).
  - Every button in the UI maps to exactly one server command.
- **Persistence:** a JSON file (`data/state.json`) stores bots, their settings, club chips and tables.
- **Tests:** Node's built-in test runner (`node:test`). 66 tests covering:
  - the hand evaluator and game rules, including every edge case found in review (side pots, uncalled bets, short all-in raises, leaving mid-hand, odd chips)
  - a fuzz test of 3,000 random hands with players leaving, sitting out, topping up and timing out, which checks that no chip is ever created or lost
  - the club: money never lost through requests, queues, leaving or a server restart; input validation; the WebSocket server
  - the bot brain: every setting has an effect, and Professional beats Fish
  - the UI rendering and its event handlers
- **Money** is stored as integer cents everywhere, to avoid floating-point errors.
- **Shuffling** uses Fisher–Yates with Node's cryptographic RNG (`crypto.randomInt`).

## Project structure
```
server/
  cards.js       deck, card encoding, CSPRNG shuffle
  evaluator.js   5-card hand ranking + Omaha rule (exactly 2 hole cards + 3 board cards)
  equity.js      Monte Carlo equity, with optional opponent-range filtering
  table.js       PLO4 cash-game engine
  brain.js       decision-making for bots and simulated players
  detection.js   bot-detection analytics
  world.js       the "club": accounts, buy-in requests, queue, bot/player controllers, chat, save/load
  index.js       HTTP static server + WebSocket command API
public/
  index.html, style.css, app.js   the UI (4 views)
test/
  evaluator.test.js, table.test.js, brain.test.js, world.test.js, ui.test.js
```

## Game engine (server/table.js)
- 8-seat PLO4 cash tables with configurable blinds.
- Buy-in range is 20–100 big blinds.
- Rake is 6.9%, capped at 7.99. It is only taken if a flop is dealt, and only from contested money.
- Correct pot-limit rules:
  - the maximum raise is "call, then raise the size of the pot"
  - the minimum raise is at least the last full raise
  - an incomplete all-in raise does not reopen the betting
  - the big blind gets its option
  - heads-up, the button posts the small blind and acts first preflop
- Side pots for multiple all-ins, return of uncalled bets, split pots with correct odd-chip handling.
- Run it twice: when players are all-in before the river, each is asked (6-second window). If all agree, the rest of the board is dealt twice from the same deck and each half of the pot is decided separately.
- 15-second action timer. On timeout the player checks if possible (otherwise folds) and is sat out.
- Players can sit out, top up (applied before the next hand, never above the max buy-in), or leave. Leaving mid-hand folds the player if they can still act; if they are all-in they stay in the pot. Either way they are cashed out when the hand ends, and their seat stays reserved until then.
- Time is passed into the engine explicitly (`tick(now)`), so it is fully testable.

## The bot brain (server/brain.js)
Each bot has two independent settings.

**Skill level** (how well it reads the game):
- **Professional:**
  - Monte Carlo equity (~350 simulations) against *ranges* inferred from the betting (e.g. someone who pot-raises the turn usually has two pair or better)
  - uses pot odds, implied odds, position and stack-to-pot ratio
  - bet sizes depend on the board
  - semi-bluffs
  - **models its opponents:** it tracks each opponent's fold-to-bet rate, bluffs more against players who fold too much, and stops bluffing and bets thinner for value against calling stations
  - never tilts, and makes almost no random mistakes
- **Medium:** fewer simulations (~160), a basic range read, some position awareness, predictable bet sizes, occasional mistakes, and can tilt.
- **Fish:** few simulations (~40) plus a lot of noise. Ignores pot odds, calls with any pair or draw, uses random bet sizes, makes frequent mistakes and tilts.

**Play style** (what it likes to do):
- **Nit:** premium hands only
- **SMC:** balanced, standard ranges
- **Aggro:** wide, lots of pressure
- **Station:** calls almost everything
- **Fold:** folds every hand

Other per-bot settings:
- bluff frequency slider
- think-time range (how long it "thinks" before acting)
- run-it-twice preference (ask each time / always once / always twice)
- automatic top-up

Preflop hand strength uses a PLO-specific scoring heuristic: pairs, suitedness (with extra weight for nut-flush potential), connectedness, rundowns, high cards, and penalties for unconnected "dangler" cards.

**Tilt:** after losing a pot bigger than 50 big blinds, Medium and Fish bots play looser and more aggressively for 12 hands.

**Calibration:** in self-play (6-max, stacks reset to 100bb every hand to reduce variance, several thousand hands per run):
- Fish lose heavily in every style.
- Professional is ahead of Medium on average.

## Simulated human players (world.js)
- They use the same brain with a random mix of skill and style (mostly Fish and Medium, some Professional).
- Their think times look human: a log-normal distribution with occasional long "tanks" on big decisions.
- Each one has its own device fingerprint.
- They join tables over time (their buy-in requests appear on the host screen), rebuy or leave when they bust, sometimes take breaks, chat after big pots, and give up if the host ignores their request for 90 seconds.

## Bot detection (server/detection.js)
Detection uses only signals a real platform operator would have. It never looks at whether an account is actually a bot.
- **Timing consistency:** variation in decision time. Scripts act inside a narrow window; humans vary a lot. +30 if variation is under 35%, +12 if under 50%.
- **Very fast average decisions:** +10 if under 1 second.
- **Shared device fingerprint:** several accounts playing from the same machine. +25.
- **Co-seating:** same-device accounts sitting together in 60% or more of their hands (after 30+ hands). +20.
- **Run-it-twice pattern:** always the same choice after a near-identical delay. +10.
- **Marathon sessions:** 250+ hands without a break. +10.

A score of 60 or more is **high** risk and 30 or more is **medium**.

With "Show ground truth" on, the Detection page shows how many bots were caught and how many false alarms there were on human players. That makes it easy to demonstrate that making bot timing look more human weakens one signal, while the device and co-seating signals still catch them.

## The UI (4 views)
1. **Dashboard.** Bots grouped by table, with stats cards that also act as filters. Each bot card shows:
   - on/off switch and its current hole cards, board and pot
   - its last decision and the reason (e.g. "Priced in: 45% vs 33% needed")
   - status: Seated / Sitting out / Awaiting host approval / Queued
   - club chips
   - buttons: Join Room, Manage Chips, Leave / Cancel request, Sit, Sit Out, Reload (reconnect), Run It Once/Twice (active when a decision is pending), chat
   - a Configure panel with every brain setting
2. **Table View.** The table from a player's point of view:
   - oval table with 8 seats, action timer ring, bets, dealer button, board (or two boards when run twice), winners, hand log, table chat
   - the user can sit in an empty seat and play as "You": Fold / Check / Call, raise presets (Min, ½ Pot, Pot/All-in), slider and amount box
   - "Reveal bots" marks the dashboard-controlled seats in red
   - clicking a player shows their stats
3. **Buy-in Requests.** The host screen:
   - Requests and Queue tabs, accept/reject each request, Accept all
   - auto-accept switch and a switch for simulated-player traffic
   - request history
4. **Bot Detection.** A risk table with score bars, VPIP/PFR, fold-to-bet, decision time and its variation, the signals that fired, and expandable details. Also an evaluation panel (bots caught, false alarms) and a reset button.

## How to run
```
npm install
npm start     # http://127.0.0.1:4300
npm test
```

## Current status
Everything works end to end. Bots join through host approval, play full hands against simulated players and the user, and are flagged by detection.

The project went through a multi-part code review: the game engine, the server logic, the bot brain, a hands-on click-through of every UI control, and a frontend code review. Each finding was checked by an independent verifier. All 51 confirmed issues have been fixed, including 3 critical ones:
- leaving while all-in forfeited the pot
- a restart lost chips in the pot and in the queue
- in a rare case, chips disappeared when both blinds left mid-hand

Each fix was re-verified by re-running the original reproductions. The full suite of 66 tests passes.
