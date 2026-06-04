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

async function getUser(phone) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
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
  const dbUpdates = {
    updated_at: new Date().toISOString()
  };
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.address !== undefined) dbUpdates.address = updates.address;
  if (updates.lang !== undefined) dbUpdates.lang = updates.lang;
  if (updates.customerType !== undefined) dbUpdates.customer_type = updates.customerType;

  // Check if user exists
  const existing = await getUser(phone);
  if (existing) {
    const { data, error } = await supabase
      .from('users')
      .update(dbUpdates)
      .eq('phone', phone)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  } else {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        phone,
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

module.exports = { getUser, saveUser, getUserAddress, getUserName, getAllUsers };
