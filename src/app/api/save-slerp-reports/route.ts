import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { franchiseeId, brand, payWeeks } = body as {
      franchiseeId?: string;
      brand?: string;
      payWeeks?: Array<{ weekStart: string; weekEnd: string; grossRevenue: number }>;
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

    const rows = payWeeks.map((w) => ({
      franchisee_id: franchiseeId,
      brand: brand.trim(),
      platform: 'slerp',
      week_start_date: w.weekStart,
      week_end_date: w.weekEnd,
      gross_revenue: Number(w.grossRevenue),
      file_path: null,
      file_type: 'xlsx' as const,
    }));

    const { error: insertError } = await supabase.from('weekly_reports').insert(rows);

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message || 'Failed to save Slerp reports' },
        { status: 500 }
      );
    }

    return NextResponse.json({ saved: rows.length });
  } catch (err) {
    console.error('save-slerp-reports error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save' },
      { status: 500 }
    );
  }
}
