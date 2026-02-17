# Connect Hungry Tum Invoicing to Supabase

Follow these steps once to connect the app to your own Supabase project.

---

## 1. Create a Supabase project (or use an existing one)

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**, choose your org, name it (e.g. `hungry-tum-invoicing`), set a database password, and create the project.
3. Wait until the project is ready.

---

## 2. Get your project URL and keys

1. In the Supabase dashboard, open **Project Settings** (gear icon) → **API**.
2. Copy:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon public** key (under "Project API keys")

---

## 3. Create `.env.local` in the project root

Create a file named `.env.local` in the same folder as `package.json` with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Replace the URL and key with the values from step 2. Save the file.

---

## 4. Create the database tables and storage

1. In Supabase, go to **SQL Editor**.
2. Click **New query** and paste the contents of **`supabase/schema.sql`** (see below).
3. Run the query (Run button).

If you prefer to run the SQL in parts, use this single block instead:

<details>
<summary>Click to expand full SQL</summary>

```sql
-- Sequence for invoice numbers
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Franchisees
CREATE TABLE IF NOT EXISTS public.franchisees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text NOT NULL,
  email text NOT NULL,
  payment_model text NOT NULL CHECK (payment_model IN ('percentage', 'monthly_fixed')),
  percentage_rate numeric DEFAULT 6,
  monthly_fee numeric,
  created_at timestamptz DEFAULT now()
);

-- Weekly reports
CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('deliveroo', 'ubereats', 'justeat')),
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  gross_revenue numeric NOT NULL,
  file_path text,
  file_type text NOT NULL CHECK (file_type IN ('csv', 'pdf')),
  uploaded_at timestamptz DEFAULT now()
);

-- Invoices
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL DEFAULT ('HT-' || EXTRACT(year FROM now())::text || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0')),
  franchisee_id uuid NOT NULL REFERENCES public.franchisees(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  total_gross_revenue numeric NOT NULL,
  fee_percentage numeric NOT NULL,
  fee_amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
  pdf_path text,
  created_at timestamptz DEFAULT now()
);

-- RLS: allow authenticated users full access to app tables
ALTER TABLE public.franchisees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access franchisees" ON public.franchisees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access weekly_reports" ON public.weekly_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated full access invoices" ON public.invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket: create via Dashboard (Storage → New bucket → name "invoicing", optional: Private)
-- Then add policies in SQL Editor:
INSERT INTO storage.buckets (id, name, public) VALUES ('invoicing', 'invoicing', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated upload invoicing" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'invoicing');
CREATE POLICY "Authenticated read invoicing" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'invoicing');
CREATE POLICY "Authenticated update invoicing" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'invoicing');
```

</details>

**If the bucket already exists**, skip the `INSERT INTO storage.buckets` line to avoid errors. You can also create the bucket in the dashboard: **Storage** → **New bucket** → name: `invoicing` (private or public as you prefer), then run only the three `CREATE POLICY` lines for `storage.objects`.

---

## 5. Enable Email auth (for sign up / sign in)

1. Go to **Authentication** → **Providers**.
2. Ensure **Email** is enabled.
3. (Optional) Under **Email Auth**, turn off **Confirm email** if you want to sign in immediately without confirming.

---

## 6. Run the app and sign in

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You’ll be sent to the login page.

- **Sign up**: Use “Create Account” and any email/password (e.g. your real email). If you left “Confirm email” on, check your inbox and confirm, then sign in.
- **Test user (optional)**: To create a fixed test user (e.g. `test@hungrytum.com`), see the next section.

---

## Optional: Create a test user (e.g. for another browser)

1. In Supabase: **Project Settings** → **API** → copy the **service_role** key (keep it secret).
2. Add to `.env.local`:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
   CREATE_TEST_USER_SECRET=any-secret-you-choose
   ```
3. Restart the dev server, then run once (replace the secret with the same value):
   ```bash
   curl -X POST http://localhost:3000/api/create-test-user \
     -H "Content-Type: application/json" \
     -d '{"secret":"any-secret-you-choose"}'
   ```
4. The response will show the test login email and password. Use those to sign in (e.g. in Chrome for downloads).
5. After that, remove or change `CREATE_TEST_USER_SECRET` so the route can’t be misused.

---

You’re done. The app is now using your Supabase project for auth, database, and storage.
