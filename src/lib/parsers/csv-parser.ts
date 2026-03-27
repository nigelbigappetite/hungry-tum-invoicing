import Papa from 'papaparse';
import { Platform } from '@/lib/types';
import { getWeekRangeFromDate, parseFlexibleDate } from '@/lib/utils';

// Common column names that indicate gross revenue across platforms
const REVENUE_COLUMN_PATTERNS: Record<Platform, string[]> = {
  deliveroo: [
    'total', 'gross', 'gross total', 'gross revenue', 'order total',
    'total (incl. vat)', 'total inc vat', 'total sales', 'net revenue',
    'gross order value', 'subtotal',
  ],
  ubereats: [
    'sales (incl. vat)', 'sales (incl vat)', 'total sales',
    'gross revenue', 'gross sales', 'order total',
    'gross order value', 'total amount', 'gross fare', 'item subtotal',
  ],
  justeat: [
    'total', 'gross', 'gross total', 'gross revenue', 'order total',
    'total sales', 'total order value', 'subtotal', 'net total',
    'gross order value',
  ],
  slerp: [], // Slerp uses xlsx upload via parse-slerp, not CSV
};

export interface CSVParseResult {
  gross_revenue: number;
  confidence: 'high' | 'medium' | 'low';
  matched_column: string | null;
  row_count: number;
  /** When a single week can be inferred from date/period columns (Mon–Sun). */
  week_start_date?: string;
  week_end_date?: string;
  /** Financial breakdown fields — populated for Uber Eats CSV. */
  platform_commission?: number;
  delivery_fee?: number;
  restaurant_offers?: number;
  platform_offers?: number;
  adjustments?: number;
  net_payout?: number;
  order_count?: number;
}

const DATE_COLUMN_PATTERNS = [
  'week ending',
  'week end',
  'period end',
  'statement date',
  'period',
  'order date',
  'date',
  'week',
  'period start',
  'period end date',
];

/** Column names that indicate the *end* of the period (e.g. "week ending 02 Feb" → use that date for the week). */
const PERIOD_END_PATTERNS = ['week ending', 'week end', 'period end', 'statement date', 'period end date'];

function parseNumeric(value: unknown): number {
  if (typeof value === 'number' && !isNaN(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[£$€,\s]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num)) return num;
  }
  return 0;
}

/**
 * Try to infer a single week from CSV date/period columns.
 * For "period end" style columns (week ending, period end, statement date), uses the *latest* date
 * in the column so the whole file is assigned to the week containing that period end (consistent
 * across files for the same week). Otherwise uses the first parseable date.
 */
function tryParseWeekFromCSV(
  headers: string[],
  rows: Record<string, unknown>[]
): { week_start_date: string; week_end_date: string } | undefined {
  if (rows.length === 0) return undefined;
  const headerMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  let dateColumn: string | null = null;
  let useMaxDate = false;
  for (const pattern of DATE_COLUMN_PATTERNS) {
    for (const [normalised, original] of headerMap) {
      if (normalised.includes(pattern) || pattern.includes(normalised)) {
        dateColumn = original;
        useMaxDate = PERIOD_END_PATTERNS.some((p) => normalised.includes(p) || p.includes(normalised));
        break;
      }
    }
    if (dateColumn) break;
  }
  if (!dateColumn) return undefined;
  const dates: Date[] = [];
  for (const row of rows) {
    const val = row[dateColumn!];
    const date = parseFlexibleDate(val);
    if (date) dates.push(date);
  }
  if (dates.length === 0) return undefined;
  const pick = useMaxDate ? new Date(Math.max(...dates.map((d) => d.getTime()))) : dates[0];
  return getWeekRangeFromDate(pick);
}

/** Sum a column by matching header against patterns; returns absolute value or undefined if not found. */
function sumColByPatterns(
  headers: string[],
  rows: Record<string, unknown>[],
  patterns: string[]
): number | undefined {
  const headerMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  for (const pattern of patterns) {
    const matched =
      headerMap.get(pattern) ??
      headers.find((h) => h.toLowerCase().trim().includes(pattern));
    if (matched) {
      let sum = 0;
      for (const row of rows) sum += parseNumeric(row[matched]);
      return Math.round(Math.abs(sum) * 100) / 100;
    }
  }
  return undefined;
}

/** Uber Eats: prefer Total Order (incl. VAT) = amount made by the site; fallback to Sales + Offers */
const UBER_TOTAL_ORDER_COL = 'total order (incl. vat)';
const UBER_SALES_COL = 'sales (incl. vat)';
const UBER_OFFERS_COL = 'offers on items (incl. vat)';

