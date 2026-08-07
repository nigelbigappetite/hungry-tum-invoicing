import { Platform, PlatformFinancialBreakdown } from '@/lib/types';
import { getWeekRangeFromDate, parseFlexibleDate } from '@/lib/utils';

export interface PDFParseResult {
  gross_revenue: number;
  /** Actual payout transferred by the platform after their commission deductions (fee basis is gross_revenue). */
  platform_payout?: number;
  /** Full financial breakdown parsed from the statement. */
  financial_breakdown?: PlatformFinancialBreakdown;
  confidence: 'high' | 'medium' | 'low';
  matched_pattern: string | null;
  raw_text: string;
  /** When a week can be inferred from period text (Mon–Sun). */
  week_start_date?: string;
  week_end_date?: string;
  /** When Deliveroo statement has multiple Hungry Tum brands (e.g. Bethnal Green), per-brand Total Order Value for invoice breakdown. Keys = Hungry Tum brand names (Wing Shack, SMSH BN, Eggs n Stuff). */
  deliveroo_brand_breakdown?: Record<string, number>;
  /** Financial breakdown fields — populated for Deliveroo PDF. */
  platform_commission?: number;
  delivery_fee?: number;
  ad_spend?: number;
  restaurant_offers?: number;
  adjustments?: number;
  net_payout?: number;
  order_count?: number;
}

export interface PDFParseOptions {
  deliverooLocation?: string;
  deliverooBrands?: string[];
  franchiseeName?: string;
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
const DELIVEROO_BRANDS = [
  { key: 'Eggs n Stuff', pattern: /Eggs\s+[nN]\s+Stuff/i },
  { key: 'SMSH BN', pattern: /Smash\s+Bun\s*\(\s*EC\s*\)|SMSH\s+BN/i },
  { key: 'Wing Shack', pattern: /Wing\s+Shack(?:\s+Co)?/i },
] as const;

const DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS: RegExp[] = DELIVEROO_BRANDS.map((b) => b.pattern);

/** Hungry Tum brand keys for invoice breakdown. */
const DELIVEROO_BRAND_KEYS = DELIVEROO_BRANDS.map((b) => b.key);

interface DeliverooSiteRow {
  siteName: string;
  brandKey: string;
  totalOrderValue: number;
  netCharges: number;
  payout: number;
}

function parseGBPAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/,/g, '').trim();
  const amount = parseFloat(cleaned.replace(/^-/, ''));
  if (!Number.isFinite(amount)) return undefined;
  return cleaned.startsWith('-') ? -amount : amount;
}

function normalizeMatchText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function identifyDeliverooBrand(siteName: string): string | null {
  const brand = DELIVEROO_BRANDS.find((b) => b.pattern.test(siteName));
  return brand?.key ?? null;
}

function extractDeliverooSiteRows(text: string): DeliverooSiteRow[] {
  const rows: DeliverooSiteRow[] = [];
  const siteRowRe = /\b((?:Eggs\s+n\s+Stuff|SMSH\s+BN|Smash\s+Bun(?:\s*\(\s*EC\s*\))?|Wing\s+Shack\s+Co)\s*[-–]\s*[^£\n]+?)\s+Total\s+Order\s+Value\s+[^£]*£\s*([\d,]+\.?\d*)\s+Deliveroo\s+net\s+charges\s+£\s*(-?[\d,]+\.?\d*)\s+£\s*(-?[\d,]+\.?\d*)\s+£\s*(-?[\d,]+\.?\d*)\s+Total\s+payable\s+to\s+site\s+[^£]*£\s*([\d,]+\.?\d*)/gi;

  let match: RegExpExecArray | null;
  while ((match = siteRowRe.exec(text)) !== null) {
    const siteName = match[1].replace(/\s+/g, ' ').trim();
    const brandKey = identifyDeliverooBrand(siteName);
    const totalOrderValue = parseGBPAmount(match[2]);
    const netCharges = parseGBPAmount(match[5]);
    const payout = parseGBPAmount(match[6]);
    if (!brandKey || totalOrderValue == null || netCharges == null || payout == null) continue;
    rows.push({ siteName, brandKey, totalOrderValue, netCharges, payout });
  }

  return rows;
}

