import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/parsers/csv-parser';
import { extractRevenueFromText, extractWeekFromFilename } from '@/lib/parsers/pdf-parser';
import { extractRevenueFromHTML } from '@/lib/parsers/html-parser';
import { Platform } from '@/lib/types';

/** Use Node.js runtime so pdf-parse (pdfjs-dist) works reliably. */
export const runtime = 'nodejs';

/**
 * Extract text from a PDF using the pdf-parse PDFParse class.
 * API: new PDFParse({ data: buffer }), then parser.getText() → result.text
 * Use resolve to force CJS build in Node (avoids bundler picking ESM/browser build).
 */
async function extractPDFText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pdf-parse');
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse ?? mod;
  if (typeof PDFParse !== 'function') {
    throw new Error('pdf-parse: PDFParse not found');
  }

  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  if (typeof parser.destroy === 'function') {
    await parser.destroy();
  }
  return result.text ?? result.pages.map((p: { text: string }) => p.text).join('\n');
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
              : 'Could not read the PDF. Please ensure the file is a valid PDF (e.g. Deliveroo Payment Statement) and try again.',
          },
          { status: 400 }
        );
      }
      const result = extractRevenueFromText(text, platform);
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
