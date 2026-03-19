// lib/users.js — Persistent user profiles using JSONBin.io when configured
// Stores customer info so they don't have to re-enter details every time

const https = require("https");

const memUsers = new Map(); // phone → profile

const JSONBIN_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_USERS_BIN = process.env.JSONBIN_USERS_BIN_ID;

function jsonbinRequest(method, path, body = null) {
  return new Promise((resolve) => {
    if (!JSONBIN_KEY || !JSONBIN_USERS_BIN) { resolve(null); return; }
    const options = {
      hostname: "api.jsonbin.io",
      path,
      method,
      headers: {
        "X-Master-Key": JSONBIN_KEY,
        "Content-Type": "application/json",
      },
    };
    const req = https.request(options, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadUsersMap() {
  if (!JSONBIN_KEY || !JSONBIN_USERS_BIN) return new Map(memUsers);
  const res = await jsonbinRequest("GET", `/v3/b/${JSONBIN_USERS_BIN}/latest`);
  const users = Array.isArray(res?.record?.users) ? res.record.users : [];
  return new Map(users.map(user => [user.phone, user]));
}

async function saveUsersMap(usersMap) {
  if (!JSONBIN_KEY || !JSONBIN_USERS_BIN) {
    memUsers.clear();
    for (const [phone, user] of usersMap.entries()) memUsers.set(phone, user);
    return;
  }
  await jsonbinRequest("PUT", `/v3/b/${JSONBIN_USERS_BIN}`, {
    users: Array.from(usersMap.values()),
  });
}

async function getUser(phone) {
  const users = await loadUsersMap();
  return users.get(phone) || null;
}

async function saveUser(phone, updates) {
  const users = await loadUsersMap();
  const existing = users.get(phone) || { phone, createdAt: new Date().toISOString() };
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  users.set(phone, updated);
  await saveUsersMap(users);
  return updated;
}

async function getUserAddress(phone) {
  return (await getUser(phone))?.address || null;
}

async function getUserName(phone) {
  return (await getUser(phone))?.name || null;
}

async function getAllUsers() {
  return Array.from((await loadUsersMap()).values());
}

module.exports = { getUser, saveUser, getUserAddress, getUserName, getAllUsers };
