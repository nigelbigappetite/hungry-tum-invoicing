import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * One-time setup: create a test user so you can log in (e.g. in another browser for downloads).
 *
 * 1. Add to .env.local:
 *    SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_from_supabase_dashboard
 *    CREATE_TEST_USER_SECRET=any-secret-you-choose
 *
 * 2. Restart dev server, then run once:
 *    curl -X POST http://localhost:3000/api/create-test-user \
 *      -H "Content-Type: application/json" \
 *      -d '{"secret":"any-secret-you-choose"}'
 *
 * 3. Use the returned email/password to sign in. Then remove or change CREATE_TEST_USER_SECRET.
 */
const TEST_EMAIL = 'test@hungrytum.com';
const TEST_PASSWORD = 'HungryTumTest99!';

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.CREATE_TEST_USER_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: 'Add CREATE_TEST_USER_SECRET to .env.local first.' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    if (body.secret !== secret) {
      return NextResponse.json({ error: 'Invalid secret.' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.' },
        { status: 500 }
      );
    }

    const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });

    if (error) {
      if (error.message.includes('already been registered')) {
        return NextResponse.json({
          message: 'Test user already exists. Use these credentials to sign in.',
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      message: 'Test user created. Use these credentials to sign in.',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to create user' },
      { status: 500 }
    );
  }
}
