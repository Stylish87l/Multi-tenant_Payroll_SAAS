// src/utils/formatCurrency.js
/**
 * Memoized currency formatter for Ghana Cedi and other currencies.
 * Keeps the same API as your original snippet while improving robustness,
 * handling BigInt, NaN, missing Intl, negative values, and filename-safe caching.
 */

const formatters = new Map();

const makeKey = (locale, currency) => `${String(locale)}|${String(currency)}`;

const createFormatter = (locale, currency) => {
  // Prefer narrowSymbol when available so symbols like "GH₵" are used when supported
  const options = {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol' in Intl.NumberFormat.prototype ? 'narrowSymbol' : 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };

  return new Intl.NumberFormat(locale, options);
};

const getFormatter = (locale, currency) => {
  const key = makeKey(locale, currency);
  if (!formatters.has(key)) {
    try {
      formatters.set(key, createFormatter(locale, currency));
    } catch {
      // If Intl throws (invalid locale/currency), fall back to a safe en-US formatter
      formatters.set(key, createFormatter('en-US', currency));
    }
  }
  return formatters.get(key);
};

/**
 * Format an amount as currency.
 *
 * @param {number|bigint|string} amount
 * @param {string} currency Defaults to 'GHS'
 * @param {string} locale Defaults to 'en-GH'
 * @returns {string} Formatted currency string, e.g. "GH₵ 1,234.00"
 */
export const formatGHS = (amount, currency = 'GHS', locale = 'en-GH') => {
  // Normalize empty values
  if (amount === null || amount === undefined || amount === '') return 'GH₵ 0.00';

  // Convert BigInt to number safely (may lose precision for extremely large values)
  let numeric;
  try {
    if (typeof amount === 'bigint') numeric = Number(amount);
    else if (typeof amount === 'string') {
      // Trim and remove common grouping characters before parse
      const cleaned = amount.trim().replace(/[, ]+/g, '');
      numeric = cleaned === '' ? NaN : Number(cleaned);
    } else numeric = Number(amount);
  } catch {
    numeric = NaN;
  }

  if (!Number.isFinite(numeric)) {
    // Fallback: show raw value with symbol to avoid crashing UI
    try {
      return `GH₵ ${String(amount)}`;
    } catch {
      return 'GH₵ 0.00';
    }
  }

  // Use Intl when available, otherwise fallback to manual formatting
  try {
    const formatter = getFormatter(locale, currency);
    return formatter.format(numeric);
  } catch (err) {
    // Last-resort fallback: manual formatting with thousands separators
    try {
      const sign = numeric < 0 ? '-' : '';
      const abs = Math.abs(numeric);
      const parts = abs.toFixed(2).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return `${sign}GH₵ ${parts.join('.')}`;
    } catch {
      return `GH₵ ${numeric}`;
    }
  }
};

export default formatGHS;
