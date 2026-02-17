import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWeekRangeFromDate } from '@/lib/utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId, total_gross_revenue, fee_amount, fee_percentage, week_start_date } = body as {
      invoiceId?: string;
      total_gross_revenue?: number;
      fee_amount?: number;
      fee_percentage?: number;
      week_start_date?: string;
    };

    if (!invoiceId || typeof invoiceId !== 'string') {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .single();

    if (fetchError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft invoices can be edited' },
        { status: 400 }
      );
    }

    const updates: {
      total_gross_revenue?: number;
      fee_amount?: number;
      fee_percentage?: number;
      week_start_date?: string;
      week_end_date?: string;
    } = {};
    if (typeof total_gross_revenue === 'number' && total_gross_revenue >= 0) {
      updates.total_gross_revenue = Math.round(total_gross_revenue * 100) / 100;
    }
    if (typeof fee_amount === 'number' && fee_amount >= 0) {
      updates.fee_amount = Math.round(fee_amount * 100) / 100;
    }
    if (typeof fee_percentage === 'number' && fee_percentage >= 0) {
      updates.fee_percentage = Math.round(fee_percentage * 100) / 100;
    }
    if (typeof week_start_date === 'string' && week_start_date.trim()) {
      try {
        const { week_start_date: start, week_end_date: end } = getWeekRangeFromDate(week_start_date.trim());
        updates.week_start_date = start;
        updates.week_end_date = end;
      } catch {
        return NextResponse.json(
          { error: 'Invalid week date. Use the Monday that starts the week (yyyy-MM-dd).' },
          { status: 400 }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, message: 'No changes.' });
    }

    const { error: updateError } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId);

    if (updateError) {
      console.error('update-invoice error:', updateError);
      return NextResponse.json(
        { error: updateError.message || 'Failed to update invoice' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Invoice updated.' });
  } catch (error) {
    console.error('update-invoice error:', error);
    return NextResponse.json(
      { error: 'Failed to update invoice' },
      { status: 500 }
    );
  }
}
