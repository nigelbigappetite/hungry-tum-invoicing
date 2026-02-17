/**
 * Parse Slerp statement (xlsx) – Completed orders only.
 * We use the total from "Product total after discounts (GMV)" on the spreadsheet.
 * Columns: Fulfillment date, Location name, Product total after discounts (GMV), Status.
 * Exclude Luton (GFV). Group by (location, payout_date), sum that GMV.
 * Hungry Tum then adds our fee and % on the HT invoice.
 * Payout date = Monday for the previous Tue–Mon sales period.
 */

import {
  getSlerpPayoutDateFromFulfillment,
  getSlerpSalesPeriod,
} from '@/lib/utils';

const SLERP_LOCATION_EXCLUDED = 'luton'; // GFV site – do not invoice

export interface SlerpParsedRow {
  location: string;
  payoutDate: string; // yyyy-MM-dd (Monday)
  weekStart: string;
  weekEnd: string;
  grossRevenue: number;
}

export interface SlerpParseResult {
  payWeeks: SlerpParsedRow[];
  errors: string[];
}

function normalizeHeader(h: string): string {
  return (h ?? '').toString().trim().toLowerCase().replace(/\*+$/, '');
}

function findColumnIndex(
  headers: string[],
  ...candidates: string[]
): number {
  const normalized = headers.map(normalizeHeader);
  for (const c of candidates) {
    const idx = normalized.findIndex((h) =>
      h.includes(c.toLowerCase()) || c.toLowerCase().includes(h)
    );
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseGMV(value: unknown): number {
  if (value == null) return 0;
  const s = String(value).replace(/[£,\s]/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Parse DD/MM/YYYY or D/M/YYYY */
function parseSlerpDate(value: unknown): Date | null {
  if (value == null) return null;
  const s = String(value).trim();
  const parts = s.split(/[/-]/);
  if (parts.length !== 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year))
    return null;
  const d = new Date(year, month, day);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Parse xlsx buffer (SheetJS). Expect first sheet to contain Completed orders table. */
export function parseSlerpXlsx(buffer: Buffer): SlerpParseResult {
  const errors: string[] = [];
  // Dynamic import to avoid bundling xlsx in edge
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { payWeeks: [], errors: ['No sheets in workbook'] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  if (!data.length) {
    return { payWeeks: [], errors: ['Sheet is empty'] };
  }

  const headerRow = data[0].map((c) => String(c ?? ''));
  const iFulfillment = findColumnIndex(
    headerRow,
    'fulfillment date',
    'Fulfillment date'
  );
  const iLocation = findColumnIndex(
    headerRow,
    'location name',
    'Location name'
  );
  const iGMV = findColumnIndex(
    headerRow,
    'product total after discounts (gmv)',
    'Product total after discounts (GMV)'
  );
  const iStatus = findColumnIndex(headerRow, 'status', 'Status');

  if (iFulfillment < 0 || iLocation < 0 || iGMV < 0) {
    errors.push(
      'Could not find required columns: Fulfillment date, Location name, Product total after discounts (GMV).'
    );
    return { payWeeks: [], errors };
  }

  const map = new Map<string, { weekStart: string; weekEnd: string; payoutDate: string; gross: number }>();

  for (let r = 1; r < data.length; r++) {
    const row = data[r] as unknown[];
    if (!Array.isArray(row)) continue;

    const status = String(row[iStatus] ?? '').trim().toLowerCase();
    if (iStatus >= 0 && status !== 'fulfilled') continue;

    const locationRaw = String(row[iLocation] ?? '').trim();
    const locationNorm = locationRaw.toLowerCase();
    if (locationNorm === SLERP_LOCATION_EXCLUDED) continue;

    const fulfillmentDate = parseSlerpDate(row[iFulfillment]);
    if (!fulfillmentDate) continue;

    const gmv = parseGMV(row[iGMV]);
    if (gmv <= 0) continue;

    const payoutDate = getSlerpPayoutDateFromFulfillment(fulfillmentDate);
    const { weekStart, weekEnd } = getSlerpSalesPeriod(payoutDate);
    const payoutKey = `${locationRaw}|${payoutDate.toISOString().slice(0, 10)}`;
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const payoutDateStr = payoutDate.toISOString().slice(0, 10);

    const existing = map.get(payoutKey);
    if (existing) {
      existing.gross += gmv;
    } else {
      map.set(payoutKey, { weekStart: weekStartStr, weekEnd: weekEndStr, payoutDate: payoutDateStr, gross: gmv });
    }
  }

  const payWeeks: SlerpParsedRow[] = [];
  for (const [key, val] of map) {
    const [location] = key.split('|');
    payWeeks.push({
      location,
      payoutDate: val.payoutDate,
      weekStart: val.weekStart,
      weekEnd: val.weekEnd,
      grossRevenue: Math.round(val.gross * 100) / 100,
    });
  }
  payWeeks.sort((a, b) => a.payoutDate.localeCompare(b.payoutDate) || a.location.localeCompare(b.location));

  return { payWeeks, errors };
}
