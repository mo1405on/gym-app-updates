function normalizeArabic(text) {
  return String(text)
    .trim()
    .replace(/[ً-ْ]/g, '') // تشكيل
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

module.exports = { normalizeArabic };
