import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoiceId } = body as { invoiceId?: string };

    if (!invoiceId || typeof invoiceId !== 'string') {
      return NextResponse.json(
        { error: 'invoiceId is required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId);

    if (error) {
      console.error('delete-invoice error:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to delete invoice' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Invoice deleted.' });
  } catch (error) {
    console.error('delete-invoice error:', error);
    return NextResponse.json(
      { error: 'Failed to delete invoice' },
      { status: 500 }
    );
  }
}
