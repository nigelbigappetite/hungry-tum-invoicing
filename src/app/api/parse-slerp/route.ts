import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseSlerpXlsx, type SlerpParsedRow } from '@/lib/parsers/slerp-parser';

export const runtime = 'nodejs';

/**
 * Match Slerp location name to franchisee location.
 * The spreadsheet has only the location name (e.g. "Loughton"); the franchisee record may be "Wing Shack Co- Loughton".
 * We match if either string contains the other, or if the part after " - " in the franchisee location equals the file location.
 */
function locationMatchesFile(franchiseeLocation: string, fileLocation: string): boolean {
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, ' ');

  const a = normalize(franchiseeLocation);
  const b = normalize(fileLocation);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  // Spreadsheet has "Loughton", franchisee may have "Wing Shack Co- Loughton" – compare to suffix after hyphen.
  const hyphenParts = a.split('-').map((p) => p.trim()).filter(Boolean);
  const suffix = hyphenParts.length > 1 ? hyphenParts[hyphenParts.length - 1] : '';
  return suffix === b || !!(suffix && b.includes(suffix));
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const franchiseeId = formData.get('franchiseeId') as string | null;
    const brand = formData.get('brand') as string | null;

    if (!file || !franchiseeId || !brand?.trim()) {
      return NextResponse.json(
        { error: 'File, franchiseeId, and brand are required' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: franchisee, error: feError } = await supabase
      .from('franchisees')
      .select('id, location, slerp_percentage')
      .eq('id', franchiseeId)
      .single();

    if (feError || !franchisee) {
      return NextResponse.json({ error: 'Franchisee not found' }, { status: 404 });
    }

    if (franchisee.slerp_percentage == null) {
      return NextResponse.json(
        { error: 'This franchisee does not have Slerp % set' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const isXlsx = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    if (!isXlsx) {
      return NextResponse.json(
        { error: 'Please upload an Excel file (.xlsx or .xls)' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { payWeeks, errors } = parseSlerpXlsx(buffer);

    const franchiseeLocation = (franchisee.location ?? '').trim();
    const filtered: SlerpParsedRow[] = payWeeks.filter((row) =>
      locationMatchesFile(franchiseeLocation, row.location)
    );

    if (filtered.length === 0) {
      const locationsInFile = [...new Set(payWeeks.map((row) => row.location))];
      return NextResponse.json(
        {
          error: `No matching Slerp rows found for location "${franchiseeLocation}". Locations in file: ${locationsInFile.join(', ') || 'none'}.`,
        },
        { status: 400 }
      );
    }

    const feePct = Number(franchisee.slerp_percentage) || 0;
    const preview = filtered.map((row) => ({
      ...row,
      feePercentage: feePct,
      feeAmount: Math.round(row.grossRevenue * (feePct / 100) * 100) / 100,
    }));

    return NextResponse.json({
      preview,
      errors: errors.length ? errors : undefined,
      franchiseeLocation,
      slerpPercentage: feePct,
    });
  } catch (err) {
    console.error('parse-slerp error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse Slerp file' },
      { status: 500 }
    );
  }
}
