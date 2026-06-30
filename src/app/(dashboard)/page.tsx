'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, formatWeekRange } from '@/lib/utils';
import { Invoice, InvoiceStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/types';
import { startOfWeek, format } from 'date-fns';
import {
  TrendingUp,
  DollarSign,
  CalendarDays,
  Users,
  ArrowRight,
} from 'lucide-react';

import Link from 'next/link';

interface DashboardStats {
  totalFranchisees: number;
  totalFeeIncome: number;
  totalRevenue: number;
  thisWeekFees: number;
  recentInvoices: Array<Invoice & { franchisees: { name: string } | null }>;
}

export default function DashboardPage() {
  const supabase = createClient();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);

    const thisWeekMonday = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');

    // Fetch counts, totals
    const [franchiseesRes, invoicesRes, thisWeekRes, recentRes] = await Promise.all([
      supabase.from('franchisees').select('id', { count: 'exact', head: true }),
      supabase.from('invoices').select('total_gross_revenue, fee_amount, status'),
      supabase.from('invoices').select('fee_amount').eq('week_start_date', thisWeekMonday),
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
    const totalFeeIncome = invoices
      .filter((i) => i.status === 'paid')
      .reduce((sum, i) => sum + Number(i.fee_amount), 0);
    const thisWeekFees = (thisWeekRes.data || []).reduce(
      (sum, i) => sum + Number(i.fee_amount),
      0
    );

    setStats({
      totalFranchisees: franchiseesRes.count || 0,
      totalFeeIncome,
      totalRevenue,
      thisWeekFees,
      recentInvoices: (recentRes.data || []) as DashboardStats['recentInvoices'],
    });

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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
      color: 'bg-slate-100 text-slate-600',
      href: '/franchisees',
    },
    {
      label: 'Total Fee Income',
      value: formatCurrency(stats.totalFeeIncome),
      icon: DollarSign,
      color: 'bg-slate-100 text-slate-600',
      href: '/franchisees',
    },
    {
      label: 'Total Gross Revenue',
      value: formatCurrency(stats.totalRevenue),
      icon: TrendingUp,
      color: 'bg-slate-100 text-slate-600',
      href: '/franchisees',
    },
    {
      label: "This Week's Fees",
      value: formatCurrency(stats.thisWeekFees),
      icon: CalendarDays,
      color: 'bg-slate-100 text-slate-600',
      href: '/weekly',
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
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
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

      {/* Quick actions */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/weekly"
          className="flex items-center justify-between rounded-xl border-2 border-dashed border-primary/30 dark:border-primary/40 bg-primary/5 dark:bg-primary/10 p-6 transition-colors hover:border-primary/50 hover:bg-primary/10 dark:hover:bg-primary/20"
        >
          <div>
            <h3 className="text-lg font-semibold text-primary-dark dark:text-primary-light">
              Weekly Hub
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
              Upload reports and generate invoices for the week
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-primary" />
        </Link>
        <Link
          href="/franchisees"
          className="flex items-center justify-between rounded-xl border-2 border-dashed border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 transition-colors hover:border-gray-300 hover:bg-gray-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50"
        >
          <div>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-neutral-200">
              Manage Franchisees
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-neutral-400">
              Add or edit franchise locations
            </p>
          </div>
          <ArrowRight className="h-5 w-5 text-gray-400 dark:text-neutral-500" />
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
            <p className="text-sm text-slate-500 dark:text-neutral-400">No invoices yet</p>
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
