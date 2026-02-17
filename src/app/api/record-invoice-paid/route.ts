import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Record that we have paid the franchisee (for pay_them flow).
 * Sets invoice status to 'paid'. Used when you have paid them their due funds manually.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, status, franchisee_id')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'This invoice is already marked as paid' }, { status: 400 });
    }

    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('id, payment_direction')
      .eq('id', invoice.franchisee_id)
      .single();

    if (franchiseeError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    if (franchisee.payment_direction !== 'pay_them') {
      return NextResponse.json(
        { error: 'Record payment is only for franchisees we pay (payment direction: We pay them). Use the status dropdown or BACS for others.' },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'paid' })
      .eq('id', invoiceId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ message: 'Invoice marked as paid.', status: 'paid' });
  } catch (error) {
    console.error('Record invoice paid error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to record payment' },
      { status: 500 }
    );
  }
}
