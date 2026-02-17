import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Stripe webhook signature verification failed:', message);
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.mode === 'setup') {
      // BACS Direct Debit mandate setup: save payment method to franchisee
      const franchiseeId = session.metadata?.franchisee_id;
      const setupIntentId = session.setup_intent;
      if (!franchiseeId || !setupIntentId) {
        return NextResponse.json({ received: true });
      }
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId as string);
      const paymentMethodId = setupIntent.payment_method;
      if (!paymentMethodId || typeof paymentMethodId !== 'string') {
        return NextResponse.json({ received: true });
      }
      if (url && serviceRoleKey) {
        const supabase = createClient(url, serviceRoleKey);
        await supabase
          .from('franchisees')
          .update({
            stripe_customer_id: session.customer as string,
            bacs_payment_method_id: paymentMethodId,
          })
          .eq('id', franchiseeId);
      }
      return NextResponse.json({ received: true });
    }

    // One-off card payment: mark invoice paid
    const invoiceId = session.metadata?.invoice_id;
    if (invoiceId && url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey);
      await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId);
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    // BACS (or other) payment confirmed – mark invoice paid (BACS often goes processing → succeeded later)
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata?.invoice_id;
    if (invoiceId && url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey);
      await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId);
    }
  }

  return NextResponse.json({ received: true });
}
