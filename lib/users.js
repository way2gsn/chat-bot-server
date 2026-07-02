// lib/users.js — Persistent user profiles using Supabase (PostgreSQL)

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  },
  realtime: {
    transport: ws
  }
});

function normalizePhone(phone) {
  if (!phone) return "";
  let cleaned = String(phone).replace(/\D/g, "");
  if (cleaned.length === 10) {
    cleaned = "91" + cleaned;
  }
  return cleaned;
}

async function getUser(phone) {
  const normPhone = normalizePhone(phone);
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', normPhone)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
    throw new Error(error.message);
  }
  
  if (!data) return null;
  return {
    phone: data.phone,
    name: data.name,
    address: data.address,
    lang: data.lang,
    customerType: data.customer_type,
    createdAt: data.created_at,
    updatedAt: data.updated_at
  };
}

async function saveUser(phone, updates) {
  const normPhone = normalizePhone(phone);
  const dbUpdates = {
    updated_at: new Date().toISOString()
  };
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.address !== undefined) dbUpdates.address = updates.address;
  if (updates.lang !== undefined) dbUpdates.lang = updates.lang;
  if (updates.customerType !== undefined) dbUpdates.customer_type = updates.customerType;

  // Check if user exists
  const existing = await getUser(normPhone);
  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update(dbUpdates)
      .eq('phone', normPhone)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        phone: normPhone,
        ...dbUpdates,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}

async function getUserAddress(phone) {
  return (await getUser(phone))?.address || null;
}

async function getUserName(phone) {
  return (await getUser(phone))?.name || null;
}

async function getAllUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data.map(u => ({
    phone: u.phone,
    name: u.name,
    address: u.address,
    lang: u.lang,
    customerType: u.customer_type,
    createdAt: u.created_at,
    updatedAt: u.updated_at
  }));
}

async function importUsers(usersList) {
  const toUpsert = usersList.map(u => {
    const normPhone = normalizePhone(u.phone);
    const dbUpdates = {
      phone: normPhone,
      updated_at: new Date().toISOString()
    };
    if (u.name !== undefined) dbUpdates.name = u.name;
    if (u.address !== undefined) dbUpdates.address = u.address;
    if (u.lang !== undefined) dbUpdates.lang = u.lang;
    if (u.customerType !== undefined) dbUpdates.customer_type = u.customerType || 'retail';
    dbUpdates.created_at = u.createdAt || new Date().toISOString();
    return dbUpdates;
  }).filter(u => u.phone);

  if (toUpsert.length === 0) return [];

  const { data, error } = await supabase
    .from('users')
    .upsert(toUpsert, { onConflict: 'phone' })
    .select();

  if (error) throw new Error(error.message);
  return data.map(u => ({
    phone: u.phone,
    name: u.name,
    address: u.address,
    lang: u.lang,
    customerType: u.customer_type,
    createdAt: u.created_at,
    updatedAt: u.updated_at
  }));
}

async function deleteUser(phone) {
  const normPhone = normalizePhone(phone);
  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('phone', normPhone);

  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getUser, saveUser, getUserAddress, getUserName, getAllUsers, importUsers, deleteUser };
