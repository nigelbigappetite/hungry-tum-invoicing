import { Platform } from '@/lib/types';
import { getWeekRangeFromDate, parseFlexibleDate } from '@/lib/utils';

export interface HTMLParseResult {
  gross_revenue: number;
  confidence: 'high' | 'medium' | 'low';
  matched_pattern: string | null;
  week_start_date?: string;
  week_end_date?: string;
}

/**
 * Try to extract a week (Mon–Sun) from HTML/DOC text (period, statement date, etc.).
 */
function extractWeekFromHTMLText(text: string): { week_start_date: string; week_end_date: string } | undefined {
  const patterns: RegExp[] = [
    /(?:week|period)\s+ending\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i,
    /(?:statement|payment)\s+(?:date|period)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /for\s+(?:the\s+)?period[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /(?:week|period)\s+of[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*[-–]\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const dateStr = m?.[1]?.trim();
    if (dateStr) {
      const date = parseFlexibleDate(dateStr);
      if (date) return getWeekRangeFromDate(date);
    }
  }
  const standalone = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/);
  if (standalone?.[1]) {
    const date = parseFlexibleDate(standalone[1]);
    if (date) return getWeekRangeFromDate(date);
  }
  return undefined;
}

/**
 * Just Eat invoices saved as .doc are actually HTML files.
 * We strip the HTML tags and extract key values.
 *
 * The HTML contains (in the "Your key takeaways" summary section):
 *   - "Total sales" followed by "£286.20" (this is the gross)
 *   - "Number of orders" followed by "10"
 *   - "You will receive from Just Eat" followed by "£192.60" (net payout)
 *
 * It also contains an order-level breakdown table with individual order totals.
 */
export function parseJustEatHTML(html: string): HTMLParseResult {
  // Strip HTML tags to get plain text
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/&pound;/g, '£')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(td|tr|th|div|p|span|table|tbody|thead)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const week = extractWeekFromHTMLText(text);

  // Primary: "Total sales" with £ amount — this is the gross
  const totalSalesMatch = text.match(
    /Total\s+sales\s*£([\d,]+\.?\d*)/i
  );
  const withWeek = (r: Omit<HTMLParseResult, 'week_start_date' | 'week_end_date'>): HTMLParseResult =>
    week ? { ...r, week_start_date: week.week_start_date, week_end_date: week.week_end_date } : r;

  if (totalSalesMatch?.[1]) {
    return withWeek({
      gross_revenue: parseFloat(totalSalesMatch[1].replace(/,/g, '')),
      confidence: 'high',
      matched_pattern: 'Total sales',
    });
  }

  // Secondary: "Total sales this period" in the account statement section
  const totalSalesPeriod = text.match(
    /Total\s+sales\s+this\s+period[\s\S]*?£([\d,]+\.?\d*)/i
  );
  if (totalSalesPeriod?.[1]) {
    return withWeek({
      gross_revenue: parseFloat(totalSalesPeriod[1].replace(/,/g, '')),
      confidence: 'high',
      matched_pattern: 'Total sales this period',
    });
  }

  // Fallback: "Gross Order Value of £X" from the commission line
  const grossOrderValue = text.match(
    /Gross\s+Order\s+Value\s+of\s+£([\d,]+\.?\d*)/i
  );
  if (grossOrderValue?.[1]) {
    return withWeek({
      gross_revenue: parseFloat(grossOrderValue[1].replace(/,/g, '')),
      confidence: 'high',
      matched_pattern: 'Gross Order Value',
    });
  }

  // Fallback: try to sum the order totals from the orders table
  // Look for the summary row at the bottom showing total card + total amounts
  // Pattern: £0.00 £286.20 £286.20 (cash, card, total at bottom of orders table)
  const orderTotalRow = text.match(
    /£[\d,]+\.?\d*\s+£([\d,]+\.?\d*)\s+£([\d,]+\.?\d*)\s*$/m
  );
  if (orderTotalRow?.[2]) {
    return withWeek({
      gross_revenue: parseFloat(orderTotalRow[2].replace(/,/g, '')),
      confidence: 'medium',
      matched_pattern: 'Orders table total',
    });
  }

  // Last resort: look for "card orders totalling £X"
  const cardOrders = text.match(
    /card\s+orders\s+totalling\s+£([\d,]+\.?\d*)/i
  );
  if (cardOrders?.[1]) {
    return withWeek({
      gross_revenue: parseFloat(cardOrders[1].replace(/,/g, '')),
      confidence: 'medium',
      matched_pattern: 'Card orders total',
    });
  }

  return withWeek({
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
  });
}

/**
 * Generic HTML parser for platforms. Routes to the correct extractor.
 */
export function extractRevenueFromHTML(
  html: string,
  platform: Platform
): HTMLParseResult {
  if (platform === 'justeat') {
    return parseJustEatHTML(html);
  }

  // For other platforms, try a generic approach
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&pound;/g, '£');

  const totalMatch = text.match(/total\s+(?:sales|revenue|gross)[\s:]*£([\d,]+\.?\d*)/i);
  if (totalMatch?.[1]) {
    return {
      gross_revenue: parseFloat(totalMatch[1].replace(/,/g, '')),
      confidence: 'medium',
      matched_pattern: 'Generic HTML total',
    };
  }

  return {
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
  };
}
