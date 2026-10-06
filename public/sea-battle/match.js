// One player's side of a Sea Battle match. DOM-free and transport-agnostic:
// give it send(msg) and feed it the peer's messages with receive(msg).
//
// Fair play without a referee:
//   * each side keeps its fleet private and publishes only a commitment
//     (sha256 of fleet + salt) when it presses Ready;
//   * the defender answers every shot itself (hit/miss/sunk);
//   * at game over both sides reveal fleet + salt, and each side audits every
//     answer it received against the revealed fleet;
//   * every random outcome (who starts, gift squares and types, missile rain
//     squares) comes from SharedRandom, so both peers agree on it and neither
//     side can pick or predict it.
//
// Messages (all carry m = match number, so rematches never mix):
//   ready  { commit, chain }      fleet commitment + hash-chain tip
//   draw   { k, v }               SharedRandom reveal for draw k
//   fire   { w, at, ms, dir }     weapon + aimed square (no `at` for rain) + time spent
//                                 (+ "row" | "col" for the carpet bomb)
//   result { hits, sunk }         defender's answer: 0/1 per fired square, newly sunk ships
//   timeout {}                    the sender's own clock ran out: they lose
//   reveal { fleet, salt }        after game over
//   abort  { reason }             protocol violation detected
//
// For games without hidden information use engine/turn-match.js instead.
import { Emitter } from "../engine/channel.js";
import { SharedRandom, commit, verifyCommit, FairPlayError } from "../engine/fair.js";
import {
  answerShots,
  applyFire,
  applyTimeout,
  auditBoard,
  checkFire,
  giftsDue,
  newMatchState,
  normalizeConfig,
  normalizeFleet,
  other,
  rainCells,
  spawnGifts,
  validateFleet,
  RuleError,
} from "./rules.js";

export class SeaBattleMatch extends Emitter {
  // config: the room's time limits (see normalizeConfig); none means no clocks.
  constructor({ send, me, fleet, m = 1, config = null }) {
    super();
    this.config = config ? normalizeConfig(config) : undefined;
    this.send = (msg) => send({ ...msg, m });
    this.me = me; // 0 = host, 1 = guest
    this.m = m;
    this.fleet = fleet;
    this.phase = "placing"; // placing -> playing -> over | aborted
    this.state = null; // public state, identical on both peers
    this.locked = false; // fleet frozen (set synchronously by ready())
    this.myReady = false; // commitment sent
    this.peer = null; // { commit, chain }
    this.pending = null; // my shot awaiting an answer
    this.working = false;
    this.salt = null;
    this.peerReveal = null;
    this.verdict = null; // { ok, reason } after the audit
    this.srReady = SharedRandom.create();
    this.queue = this.srReady.then((sr) => {
      this.sr = sr;
    });
  }

  // ---------- public API ----------
  setFleet(fleet) {
    if (this.locked) throw new RuleError("fleet already locked");
    this.fleet = fleet;
  }

