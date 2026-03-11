// lib/session.js — In-memory session store
// For production scale: replace with Upstash Redis (free tier available)

const store = new Map();
const TTL_MS = 30 * 60 * 1000; // 30 minute session timeout

function getSession(userId) {
  const existing = store.get(userId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing;
  }
  const session = {
    userId,
    lang:         null,        // null = new customer, set after language selection
    state:        "new",       // new | choosing_lang | choosing_type | browsing | ordering | awaiting_payment
    customerType: null,        // null = not chosen, "retail" or "wholesale"
    cart:         [],
    messages:     [],
    lastActive:   Date.now(),
  };
  store.set(userId, session);
  return session;
}

function saveSession(userId, updates) {
  const session = getSession(userId);
  Object.assign(session, updates, { lastActive: Date.now() });
  store.set(userId, session);
}

function clearSession(userId) {
  store.delete(userId);
}

// Clean up expired sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of store.entries()) {
    if (now - session.lastActive > TTL_MS) {
      store.delete(id);
    }
  }
}, 15 * 60 * 1000);

module.exports = { getSession, saveSession, clearSession };