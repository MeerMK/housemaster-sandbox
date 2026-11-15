// Bot detection — what a poker platform's security team could run on its own data.
// It only uses signals a real operator has: action timing, device fingerprints, who sits with whom,
// run-it-twice behaviour and session length. It never peeks at the "kind" of an account.

const MIN_DECISIONS = 20;

export class Detection {
  constructor() {
    this.players = new Map();   // accountId -> stats
    this.partners = new Map();  // accountId -> Map(otherId -> hands dealt together)
    this.rows = null;           // cached report, rebuilt at most once a second while stats change
    this.stale = false;
    this.reportAt = 0;
  }

  p(id, name, fingerprint) {
    let s = this.players.get(id);
    if (!s) {
      s = { id, name, fingerprint, hands: 0, vpip: 0, pfr: 0, n: 0, mean: 0, m2: 0, fastest: Infinity,
        facedBet: 0, foldedToBet: 0, bets: 0, calls: 0, ritAnswers: { once: 0, twice: 0 }, ritTimes: [],
        streak: 0, maxStreak: 0, lastHandAt: 0 };
      this.players.set(id, s);
      this.partners.set(id, new Map());
      this.stale = true;
    }
    if (name && name !== s.name) s.name = name, this.stale = true;
    if (fingerprint && fingerprint !== s.fingerprint) s.fingerprint = fingerprint, this.stale = true;
    return s;
  }

  // Drop a player who is gone for good, with every pair that mentions them.
  forget(id) {
    for (const other of this.partners.get(id)?.keys() || []) this.partners.get(other)?.delete(id);
    this.partners.delete(id);
    if (this.players.delete(id)) this.stale = true;
  }

  onAction({ accountId, ms, street, type, legal }) {
    const s = this.p(accountId);
    // Welford running mean / variance of decision time (seconds).
    const x = ms / 1000;
    s.n++;
    const d = x - s.mean;
    s.mean += d / s.n;
    s.m2 += d * (x - s.mean);
    s.fastest = Math.min(s.fastest, x);
    if (street > 0 && legal.toCall > 0) { s.facedBet++; if (type === 'fold') s.foldedToBet++; }
    if (type === 'raise' || type === 'bet') s.bets++;
    if (type === 'call') s.calls++;
    this.stale = true;
  }

  onRit(accountId, choice, ms) {
    const s = this.p(accountId);
    s.ritAnswers[choice]++;
    s.ritTimes.push(ms / 1000);
    if (s.ritTimes.length > 30) s.ritTimes.shift();
    this.stale = true;
  }

  onHandEnd(result, now) {
    const ids = result.players.map(p => p.accountId);
    for (const p of result.players) {
      const s = this.p(p.accountId);
      s.hands++;
      if (p.vpip) s.vpip++;
      if (p.pfr) s.pfr++;
      // A "session streak" breaks if the player skipped more than 2 minutes between hands.
      s.streak = now - s.lastHandAt < 120000 ? s.streak + 1 : 1;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      s.lastHandAt = now;
    }
    for (const a of ids) {
      const m = this.partners.get(a);
      for (const b of ids) if (b !== a) m.set(b, (m.get(b) || 0) + 1);
    }
    this.stale = true;
  }

  // Called on every broadcast, so the scoring itself runs at most once a second.
  report(seatedIds = new Set(), now = Date.now()) {
    if (!this.rows || (this.stale && now - this.reportAt >= 1000)) {
      this.rows = this.score();
      this.stale = false;
      this.reportAt = now;
    }
    return this.rows.map(r => ({ ...r, seated: seatedIds.has(r.id) }));
  }

  score() {
    const rows = [];
    const byFp = new Map();
    for (const s of this.players.values()) {
      if (!byFp.has(s.fingerprint)) byFp.set(s.fingerprint, []);
      byFp.get(s.fingerprint).push(s);
    }

    for (const s of this.players.values()) {
      const flags = [];
      let score = 0;
      const sd = s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 0;
      const cv = s.mean ? sd / s.mean : 0;

      if (s.n >= MIN_DECISIONS) {
        if (cv < 0.35) { score += 30; flags.push({ sev: 'high', text: `Robotic timing — decisions vary only ${Math.round(cv * 100)}% (humans: 60%+)` }); }
        else if (cv < 0.5) { score += 12; flags.push({ sev: 'med', text: `Unusually steady timing (${Math.round(cv * 100)}% variation)` }); }
        if (s.mean < 1.0) { score += 10; flags.push({ sev: 'med', text: `Acts very fast (avg ${s.mean.toFixed(1)}s)` }); }
      }

      const sameDevice = (byFp.get(s.fingerprint) || []).filter(o => o !== s);
      if (sameDevice.length) {
        score += 25;
        flags.push({ sev: 'high', text: `Same device as ${sameDevice.map(o => o.name).join(', ')}` });
      }

      const partners = [];
      for (const [id, n] of this.partners.get(s.id) || []) {
        const other = this.players.get(id);
        if (!other) continue;
        const base = Math.min(s.hands, other.hands);
        if (base >= 30 && n / base >= 0.6) partners.push({ name: other.name, pct: Math.round((100 * n) / base), device: other.fingerprint === s.fingerprint });
      }
      const suspicious = partners.filter(p => p.device);
      if (suspicious.length) {
        score += 20;
        flags.push({ sev: 'high', text: `Sits with same-device accounts: ${suspicious.map(p => `${p.name} (${p.pct}% of hands)`).join(', ')}` });
      }

      const rit = s.ritAnswers.once + s.ritAnswers.twice;
      if (rit >= 4) {
        const same = Math.max(s.ritAnswers.once, s.ritAnswers.twice) / rit;
        const m = s.ritTimes.reduce((a, b) => a + b, 0) / s.ritTimes.length;
        const v = Math.sqrt(s.ritTimes.reduce((a, b) => a + (b - m) ** 2, 0) / s.ritTimes.length);
        if (same === 1 && v / m < 0.3) { score += 10; flags.push({ sev: 'med', text: `Always picks "run it ${s.ritAnswers.twice ? 'twice' : 'once'}" after ${m.toFixed(1)}s` }); }
      }

      if (s.maxStreak >= 250) { score += 10; flags.push({ sev: 'low', text: `Marathon session: ${s.maxStreak} hands without a break` }); }

      rows.push({
        id: s.id, name: s.name, fingerprint: s.fingerprint,
        hands: s.hands, decisions: s.n,
        vpip: s.hands ? s.vpip / s.hands : 0, pfr: s.hands ? s.pfr / s.hands : 0,
        foldToBet: s.facedBet ? s.foldedToBet / s.facedBet : null,
        af: s.calls ? s.bets / s.calls : s.bets,
        avgTime: s.mean, timeCv: cv, fastest: Number.isFinite(s.fastest) ? s.fastest : null,
        score: Math.min(100, score), level: score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low', flags,
      });
    }
    rows.sort((a, b) => b.score - a.score || b.hands - a.hands);
    return rows;
  }

  // What an opponent-modelling bot can learn from public play (fold-to-bet rate).
  foldToBet(ids) {
    let a = 0, b = 0;
    for (const id of ids) { const s = this.players.get(id); if (s) { a += s.foldedToBet; b += s.facedBet; } }
    return { foldToBet: b ? a / b : 0.35, samples: b };
  }

  // Clear statistics but keep who is who (names and device fingerprints).
  reset(keepIds) {
    const known = [...this.players.values()].filter(s => !keepIds || keepIds.has(s.id));
    this.players.clear();
    this.partners.clear();
    for (const s of known) this.p(s.id, s.name, s.fingerprint);
    this.rows = null;
  }
}
