// STUB — no live on-chain wiring. Do not call in production paths.
//
// Interface stubs only. Every function returns {wired: false, reason}
// naming a specific blocker. No function performs a wallet call, a
// network request, or a settlement call. No addresses, no endpoints,
// no chain identifiers, no token standards, no gas figures, and no
// payout mechanics appear in this file. This file defines an interface
// shape only; importing it has no on-chain effect.

function notWired(reason) {
  return { wired: false, reason: reason };
}

const Onchain = {
  connectWallet: function connectWallet() {
    return notWired(
      "Not wired: wallet address for operations-cut/mint is TBD " +
      "(Adrian provides); chain label pending NAR-7 confirmation; " +
      "no wallet provider selected."
    );
  },

  disconnectWallet: function disconnectWallet() {
    return notWired(
      "Not wired: no wallet session exists; connectWallet is not wired."
    );
  },

  getStatus: function getStatus() {
    return notWired(
      "Not wired: no wallet session exists; no on-chain state is available."
    );
  },

  mintFighter: function mintFighter() {
    return notWired(
      "Not wired: Genesis mint design BLOCKED (Phase 3 + legal; " +
      "known-item direct-sale redesign required); wallet address TBD; B2-4 OPEN."
    );
  },

  listItem: function listItem() {
    return notWired(
      "Not wired: marketplace Play-build shape unresolved " +
      "(compliance plan section 2.3c); B2-4 OPEN; " +
      "marketplace fee figure UNCONFIRMED (NAR-3)."
    );
  },

  buyItem: function buyItem() {
    return notWired(
      "Not wired: marketplace Play-build shape unresolved " +
      "(section 2.3c); B2-4 OPEN; settlement not implemented in this phase."
    );
  },

  settleTrade: function settleTrade() {
    return notWired(
      "Not wired: settlement not implemented in this phase; " +
      "marketplace shape BLOCKER (section 2.3c); B2-4 OPEN."
    );
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Onchain: Onchain };
}
