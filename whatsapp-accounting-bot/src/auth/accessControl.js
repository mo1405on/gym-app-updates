function normalizeNumber(jidOrNumber) {
  return String(jidOrNumber || '')
    .split('@')[0]
    .replace(/^\+/, '')
    .replace(/:.*/, '');
}

function getRole(config, jidOrNumber) {
  const number = normalizeNumber(jidOrNumber);
  if (config.ownerNumbers.includes(number)) return 'owner';
  if (config.accountantNumbers.includes(number)) return 'accountant';
  return null;
}

const PERMISSIONS = {
  owner: new Set(['post', 'void', 'addAccount', 'report', 'accounts', 'statement']),
  accountant: new Set(['post', 'report', 'accounts', 'statement']),
};

function can(role, action) {
  if (!role) return false;
  return PERMISSIONS[role]?.has(action) ?? false;
}

module.exports = { normalizeNumber, getRole, can };
