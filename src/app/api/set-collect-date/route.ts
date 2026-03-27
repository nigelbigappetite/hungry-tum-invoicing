import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { invoiceId, collect_from_date } = await request.json() as {
      invoiceId?: string;
      collect_from_date?: string | null;
    };

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('invoices')
      .update({ collect_from_date: collect_from_date ?? null })
      .eq('id', invoiceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update collect date' }, { status: 500 });
  }
}
