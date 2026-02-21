import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLastFullMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    periodStart: formatDateOnly(start),
    periodEnd: formatDateOnly(end),
  };
}

function getRangeForMonth(monthStr: string) {
  const normalized = String(monthStr || '').trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) return null;
  const [yearStr, monthPart] = normalized.split('-');
  const year = Number(yearStr);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    periodStart: formatDateOnly(start),
    periodEnd: formatDateOnly(end),
    label: normalized,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { franchiseeId, invoiceMonth } = body as { franchiseeId?: string; invoiceMonth?: string };

    if (!franchiseeId || typeof franchiseeId !== 'string') {
      return NextResponse.json({ error: 'franchiseeId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('id, payment_model, monthly_fee')
      .eq('id', franchiseeId)
      .single();

    if (franchiseeError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }
    if (franchisee.payment_model !== 'monthly_fixed') {
      return NextResponse.json(
        { error: 'Monthly invoice generation is only available for monthly_fixed franchisees.' },
        { status: 400 }
      );
    }

    const monthlyFee = Number(franchisee.monthly_fee ?? 0);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) {
      return NextResponse.json(
        { error: 'Monthly fee must be set for this franchisee before generating an invoice.' },
        { status: 400 }
      );
    }

    const selectedRange = typeof invoiceMonth === 'string' && invoiceMonth.trim()
      ? getRangeForMonth(invoiceMonth)
      : null;
    if (typeof invoiceMonth === 'string' && invoiceMonth.trim() && !selectedRange) {
      return NextResponse.json({ error: 'invoiceMonth must be in yyyy-MM format.' }, { status: 400 });
    }
    const { periodStart, periodEnd } = selectedRange ?? getLastFullMonthRange();
    const periodLabel = selectedRange?.label ?? 'last month';
    const { data: existingInvoice, error: existingError } = await supabase
      .from('invoices')
      .select('*')
      .eq('franchisee_id', franchiseeId)
      .eq('week_start_date', periodStart)
      .eq('week_end_date', periodEnd)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message || 'Failed to check existing invoice' }, { status: 500 });
    }

    if (existingInvoice) {
      return NextResponse.json({
        success: true,
        created: false,
        invoice: existingInvoice,
        message: `Invoice already exists for ${periodLabel} (status: ${existingInvoice.status}). Returned existing invoice.`,
      });
    }

    const feeAmount = Math.round(monthlyFee * 100) / 100;
    const { data: createdInvoice, error: createError } = await supabase
      .from('invoices')
      .insert({
        franchisee_id: franchiseeId,
        week_start_date: periodStart,
        week_end_date: periodEnd,
        total_gross_revenue: 0,
        fee_percentage: 0,
        fee_amount: feeAmount,
        status: 'draft',
      })
      .select('*')
      .single();

    if (createError || !createdInvoice) {
      return NextResponse.json({ error: createError?.message || 'Failed to create monthly invoice' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      created: true,
      invoice: createdInvoice,
      message: `Monthly invoice created for ${periodLabel}.`,
    });
  } catch (error) {
    console.error('create-monthly-invoice error:', error);
    return NextResponse.json({ error: 'Failed to create monthly invoice' }, { status: 500 });
  }
}
