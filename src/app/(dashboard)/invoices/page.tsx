'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InvoicesRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/franchisees');
  }, [router]);
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-slate-500">Redirecting to Franchisees…</p>
      <p className="mt-2 text-sm text-slate-400">
        Invoices are now per franchisee. Select a franchisee to view their invoices.
      </p>
    </div>
  );
}
