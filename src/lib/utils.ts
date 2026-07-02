import { format, startOfWeek, endOfWeek, parseISO, addDays } from 'date-fns';
import type { Franchisee } from '@/lib/types';
import type { Platform } from '@/lib/types';

/** Fee % for a platform (percentage_per_platform uses deliveroo/ubereats/justeat %; otherwise percentage_rate). */
export function getPlatformFeeRate(f: Franchisee | null, platform: Platform): number {
  if (!f) return 6;
  if (platform === 'slerp') return Number(f.slerp_percentage) || 0;
  if (f.payment_model === 'percentage_per_platform') {
    const v =
      platform === 'deliveroo'
        ? f.deliveroo_percentage
        : platform === 'ubereats'
          ? f.ubereats_percentage
          : f.justeat_percentage;
    return Number(v) || 0;
  }
  return Number(f.percentage_rate) || 6;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amount);
}

export function formatDate(date: string): string {
  return format(parseISO(date), 'dd MMM yyyy');
}

export function getWeekRange(dateStr: string): { start: Date; end: Date } {
  const date = parseISO(dateStr);
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  };
}

export function formatWeekRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export function generateInvoiceNumber(sequenceNum: number): string {
  const year = new Date().getFullYear();
  return `HT-${year}-${String(sequenceNum).padStart(4, '0')}`;
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Slerp: payout every Monday for a Tue–Mon sales period, after 7 days maturity.
 * For a fulfillment date, first find the Monday that ends its Tue–Mon sales period,
 * then add 7 days to get the payout Monday.
 */
export function getSlerpPayoutDateFromFulfillment(fulfillmentDate: Date): Date {
  const d = new Date(fulfillmentDate);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const daysUntilMonday = day === 1 ? 0 : (8 - day) % 7;
  const salesPeriodEndMonday = addDays(d, daysUntilMonday);
  return addDays(salesPeriodEndMonday, 7);
}

/**
 * Slerp: for a payout Monday, the sales period that gets paid is the *previous* Tue–Mon week.
 * E.g. payout Monday 16 Feb → sales Tue 3 Feb – Mon 9 Feb (paid the following Monday).
 */
export function getSlerpSalesPeriod(payoutDate: Date): { weekStart: Date; weekEnd: Date } {
  const payoutMonday = new Date(payoutDate);
  const salesPeriodEndMonday = addDays(payoutMonday, -7); // previous Monday
  const salesPeriodStartTuesday = addDays(salesPeriodEndMonday, -6);
  return {
    weekEnd: salesPeriodEndMonday,
    weekStart: salesPeriodStartTuesday,
  };
}

/** For an invoice week (Mon–Sun), the Slerp payout date shown is the Monday after that week (i.e. day after Sunday). */
export function getSlerpPayoutDateForInvoiceWeek(weekEndDate: string): string {
  const sunday = parseISO(weekEndDate);
  const monday = addDays(sunday, 1);
  return format(monday, 'yyyy-MM-dd');
}

/** For an invoice week (Mon–Sun), the Slerp sales-period week_end_date we store (Monday ending the sales period that pays on the following Monday). */
export function getSlerpSalesPeriodEndForInvoiceWeek(weekEndDate: string): string {
  const payoutMonday = parseISO(getSlerpPayoutDateForInvoiceWeek(weekEndDate));
  const salesPeriodEndMonday = addDays(payoutMonday, -7);
  return format(salesPeriodEndMonday, 'yyyy-MM-dd');
}

/**
 * Given any date (string or Date), return the containing Monday–Sunday week as yyyy-MM-dd.
 * If the input is a "week ending" (Sunday), pass that date; it will be used as week_end_date.
 * If the input is any day in the week, the full week is returned.
 */
export function getWeekRangeFromDate(
  dateInput: string | Date
): { week_start_date: string; week_end_date: string } {
  const date = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return {
    week_start_date: format(start, 'yyyy-MM-dd'),
    week_end_date: format(end, 'yyyy-MM-dd'),
  };
}

/**
 * Parse a date string in common formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, "d MMM yyyy", etc.).
 * Returns null if unparseable.
 */
export function parseFlexibleDate(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const str = String(value ?? '').trim();
  if (!str) return null;
  // ISO
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYYMMDD (e.g. from filenames: 20260202)
  const ymd = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd) {
    const d = new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  // Try native Date parse for "14 Jan 2024" etc.
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}
