const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
const DIGITS: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((c, i) => (DIGITS[c] = String(i)));
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((c, i) => (DIGITS[c] = String(i)));

/** Normalises Arabic/English text for search: strips tashkeel, unifies alef/yeh/teh-marbuta, maps Arabic digits, lowercases. */
export function normalizeSearch(input: string): string {
  return input
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const buildSearchText = (...parts: Array<string | null | undefined>): string =>
  normalizeSearch(parts.filter(Boolean).join(' '));
