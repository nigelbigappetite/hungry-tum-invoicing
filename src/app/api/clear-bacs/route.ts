import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Clears stored BACS/Stripe IDs for a franchisee so they can complete
 * "Set up BACS" again (e.g. after switching from test to live Stripe keys).
 */
export async function POST(request: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const franchiseeId = body?.franchiseeId ?? null;
    if (!franchiseeId || typeof franchiseeId !== 'string') {
      return NextResponse.json({ error: 'Franchisee ID is required' }, { status: 400 });
    }

    const supabase = createClient(url, serviceRoleKey);
    const { error } = await supabase
      .from('franchisees')
      .update({
        stripe_customer_id: null,
        bacs_payment_method_id: null,
      })
      .eq('id', franchiseeId.trim());

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'BACS details cleared. Use "Set up BACS" to set up again (e.g. with live Stripe).',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to clear BACS';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
