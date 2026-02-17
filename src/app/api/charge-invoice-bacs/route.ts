import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json(
        { error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local.' },
        { status: 500 }
      );
    }

    const { invoiceId } = await request.json();
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, invoice_number, fee_amount, status, franchisee_id')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'This invoice is already paid' }, { status: 400 });
    }
    if (invoice.status === 'processing') {
      return NextResponse.json(
        { error: 'A BACS collection is already in progress for this invoice. It will be marked paid when the bank confirms.' },
        { status: 400 }
      );
    }

    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('id, stripe_customer_id, bacs_payment_method_id')
      .eq('id', invoice.franchisee_id)
      .single();

    if (franchiseeError || !franchisee?.stripe_customer_id || !franchisee?.bacs_payment_method_id) {
      return NextResponse.json(
        { error: 'This franchisee has not set up BACS Direct Debit. Ask them to set up BACS on the Franchisees page.' },
        { status: 400 }
      );
    }

    const amountPence = Math.round(Number(invoice.fee_amount) * 100);
    if (amountPence < 50) {
      return NextResponse.json(
        { error: 'Amount too small for BACS (minimum £0.50)' },
        { status: 400 }
      );
    }

    const stripe = new Stripe(secretKey);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency: 'gbp',
      payment_method_types: ['bacs_debit'],
      customer: franchisee.stripe_customer_id,
      payment_method: franchisee.bacs_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
      },
      description: `Invoice ${invoice.invoice_number}`,
    });

    // Set status to 'processing' when BACS is in progress; only webhook marks 'paid' when bank confirms.
    const isTestMode = secretKey.startsWith('sk_test_');
    if (paymentIntent.status === 'processing') {
      await supabase.from('invoices').update({ status: 'processing' }).eq('id', invoiceId);
      if (isTestMode) {
        // Test mode: also mark paid so you can test without webhooks to localhost
        await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoiceId);
      }
    }

    return NextResponse.json({
      status: paymentIntent.status,
      message:
        paymentIntent.status === 'processing'
          ? isTestMode
            ? 'BACS collection started. (Test mode: invoice marked paid immediately.)'
            : 'BACS collection started. Payment typically confirms in a few business days. The invoice will be marked paid automatically when the bank confirms (or stay unpaid if it bounces).'
          : paymentIntent.status === 'succeeded'
            ? 'Payment confirmed. The invoice will be marked paid by the webhook shortly.'
            : paymentIntent.status,
    });
  } catch (error) {
    const err = error as Stripe.errors.StripeError;
    const message = err?.message ?? (error instanceof Error ? error.message : 'Charge failed');
    console.error('Charge invoice BACS error:', error);
    return NextResponse.json(
      { error: message },
      { status: err?.statusCode && err.statusCode >= 400 ? err.statusCode : 500 }
    );
  }
}
