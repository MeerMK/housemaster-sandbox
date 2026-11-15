# HouseMaster Sandbox

A self-contained pot-limit Omaha sandbox for a final-year project on **how bots slip into online poker games, and how a platform could catch them**.

Everything runs on your own machine: the game server, the bots, the simulated human players and the host screens. It never connects to a real poker site or app, and no real money is involved.

## Run it

```bash
npm install
npm start          # http://127.0.0.1:4300
npm test           # engine, evaluator, brain, club/server and UI tests (66)
```

State (bots, their settings, club chips, tables) is saved to `data/state.json`. Delete that file to start fresh.

## What's in it

| Part | File | What it does |
|---|---|---|
| Game engine | `server/table.js` | PLO4 cash table: blinds, pot-limit betting, min-raise / incomplete all-in rules, side pots, rake (6.9%, cap 7.99, no flop no drop), run it twice, action timer, sit out / leave / top-up. All money in integer cents. |
| Hand evaluator | `server/evaluator.js` | 5-card ranking plus the Omaha rule: exactly two hole cards and three board cards. |
| Equity | `server/equity.js` | Monte Carlo equity with optional opponent-range filtering. |
| Brain | `server/brain.js` | How bots and simulated players decide. There are two independent settings, skill and style. |
| Detection | `server/detection.js` | Flags bot-like accounts using only signals a real operator has. |
| Club | `server/world.js` | Accounts, buy-in requests and host approval, the seat queue, bot and simulated-player controllers, chat, persistence. |
| Server | `server/index.js` | Static UI and a WebSocket API. Every UI button is one command. |
| UI | `public/` | Dashboard, Table View (you can play), Buy-in Requests (host screen), Bot Detection. |

### The brain

**Skill** sets how well a player reads the game:

- **Professional**: reads opponent ranges from their betting, uses accurate equity, pot odds, position and stack-to-pot ratio, and semi-bluffs. It also models opponents: it bluffs players who fold too much and stops bluffing calling stations. It never tilts.
- **Medium**: fair equity reads and some position awareness, but predictable bet sizes and it can tilt.
- **Fish**: plays by feel. It ignores pot odds, overvalues any pair or draw, uses random bet sizes and chases.

**Style** sets what a player likes to do: Nit, SMC (standard), Aggro, Station, or Fold.

Each bot also has a bluff-frequency slider, a think-time range, a run-it-twice preference and an auto top-up switch.

In self-play with stacks reset to 100bb every hand, Professional beats Medium and Fish loses heavily in every style.

### Detection signals

- **Timing.** Humans vary a lot; scripts act inside a narrow window.
- **Same device.** Several accounts play from one machine.
- **Co-seating.** Same-device accounts keep ending up at the same table.
- **Run-it-twice pattern.** The same choice every time, after the same delay.
- **Marathon sessions.** Hundreds of hands without a break.

Turn on **Show ground truth** on the Bot Detection page to see how many bots were caught and how many false alarms there were.

## Demo script

1. **Dashboard.** Press **Join Room** on a few bots and pick the same table. Each one sends a buy-in request.
2. **Buy-in Requests.** Approve them. To the host they look like anyone else.
3. **Table View.** Click an empty seat to sit down as *You*, approve yourself, and play a few hands. Then turn on **Reveal bots**: several of the "players" around you are run by one person.
4. **Bot Detection.** After 30–50 hands the bots show up as high-risk (shared device, co-seating, robotic timing). The simulated humans stay low.
5. Increase a bot's think-time range and reset the stats. The timing signal weakens, but the device and co-seating signals still catch it.
