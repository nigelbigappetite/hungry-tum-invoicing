'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, formatWeekRange } from '@/lib/utils';
import { Invoice, InvoiceStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/types';
import {
  TrendingUp,
  DollarSign,
  FileText,
  Users,
  ArrowRight,
  Building2,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';

interface FranchiseeBacs {
  id: string;
  name: string;
  bacs_payment_method_id: string | null;
}

interface DashboardStats {
  totalFranchisees: number;
  totalInvoices: number;
  totalRevenue: number;
  totalFees: number;
  outstandingFees: number;
  franchiseesBacs: FranchiseeBacs[];
  recentInvoices: Array<Invoice & { franchisees: { name: string } | null }>;
}

export default function DashboardPage() {
  const supabase = createClient();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingBacs, setSyncingBacs] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);

    // Fetch counts, totals, and franchisee BACS status
    const [franchiseesRes, franchiseesBacsRes, invoicesRes, recentRes] = await Promise.all([
      supabase.from('franchisees').select('id', { count: 'exact', head: true }),
      supabase.from('franchisees').select('id, name, bacs_payment_method_id'),
      supabase.from('invoices').select('total_gross_revenue, fee_amount, status'),
      supabase
        .from('invoices')
        .select('*, franchisees(name)')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const invoices = invoicesRes.data || [];
    const totalRevenue = invoices.reduce(
      (sum, i) => sum + Number(i.total_gross_revenue),
      0
    );
    const totalFees = invoices.reduce(
      (sum, i) => sum + Number(i.fee_amount),
      0
    );
    const outstandingFees = invoices
      .filter((i) => i.status !== 'paid')
      .reduce((sum, i) => sum + Number(i.fee_amount), 0);

    const franchiseesBacs = (franchiseesBacsRes.data || []) as FranchiseeBacs[];
    setStats({
      totalFranchisees: franchiseesRes.count || 0,
      totalInvoices: invoices.length,
      totalRevenue,
      totalFees,
      outstandingFees,
      franchiseesBacs,
      recentInvoices: (recentRes.data || []) as DashboardStats['recentInvoices'],
    });

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const syncBacsStatus = async () => {
    setSyncingBacs(true);
    try {
      const res = await fetch('/api/sync-bacs-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (data.message) alert(data.message);
      fetchStats();
    } finally {
      setSyncingBacs(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      label: 'Total Franchisees',
      value: stats.totalFranchisees.toString(),
      icon: Users,
      color: 'bg-blue-50 text-blue-600',
      href: '/franchisees',
    },
    {
      label: 'Total Invoices',
      value: stats.totalInvoices.toString(),
      icon: FileText,
      color: 'bg-purple-50 text-purple-600',
      href: '/franchisees',
    },
    {
      label: 'Total Gross Revenue',
      value: formatCurrency(stats.totalRevenue),
      icon: TrendingUp,
      color: 'bg-green-50 text-green-600',
      href: '/franchisees',
    },
    {
      label: 'Outstanding Fees',
      value: formatCurrency(stats.outstandingFees),
      icon: DollarSign,
      color: 'bg-orange-50 text-orange-600',
      href: '/franchisees',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-neutral-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
          Invoicing overview
        </p>
      </div>

      {/* Stats cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm transition-shadow hover:shadow-md dark:shadow-none"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-neutral-500">
                {stat.label}
              </span>
              <div className={`rounded-lg p-2 ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-neutral-100">{stat.value}</p>
          </Link>
        ))}
      </div>

      {/* BACS setup confirmation */}
      {stats.franchiseesBacs.length > 0 && (
        <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-800 px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-neutral-100">
              <Building2 className="h-4 w-4 text-primary" />
              BACS Direct Debit
            </h2>
            <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={syncBacsStatus}
              disabled={syncingBacs}
              className="text-sm font-medium text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-300 disabled:opacity-50"
            >
              {syncingBacs ? 'Syncing…' : 'Refresh status'}
            </button>
              <Link
                href="/franchisees"
                className="text-sm font-medium text-primary hover:text-primary-dark"
              >
                Manage
              </Link>
            </div>
          </div>
          <div className="px-5 py-4">
            {stats.franchiseesBacs.every((f) => f.bacs_payment_method_id) ? (
              <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                <CheckCircle className="h-4 w-4 shrink-0" />
                All {stats.franchiseesBacs.length} franchisee{stats.franchiseesBacs.length !== 1 ? 's' : ''} have BACS set up.
              </p>
            ) : (
              <p className="mb-3 text-sm text-slate-600 dark:text-neutral-400">
                {stats.franchiseesBacs.filter((f) => f.bacs_payment_method_id).length} of {stats.franchiseesBacs.length} franchisee{stats.franchiseesBacs.length !== 1 ? 's' : ''} have BACS set up.
              </p>
            )}
            <ul className="mt-2 space-y-1.5">
              {stats.franchiseesBacs.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700 dark:text-neutral-300">{f.name}</span>
                  {f.bacs_payment_method_id ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle className="h-3.5 w-3.5" />
                      BACS set up
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-neutral-500">Pending setup</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/franchisees"
          className="flex items-center justify-between rounded-xl border-2 border-dashed border-primary/30 dark:border-primary/40 bg-primary/5 dark:bg-primary/10 p-6 transition-colors hover:border-primary/50 hover:bg-primary/10 dark:hover:bg-primary/20"
        >
          <div>
            <h3 className="text-lg font-semibold text-primary-dark dark:text-primary-light">
              Upload Reports & Invoices
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
              Open a franchisee to upload reports and manage their invoices
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-primary" />
        </Link>
        <Link
          href="/franchisees"
          className="flex items-center justify-between rounded-xl border-2 border-dashed border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50"
        >
          <div>
            <h3 className="text-lg font-semibold text-slate-700 dark:text-neutral-200">
              Manage Franchisees
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
              Add or edit franchise locations
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-slate-400 dark:text-neutral-500" />
        </Link>
      </div>

      {/* Recent invoices */}
      <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-neutral-800 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900 dark:text-neutral-100">
            Recent Invoices
          </h2>
          <Link
            href="/franchisees"
            className="text-sm font-medium text-primary hover:text-primary-dark"
          >
            View franchisees
          </Link>
        </div>

        {stats.recentInvoices.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400 dark:text-neutral-500">No invoices yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-neutral-800">
            {stats.recentInvoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/franchisees/${invoice.franchisee_id}`}
                className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-neutral-800/50"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                      {invoice.invoice_number}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-neutral-400">
                      {invoice.franchisees?.name || 'Unknown'} &bull;{' '}
                      {formatWeekRange(
                        invoice.week_start_date,
                        invoice.week_end_date
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-primary-dark">
                    {formatCurrency(invoice.fee_amount)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      STATUS_COLORS[invoice.status as InvoiceStatus]
                    }`}
                  >
                    {STATUS_LABELS[invoice.status as InvoiceStatus]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
