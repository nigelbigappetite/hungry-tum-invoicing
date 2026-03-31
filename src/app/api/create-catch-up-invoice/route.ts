import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type SourceInvoiceRow = {
  id: string;
  invoice_number: string;
  franchisee_id: string;
  brand: string | null;
  brands?: string[] | null;
  week_start_date: string;
  week_end_date: string;
  total_gross_revenue: number | string | null;
  fee_amount: number | string | null;
  status: string;
  line_items?: unknown;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateLabel(dateStr: string): string {
  const parsed = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? dateStr
    : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { franchiseeId, invoiceIds } = body as { franchiseeId?: string; invoiceIds?: string[] };

    if (!franchiseeId || typeof franchiseeId !== 'string') {
      return NextResponse.json({ error: 'franchiseeId is required' }, { status: 400 });
    }
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one invoice' }, { status: 400 });
    }

    const uniqueInvoiceIds = [...new Set(invoiceIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
    if (uniqueInvoiceIds.length === 0) {
      return NextResponse.json({ error: 'Select at least one valid invoice' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: sourceInvoices, error: sourceInvoicesError } = await supabase
      .from('invoices')
      .select('id, invoice_number, franchisee_id, brand, brands, week_start_date, week_end_date, total_gross_revenue, fee_amount, status, line_items')
      .in('id', uniqueInvoiceIds)
      .order('week_end_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (sourceInvoicesError) {
      return NextResponse.json({ error: sourceInvoicesError.message || 'Failed to load invoices' }, { status: 500 });
    }

    const rows = (sourceInvoices ?? []) as SourceInvoiceRow[];
    if (rows.length !== uniqueInvoiceIds.length) {
      return NextResponse.json({ error: 'One or more invoices could not be found' }, { status: 404 });
    }
    if (rows.some((row) => row.franchisee_id !== franchiseeId)) {
      return NextResponse.json({ error: 'All invoices must belong to the same franchisee' }, { status: 400 });
    }
    if (rows.some((row) => row.status === 'paid' || row.status === 'processing')) {
      return NextResponse.json({ error: 'Paid or processing invoices cannot be bundled' }, { status: 400 });
    }
    if (rows.some((row) => Array.isArray(row.line_items) && row.line_items.length > 0)) {
      return NextResponse.json({ error: 'Catch-up invoices cannot be bundled again' }, { status: 400 });
    }

    const sortedRows = [...rows].sort((a, b) => {
      if (a.week_end_date === b.week_end_date) return b.week_start_date.localeCompare(a.week_start_date);
      return b.week_end_date.localeCompare(a.week_end_date);
    });
    const periodStart = [...rows].map((row) => row.week_start_date).sort()[0];
    const periodEnd = [...rows].map((row) => row.week_end_date).sort().slice(-1)[0];
    const totalGrossRevenue = Math.round(sortedRows.reduce((sum, row) => sum + toNumber(row.total_gross_revenue), 0) * 100) / 100;
    const feeAmount = Math.round(sortedRows.reduce((sum, row) => sum + toNumber(row.fee_amount), 0) * 100) / 100;
    const feePercentage = totalGrossRevenue > 0 ? Math.round((feeAmount / totalGrossRevenue) * 10000) / 100 : 0;
    const brands = [...new Set(sortedRows.flatMap((row) => {
      if (Array.isArray(row.brands) && row.brands.length > 0) return row.brands.filter(Boolean);
      return row.brand?.trim() ? [row.brand.trim()] : [];
    }))];
    const lineItems = sortedRows.map((row) => ({
      label: `${formatDateLabel(row.week_start_date)} to ${formatDateLabel(row.week_end_date)}`,
      period_start: row.week_start_date,
      period_end: row.week_end_date,
      gross_revenue: Math.round(toNumber(row.total_gross_revenue) * 100) / 100,
      fee_amount: Math.round(toNumber(row.fee_amount) * 100) / 100,
      source_invoice_id: row.id,
      source_invoice_number: row.invoice_number,
    }));

    const { data: createdInvoice, error: createError } = await supabase
      .from('invoices')
      .insert({
        franchisee_id: franchiseeId,
        brand: null,
        brands: brands.length > 0 ? brands : null,
        source_invoice_ids: sortedRows.map((row) => row.id),
        line_items: lineItems,
        week_start_date: periodStart,
        week_end_date: periodEnd,
        total_gross_revenue: totalGrossRevenue,
        fee_percentage: feePercentage,
        fee_amount: feeAmount,
        status: 'draft',
      })
      .select('*')
      .single();

    if (createError || !createdInvoice) {
      return NextResponse.json({ error: createError?.message || 'Failed to create catch-up invoice' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      invoice: createdInvoice,
      message: `Catch-up invoice created for ${sortedRows.length} invoice${sortedRows.length === 1 ? '' : 's'}.`,
    });
  } catch (error) {
    console.error('create-catch-up-invoice error:', error);
    return NextResponse.json({ error: 'Failed to create catch-up invoice' }, { status: 500 });
  }
}
