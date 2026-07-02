import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPlatformFeeRate } from '@/lib/utils';
import type { Platform, Franchisee } from '@/lib/types';

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { franchiseeId, weekStartDate, weekEndDate } = body as {
      franchiseeId?: string;
      weekStartDate?: string;
      weekEndDate?: string;
    };

    if (!franchiseeId || !weekStartDate || !weekEndDate) {
      return NextResponse.json(
        { error: 'franchiseeId, weekStartDate, and weekEndDate are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('*')
      .eq('id', franchiseeId)
      .single();

    if (franchiseeError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    if (franchisee.payment_model === 'monthly_fixed') {
      return NextResponse.json(
        { error: 'Use /api/create-monthly-invoice for monthly_fixed franchisees.' },
        { status: 400 }
      );
    }

    const { data: allReports, error: reportsError } = await supabase
      .from('weekly_reports')
      .select('platform, gross_revenue')
      .eq('franchisee_id', franchiseeId)
      .eq('week_start_date', weekStartDate)
      .eq('week_end_date', weekEndDate);

    if (reportsError) {
      return NextResponse.json({ error: reportsError.message }, { status: 500 });
    }

    const reports = allReports || [];
    const totalGrossAll = reports.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);

    const totalFeeAll =
      franchisee.payment_model === 'percentage_per_platform'
        ? reports.reduce(
            (s, r) =>
              s +
              Math.round(
                Number(r.gross_revenue ?? 0) *
                  (getPlatformFeeRate(franchisee as Franchisee, r.platform as Platform) / 100) *
                  100
              ) /
                100,
            0
          )
        : Math.round(totalGrossAll * ((franchisee.percentage_rate ?? 6) / 100) * 100) / 100;

    const roundedGross = Math.round(totalGrossAll * 100) / 100;
    const roundedFee = Math.round(totalFeeAll * 100) / 100;
    const effectivePct =
      roundedGross > 0
        ? Math.round((roundedFee / roundedGross) * 10000) / 100
        : (franchisee.percentage_rate ?? 6);

    const franchiseeBrands =
      Array.isArray(franchisee.brands) && franchisee.brands.length > 0
        ? (franchisee.brands as string[])
        : null;

    const { data: existingInvoices } = await supabase
      .from('invoices')
      .select('id, status, created_at')
      .eq('franchisee_id', franchiseeId)
      .eq('week_start_date', weekStartDate)
      .eq('week_end_date', weekEndDate)
      .order('created_at', { ascending: true });

    const toKeep = existingInvoices?.[0];
    const toDelete = (existingInvoices || []).slice(1);

    for (const inv of toDelete) {
      await supabase.from('invoices').delete().eq('id', inv.id);
    }

    let invoice;
    let created = false;
    const today = formatDateOnly(new Date());

    if (toKeep) {
      const { data: updated, error: updateError } = await supabase
        .from('invoices')
        .update({
          total_gross_revenue: roundedGross,
          fee_percentage: effectivePct,
          fee_amount: roundedFee,
          brands: franchiseeBrands,
        })
        .eq('id', toKeep.id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      invoice = updated;
    } else {
      if (roundedGross <= 0) {
        return NextResponse.json(
          { error: 'No revenue data for this week. Upload platform reports first.' },
          { status: 400 }
        );
      }
      const { data: inserted, error: insertError } = await supabase
        .from('invoices')
        .insert({
          franchisee_id: franchiseeId,
          brand: null,
          brands: franchiseeBrands,
          week_start_date: weekStartDate,
          week_end_date: weekEndDate,
          total_gross_revenue: roundedGross,
          fee_percentage: effectivePct,
          fee_amount: roundedFee,
          invoice_date: today,
          status: 'draft',
        })
        .select('*')
        .single();
      if (insertError) throw insertError;
      invoice = inserted;
      created = true;
    }

    return NextResponse.json({ success: true, invoice, created });
  } catch (error) {
    console.error('generate-weekly-invoice error:', error);
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 });
  }
}
