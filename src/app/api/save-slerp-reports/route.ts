import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { franchiseeId, brand, payWeeks, sourceMode } = body as {
      franchiseeId?: string;
      brand?: string;
      payWeeks?: Array<{ weekStart: string; weekEnd: string; grossRevenue: number }>;
      sourceMode?: 'invoice_gross' | 'stripe_payout_72';
    };

    if (!franchiseeId || !brand?.trim() || !Array.isArray(payWeeks) || payWeeks.length === 0) {
      return NextResponse.json(
        { error: 'franchiseeId, brand, and at least one payWeek are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: franchisee, error: feError } = await supabase
      .from('franchisees')
      .select('id, slerp_percentage')
      .eq('id', franchiseeId)
      .single();

    if (feError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    const feePct = Number(franchisee.slerp_percentage) || 0;
    const franchiseeSharePct = Math.max(0, 100 - feePct);
    const fromStripePayout = sourceMode === 'stripe_payout_72';
    const round2 = (n: number) => Math.round(n * 100) / 100;

    const rows = payWeeks.map((w) => {
      const inputAmount = Number(w.grossRevenue) || 0;
      const grossRevenue =
        fromStripePayout && franchiseeSharePct > 0
          ? round2(inputAmount / (franchiseeSharePct / 100))
          : round2(inputAmount);

      return {
      franchisee_id: franchiseeId,
      brand: brand.trim(),
      platform: 'slerp',
      week_start_date: w.weekStart,
      week_end_date: w.weekEnd,
      gross_revenue: grossRevenue,
      file_path: null,
      file_type: 'xlsx' as const,
      };
    });

    for (const row of rows) {
      const { error: deleteError } = await supabase
        .from('weekly_reports')
        .delete()
        .eq('franchisee_id', row.franchisee_id)
        .eq('brand', row.brand)
        .eq('platform', row.platform)
        .eq('week_start_date', row.week_start_date)
        .eq('week_end_date', row.week_end_date);

      if (deleteError) {
        return NextResponse.json(
          { error: deleteError.message || 'Failed to replace existing Slerp report' },
          { status: 500 }
        );
      }

      const { error: insertError } = await supabase.from('weekly_reports').insert(row);
      if (insertError) {
        return NextResponse.json(
          { error: insertError.message || 'Failed to save Slerp reports' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ saved: rows.length, mode: fromStripePayout ? 'stripe_payout_72' : 'invoice_gross' });
  } catch (err) {
    console.error('save-slerp-reports error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save' },
      { status: 500 }
    );
  }
}
