import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';
import InvoicePDF from '@/components/InvoicePDF';
import { formatRecommendedBacsDateFromInvoiceDate, getSlerpPayoutDateForInvoiceWeek, getSlerpSalesPeriodEndForInvoiceWeek } from '@/lib/utils';
import { createElement } from 'react';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { invoiceId, testEmail } = body as { invoiceId?: string; testEmail?: string };
    if (!invoiceId || typeof invoiceId !== 'string') {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('*')
      .eq('id', invoice.franchisee_id)
      .single();

    if (franchiseeError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    const toEmail = typeof testEmail === 'string' && testEmail.trim()
      ? testEmail.trim()
      : franchisee.email;
    if (!toEmail) {
      return NextResponse.json({ error: 'Franchisee has no email' }, { status: 400 });
    }

    let reportsQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .eq('week_start_date', invoice.week_start_date)
      .eq('week_end_date', invoice.week_end_date)
      .in('platform', ['deliveroo', 'ubereats', 'justeat']);
    if (invoice.brand?.trim()) {
      reportsQuery = reportsQuery.eq('brand', invoice.brand.trim());
    }
    const { data: reports, error: reportsError } = await reportsQuery.order('platform');

    if (reportsError) {
      return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
    }

    const slerpPayoutDate = getSlerpPayoutDateForInvoiceWeek(invoice.week_end_date);
    const slerpSalesPeriodEnd = getSlerpSalesPeriodEndForInvoiceWeek(invoice.week_end_date);
    let slerpQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .eq('platform', 'slerp')
      .eq('week_end_date', slerpSalesPeriodEnd);
    if (invoice.brand?.trim()) {
      slerpQuery = slerpQuery.eq('brand', invoice.brand.trim());
    }
    const { data: slerpReports } = await slerpQuery.order('week_start_date');

    const paymentDaysNum = process.env.INVOICE_PAYMENT_DAYS != null ? Number(process.env.INVOICE_PAYMENT_DAYS) : NaN;
    const paymentDetails = {
      paymentDays: Number.isFinite(paymentDaysNum) ? paymentDaysNum : undefined,
      bankName: process.env.INVOICE_BANK_NAME || undefined,
      sortCode: process.env.INVOICE_SORT_CODE || undefined,
      accountNumber: process.env.INVOICE_ACCOUNT_NUMBER || undefined,
    };

    const bacsCollectionDate = franchisee.bacs_payment_method_id && invoice.created_at
      ? formatRecommendedBacsDateFromInvoiceDate(invoice.created_at)
      : undefined;

    const publicDir = path.resolve(process.cwd(), 'public');
    const logoPathCandidate =
      process.env.INVOICE_LOGO_PATH ||
      path.join(publicDir, 'Hungry Tum Logo.png');
    const logoPath = fs.existsSync(logoPathCandidate) ? path.resolve(logoPathCandidate) : undefined;

    const businessAddressRaw = process.env.INVOICE_BUSINESS_ADDRESS?.trim();
    const businessAddressLines = businessAddressRaw
      ? businessAddressRaw.replace(/\\n/g, '\n').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : undefined;

    const element = createElement(InvoicePDF, {
      invoice,
      franchisee,
      reports: reports || [],
      slerpReports: slerpReports || [],
      slerpPayoutDate: (slerpReports?.length ?? 0) > 0 ? slerpPayoutDate : undefined,
      paymentDetails,
      bacsCollectionDate,
      logoPath,
      businessAddressLines,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(element as any);
    const pdfUint8 = new Uint8Array(pdfBuffer);

    const pdfPath = `invoices/${invoice.invoice_number}.pdf`;
    try {
      const { error: uploadError } = await supabase.storage
        .from('invoicing')
        .upload(pdfPath, pdfUint8, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (!uploadError) {
        await supabase.from('invoices').update({ pdf_path: pdfPath }).eq('id', invoiceId);
      }
    } catch {
      // continue to send email even if storage fails
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.INVOICE_EMAIL_FROM || process.env.BACS_EMAIL_FROM || 'Hungry Tum <onboarding@resend.dev>';
    if (!resendKey) {
      return NextResponse.json(
        { error: 'Email not configured. Add RESEND_API_KEY to .env.local.' },
        { status: 500 }
      );
    }

    const resend = new Resend(resendKey);
    const firstName = franchisee.name?.split(/\s+/)[0] || 'there';
    const filename = `${invoice.invoice_number}.pdf`;
    const amountPence = Math.round(Number(invoice.fee_amount) * 100);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      request.headers.get('origin') ||
      'http://localhost:3000';
    let paymentLinkHtml = '';
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (stripeSecretKey && amountPence >= 50 && invoice.status !== 'paid') {
      try {
        const stripe = new Stripe(stripeSecretKey);
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'gbp',
                unit_amount: amountPence,
                product_data: {
                  name: `Invoice ${invoice.invoice_number}`,
                  description: `Franchise fee invoice ${invoice.invoice_number}`,
                },
              },
            },
          ],
          metadata: {
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
          },
          success_url: `${baseUrl}/invoices?paid=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/invoices?canceled=1`,
        });
        if (session.url) {
          paymentLinkHtml = `
            <p>You can also pay instantly by card here:<br />
            <a href="${session.url}">${session.url}</a></p>
          `;
        }
      } catch (stripeError) {
        console.warn('Failed to create Stripe payment link for invoice email:', stripeError);
      }
    }
    const bankDetailsHtml =
      paymentDetails.bankName || paymentDetails.sortCode || paymentDetails.accountNumber
        ? `
          <p>To pay by bank transfer, please use the following details:</p>
          <p>
            ${paymentDetails.bankName ? `Bank: ${paymentDetails.bankName}<br />` : ''}
            ${paymentDetails.sortCode ? `Sort code: ${paymentDetails.sortCode}<br />` : ''}
            ${paymentDetails.accountNumber ? `Account number: ${paymentDetails.accountNumber}<br />` : ''}
            Reference: ${invoice.invoice_number}
          </p>
        `
        : '';
    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: toEmail,
      subject: `Your Hungry Tum invoice ${invoice.invoice_number}`,
      html: `
        <p>Hi ${firstName},</p>
        <p>Please find your franchise fee invoice for the period ${invoice.week_start_date} to ${invoice.week_end_date} attached.</p>
        ${bankDetailsHtml}
        ${paymentLinkHtml}
        <p>If you have any questions, please get in touch.</p>
        <p>— Hungry Tum</p>
      `,
      attachments: [
        {
          filename,
          content: Buffer.from(pdfUint8).toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    });

    if (emailError) {
      console.error('Resend error:', emailError);
      return NextResponse.json(
        { error: `Failed to send email: ${emailError.message}` },
        { status: 500 }
      );
    }

    await supabase.from('invoices').update({ status: 'sent' }).eq('id', invoiceId);

    return NextResponse.json({
      success: true,
      message: testEmail ? `Invoice sent to ${toEmail} (test address).` : `Invoice sent to ${toEmail}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Send invoice email error:', error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? message : 'Failed to send invoice email' },
      { status: 500 }
    );
  }
}
