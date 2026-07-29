import db from './db.js';

export function jidToPhone(jid) {
  return jid.split('@')[0].split(':')[0];
}

export function checkAccess(jid) {
  const user = db.isAllowed(jid);
  if (!user) return { allowed: false, role: null };
  return { allowed: true, role: user.role, name: user.name };
}

export function isAdmin(jid) {
  const user = db.isAllowed(jid);
  return !!user && user.role === 'admin';
}

export function seedAdminsFromEnv() {
  const raw = process.env.ADMIN_NUMBERS || '';
  const numbers = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const jids = numbers.map((n) => `${n}@s.whatsapp.net`);
  db.seedAdmins(jids);
  return jids;
}

export default { jidToPhone, checkAccess, isAdmin, seedAdminsFromEnv };
