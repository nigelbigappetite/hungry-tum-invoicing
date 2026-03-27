import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: draft, error } = await supabase
      .from('email_drafts')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }
    if (draft.status !== 'draft') {
      return NextResponse.json({ error: 'Draft already sent or discarded' }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    const fromEmail = process.env.INVOICE_EMAIL_FROM || process.env.BACS_EMAIL_FROM || 'Hungry Tum <onboarding@resend.dev>';
    const resend = new Resend(resendKey);

    const html = draft.body
      .split('\n\n')
      .map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: draft.to_email,
      subject: draft.subject,
      html,
    });

    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 500 });
    }

    await supabase
      .from('email_drafts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
