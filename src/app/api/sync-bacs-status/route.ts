import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

/**
 * Sync BACS status from Stripe for franchisees that have stripe_customer_id
 * but no bacs_payment_method_id (e.g. webhook didn't run when they completed setup).
 * Call with POST { franchiseeId?: string } - if omitted, syncs all franchisees with stripe_customer_id.
 */
export async function POST(request: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey || !url || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Missing STRIPE_SECRET_KEY or Supabase config' },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const franchiseeId = body?.franchiseeId;

  const supabase = createClient(url, serviceRoleKey);
  let query = supabase
    .from('franchisees')
    .select('id, name, stripe_customer_id, bacs_payment_method_id')
    .not('stripe_customer_id', 'is', null);

  if (franchiseeId) {
    query = query.eq('id', franchiseeId);
  }

  const { data: franchisees, error: fetchError } = await query;

  if (fetchError || !franchisees?.length) {
    return NextResponse.json(
      { updated: 0, message: 'No franchisees to sync' },
      { status: 200 }
    );
  }

  const stripe = new Stripe(secretKey);
  let updated = 0;

  for (const f of franchisees) {
    if (f.bacs_payment_method_id) continue;

    try {
      const methods = await stripe.paymentMethods.list({
        customer: f.stripe_customer_id!,
        type: 'bacs_debit',
      });

      const bacs = methods.data[0];
      if (bacs?.id) {
        const { error: updateErr } = await supabase
          .from('franchisees')
          .update({ bacs_payment_method_id: bacs.id })
          .eq('id', f.id);

        if (!updateErr) updated++;
      }
    } catch (err) {
      console.error('Sync BACS for franchisee', f.id, err);
    }
  }

  return NextResponse.json({
    updated,
    message:
      updated > 0
        ? `Updated ${updated} franchisee(s). Refresh the dashboard.`
        : 'No BACS payment methods found in Stripe for these franchisees.',
  });
}
