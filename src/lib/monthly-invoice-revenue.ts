import { differenceInCalendarDays, parseISO } from 'date-fns';

type DateRange = {
  week_start_date: string;
  week_end_date: string;
};

type RevenueRow = {
  gross_revenue: number | null;
  week_end_date: string;
};

export function isExtendedInvoiceRange(weekStartDate: string, weekEndDate: string): boolean {
  return differenceInCalendarDays(parseISO(weekEndDate), parseISO(weekStartDate)) > 7;
}

export function reportFallsInExtendedInvoiceRange(
  reportWeekEndDate: string,
  invoice: DateRange
): boolean {
  return reportWeekEndDate >= invoice.week_start_date && reportWeekEndDate <= invoice.week_end_date;
}

export function sumRevenueRowsForExtendedInvoice(
  rows: RevenueRow[],
  invoice: DateRange
): number {
  return Math.round(
    rows.reduce((sum, row) => {
      if (!reportFallsInExtendedInvoiceRange(row.week_end_date, invoice)) return sum;
      return sum + Number(row.gross_revenue ?? 0);
    }, 0) * 100
  ) / 100;
}