  // Locks a private copy of the fleet synchronously, so later UI edits can't
  // make the committed fleet differ from the one that answers shots.
  ready() {
    if (this.locked) return this.queue;
    const v = validateFleet(this.fleet);
    if (!v.ok) {
      this.emit("invalid", v.reason);
      return this.queue;
    }
    this.locked = true;
    this.fleet = normalizeFleet(this.fleet);
    this.emit("update");
    return this.#enqueue(async () => {
      const { commitment, salt } = await commit(this.fleet);
      this.salt = salt;
      this.myReady = true;
      this.send({ t: "ready", commit: commitment, chain: this.sr.tip });
      this.emit("update");
      if (this.peer) await this.#start();
    });
  }

  canFire() {
    return this.phase === "playing" && this.state.turn === this.me && !this.pending && !this.working;
  }

  // ms: time spent on this shot (required when the room has clocks).
  // dir: the carpet bomb's "row" or "col".
  fire(weapon, target, ms, dir) {
    return this.#enqueue(async () => {
      if (!this.canFireQueued()) return;
      let cells;
      try {
        cells = checkFire(this.state, this.me, weapon, target, ms, dir);
      } catch (err) {
        if (err instanceof RuleError) return this.emit("invalid", err.message);
        throw err;
      }
      if (weapon !== "carpet") dir = undefined;
      this.pending = { weapon, target, cells, ms };
      this.send({ t: "fire", w: weapon, at: weapon === "rain" ? undefined : target, ms, dir });
      if (weapon === "rain") {
        this.pending.cells = rainCells(this.state.boards[other(this.me)], await this.#draw());
      }
      this.emit("fired", { by: this.me, weapon, target, dir, cells: this.pending.cells });
    });
  }

  canFireQueued() {
    return this.phase === "playing" && this.state.turn === this.me && !this.pending;
  }

  // My clock ran out on my turn: I lose.
  timeout() {
    return this.#enqueue(async () => {
      if (!this.canFireQueued() || !this.state.clocks) return;
      applyTimeout(this.state, this.me);
      this.send({ t: "timeout" });
      await this.#finish();
    });
  }

  receive(msg, from = 1 - this.me) {
    if (msg.m !== this.m) return;
    // draw and abort are handled out of band: a queued step may be waiting on a draw.
    if (msg.t === "draw") {
      this.srReady.then((sr) => sr.receive(msg.k, msg.v, from));
      return;
    }
    if (msg.t === "abort") return this.abort(`Opponent stopped the match: ${String(msg.reason).slice(0, 80)}`);
    this.#enqueue(() => this.#handle(msg));
  }

  abort(reason) {
    if (this.phase === "aborted") return;
    this.phase = "aborted";
    this.sr?.abort(new FairPlayError(reason));
    this.emit("abort", { reason });
    this.emit("update");
  }

  // ---------- internals ----------
  #enqueue(step) {
    const run = this.queue.then(async () => {
      if (this.phase === "aborted") return;
      this.working = true;
      try {
        await step();
      } catch (err) {
        // Always tell the peer, or it would wait forever.
        this.send({ t: "abort", reason: err.message });
        if (err instanceof RuleError || err instanceof FairPlayError) {
          this.abort(`Opponent broke the rules: ${err.message}`);
        } else {
          console.error(err);
          this.abort(`Unexpected error: ${err.message}`);
        }
      } finally {
        this.working = false;
        this.emit("update");
      }
    });
    this.queue = run;
    return run;
  }

  #draw() {
    return this.sr.draw((k, v) => this.send({ t: "draw", k, v }));
  }

  async #start() {
    const rng = await this.#draw();
    const first = rng() < 0.5 ? 0 : 1;
    this.state = newMatchState(first, this.config);
    this.phase = "playing";
    this.emit("start", { first });
  }

  async #handle(msg) {
    switch (msg.t) {
      case "ready": {
        if (this.peer) throw new RuleError("ready sent twice");
        if (typeof msg.commit !== "string" || msg.commit.length !== 64) throw new RuleError("bad commitment");
        this.peer = { commit: msg.commit, chain: msg.chain };
        this.sr.setPeer(msg.chain, this.me);
        this.emit("peer-ready");
        if (this.myReady) await this.#start();
        return;
      }
      case "fire": {
        if (this.phase !== "playing") throw new RuleError("fire outside play");
        const shooter = other(this.me);
        const weapon = String(msg.w);
        let cells = checkFire(this.state, shooter, weapon, msg.at, msg.ms, msg.dir);
        if (weapon === "rain") cells = rainCells(this.state.boards[this.me], await this.#draw());
        this.emit("fired", { by: shooter, weapon, target: msg.at, dir: msg.dir, cells });
        const { hits, sunk } = answerShots(this.fleet, this.state.boards[this.me], cells);
        this.send({ t: "result", hits, sunk });
        await this.#advance(shooter, weapon, cells, hits, sunk, { ms: msg.ms, target: msg.at });
        return;
      }
      case "result": {
        if (!this.pending) throw new RuleError("unexpected result");
        const { weapon, cells, ms, target } = this.pending;
        this.pending = null;
        await this.#advance(this.me, weapon, cells, msg.hits, msg.sunk, { ms, target });
        return;
      }
      case "timeout": {
        if (this.phase !== "playing") throw new RuleError("timeout outside play");
        applyTimeout(this.state, other(this.me));
        await this.#finish();
        return;
      }
      case "reveal": {
        this.peerReveal = { fleet: msg.fleet, salt: msg.salt };
        if (this.phase === "over") await this.#audit();
        return;
      }
      default:
        throw new RuleError(`unknown message ${String(msg.t).slice(0, 20)}`);
    }
  }

  async #advance(shooter, weapon, cells, hits, sunk, shot) {
    const events = applyFire(this.state, shooter, weapon, cells, hits, sunk, shot);
    this.emit("events", { shooter, weapon, events });
    if (this.state.winner !== -1) return this.#finish();
    if (giftsDue(this.state)) {
      const spawned = spawnGifts(this.state, await this.#draw());
      if (spawned.length) this.emit("gifts", spawned);
    }
  }

  // Game over (fleet sunk or clock out): reveal my fleet and audit theirs.
  async #finish() {
    this.phase = "over";
    this.send({ t: "reveal", fleet: this.fleet, salt: this.salt });
    this.emit("over", { winner: this.state.winner, reason: this.state.reason });
    if (this.peerReveal) await this.#audit();
  }

  async #audit() {
    if (this.verdict) return;
    const { fleet, salt } = this.peerReveal;
    let verdict;
    if (!(await verifyCommit(this.peer.commit, fleet, salt))) {
      verdict = { ok: false, reason: "their revealed fleet doesn't match the one they locked in" };
    } else {
      try {
        verdict = auditBoard(this.state.boards[other(this.me)], fleet);
      } catch {
        verdict = { ok: false, reason: "their revealed fleet is malformed" };
      }
    }
    this.verdict = verdict;
    this.peerFleet = Array.isArray(fleet) ? fleet : null;
    this.emit("verified", verdict);
  }
}
