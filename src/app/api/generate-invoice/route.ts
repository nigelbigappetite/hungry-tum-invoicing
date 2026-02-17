import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import InvoicePDF from '@/components/InvoicePDF';
import { formatRecommendedBacsDateFromInvoiceDate, formatWeekRange, getSlerpPayoutDateForInvoiceWeek, getSlerpSalesPeriodEndForInvoiceWeek } from '@/lib/utils';
import { createElement } from 'react';

export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch invoice with franchisee
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Fetch franchisee
    const { data: franchisee, error: franchiseeError } = await supabase
      .from('franchisees')
      .select('*')
      .eq('id', invoice.franchisee_id)
      .single();

    if (franchiseeError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    // Fetch aggregator weekly reports for this invoice period (Mon–Sun). Combined invoice: no brand filter.
    let reportsQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .eq('week_start_date', invoice.week_start_date)
      .eq('week_end_date', invoice.week_end_date)
      .in('platform', ['deliveroo', 'ubereats', 'justeat']);
    const isCombinedInvoice = invoice.brands && Array.isArray(invoice.brands) && invoice.brands.length > 0;
    if (!isCombinedInvoice && invoice.brand?.trim()) {
      reportsQuery = reportsQuery.eq('brand', invoice.brand.trim());
    }
    const { data: reports, error: reportsError } = await reportsQuery.order('platform');

    if (reportsError) {
      return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
    }

    // Fetch Slerp: invoice week 9–15 Feb → payout Monday 16 Feb → sales period Tue 3–Mon 9 Feb (week_end_date = 9 Feb)
    const slerpPayoutDate = getSlerpPayoutDateForInvoiceWeek(invoice.week_end_date);
    const slerpSalesPeriodEnd = getSlerpSalesPeriodEndForInvoiceWeek(invoice.week_end_date);
    let slerpQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .eq('platform', 'slerp')
      .eq('week_end_date', slerpSalesPeriodEnd);
    if (!isCombinedInvoice && invoice.brand?.trim()) {
      slerpQuery = slerpQuery.eq('brand', invoice.brand.trim());
    }
    const { data: slerpReports } = await slerpQuery.order('week_start_date');

    // Payment details from env (optional) – set in .env.local, see README
    const paymentDaysNum = process.env.INVOICE_PAYMENT_DAYS != null ? Number(process.env.INVOICE_PAYMENT_DAYS) : NaN;
    const paymentDetails = {
      paymentDays: Number.isFinite(paymentDaysNum) ? paymentDaysNum : undefined,
      bankName: process.env.INVOICE_BANK_NAME || undefined,
      sortCode: process.env.INVOICE_SORT_CODE || undefined,
      accountNumber: process.env.INVOICE_ACCOUNT_NUMBER || undefined,
    };

    // If franchisee has BACS and we collect fees, show collection date; for pay_them we pay them, no BACS
    const payThem = franchisee.payment_direction === 'pay_them';
    const bacsCollectionDate = !payThem && franchisee.bacs_payment_method_id && invoice.created_at
      ? formatRecommendedBacsDateFromInvoiceDate(invoice.created_at)
      : undefined;

    // For pay_them: amount we pay = Deliveroo gross − our fees (D+U+J)
    const reportsList = reports || [];
    const deliverooGross = reportsList
      .filter((r: { platform: string }) => r.platform === 'deliveroo')
      .reduce((s: number, r: { gross_revenue?: number }) => s + Number(r.gross_revenue ?? 0), 0);
    const amountWePay = payThem
      ? Math.round((deliverooGross - Number(invoice.fee_amount ?? 0)) * 100) / 100
      : undefined;

    // Logo: same folder as test PDFs – project root / public / Hungry Tum Logo.png
    const publicDir = path.resolve(process.cwd(), 'public');
    const logoPathCandidate =
      process.env.INVOICE_LOGO_PATH ||
      path.join(publicDir, 'Hungry Tum Logo.png');
    const logoPath = fs.existsSync(logoPathCandidate) ? path.resolve(logoPathCandidate) : undefined;

    // Business address (optional) – from env; use \n in value for line breaks
    const businessAddressRaw = process.env.INVOICE_BUSINESS_ADDRESS?.trim();
    const businessAddressLines = businessAddressRaw
      ? businessAddressRaw.replace(/\\n/g, '\n').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : undefined;

    // Generate PDF - use type assertion for react-pdf compatibility
    const element = createElement(InvoicePDF, {
      invoice,
      franchisee,
      reports: reports || [],
      slerpReports: slerpReports || [],
      slerpPayoutDate: (slerpReports?.length ?? 0) > 0 ? slerpPayoutDate : undefined,
      paymentDetails,
      bacsCollectionDate,
      amountWePay,
      logoPath,
      businessAddressLines,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(element as any);
    const pdfUint8 = new Uint8Array(pdfBuffer);

    // Upload to storage (optional: don't fail the request if storage fails)
    const pdfPath = `invoices/${invoice.invoice_number}.pdf`;
    try {
      const { error: uploadError } = await supabase.storage
        .from('invoicing')
        .upload(pdfPath, pdfUint8, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (!uploadError) {
        await supabase
          .from('invoices')
          .update({ pdf_path: pdfPath })
          .eq('id', invoiceId);
      } else {
        console.warn('Invoice PDF storage upload failed (download still works):', uploadError.message);
      }
    } catch (storageErr) {
      console.warn('Invoice PDF storage upload failed (download still works):', storageErr);
    }

    // Filename: [FRANCHISE NAME - INV NUMBER - WEEK].pdf
    const franchiseName = (franchisee.name ?? 'Franchisee').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Franchisee';
    const weekStr = formatWeekRange(invoice.week_start_date, invoice.week_end_date);
    const filename = `${franchiseName} - ${invoice.invoice_number} - ${weekStr}.pdf`.replace(/\s+/g, ' ').replace(/"/g, "'");
    return new Response(pdfUint8, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfUint8.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Invoice generation error:', error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? `Failed to generate invoice: ${message}` : 'Failed to generate invoice' },
      { status: 500 }
    );
  }
}