function filterDeliverooRowsForContext(rows: DeliverooSiteRow[], options?: PDFParseOptions): DeliverooSiteRow[] {
  const allowedBrands = new Set((options?.deliverooBrands ?? []).map(normalizeMatchText).filter(Boolean));
  const location = normalizeMatchText(options?.deliverooLocation);
  const franchiseeName = normalizeMatchText(options?.franchiseeName);

  let candidates = rows;
  if (allowedBrands.size > 0) {
    candidates = candidates.filter((row) => allowedBrands.has(normalizeMatchText(row.brandKey)));
  }

  if (location) {
    const locationMatches = candidates.filter((row) => normalizeMatchText(row.siteName).includes(location));
    if (locationMatches.length > 0) return locationMatches;
  }

  if (franchiseeName) {
    const nameMatches = candidates.filter((row) => normalizeMatchText(row.siteName).includes(franchiseeName));
    if (nameMatches.length > 0) return nameMatches;
  }

  return candidates;
}

/**
 * Sum Total Order Value for Hungry Tum brands and optionally return per-brand breakdown.
 * Returns { sum, foundAny, brand_breakdown }. Uses first match per brand only.
 */
function sumHungryTumTotalOrderValueInText(
  textSlice: string
): { sum: number; foundAny: boolean; brand_breakdown: Record<string, number> } {
  const siteRows = extractDeliverooSiteRows(textSlice);
  if (siteRows.length > 0) {
    const brand_breakdown = Object.fromEntries(DELIVEROO_BRAND_KEYS.map((key) => [key, 0]));
    for (const row of siteRows) {
      brand_breakdown[row.brandKey] = Math.round(((brand_breakdown[row.brandKey] ?? 0) + row.totalOrderValue) * 100) / 100;
    }
    return {
      sum: Math.round(siteRows.reduce((sum, row) => sum + row.totalOrderValue, 0) * 100) / 100,
      foundAny: true,
      brand_breakdown,
    };
  }

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
    const m = rowRe.exec(textSlice);
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
 * Extract billing period week from Deliveroo PDF text.
 * Deliveroo PDFs have "Issue date: Mon, 16 Feb 2026" (issue date = Monday AFTER billing period)
 * and "Period covered: Mon, 09 Feb 00:00 - Sun, 15 Feb 23:59 (UTC)" (actual billing period).
 * The period dates lack a year, so we infer it from the issue date (handling Dec→Jan rollover).
 */
function extractDeliverooWeek(text: string): { week_start_date: string; week_end_date: string } | undefined {
  const periodMatch = text.match(/[Pp]eriod\s+covered:\s+\w+,\s+(\d{1,2})\s+(\w{3})\s+\d{2}:\d{2}/i);
  const issueMatch = text.match(/[Ii]ssue\s+date:\s+\w+,\s+\d{1,2}\s+(\w{3})\s+(\d{4})/i);
  if (!periodMatch || !issueMatch) return undefined;

  const [, day, periodMonth] = periodMatch;
  const [, issueMonth, issueYearStr] = issueMatch;
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  let year = parseInt(issueYearStr, 10);
  // Period is Dec, issue date is Jan → billing period was previous year
  if (MONTHS[periodMonth] === 11 && MONTHS[issueMonth] === 0) year -= 1;
  const date = parseFlexibleDate(`${day} ${periodMonth} ${year}`);
  if (!date) return undefined;
  return getWeekRangeFromDate(date);
}

/**
 * For multi-site Deliveroo statements (Site Breakdown section), extract the payout
 * for Hungry Tum sites only — not the combined "Total payable to [company]" figure.
 * Looks for each HT brand name and finds the "Total payable to site" that follows it.
 */
function extractHungryTumSitePayout(text: string): number | undefined {
  for (const brandRe of DELIVEROO_HUNGRY_TUM_BRAND_PATTERNS) {
    const globalRe = new RegExp(brandRe.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = globalRe.exec(text)) !== null) {
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 500);
      const payoutMatch = after.match(/Total\s+payable\s+to\s+site[^£]*£\s*([\d,]+\.?\d*)/i);
      if (payoutMatch?.[1]) {
        return parseFloat(payoutMatch[1].replace(/,/g, ''));
      }
    }
  }
  return undefined;
}

