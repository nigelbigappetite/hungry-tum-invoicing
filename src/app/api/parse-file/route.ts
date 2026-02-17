import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/parsers/csv-parser';
import { extractRevenueFromText, extractWeekFromFilename } from '@/lib/parsers/pdf-parser';
import { extractRevenueFromHTML } from '@/lib/parsers/html-parser';
import { Platform } from '@/lib/types';

/** Use Node.js runtime so PDF parsing works reliably in Vercel functions. */
export const runtime = 'nodejs';
/** Allow up to 60s for large PDFs (e.g. Deliveroo statements) on Vercel. */
export const maxDuration = 60;

/** Max PDF size to avoid timeouts/OOM in serverless (15MB). */
const MAX_PDF_BYTES = 15 * 1024 * 1024;

async function extractPDFText(buffer: Buffer): Promise<string> {
  // Use pdfjs-serverless (pure JS, serverless-friendly PDF.js build).
  const { getDocument } = await import('pdfjs-serverless');

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });

  const doc = await loadingTask.promise;
  try {
    let fullText = '';
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page: any = await doc.getPage(pageNum);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textContent: any = await page.getTextContent();
      const pageText = textContent.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      fullText += pageText + '\n';
    }
    return fullText.trim();
  } finally {
    // Clean up PDF document resources if supported.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDoc: any = doc as any;
    if (typeof anyDoc.destroy === 'function') {
      await anyDoc.destroy();
    }
  }
}

/**
 * Detect if a .doc file is actually HTML (common for Just Eat).
 * Real .doc files start with specific binary signatures.
 */
function isHTMLContent(buffer: Buffer): boolean {
  const start = buffer.subarray(0, 100).toString('utf-8').trim();
  return (
    start.startsWith('<!DOCTYPE') ||
    start.startsWith('<html') ||
    start.startsWith('<HTML') ||
    start.includes('<html')
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const platform = formData.get('platform') as Platform | null;

    if (!file || !platform) {
      return NextResponse.json(
        { error: 'File and platform are required' },
        { status: 400 }
      );
    }

    const validPlatforms: Platform[] = ['deliveroo', 'ubereats', 'justeat'];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: 'Invalid platform' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isPDF = fileName.endsWith('.pdf');
    const isDOC = fileName.endsWith('.doc') || fileName.endsWith('.docx');
    const isHTML = fileName.endsWith('.html') || fileName.endsWith('.htm');

    if (!isCSV && !isPDF && !isDOC && !isHTML) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload a CSV, PDF, or DOC file.' },
        { status: 400 }
      );
    }

    // CSV files
    if (isCSV) {
      const text = await file.text();
      const result = parseCSV(text, platform);
      return NextResponse.json({
        ...result,
        file_type: 'csv',
        file_name: file.name,
      });
    }

    // PDF files (Deliveroo statements, Uber Eats invoices)
    if (isPDF) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > MAX_PDF_BYTES) {
        return NextResponse.json(
          {
            error: `PDF is too large (max ${MAX_PDF_BYTES / 1024 / 1024}MB). Try a shorter date range or use CSV if available.`,
          },
          { status: 400 }
        );
      }
      let text: string;
      try {
        text = await extractPDFText(buffer);
      } catch (pdfError) {
        const err = pdfError instanceof Error ? pdfError : new Error(String(pdfError));
        console.error('PDF text extraction failed:', err.message, err.stack);
        const isDev = process.env.NODE_ENV === 'development';
        return NextResponse.json(
          {
            error: isDev
              ? `PDF failed: ${err.message}`
              : 'Could not read the PDF. For Deliveroo, re-download the Payment Statement PDF or try exporting CSV from the partner hub.',
          },
          { status: 400 }
        );
      }
      const result = extractRevenueFromText(text, platform);
      if (platform === 'deliveroo' && process.env.NODE_ENV === 'development') {
        console.log('[parse-file] Deliveroo PDF:', {
          textLength: text.length,
          gross_revenue: result.gross_revenue,
          matched_pattern: result.matched_pattern,
        });
      }
      const weekFromText = result.week_start_date
        ? { week_start_date: result.week_start_date, week_end_date: result.week_end_date! }
        : null;
      const weekFromName = extractWeekFromFilename(file.name);
      const week = weekFromText ?? weekFromName;
      return NextResponse.json({
        ...result,
        ...(week && { week_start_date: week.week_start_date, week_end_date: week.week_end_date }),
        file_type: 'pdf',
        file_name: file.name,
      });
    }

    // DOC/HTML files (Just Eat invoices are .doc files that contain HTML)
    if (isDOC || isHTML) {
      const buffer = Buffer.from(await file.arrayBuffer());

      if (isHTMLContent(buffer)) {
        // It's HTML disguised as .doc (very common for Just Eat)
        const html = buffer.toString('utf-8');
        const result = extractRevenueFromHTML(html, platform);
        return NextResponse.json({
          ...result,
          file_type: 'pdf', // Store as 'pdf' type for DB compatibility
          file_name: file.name,
          raw_text: html.substring(0, 500),
        });
      }

      // Actual .doc binary format — not supported
      return NextResponse.json(
        {
          error:
            'This appears to be a binary .doc file. Just Eat invoices are usually HTML files saved as .doc — please re-download it from Just Eat Partner Centre.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Unsupported file type.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('File parse error:', error);
    return NextResponse.json(
      { error: 'Failed to parse file. Please check the file format and try again.' },
      { status: 500 }
    );
  }
}
