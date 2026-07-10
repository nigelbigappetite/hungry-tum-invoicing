import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import InvoicePDF from '@/components/InvoicePDF';
import { formatWeekRange, isTzPeriPeriInvoice } from '@/lib/utils';
import { createElement } from 'react';
import { isExtendedInvoiceRange } from '@/lib/monthly-invoice-revenue';

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

    // Fetch weekly reports for this invoice period (Mon–Sun). Combined invoice: no brand filter.
    let aggregatorReportsQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .in('platform', ['deliveroo', 'ubereats', 'justeat']);
    if (isExtendedInvoiceRange(invoice.week_start_date, invoice.week_end_date)) {
      aggregatorReportsQuery = aggregatorReportsQuery
        .gte('week_end_date', invoice.week_start_date)
        .lte('week_end_date', invoice.week_end_date);
    } else {
      aggregatorReportsQuery = aggregatorReportsQuery
        .eq('week_start_date', invoice.week_start_date)
        .eq('week_end_date', invoice.week_end_date);
    }
    const isCombinedInvoice = invoice.brands && Array.isArray(invoice.brands) && invoice.brands.length > 0;
    if (!isCombinedInvoice && invoice.brand?.trim()) {
      aggregatorReportsQuery = aggregatorReportsQuery.eq('brand', invoice.brand.trim());
    }
    const { data: aggregatorReports, error: reportsError } = await aggregatorReportsQuery.order('platform');

    if (reportsError) {
      return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
    }

    // Fetch Slerp (Wing Shack Direct) for the same invoice week as aggregator platforms.
    let slerpQuery = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', invoice.franchisee_id)
      .eq('platform', 'slerp');
    if (isExtendedInvoiceRange(invoice.week_start_date, invoice.week_end_date)) {
      slerpQuery = slerpQuery
        .gte('week_end_date', invoice.week_start_date)
        .lte('week_end_date', invoice.week_end_date);
    } else {
      slerpQuery = slerpQuery
        .eq('week_start_date', invoice.week_start_date)
        .eq('week_end_date', invoice.week_end_date);
    }
    if (!isCombinedInvoice && invoice.brand?.trim()) {
      slerpQuery = slerpQuery.eq('brand', invoice.brand.trim());
    }
    const { data: slerpReports } = await slerpQuery.order('week_start_date');
    const reports = [...(aggregatorReports || []), ...(slerpReports || [])];

    // Payment details from env (optional) – set in .env.local, see README
    const paymentDaysNum = process.env.INVOICE_PAYMENT_DAYS != null ? Number(process.env.INVOICE_PAYMENT_DAYS) : NaN;
    const paymentDetails = {
      paymentDays: Number.isFinite(paymentDaysNum) ? paymentDaysNum : undefined,
      bankName: process.env.INVOICE_BANK_NAME || undefined,
      sortCode: process.env.INVOICE_SORT_CODE || undefined,
      accountNumber: process.env.INVOICE_ACCOUNT_NUMBER || undefined,
    };

    const payThem = franchisee.payment_direction === 'pay_them';

    // For pay_them: calculate what HT transfers to the franchisee.
    // TZ Peri Peri (exception): HT holds Deliveroo funds and pays Deliveroo gross − all platform HT fees.
    // All other pay_them franchisees: HT pays for all 3rd party platforms directly —
    //   amount = total platform payout across D+U+J (or gross if payout not available) − HT fee.
    const reportsList = aggregatorReports || [];
    let amountWePay: number | undefined;
    if (payThem) {
      if (isTzPeriPeriInvoice(franchisee)) {
        const deliverooGross = reportsList
          .filter((r: { platform: string }) => r.platform === 'deliveroo')
          .reduce((s: number, r: { gross_revenue?: number }) => s + Number(r.gross_revenue ?? 0), 0);
        amountWePay = Math.round((deliverooGross - Number(invoice.fee_amount ?? 0)) * 100) / 100;
      } else {
        const totalPayout = reportsList.reduce(
          (s: number, r: { platform_payout?: number | null }) => s + Number(r.platform_payout ?? 0),
          0
        );
        const totalGross = reportsList.reduce(
          (s: number, r: { gross_revenue?: number }) => s + Number(r.gross_revenue ?? 0),
          0
        );
        const basis = totalPayout > 0 ? totalPayout : totalGross;
        amountWePay = Math.round((basis - Number(invoice.fee_amount ?? 0)) * 100) / 100;
      }
    }

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
      paymentDetails,
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
