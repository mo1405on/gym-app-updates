const PENDING_TTL_MS = 5 * 60 * 1000;

const pending = new Map();

function setPending(chatId, payload) {
  pending.set(chatId, { payload, expiresAt: Date.now() + PENDING_TTL_MS });
}

function getPending(chatId) {
  const entry = pending.get(chatId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pending.delete(chatId);
    return null;
  }
  return entry.payload;
}

function clearPending(chatId) {
  pending.delete(chatId);
}

module.exports = { setPending, getPending, clearPending };
