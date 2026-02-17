import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

/**
 * Called when Stripe redirects the user after they complete BACS setup.
 * Updates the franchisee in the DB so the dashboard shows "BACS set up".
 * This works even when webhooks don't reach the app (e.g. local dev).
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId) {
    return NextResponse.redirect(new URL('/bacs-setup-complete', request.url));
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey || !url || !serviceRoleKey) {
    return NextResponse.redirect(new URL('/bacs-setup-complete', request.url));
  }

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['setup_intent'],
    });

    if (session.mode !== 'setup' || !session.setup_intent) {
      return NextResponse.redirect(new URL('/bacs-setup-complete', request.url));
    }

    const franchiseeId = session.metadata?.franchisee_id;
    const setupIntent =
      typeof session.setup_intent === 'object' ? session.setup_intent : null;
    const pm = setupIntent?.payment_method;
    const paymentMethodId =
      typeof pm === 'string' ? pm : (pm as { id?: string } | null)?.id ?? null;

    if (!franchiseeId || !paymentMethodId) {
      return NextResponse.redirect(new URL('/bacs-setup-complete', request.url));
    }

    const supabase = createClient(url, serviceRoleKey);
    await supabase
      .from('franchisees')
      .update({
        stripe_customer_id: session.customer as string,
        bacs_payment_method_id: paymentMethodId,
      })
      .eq('id', franchiseeId);
  } catch (err) {
    console.error('confirm-bacs-setup error:', err);
  }

  return NextResponse.redirect(new URL('/bacs-setup-complete', request.url));
}
