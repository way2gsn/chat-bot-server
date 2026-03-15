// lib/users.js — Persistent user profiles
// Stores customer info so they don't have to re-enter address every time

const users = new Map(); // phone → profile

function getUser(phone) {
  return users.get(phone) || null;
}

function saveUser(phone, updates) {
  const existing = users.get(phone) || { phone, createdAt: new Date().toISOString() };
  const updated  = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  users.set(phone, updated);
  return updated;
}

function getUserAddress(phone) {
  return users.get(phone)?.address || null;
}

function getUserName(phone) {
  return users.get(phone)?.name || null;
}

function getAllUsers() {
  return Array.from(users.values());
}

module.exports = { getUser, saveUser, getUserAddress, getUserName, getAllUsers };