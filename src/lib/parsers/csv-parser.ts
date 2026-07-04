import Papa from 'papaparse';
import { Platform, PlatformFinancialBreakdown, WeeklyCSVSplit } from '@/lib/types';
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
  /** Actual payout transferred by the platform — populated for Uber Eats CSV. */
  platform_payout?: number;
  /** Full financial breakdown — populated for Uber Eats CSV. */
  financial_breakdown?: PlatformFinancialBreakdown;
  /**
   * Per-week splits when the file spans multiple payout dates (e.g. a monthly Uber Eats CSV).
   * Only populated when > 1 distinct payout week is detected.
   */
  weekly_splits?: WeeklyCSVSplit[];
  /** @deprecated Legacy fields — kept for backwards compatibility. */
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
  'payout date',
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

/** Find a header by exact lowercase-trimmed key or partial match, returns the original header string. */
function findHeader(headerMap: Map<string, string>, headers: string[], key: string): string | undefined {
  return headerMap.get(key) ?? headers.find((h) => h.toLowerCase().trim().includes(key));
}

/** Sum a specific column across given rows (signed — preserves negatives). */
function sumCol(rows: Record<string, unknown>[], col: string | undefined): number {
  if (!col) return 0;
  let sum = 0;
  for (const row of rows) sum += parseNumeric(row[col]);
  return sum;
}

/**
 * Convert an Uber Eats payout date (DD/MM/YYYY) to the order week it covers.
 * Uber pays weekly: payout on Monday N covers orders from Monday N-7 to Sunday N-1.
 */