/** Extract Deliveroo financial breakdown from PDF text. */
function extractDeliverooFinancials(text: string): Pick<PDFParseResult, 'platform_commission' | 'delivery_fee' | 'ad_spend' | 'restaurant_offers' | 'adjustments' | 'net_payout' | 'order_count'> {
  const parseAmount = (m: RegExpMatchArray | null) =>
    m?.[1] ? parseFloat(m[1].replace(/,/g, '')) : undefined;

  // "Total payable to Wing Shack Co - OG  —  —  £1,025.58"
  const net_payout = parseAmount(text.match(/Total\s+payable\s+to\s+[A-Za-z][^£\n]{0,60}£\s*([\d,]+\.?\d*)/i));

  // "Deliveroo Commission   £-232.38   £-46.48   £-278.86" — amounts use £- prefix
  const platform_commission = parseAmount(text.match(/(?:Deliveroo\s+)?[Cc]ommission\s+£-?([\d,]+\.?\d*)/));

  // "Marketplace+ delivery fee   56   £70.21" — positive amount (payment to restaurant)
  const delivery_fee = parseAmount(text.match(/[Dd]elivery\s+(?:fee|charge)[^£\n]{0,40}£\s*([\d,]+\.?\d*)/));

  // "Marketer Adverts   10   £-427.62" — paid advertising / boost spend
  const ad_spend = parseAmount(text.match(/[Mm]arketer\s+[Aa]dverts\s+[\d\s]*£-?([\d,]+\.?\d*)/));

  // "Restaurant funded voucher promotion   £-6.00" — restaurant-funded customer discounts
  const restaurant_offers = parseAmount(text.match(/[Rr]estaurant\s+funded[^£\n]{0,60}£-?([\d,]+\.?\d*)/));

  // "Customer refunds   £-22.34" — platform refunds deducted from payout
  const customer_refunds = parseAmount(text.match(/[Cc]ustomer\s+refunds?\s+£-?([\d,]+\.?\d*)/i)) ?? 0;
  const raw_adjustments = parseAmount(text.match(/[Aa]djustment[^£\n]{0,40}£\s*([\d,]+\.?\d*)/)) ?? 0;
  const adjustments = Math.round((raw_adjustments + customer_refunds) * 100) / 100 || undefined;

  // Order count from Site Itemisation Summary: "Pickup   1   £x" + "Marketplace+   56   £x"
  const pickupCount = text.match(/Pickup\s+(\d+)\s+£/)?.[1];
  const marketplaceCount = text.match(/Marketplace\+\s+(\d+)\s+£/)?.[1];
  const order_count = (pickupCount !== undefined || marketplaceCount !== undefined)
    ? (pickupCount ? parseInt(pickupCount, 10) : 0) + (marketplaceCount ? parseInt(marketplaceCount, 10) : 0)
    : (() => { const m = text.match(/(\d+)\s+order/i); return m ? parseInt(m[1], 10) : undefined; })();

  return { platform_commission, delivery_fee, ad_spend, restaurant_offers, adjustments, net_payout, order_count };
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
function extractDeliverooRevenue(text: string, options?: PDFParseOptions): PDFParseResult {
  const rawTextSnippet = text.substring(0, 2000);
  const financials = extractDeliverooFinancials(text);

  // 1) First: sum Total Order Value for Hungry Tum brands anywhere in the document.
  // HT charges 6% on the full TOV (gross customer payment).
  // Offer spend is recorded in the breakdown for invoice transparency, not deducted from the fee basis.
  const htOffers = Math.round((financials.restaurant_offers ?? 0) * 100) / 100;

  const buildBreakdown = (tov: number): PlatformFinancialBreakdown => ({
    earnings: tov,
    platform_commission: financials.platform_commission || undefined,
    ad_spend: financials.ad_spend || undefined,
    offer_redemption: htOffers || undefined,
    adjustments: financials.adjustments || undefined,
  });

  const siteRows = extractDeliverooSiteRows(text);
  if (siteRows.length > 0) {
    const rowsForContext = filterDeliverooRowsForContext(siteRows, options);
    const selectedRows = rowsForContext.length > 0 ? rowsForContext : siteRows;
    const tov = Math.round(selectedRows.reduce((sum, row) => sum + row.totalOrderValue, 0) * 100) / 100;
    const payout = Math.round(selectedRows.reduce((sum, row) => sum + row.payout, 0) * 100) / 100;
    const selectedNetCharges = Math.round(selectedRows.reduce((sum, row) => sum + Math.abs(row.netCharges), 0) * 100) / 100;
    const brand_breakdown = Object.fromEntries(DELIVEROO_BRAND_KEYS.map((key) => [key, 0]));
    for (const row of selectedRows) {
      brand_breakdown[row.brandKey] = Math.round(((brand_breakdown[row.brandKey] ?? 0) + row.totalOrderValue) * 100) / 100;
    }
    const selectedFinancials = {
      ...financials,
      net_payout: payout,
      // On a future multi-trading-site statement the company-level commission is combined.
      // Use the selected row's net charges so the invoice does not show another site's deductions.
      platform_commission: selectedRows.length < siteRows.length ? selectedNetCharges : financials.platform_commission,
    };

    return {
      gross_revenue: tov,
      platform_payout: payout,
      financial_breakdown: {
        earnings: tov,
        platform_commission: selectedFinancials.platform_commission || undefined,
        ad_spend: selectedFinancials.ad_spend || undefined,
        offer_redemption: htOffers || undefined,
        adjustments: selectedFinancials.adjustments || undefined,
      },
      confidence: rowsForContext.length > 0 ? 'high' : 'medium',
      matched_pattern: rowsForContext.length > 0
        ? `Deliveroo Site Breakdown (${selectedRows.map((row) => row.siteName).join(', ')})`
        : 'Deliveroo Site Breakdown (all Hungry Tum site rows)',
      raw_text: rawTextSnippet,
      deliveroo_brand_breakdown: brand_breakdown,
      ...selectedFinancials,
    };
  }

  const wholeDoc = sumHungryTumTotalOrderValueInText(text);
  if (wholeDoc.foundAny) {
    const tov = Math.round(wholeDoc.sum * 100) / 100;
    // For multi-site statements (e.g. Wing Shack + Fireaway on same account), use the
    // site-specific "Total payable to site" rather than the combined company-level total.
    const sitePayout = extractHungryTumSitePayout(text) ?? financials.net_payout;
    return {
      gross_revenue: tov,
      platform_payout: sitePayout,
      financial_breakdown: buildBreakdown(tov),
      confidence: 'high',
      matched_pattern: 'Hungry Tum brands only (per-brand Total Order Value)',
      raw_text: rawTextSnippet,
      deliveroo_brand_breakdown: wholeDoc.brand_breakdown,
      ...financials,
    };
  }

  // 2) No Hungry Tum brand rows found: use first "Total Order Value" in document (single-brand statement).
  const totalOrderValue = text.match(
    /Total\s+Order\s+Value[^£]*£([\d,]+\.?\d*)/i
  );
  if (totalOrderValue?.[1]) {
    const tov = parseFloat(totalOrderValue[1].replace(/,/g, ''));
    return {
      gross_revenue: tov,
      platform_payout: financials.net_payout,
      financial_breakdown: buildBreakdown(tov),
      confidence: 'high',
      matched_pattern: 'Total Order Value',
      raw_text: rawTextSnippet,
      deliveroo_brand_breakdown: {
        'Eggs n Stuff': 0,
        'SMSH BN': 0,
        'Wing Shack': tov,
      },
      ...financials,
    };
  }
  return {
    gross_revenue: 0,
    platform_payout: financials.net_payout,
    confidence: 'low',
    matched_pattern: null,
    raw_text: rawTextSnippet,
    ...financials,
  };
}

/**
 * Uber Eats weekly earnings statement PDF.
 *
 * The statement has:
 *   Earnings £282.11                      ← gross customer order value
 *   Marketing -£108.13
 *     Offers on items (incl. VAT) -£76.30  ← HT-covered offer spend
 *     Offer Redemption Fee (incl. VAT) -£5.60  ← HT-covered redemption fee
 *     Ad spends -£26.23                   ← NOT covered by HT
 *   Service fees -£51.04
 *     Marketplace Fee -£51.04             ← Uber's commission
 *   Net order error adjustments -£10.70
 *   Total payout £112.24                  ← what Uber transfers to HT
 *
 * Fee basis = Earnings (full gross). HT covers offer costs — they are recorded for transparency only.
 * Platform payout = Total payout.
 */
function extractUberEatsRevenue(text: string): PDFParseResult {
  const raw = text.substring(0, 2000);
  const parseAbs = (m: RegExpMatchArray | null) =>
    m?.[1] ? Math.abs(parseFloat(m[1].replace(/,/g, ''))) : null;

  // "Earnings £282.11"
  const earnings = parseAbs(text.match(/\bEarnings\s+£\s*-?\s*([\d,]+\.?\d*)/i));

  // "Offers on items (incl. VAT) -£76.30"
  const offersAmount = parseAbs(text.match(/Offers?\s+on\s+items?[^£\n]{0,40}£\s*-?\s*([\d,]+\.?\d*)/i)) ?? 0;

  // "Offer Redemption Fee (incl. VAT) -£5.60"
  const redemptionAmount = parseAbs(text.match(/Offer\s+Redemption\s+Fee[^£\n]{0,40}£\s*-?\s*([\d,]+\.?\d*)/i)) ?? 0;

  // "Ad spends -£26.23"
  const adSpend = parseAbs(text.match(/Ad\s+spends?\s+(?:-)?£?\s*-?\s*([\d,]+\.?\d*)/i)) ?? 0;

  // "Marketplace Fee -£51.04" (under Service fees)
  const platformCommission = parseAbs(text.match(/Marketplace\s+Fee\s+(?:-)?£?\s*-?\s*([\d,]+\.?\d*)/i)) ?? 0;

  // "Net order error adjustments -£10.70"
  const adjustments = parseAbs(text.match(/Net\s+order\s+error\s+adjustments?\s+(?:-)?£?\s*-?\s*([\d,]+\.?\d*)/i)) ?? 0;

  // "Total payout £112.24"
  const payoutMatch = text.match(/Total\s+payout\s+£\s*([\d,]+\.?\d*)/i);
  const platform_payout = payoutMatch ? parseFloat(payoutMatch[1].replace(/,/g, '')) : undefined;

  if (earnings !== null) {
    // Uber Eats "Earnings" includes the offer-item value at full price, but the customer
    // never paid that portion — HT covered it. Deduct offer costs so gross_revenue = actual customer spend.
    const htOffers = offersAmount + redemptionAmount;
    const grossRevenue = Math.round((earnings - htOffers) * 100) / 100;
    const breakdown: PlatformFinancialBreakdown = {
      earnings: grossRevenue || undefined,
      platform_commission: platformCommission || undefined,
      ad_spend: adSpend || undefined,
      // offer_redemption intentionally omitted — already deducted from gross_revenue
      adjustments: adjustments || undefined,
    };
    return {
      gross_revenue: grossRevenue,
      platform_payout,
      financial_breakdown: breakdown,
      confidence: 'high',
      matched_pattern: `Earnings £${earnings} − offers £${htOffers}`,
      raw_text: raw,
    };
  }

  // Fallback: if Total payout found but not the breakdown, return 0 gross — user must enter fee basis manually
  if (platform_payout !== undefined) {
    return {
      gross_revenue: 0,
      platform_payout,
      confidence: 'low',
      matched_pattern: `Total payout £${platform_payout} — enter net sales (earnings minus offers) manually`,
      raw_text: raw,
    };
  }

  // Legacy fallback: estimate from marketplace fee (old Uber invoice format)
  const marketplaceFeeNet = text.match(/Marketplace\s+Fee[\s\S]*?£[\d,.]+[\s\S]*?£([\d,]+\.?\d*)/i);
  if (marketplaceFeeNet?.[1]) {
    const feeAmount = parseFloat(marketplaceFeeNet[1].replace(/,/g, ''));
    return {
      gross_revenue: Math.round((feeAmount / 0.30) * 100) / 100,
      confidence: 'low',
      matched_pattern: `Estimated from Marketplace Fee £${feeAmount} (assumed 30% — PLEASE VERIFY)`,
      raw_text: raw,
    };
  }

  const totalPayable = text.match(/Total\s+amount\s+payable[\s\t]*£([\d,]+\.?\d*)/i);
  if (totalPayable?.[1]) {
    return {
      gross_revenue: parseFloat(totalPayable[1].replace(/,/g, '')),
      confidence: 'low',
      matched_pattern: 'Total amount payable (fees, not gross — PLEASE VERIFY)',
      raw_text: raw,
    };
  }

  return {
    gross_revenue: 0,
    confidence: 'low',
    matched_pattern: null,
    raw_text: raw,
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
  platform: Platform,
  options?: PDFParseOptions
): PDFParseResult {
  // Deliveroo: use "Period covered" billing period (precise) before falling back to generic patterns
  const weekFromFile = platform === 'deliveroo'
    ? (extractDeliverooWeek(text) ?? extractWeekFromPDFText(text))
    : extractWeekFromPDFText(text);
  let result: PDFParseResult;
  switch (platform) {
    case 'deliveroo':
      result = extractDeliverooRevenue(text, options);
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
