import { Platform } from '@/lib/types';
import { getWeekRangeFromDate, parseFlexibleDate } from '@/lib/utils';

export interface PDFParseResult {
  gross_revenue: number;
  confidence: 'high' | 'medium' | 'low';
  matched_pattern: string | null;
  raw_text: string;
  /** When a week can be inferred from period text (Mon–Sun). */
  week_start_date?: string;
  week_end_date?: string;
  /** When Deliveroo statement has multiple Hungry Tum brands (e.g. Bethnal Green), per-brand Total Order Value for invoice breakdown. Keys = Hungry Tum brand names (Wing Shack, SMSH BN, Eggs n Stuff). */
  deliveroo_brand_breakdown?: Record<string, number>;
}

/**
 * Try to extract a single date from PDF text (e.g. "week ending 14 Jan 2024", "period ending 01/02/2024").
 * Returns the containing Monday–Sunday week.
 */
function extractWeekFromPDFText(text: string): { week_start_date: string; week_end_date: string } | undefined {
  const patterns: RegExp[] = [
    /week\s+ending\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|[\d ]+\w+\s+\d{4})/i,
    /period\s+ending\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2}|[\d ]+\w+\s+\d{4})/i,
    /statement\s+period[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /for\s+the\s+period[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:week|period)\s+end[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s*[-–]\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/,
    /statement\s+date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /payment\s+date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /billing\s+period[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /statement\s+for[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /(?:week|period)\s+of[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const date = parseFlexibleDate(m[1].trim());
      if (date) return getWeekRangeFromDate(date);
    }
  }
  // First 2000 chars: any standalone DD/MM/YYYY or DD-MM-YYYY (often statement date at top)
  const head = text.slice(0, 2000);
  const standalone = head.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/);
  if (standalone?.[1]) {
    const date = parseFlexibleDate(standalone[1]);
    if (date) return getWeekRangeFromDate(date);
  }
  return undefined;
}

/**
 * Try to infer week from filename (e.g. SVAYA_LIMITED_20260202_statement.pdf → 2 Feb 2026).
 * Looks for YYYYMMDD in the name.
 */
export function extractWeekFromFilename(fileName: string): { week_start_date: string; week_end_date: string } | undefined {
  const m = fileName.match(/(\d{4})(\d{2})(\d{2})/);
  if (!m) return undefined;
  const date = parseFlexibleDate(`${m[1]}-${m[2]}-${m[3]}`);
  if (!date) return undefined;
  return getWeekRangeFromDate(date);
}

/**
 * Hungry Tum brand names as they appear on Deliveroo Site Breakdown (case-insensitive, flexible spacing).
 * Used to sum only these brands' Total Order Value and exclude others (e.g. Chitti Dosa).
 * Order: Eggs N Stuff, Smash Bun (EC), Wing Shack (Co - Bethnal Green (EC) optional; PDFs often abbreviate).
 */
const DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS: RegExp[] = [
  /Eggs\s+[nN]\s+Stuff/i,
  /Smash\s+Bun\s*\(\s*EC\s*\)|SMSH\s+BN/i,
  /Wing\s+Shack(?:\s+Co\s*[-–]\s*Bethnal\s+Green\s*\(\s*EC\s*\))?/i,
];

/** Hungry Tum brand keys for invoice breakdown (same order as DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS). */
const DELIVEROO_BRAND_KEYS = ['Eggs n Stuff', 'SMSH BN', 'Wing Shack'] as const;

/**
 * Sum Total Order Value for Hungry Tum brands and optionally return per-brand breakdown.
 * Returns { sum, foundAny, brand_breakdown }. Uses first match per brand only.
 */
function sumHungryTumTotalOrderValueInText(
  textSlice: string
): { sum: number; foundAny: boolean; brand_breakdown: Record<string, number> } {
  let sum = 0;
  let foundAny = false;
  const brand_breakdown: Record<string, number> = {};
  for (let i = 0; i < DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS.length; i += 1) {
    const brandRe = DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS[i];
    const brandKey = DELIVEROO_BRAND_KEYS[i];
    let amount = 0;
    let rowFound = false;
    const rowRe = new RegExp(
      `(${brandRe.source})\\s+Total\\s+Order\\s+Value\\s+[^£\\d]*(?:£)?([\\d,]+\\.?\\d*)`,
      'gi'
    );
    let m = rowRe.exec(textSlice);
    if (m?.[2]) {
      amount = parseFloat(m[2].replace(/,/g, ''));
      rowFound = true;
    } else if (textSlice.includes('Total Order Value')) {
      const brandReFresh = new RegExp(brandRe.source, 'gi');
      const brandMatch = brandReFresh.exec(textSlice);
      if (brandMatch) {
        const afterBrand = textSlice.slice(
          brandMatch.index + brandMatch[0].length,
          brandMatch.index + 350
        );
        const amountMatch = afterBrand.match(/Total\s+Order\s+Value[\s\S]*?(?:£|\b)([\d,]+\.\d{2})\b/);
        if (amountMatch?.[1]) {
          amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          rowFound = true;
        }
      }
    }
    if (rowFound) {
      foundAny = true;
      sum += amount;
    }
    brand_breakdown[brandKey] = Math.round(amount * 100) / 100;
  }
  return { sum, foundAny, brand_breakdown };
}

/**
 * Deliveroo sends a Payment Statement PDF.
 * We must use "Total Order Value" only (total price of all menu items purchased by customers).
 * Do NOT use "Total payable to [company]" — that is net payout after commission/fees.
 *
 * When the PDF contains a "Site Breakdown" section (multi-brand), we sum Total Order Value
 * for Hungry Tum brands only (Eggs N Stuff, Smash Bun (EC), Wing Shack Co - Bethnal Green (EC))
 * and exclude other brands (e.g. Chitti Dosa).
 */
function extractDeliverooRevenue(text: string): PDFParseResult {
  const rawTextSnippet = text.substring(0, 2000);

  // 1) First: sum Total Order Value for Hungry Tum brands anywhere in the document.
  // This runs on the full extracted text so we always prefer per-brand totals when present,
  // regardless of page order or "Site Breakdown" section boundaries.
  const wholeDoc = sumHungryTumTotalOrderValueInText(text);
  if (wholeDoc.foundAny) {
    return {
      gross_revenue: Math.round(wholeDoc.sum * 100) / 100,
      confidence: 'high',
      matched_pattern: 'Hungry Tum brands only (per-brand Total Order Value)',
      raw_text: rawTextSnippet,
      deliveroo_brand_breakdown: wholeDoc.brand_breakdown,
    };
  }

  // 2) No Hungry Tum brand rows found: use first "Total Order Value" in document (single-brand statement).
  // Still return full three-brand breakdown so the invoice builder shows separate lines (total under Wing Shack, others 0).
  const totalOrderValue = text.match(
    /Total\s+Order\s+Value[^£]*£([\d,]+\.?\d*)/i
  );
  if (totalOrderValue?.[1]) {
    const total = parseFloat(totalOrderValue[1].replace(/,/g, ''));
    const rounded = Math.round(total * 100) / 100;
    return {
      gross_revenue: rounded,
      confidence: 'high',
      matched_pattern: 'Total Order Value',
      raw_text: rawTextSnippet,
      deliveroo_brand_breakdown: {
        'Eggs n Stuff': 0,
        'SMSH BN': 0,
        'Wing Shack': rounded,
      },
    };
  }
  return {
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
    raw_text: rawTextSnippet,
  };
}

/**
 * Uber Eats sends a Tax Invoice PDF for their fees.
 * This does NOT directly contain gross order value — it shows the fees Uber charges.
 *
 * Key line: "Uber Eats Marketplace Fee ... Net amount £187.31"
 * To get approximate gross, we try to find the marketplace fee and reverse-calculate,
 * but the user should always verify.
 *
 * If they upload a payment summary CSV instead, that goes through the CSV parser.
 */
function extractUberEatsRevenue(text: string): PDFParseResult {
  // Try to find "Total net amount" which is total fees (not gross revenue)
  const totalNetAmount = text.match(
    /Total\s+net\s+amount[\s\t]*£([\d,]+\.?\d*)/i
  );

  // Try marketplace fee specifically — this is the commission on gross
  const marketplaceFee = text.match(
    /(?:Uber\s+Eats\s+)?Marketplace\s+Fee[\s\S]*?£([\d,]+\.?\d*)\s*\n/i
  );

  // The marketplace fee net amount is the last £ value on that line
  const marketplaceFeeNet = text.match(
    /Marketplace\s+Fee[\s\S]*?£[\d,.]+[\s\S]*?£([\d,]+\.?\d*)/i
  );

  // If we have the marketplace fee, it's typically 30% of gross.
  // But percentage varies (25-35%), so we flag as low confidence.
  if (marketplaceFeeNet?.[1]) {
    const feeAmount = parseFloat(marketplaceFeeNet[1].replace(/,/g, ''));
    // Common Uber Eats commission is 30%, but this is an estimate
    const estimatedGross = Math.round((feeAmount / 0.30) * 100) / 100;

    return {
      gross_revenue: estimatedGross,
      confidence: 'low',
      matched_pattern: `Estimated from Marketplace Fee £${feeAmount} (assumed 30% rate - PLEASE VERIFY)`,
      raw_text: text.substring(0, 2000),
    };
  }

  // Fallback: total amount payable
  const totalPayable = text.match(
    /Total\s+amount\s+payable[\s\t]*£([\d,]+\.?\d*)/i
  );
  if (totalPayable?.[1]) {
    return {
      gross_revenue: parseFloat(totalPayable[1].replace(/,/g, '')),
      confidence: 'low',
      matched_pattern: 'Total amount payable (this is fees, not gross revenue - PLEASE VERIFY)',
      raw_text: text.substring(0, 2000),
    };
  }

  if (totalNetAmount?.[1]) {
    return {
      gross_revenue: parseFloat(totalNetAmount[1].replace(/,/g, '')),
      confidence: 'low',
      matched_pattern: 'Total net amount (this is fees, not gross revenue - PLEASE VERIFY)',
      raw_text: text.substring(0, 2000),
    };
  }

  return {
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
    raw_text: text.substring(0, 2000),
  };
}

/**
 * Just Eat can also come as PDF. We look for "Total sales".
 */
function extractJustEatRevenue(text: string): PDFParseResult {
  const totalSales = text.match(
    /Total\s+sales[\s\t]*£([\d,]+\.?\d*)/i
  );
  if (totalSales?.[1]) {
    return {
      gross_revenue: parseFloat(totalSales[1].replace(/,/g, '')),
      confidence: 'high',
      matched_pattern: 'Total sales',
      raw_text: text.substring(0, 2000),
    };
  }

  // Fallback: Gross Order Value
  const grossOrder = text.match(
    /Gross\s+Order\s+Value\s+of\s+£([\d,]+\.?\d*)/i
  );
  if (grossOrder?.[1]) {
    return {
      gross_revenue: parseFloat(grossOrder[1].replace(/,/g, '')),
      confidence: 'high',
      matched_pattern: 'Gross Order Value',
      raw_text: text.substring(0, 2000),
    };
  }

  return {
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
    raw_text: text.substring(0, 2000),
  };
}

export function extractRevenueFromText(
  text: string,
  platform: Platform
): PDFParseResult {
  const weekFromFile = extractWeekFromPDFText(text);
  let result: PDFParseResult;
  switch (platform) {
    case 'deliveroo':
      result = extractDeliverooRevenue(text);
      break;
    case 'ubereats':
      result = extractUberEatsRevenue(text);
      break;
    case 'justeat':
      result = extractJustEatRevenue(text);
      break;
    default:
      result = {
        gross_revenue: 0,
        confidence: 'low',
        matched_pattern: null,
        raw_text: text.substring(0, 2000),
      };
  }
  return {
    ...result,
    ...(weekFromFile && { week_start_date: weekFromFile.week_start_date, week_end_date: weekFromFile.week_end_date }),
  };
}
