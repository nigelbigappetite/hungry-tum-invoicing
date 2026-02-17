import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json(
        { error: 'Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local.' },
        { status: 500 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Server configuration error. Ensure SUPABASE_SERVICE_ROLE_KEY is in .env.local.' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const franchiseeId = body?.franchiseeId ?? null;
    if (!franchiseeId || typeof franchiseeId !== 'string') {
      return NextResponse.json({ error: 'Franchisee ID is required' }, { status: 400 });
    }

    const supabase = createClient(url, serviceRoleKey);
    // Select only base columns so this works even if BACS columns weren’t added yet
    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('id, name, email')
      .eq('id', franchiseeId.trim())
      .single();

    if (franchiseeError) {
      console.error('Setup BACS franchisee lookup:', franchiseeError.message, 'code:', franchiseeError.code, 'id:', franchiseeId);
      const msg = process.env.NODE_ENV === 'development' ? `${franchiseeError.message} (id: ${franchiseeId})` : 'Franchisee not found';
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (!franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    // Optional: get existing Stripe customer id if BACS columns exist
    let stripeCustomerId: string | null = null;
    const { data: row } = await supabase
      .from('franchisees')
      .select('stripe_customer_id')
      .eq('id', franchiseeId)
      .single();
    if (row?.stripe_customer_id) stripeCustomerId = row.stripe_customer_id;

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      request.headers.get('origin') ||
      'http://localhost:3000';

    const stripe = new Stripe(secretKey);
    let customerId = stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: franchisee.email,
        name: franchisee.name,
        metadata: { franchisee_id: franchisee.id },
      });
      customerId = customer.id;
      const { error: updateErr } = await supabase
        .from('franchisees')
        .update({ stripe_customer_id: customerId })
        .eq('id', franchiseeId);
      if (updateErr) {
        console.warn('Could not save stripe_customer_id (run BACS migration?):', updateErr.message);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      payment_method_types: ['bacs_debit'],
      customer: customerId,
      metadata: { franchisee_id: franchiseeId },
      success_url: `${baseUrl}/api/confirm-bacs-setup?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/bacs-setup-complete?canceled=1`,
    });

    const setupUrl = session.url;
    if (!setupUrl) {
      return NextResponse.json({ error: 'Could not create setup link' }, { status: 500 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.BACS_EMAIL_FROM || 'Hungry Tum <onboarding@resend.dev>';
    if (!resendKey) {
      return NextResponse.json(
        { error: 'Email not configured. Add RESEND_API_KEY to .env.local to send the BACS setup link to the franchisee.' },
        { status: 500 }
      );
    }

    const resend = new Resend(resendKey);
    const firstName = franchisee.name?.split(/\s+/)[0] || 'there';
    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: franchisee.email,
      subject: 'Hungry Tum have invited you',
      html: `
        <p>Hi ${firstName},</p>
        <p>Hungry Tum have invited you to set up a BACS Direct Debit securely for your weekly franchise fee.</p>
        <p>You only pay when you’ve been paid by the platforms, and you will always receive an invoice and notice before any payment is taken.</p>
        <p><a href="${setupUrl}" style="display:inline-block; background:#ea580c; color:#fff; padding:12px 24px; text-decoration:none; border-radius:8px; font-weight:600;">Set up Direct Debit</a></p>
        <p>Or copy this link into your browser: ${setupUrl}</p>
        <p>— Hungry Tum</p>
      `,
    });

    if (emailError) {
      console.error('Resend error:', emailError);
      return NextResponse.json(
        { error: `Failed to send email: ${emailError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Email sent to ${franchisee.email} with a link to set up BACS.`,
    });
  } catch (error) {
    console.error('Setup BACS error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start BACS setup' },
      { status: 500 }
    );
  }
}
