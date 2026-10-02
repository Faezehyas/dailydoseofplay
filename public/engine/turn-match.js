// Generic two-player turn-based match for games WITHOUT hidden information
// (Tic Tac Toe, Connect 4, Gomoku, Chess, Checkers, Backgammon...).
// Both peers run the same rules on the same moves, so each one validates the
// other's moves. Who starts, and any luck in a move (dice), comes from
// SharedRandom, so neither side can choose it.
//
// A rules module provides:
//   newState(first)                 -> state with state.turn (0|1) and state.winner (-1 | 0 | 1 | 2 for a draw)
//   applyMove(state, player, move, rng) -> events[]; mutates state; throws RuleError if illegal
//   needsRandom(state, move)        -> optional; true if this move's outcome uses rng (e.g. rolling dice)
// rules.js must be pure: no DOM, timers, network or Math.random (use rng).
//
// Messages (all carry m = match number): chain {tip}, draw {k, v}, move {move}, abort {reason}
import { Emitter } from "./channel.js";
import { SharedRandom, FairPlayError } from "./fair.js";
import { matchRouter } from "./session.js";

export class RuleError extends Error {
  name = "RuleError";
}

const noRandom = () => {
  throw new RuleError("this move may not use randomness");
};

export class TurnMatch extends Emitter {
  constructor({ send, me, rules, m = 1 }) {
    super();
    this.send = (msg) => send({ ...msg, m });
    this.me = me; // 0 = host, 1 = guest
    this.m = m;
    this.rules = rules;
    this.phase = "starting"; // starting -> playing -> over | aborted
    this.state = null;
    this.peerTip = null;
    this.working = false;
    this.srReady = SharedRandom.create();
    this.queue = this.srReady.then((sr) => {
      this.sr = sr;
      this.send({ t: "chain", tip: sr.tip });
    });
  }

  canMove() {
    return this.phase === "playing" && this.state.turn === this.me && !this.working;
  }

  // Validate locally, then send and apply. Illegal moves emit "invalid".
  play(move) {
    return this.#enqueue(async () => {
      if (this.phase !== "playing" || this.state.turn !== this.me) return this.emit("invalid", "not your turn");
      try {
        this.rules.applyMove(structuredClone(this.state), this.me, move, () => 0);
      } catch (err) {
        if (err?.name === "RuleError") return this.emit("invalid", err.message);
        throw err;
      }
      this.send({ t: "move", move });
      await this.#apply(this.me, move);
    });
  }

  receive(msg) {
    if (msg.m !== this.m) return;
    if (msg.t === "draw") {
      this.srReady.then((sr) => sr.receive(msg.k, msg.v));
      return;
    }
    this.#enqueue(() => this.#handle(msg));
  }

  abort(reason) {
    if (this.phase === "aborted") return;
    this.phase = "aborted";
    this.abortReason = reason;
    this.sr?.abort(new FairPlayError(reason));
    this.emit("abort", { reason });
    this.emit("update");
  }

  #enqueue(step) {
    const run = this.queue.then(async () => {
      if (this.phase === "aborted") return;
      this.working = true;
      try {
        await step();
      } catch (err) {
        // Always tell the peer, or it would wait forever.
        this.send({ t: "abort", reason: err.message });
        if (err?.name === "RuleError" || err instanceof FairPlayError) {
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

  async #handle(msg) {
    switch (msg.t) {
      case "chain": {
        if (this.peerTip) throw new RuleError("chain sent twice");
        this.peerTip = msg.tip;
        this.sr.setPeer(msg.tip, this.me);
        const rng = await this.#draw();
        const first = rng() < 0.5 ? 0 : 1;
        this.state = this.rules.newState(first);
        this.phase = "playing";
        this.emit("start", { first });
        return;
      }
      case "move": {
        if (this.phase !== "playing") throw new RuleError("move outside play");
        if (this.state.turn !== 1 - this.me) throw new RuleError("move out of turn");
        await this.#apply(1 - this.me, msg.move);
        return;
      }
      case "abort":
        this.abort(`Opponent stopped the match: ${String(msg.reason).slice(0, 80)}`);
        return;
      default:
        throw new RuleError(`unknown message ${String(msg.t).slice(0, 20)}`);
    }
  }

  async #apply(player, move) {
    const rng = this.rules.needsRandom?.(this.state, move) ? await this.#draw() : noRandom;
    const events = this.rules.applyMove(this.state, player, move, rng);
    this.emit("events", { player, move, events });
    if (this.state.winner !== -1) {
      this.phase = "over";
      this.emit("over", { winner: this.state.winner });
    }
  }
}

// Drive a robot over a session for a TurnMatch game.
// choose(state, me, rng) returns a legal move.
export function startTurnRobot(session, { rules, choose, delay = 600, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!destroyed && match.canMove()) match.play(choose(match.state, match.me, rng));
    }, delay);
  }
  function newMatch(m) {
    match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, rules, m });
    match.on("update", schedule);
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
