// One WebRTC DataChannel between two browsers, negotiated through RoomClient.
// There is no TURN server, so some network pairs cannot connect; we detect
// that (ICE failure or timeout) and report it instead of hanging.
import { Emitter } from "./channel.js";

export const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
];
const CONNECT_TIMEOUT_MS = 20_000;
const DISCONNECTED_GRACE_MS = 10_000;

export class PeerChannel extends Emitter {
  constructor({ rooms, peerId, initiator, timeoutMs = CONNECT_TIMEOUT_MS }) {
    super();
    this.rooms = rooms;
    this.peerId = peerId;
    this.open = false;
    this.closed = false;
    this.dc = null;
    this.remoteSet = false;
    this.queuedCandidates = [];
    this.graceTimer = null;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) rooms.signal(peerId, { candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.#onState(pc.connectionState);
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") this.#fail("ice_failed");
    };
    pc.ondatachannel = (e) => this.#attach(e.channel);
    this.offSignal = rooms.on("signal", ({ from, data }) => {
      if (from === peerId) this.#onSignal(data).catch((err) => this.#fail("negotiation_failed", err));
    });
    this.timer = setTimeout(() => this.#fail("timeout"), timeoutMs);

    if (initiator) {
      this.#attach(pc.createDataChannel("game", { ordered: true }));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => rooms.signal(peerId, { sdp: pc.localDescription.toJSON() }))
        .catch((err) => this.#fail("negotiation_failed", err));
    }
  }

  async #onSignal(data) {
    const pc = this.pc;
    if (this.closed) return;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      this.remoteSet = true;
      for (const c of this.queuedCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === "offer") {
        await pc.setLocalDescription(await pc.createAnswer());
        this.rooms.signal(this.peerId, { sdp: pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      if (!this.remoteSet) this.queuedCandidates.push(data.candidate);
      else await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  #attach(dc) {
    this.dc = dc;
    dc.onopen = () => {
      clearTimeout(this.timer);
      this.open = true;
      this.emit("open");
    };
    dc.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.emit("message", msg);
    };
    dc.onclose = () => this.#shutdown();
  }

  #onState(state) {
    if (state === "failed") return this.#fail("ice_failed");
    if (state === "closed") return this.#shutdown();
    if (state === "disconnected") {
      clearTimeout(this.graceTimer);
      this.graceTimer = setTimeout(() => {
        if (this.pc.connectionState === "disconnected") this.#shutdown();
      }, DISCONNECTED_GRACE_MS);
    } else if (state === "connected") {
      clearTimeout(this.graceTimer);
    }
  }

  #fail(reason, err) {
    if (this.closed) return;
    if (err) console.warn("peer", reason, err);
    if (this.open) return this.#shutdown();
    this.closed = true;
    this.#cleanup();
    this.emit("failed", reason);
  }

  #shutdown() {
    if (this.closed) return;
    this.closed = true;
    const wasOpen = this.open;
    this.open = false;
    this.#cleanup();
    if (wasOpen) this.emit("close");
    else this.emit("failed", "closed_before_open");
  }

  #cleanup() {
    clearTimeout(this.timer);
    clearTimeout(this.graceTimer);
    this.offSignal();
    try {
      this.dc?.close();
      this.pc.close();
    } catch {}
  }

  send(msg) {
    if (!this.open || this.dc?.readyState !== "open") return false;
    this.dc.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.#shutdown();
  }
}