export function parseCSV(
  csvText: string,
  platform: Platform
): CSVParseResult {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { gross_revenue: 0, confidence: 'low', matched_column: null, row_count: 0 };
  }

  const headers = parsed.meta.fields || [];
  const rows = parsed.data as Record<string, unknown>[];
  const weekFromFile = tryParseWeekFromCSV(headers, rows);

  // Uber Eats: prefer Total Order (incl. VAT) — amount made by the site; fallback to Sales + Offers
  if (platform === 'ubereats') {
    const headerMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));

    // Extract financial breakdown columns
    const financials = {
      platform_commission: sumColByPatterns(headers, rows, ['marketplace fee', 'service fee', 'uber eats fee']),
      delivery_fee: sumColByPatterns(headers, rows, ['delivery fee']),
      restaurant_offers: sumColByPatterns(headers, rows, ['offers on items (incl. vat)', 'restaurant funded discounts']),
      platform_offers: sumColByPatterns(headers, rows, ['uber funded discounts', 'uber funded offers', 'platform funded discounts']),
      adjustments: sumColByPatterns(headers, rows, ['adjustments', 'adjustment']),
      net_payout: sumColByPatterns(headers, rows, ['net payout', 'total payout', 'amount paid', 'payout']),
      order_count: rows.length,
    };

    const totalOrderHeader =
      headerMap.get(UBER_TOTAL_ORDER_COL) ??
      headers.find((h) => {
        const n = h.toLowerCase().replace(/\s+/g, ' ').trim();
        return n === UBER_TOTAL_ORDER_COL || (n.includes('total order') && n.includes('incl') && n.includes('vat'));
      });

    if (totalOrderHeader) {
      let grossRevenue = 0;
      for (const row of rows) {
        grossRevenue += parseNumeric(row[totalOrderHeader]);
      }
      return {
        gross_revenue: Math.round(grossRevenue * 100) / 100,
        confidence: 'high',
        matched_column: 'Total Order (incl. VAT)',
        row_count: rows.length,
        ...financials,
        ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
      };
    }

    const salesHeader = headerMap.get(UBER_SALES_COL) ?? headers.find((h) => h.toLowerCase().trim() === UBER_SALES_COL);
    const offersHeader = headerMap.get(UBER_OFFERS_COL) ?? headers.find((h) => h.toLowerCase().trim() === UBER_OFFERS_COL);

    if (salesHeader && offersHeader) {
      let grossRevenue = 0;
      for (const row of rows) {
        grossRevenue += parseNumeric(row[salesHeader]) + parseNumeric(row[offersHeader]);
      }
      return {
        gross_revenue: Math.round(grossRevenue * 100) / 100,
        confidence: 'high',
        matched_column: 'Sales (incl. VAT) + Offers on items (incl. VAT)',
        row_count: rows.length,
        ...financials,
        ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
      };
    }
    if (salesHeader) {
      let grossRevenue = 0;
      for (const row of rows) grossRevenue += parseNumeric(row[salesHeader]);
      return {
        gross_revenue: Math.round(grossRevenue * 100) / 100,
        confidence: 'medium',
        matched_column: salesHeader,
        row_count: rows.length,
        ...financials,
        ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
      };
    }
  }

  const patterns = REVENUE_COLUMN_PATTERNS[platform];

  // Try to find a matching revenue column
  let matchedColumn: string | null = null;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  // Try exact match first
  for (const header of headers) {
    const normalised = header.toLowerCase().trim();
    if (patterns.includes(normalised)) {
      matchedColumn = header;
      confidence = 'high';
      break;
    }
  }

  // Try partial match
  if (!matchedColumn) {
    for (const header of headers) {
      const normalised = header.toLowerCase().trim();
      for (const pattern of patterns) {
        if (normalised.includes(pattern) || pattern.includes(normalised)) {
          matchedColumn = header;
          confidence = 'medium';
          break;
        }
      }
      if (matchedColumn) break;
    }
  }

  // If we still don't have a match, look for any column with currency-like values
  if (!matchedColumn) {
    for (const header of headers) {
      const values = rows.map((row) => row[header]);
      const numericValues = values.filter(
        (v) => typeof v === 'number' || (typeof v === 'string' && /^[£$€]?\d/.test(String(v).trim()))
      );
      if (numericValues.length > rows.length * 0.5) {
        matchedColumn = header;
        confidence = 'low';
        break;
      }
    }
  }

  if (!matchedColumn) {
    return {
      gross_revenue: 0,
      confidence: 'low',
      matched_column: null,
      row_count: rows.length,
      ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
    };
  }

  // Sum the revenue column
  let grossRevenue = 0;
  for (const row of rows) {
    grossRevenue += parseNumeric(row[matchedColumn]);
  }

  return {
    gross_revenue: Math.round(grossRevenue * 100) / 100,
    confidence,
    matched_column: matchedColumn,
    row_count: rows.length,
    ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
  };
}
