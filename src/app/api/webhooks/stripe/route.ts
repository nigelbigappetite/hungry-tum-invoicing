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
    // BACS payment confirmed – mark invoice paid
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata?.invoice_id;
    if (invoiceId && url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey);
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          payment_intent_id: paymentIntent.id,
          payment_failure_reason: null,
        })
        .eq('id', invoiceId);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    // BACS payment declined by bank – mark invoice failed so admin can retry
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const invoiceId = paymentIntent.metadata?.invoice_id;
    const invoiceNumber = paymentIntent.metadata?.invoice_number;
    if (invoiceId && url && serviceRoleKey) {
      const supabase = createClient(url, serviceRoleKey);
      const lastError = paymentIntent.last_payment_error;
      const failureReason =
        lastError?.decline_code ?? lastError?.code ?? lastError?.message ?? 'Payment declined';

      await supabase
        .from('invoices')
        .update({
          status: 'failed',
          payment_intent_id: paymentIntent.id,
          payment_failure_reason: failureReason,
        })
        .eq('id', invoiceId);

      // Create a draft failure notification email for admin review
      const { data: invoice } = await supabase
        .from('invoices')
        .select('franchisee_id, fee_amount')
        .eq('id', invoiceId)
        .single();

      if (invoice) {
        const { data: franchisee } = await supabase
          .from('franchisees')
          .select('name, email')
          .eq('id', invoice.franchisee_id)
          .single();

        if (franchisee?.email) {
          const firstName = franchisee.name?.split(/\s+/)[0] || 'there';
          const amount = `£${Number(invoice.fee_amount).toFixed(2)}`;
          const ref = invoiceNumber ?? invoiceId;

          const subject = `Action Required – Payment Collection Unsuccessful | Invoice ${ref}`;
          const body = `Hi ${firstName},

I hope you're well. I'm getting in touch to let you know that our recent attempt to collect payment for Invoice ${ref} (${amount}) via BACS Direct Debit was unsuccessful.

We'll automatically retry the collection in the next few business days. In most cases this resolves itself, so no immediate action is needed.

However, if you're aware of any issues with your bank account or would prefer to arrange payment another way, please don't hesitate to get in touch and we'll sort it out together. It's important we get this resolved promptly to keep your account in good standing.

If you have any questions at all, just reply to this email.

Thanks,
Hungry Tum`;

          await supabase.from('email_drafts').insert({
            invoice_id: invoiceId,
            franchisee_id: invoice.franchisee_id,
            to_email: franchisee.email,
            subject,
            body,
            trigger: 'payment_failed',
          });
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