function payoutDateToWeekRange(payoutDateStr: string): { week_start_date: string; week_end_date: string } | null {
  const parts = payoutDateStr.split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  const payout = new Date(y, m - 1, d);
  if (isNaN(payout.getTime())) return null;
  const weekStart = new Date(payout);
  weekStart.setDate(payout.getDate() - 7);
  const weekEnd = new Date(payout);
  weekEnd.setDate(payout.getDate() - 1);
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  return { week_start_date: fmt(weekStart), week_end_date: fmt(weekEnd) };
}

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

  // ── Uber Eats order-level CSV ────────────────────────────────────────────────
  // Format: one row per order + child item rows. Order rows have a non-blank
  // "Order ID" and an "Order status". Item rows have a blank Order ID.
  // Summing all rows would double-count — filter to order rows only.
  if (platform === 'ubereats') {
    const headerMap = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));

    const orderIdCol    = findHeader(headerMap, headers, 'order id');
    const statusCol     = findHeader(headerMap, headers, 'order status');
    const salesCol      = findHeader(headerMap, headers, 'sales (incl. vat)');
    const offersCol     = findHeader(headerMap, headers, 'offers on items (incl. vat)');
    const redemFeeCol   = findHeader(headerMap, headers, 'offer redemption fee');
    const redemVatCol   = findHeader(headerMap, headers, 'vat on offer redemption fee');
    const marketingCol  = findHeader(headerMap, headers, 'marketing adjustment (incl. vat)');
    const commissionCol = findHeader(headerMap, headers, 'marketplace fee after promotion (incl. vat)')
      ?? findHeader(headerMap, headers, 'marketplace fee after discount (incl. vat)')
      ?? findHeader(headerMap, headers, 'marketplace fee (incl. vat)');
    const adjustCol     = findHeader(headerMap, headers, 'order error adjustments (incl. vat)')
      ?? findHeader(headerMap, headers, 'price adjustments (incl. vat)');
    const payoutCol     = findHeader(headerMap, headers, 'total payout')
      ?? findHeader(headerMap, headers, 'net payout');
    const otherPayCol   = findHeader(headerMap, headers, 'other payments (incl. vat)');
    const payoutDateCol = findHeader(headerMap, headers, 'payout date');

    /** Returns true for completed order-level rows (not item sub-rows). */
    const isCompletedOrder = (r: Record<string, unknown>) => {
      const id = String(r[orderIdCol ?? ''] ?? '').trim();
      if (!id) return false;
      if (statusCol) return String(r[statusCol] ?? '').trim().toLowerCase() === 'completed';
      return true;
    };

    /**
     * Compute gross_revenue, payout, and financial_breakdown for a subset of rows.
     * allRows = every row for this period (order + adjustment rows).
     * orderRows = completed order-level rows only (for revenue sums).
     *
     * Tips and delivery fee are excluded from the franchise fee base — they belong
     * to the franchisee (own-delivery sites keep both).
     */
    const computeGroup = (allRows: typeof rows, orderRows: typeof rows) => {
      const salesSum   = sumCol(orderRows, salesCol);
      const offersSum  = sumCol(orderRows, offersCol);   // negative
      const redemFee   = sumCol(orderRows, redemFeeCol); // negative
      const redemVat   = sumCol(orderRows, redemVatCol); // negative
      const htOffers   = Math.abs(offersSum) + Math.abs(redemFee) + Math.abs(redemVat);
      const grossRevenue = Math.round((salesSum - htOffers) * 100) / 100;

      const commission  = Math.round(Math.abs(sumCol(orderRows, commissionCol)) * 100) / 100;
      const adSpend     = Math.round(Math.abs(sumCol(orderRows, marketingCol)) * 100) / 100;
      const adjustments = Math.round(Math.abs(sumCol(orderRows, adjustCol)) * 100) / 100;

      // Sum payout across ALL rows so period-level adjustments (ad spend, VAT
      // rounding, other fees) are included. Use otherPayCol as fallback when
      // payoutCol is zero to avoid double-counting rows that have both columns.
      const payoutSum = allRows.reduce((acc, row) => {
        const main  = parseNumeric(row[payoutCol ?? ''] ?? 0);
        const other = otherPayCol ? parseNumeric(row[otherPayCol] ?? 0) : 0;
        return acc + (main !== 0 ? main : other);
      }, 0);
      const payout = Math.round(payoutSum * 100) / 100;

      const financial_breakdown: PlatformFinancialBreakdown = {
        earnings:            grossRevenue || undefined,
        platform_commission: commission   || undefined,
        ad_spend:            adSpend      || undefined,
        // offer_redemption intentionally omitted — already deducted from gross_revenue
        adjustments:         adjustments  || undefined,
      };

      return { grossRevenue, payout, financial_breakdown, orderCount: orderRows.length };
    };

    const allOrderRows = orderIdCol ? rows.filter(isCompletedOrder) : rows;

    if (salesCol && allOrderRows.length > 0) {
      const overall = computeGroup(rows, allOrderRows);

      // ── Multi-week split by payout date ────────────────────────────────────
      // Uber monthly CSVs span multiple payout dates. When > 1 distinct payout
      // date is found, build a WeeklyCSVSplit for each so the UI can backfill
      // weekly_report records for every covered week in one upload.
      let weekly_splits: WeeklyCSVSplit[] | undefined;
      if (payoutDateCol) {
        const payoutDates = Array.from(
          new Set(rows.map((r) => String(r[payoutDateCol] ?? '').trim()).filter(Boolean))
        ).sort();

        if (payoutDates.length > 1) {
          weekly_splits = [];
          for (const pd of payoutDates) {
            const splitAll    = rows.filter((r) => String(r[payoutDateCol] ?? '').trim() === pd);
            const splitOrders = splitAll.filter(isCompletedOrder);
            const wr = payoutDateToWeekRange(pd);
            if (!wr) continue;
            const g = computeGroup(splitAll, splitOrders);
            weekly_splits.push({
              week_start_date:    wr.week_start_date,
              week_end_date:      wr.week_end_date,
              payout_date:        pd,
              gross_revenue:      g.grossRevenue,
              platform_payout:    g.payout || undefined,
              financial_breakdown: g.financial_breakdown,
              order_count:        g.orderCount,
            });
          }
          if (weekly_splits.length <= 1) weekly_splits = undefined;
        }
      }

      return {
        gross_revenue:    overall.grossRevenue,
        platform_payout:  overall.payout || undefined,
        financial_breakdown: overall.financial_breakdown,
        confidence:       'high',
        matched_column:   'Sales (incl. VAT) − offer costs (order rows only)',
        row_count:        allOrderRows.length,
        ...(weekly_splits && { weekly_splits }),
        ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
      };
    }

    // Fallback: summary CSV without Order ID column — use old pattern matching
    const net_payout  = sumColByPatterns(headers, rows, ['total payout', 'net payout', 'amount paid', 'payout']);
    const legacyGross = sumColByPatterns(headers, rows, ['sales (incl. vat)']);
    return {
      gross_revenue:   legacyGross ?? 0,
      platform_payout: net_payout,
      confidence:      legacyGross != null ? 'medium' : 'low',
      matched_column:  legacyGross != null ? 'Sales (incl. VAT)' : null,
      row_count:       rows.length,
      ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
    };
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
