import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseMonthStart(monthStr: string): Date | null {
  const m = String(monthStr || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [yearStr, monthPart] = m.split('-');
  const year = Number(yearStr);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

function getLastFullMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { franchiseeId, startMonth, initialArrears } = body as {
      franchiseeId?: string;
      startMonth?: string;
      initialArrears?: number;
    };

    if (!franchiseeId || typeof franchiseeId !== 'string') {
      return NextResponse.json({ error: 'franchiseeId is required' }, { status: 400 });
    }
    const parsedStart = parseMonthStart(startMonth ?? '');
    if (!parsedStart) {
      return NextResponse.json({ error: 'startMonth must be yyyy-MM' }, { status: 400 });
    }
    const arrears = Number(initialArrears);
    if (!Number.isFinite(arrears) || arrears < 0) {
      return NextResponse.json({ error: 'initialArrears must be a non-negative number' }, { status: 400 });
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
      return NextResponse.json({ error: 'Backfill is only available for monthly_fixed franchisees.' }, { status: 400 });
    }

    const monthlyFee = Number(franchisee.monthly_fee ?? 0);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) {
      return NextResponse.json({ error: 'Monthly fee must be set before backfilling.' }, { status: 400 });
    }

    const endMonthStart = getLastFullMonthStart();
    let effectiveStart = parsedStart;
    let adjustedStartMonth: string | null = null;
    if (effectiveStart > endMonthStart) {
      // UX helper: if user picks e.g. Jun this year while we're in Jan, assume previous year Jun.
      const shiftedOneYearBack = new Date(effectiveStart.getFullYear() - 1, effectiveStart.getMonth(), 1);
      if (shiftedOneYearBack <= endMonthStart) {
        effectiveStart = shiftedOneYearBack;
        adjustedStartMonth = `${effectiveStart.getFullYear()}-${String(effectiveStart.getMonth() + 1).padStart(2, '0')}`;
      } else {
        return NextResponse.json({ error: 'startMonth must be before or equal to last full month.' }, { status: 400 });
      }
    }

    let remainingArrears = Math.round(arrears * 100) / 100;
    let cursor = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth(), 1);
    let createdCount = 0;
    let skippedCount = 0;
    const monthsProcessed: Array<{
      month: string;
      waivedAmount: number;
      feeAmount: number;
      created: boolean;
      invoiceId?: string;
    }> = [];

    while (cursor <= endMonthStart) {
      const periodStart = formatDateOnly(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      const periodEnd = formatDateOnly(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      const monthLabel = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;

      const { data: existingInvoice } = await supabase
        .from('invoices')
        .select('id')
        .eq('franchisee_id', franchiseeId)
        .eq('week_start_date', periodStart)
        .eq('week_end_date', periodEnd)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const waiveAmount = Math.min(monthlyFee, remainingArrears);
      const feeAmount = Math.round(monthlyFee * 100) / 100;
      const balanceAfter = Math.max(0, Math.round((remainingArrears - waiveAmount) * 100) / 100);

      if (existingInvoice) {
        skippedCount += 1;
        monthsProcessed.push({
          month: monthLabel,
          waivedAmount: Math.round(waiveAmount * 100) / 100,
          feeAmount,
          balanceAfter,
          created: false,
          invoiceId: existingInvoice.id,
        });
      } else {
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
            created_at: `${periodEnd}T12:00:00Z`,
          })
          .select('id')
          .single();

        if (createError || !createdInvoice) {
          return NextResponse.json({ error: createError?.message || `Failed creating invoice for ${monthLabel}` }, { status: 500 });
        }

        createdCount += 1;
        monthsProcessed.push({
          month: monthLabel,
          waivedAmount: Math.round(waiveAmount * 100) / 100,
          feeAmount,
          balanceAfter,
          created: true,
          invoiceId: createdInvoice.id,
        });
      }

      remainingArrears = balanceAfter;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    return NextResponse.json({
      success: true,
      message: `Backfill complete: ${createdCount} created, ${skippedCount} skipped.`,
      createdCount,
      skippedCount,
      adjustedStartMonth,
      startingArrears: Math.round(arrears * 100) / 100,
      remainingArrears,
      monthlyFee: Math.round(monthlyFee * 100) / 100,
      monthsProcessed,
    });
  } catch (error) {
    console.error('backfill-monthly-invoices error:', error);
    return NextResponse.json({ error: 'Failed to backfill monthly invoices' }, { status: 500 });
  }
}
