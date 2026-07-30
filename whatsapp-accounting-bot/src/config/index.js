require('dotenv').config();
const path = require('path');

function parseNumberList(value) {
  return String(value || '')
    .split(',')
    .map((n) => n.trim().replace(/^\+/, ''))
    .filter(Boolean);
}

const config = {
  ownerNumbers: parseNumberList(process.env.OWNER_NUMBERS),
  accountantNumbers: parseNumberList(process.env.ACCOUNTANT_NUMBERS),
  currency: process.env.CURRENCY || 'ريال',
  businessName: process.env.BUSINESS_NAME || '',
  confirmAboveAmount: process.env.CONFIRM_ABOVE_AMOUNT ? Number(process.env.CONFIRM_ABOVE_AMOUNT) : null,
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/accounting.db'),
  authDir: path.resolve(process.cwd(), process.env.AUTH_DIR || './data/auth'),
};

module.exports = config;
