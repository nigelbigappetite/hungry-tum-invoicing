'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils';
import { BrandRecord, Franchisee } from '@/lib/types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeeklyReportRow {
  franchisee_id: string;
  brand: string | null;
  platform: string;
  week_start_date: string;
  gross_revenue: number;
}

interface InvoiceRow {
  franchisee_id: string;
  fee_amount: number;
  fee_percentage: number;
  total_gross_revenue: number;
  status: string;
  week_start_date: string;
  brands: string[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  deliveroo: 'Deliveroo',
  ubereats: 'Uber Eats',
  justeat: 'Just Eat',
  slerp: 'Direct (Slerp)',
};

const PLATFORM_COLORS: Record<string, string> = {
  deliveroo: '#00CCBC',
  ubereats: '#06C167',
  justeat: '#FF8000',
  slerp: '#6366f1',
};

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const PERIOD_OPTIONS = [
  { label: 'Last 4 weeks', weeks: 4 },
  { label: 'Last 8 weeks', weeks: 8 },
  { label: 'Last 13 weeks', weeks: 13 },
  { label: 'Last 26 weeks', weeks: 26 },
  { label: 'All time', weeks: 0 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const supabase = createClient();

  // ── Raw data
  const [reports, setReports] = useState<WeeklyReportRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters
  const [periodWeeks, setPeriodWeeks] = useState(13);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');

  // ── Fetch
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [rRes, iRes, bRes, fRes] = await Promise.all([
        supabase.from('weekly_reports').select('franchisee_id,brand,platform,week_start_date,gross_revenue'),
        supabase.from('invoices').select('franchisee_id,fee_amount,fee_percentage,total_gross_revenue,status,week_start_date,brands'),
        supabase.from('brands').select('*').eq('active', true).order('name'),
        supabase.from('franchisees').select('*').order('location'),
      ]);
      setReports((rRes.data as WeeklyReportRow[]) ?? []);
      setInvoices((iRes.data as InvoiceRow[]) ?? []);
      setBrands((bRes.data as BrandRecord[]) ?? []);
      setFranchisees((fRes.data as Franchisee[]) ?? []);
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Period cutoff date
  const cutoffDate = useMemo(() => {
    if (periodWeeks === 0) return null;
    return isoDate(addWeeks(new Date(), -periodWeeks));
  }, [periodWeeks]);

  // ── Filtered data
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (cutoffDate && r.week_start_date < cutoffDate) return false;
      if (locationFilter !== 'all' && r.franchisee_id !== locationFilter) return false;
      if (brandFilter !== 'all' && r.brand !== brandFilter) return false;
      return true;
    });
  }, [reports, cutoffDate, locationFilter, brandFilter]);

  // ── Invoices filtered by period + location only (no brand) — used as apportionment source
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (cutoffDate && inv.week_start_date < cutoffDate) return false;
      if (locationFilter !== 'all' && inv.franchisee_id !== locationFilter) return false;
      return true;
    });
  }, [invoices, cutoffDate, locationFilter]);

  // ── When brand is selected: apportion each invoice's fee by brand's share of that week's gross
  // This is the single source of truth for all fee metrics when brand-filtered.
  const apportionedFees = useMemo(() => {
    if (brandFilter === 'all') return null;

    // Total gross per (franchisee, week) across ALL brands — denominator
    const totalGrossMap: Record<string, number> = {};
    reports.forEach((r) => {
      if (cutoffDate && r.week_start_date < cutoffDate) return;
      if (locationFilter !== 'all' && r.franchisee_id !== locationFilter) return;
      const key = `${r.franchisee_id}__${r.week_start_date}`;
      totalGrossMap[key] = (totalGrossMap[key] ?? 0) + Number(r.gross_revenue);
    });

    // Brand gross per (franchisee, week) — numerator
    const brandGrossMap: Record<string, number> = {};
    filteredReports.forEach((r) => {
      const key = `${r.franchisee_id}__${r.week_start_date}`;
      brandGrossMap[key] = (brandGrossMap[key] ?? 0) + Number(r.gross_revenue);
    });

    // Franchisees that actually have reports for this brand in this period
    const relevantFranchiseeIds = new Set(filteredReports.map((r) => r.franchisee_id));

    // Apportion invoice fees
    const byFranchisee: Record<string, { fee: number; paid: number; outstanding: number }> = {};
    const byStatus: Record<string, { count: number; amount: number }> = {};
    const byWeek: Record<string, number> = {};
    let totalFee = 0, paidFee = 0, outstandingFee = 0;

    filteredInvoices.forEach((inv) => {
      if (!relevantFranchiseeIds.has(inv.franchisee_id)) return;
      const key = `${inv.franchisee_id}__${inv.week_start_date}`;
      const brandGross = brandGrossMap[key] ?? 0;
      const totalGross = totalGrossMap[key] ?? 0;
      if (totalGross === 0) return;

      const share = brandGross / totalGross;
      const fee = Number(inv.fee_amount) * share;
      const isPaid = inv.status === 'paid';

      if (!byFranchisee[inv.franchisee_id]) byFranchisee[inv.franchisee_id] = { fee: 0, paid: 0, outstanding: 0 };
      byFranchisee[inv.franchisee_id].fee += fee;
      if (isPaid) { byFranchisee[inv.franchisee_id].paid += fee; paidFee += fee; }
      else { byFranchisee[inv.franchisee_id].outstanding += fee; outstandingFee += fee; }
      totalFee += fee;

      if (!byStatus[inv.status]) byStatus[inv.status] = { count: 0, amount: 0 };
      byStatus[inv.status].count++;
      byStatus[inv.status].amount += fee;

      byWeek[inv.week_start_date] = (byWeek[inv.week_start_date] ?? 0) + fee;
    });

    return { byFranchisee, byStatus, byWeek, totalFee, paidFee, outstandingFee };
  }, [brandFilter, filteredReports, filteredInvoices, reports, cutoffDate, locationFilter]);

  // ── KPIs
  const kpis = useMemo(() => {
    const networkGross = filteredReports.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const externalBrandNames = brands.filter((b) => b.is_external).map((b) => b.name);

    let totalFeeInvoiced: number, feesCollected: number, feesOutstanding: number;
    if (apportionedFees) {
      totalFeeInvoiced = apportionedFees.totalFee;
      feesCollected = apportionedFees.paidFee;
      feesOutstanding = apportionedFees.outstandingFee;
    } else {
      totalFeeInvoiced = filteredInvoices.reduce((s, i) => s + Number(i.fee_amount), 0);
      feesCollected = filteredInvoices.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.fee_amount), 0);
      feesOutstanding = filteredInvoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + Number(i.fee_amount), 0);
    }
    const collectionRate = totalFeeInvoiced > 0 ? (feesCollected / totalFeeInvoiced) * 100 : 0;

    const htFees = filteredReports
      .filter((r) => !r.brand || !externalBrandNames.includes(r.brand))
      .reduce((s, r) => s + Number(r.gross_revenue) * 0.06, 0);

    const externalFees = brandFilter !== 'all'
      ? apportionedFees?.totalFee ?? 0
      : filteredReports
          .filter((r) => r.brand && externalBrandNames.includes(r.brand))
          .reduce((s, r) => s + Number(r.gross_revenue) * 0.06, 0);

    return { networkGross, totalFeeInvoiced, feesCollected, feesOutstanding, collectionRate, htFees, externalFees };
  }, [filteredReports, filteredInvoices, apportionedFees, brands, brandFilter]);

  // ── Revenue by brand
  const revenueByBrand = useMemo(() => {
    const map: Record<string, { gross: number; fee: number; isExternal: boolean; feeBeneficiary: string }> = {};
    filteredReports.forEach((r) => {
      const name = r.brand ?? 'Unknown';
      const brandRecord = brands.find((b) => b.name === name);
      if (!map[name]) map[name] = { gross: 0, fee: 0, isExternal: brandRecord?.is_external ?? false, feeBeneficiary: brandRecord?.fee_beneficiary ?? 'ht' };
      map[name].gross += Number(r.gross_revenue);
    });
    Object.keys(map).forEach((name) => {
      const relatedInvoices = filteredInvoices.filter((inv) => (inv.brands ?? []).includes(name));
      const avgRate = relatedInvoices.length > 0
        ? relatedInvoices.reduce((s, i) => s + Number(i.fee_percentage), 0) / relatedInvoices.length
        : 6;
      map[name].fee = map[name].gross * (avgRate / 100);
    });
    return Object.entries(map)
      .map(([name, d]) => ({ name, ...d, net: d.gross - d.fee }))
      .sort((a, b) => b.gross - a.gross);
  }, [filteredReports, filteredInvoices, brands]);

  // ── Revenue by location
  // Source of truth: filteredReports determines WHICH locations appear.
  // Fees are apportioned when brand-filtered; full invoice totals when all brands.
  const revenueByLocation = useMemo(() => {
    const map: Record<string, { name: string; location: string; gross: number; fee: number; paid: number; outstanding: number }> = {};
    filteredReports.forEach((r) => {
      const f = franchisees.find((x) => x.id === r.franchisee_id);
      if (!f) return;
      if (!map[f.id]) map[f.id] = { name: f.name, location: f.location, gross: 0, fee: 0, paid: 0, outstanding: 0 };
      map[f.id].gross += Number(r.gross_revenue);
    });

    if (apportionedFees) {
      Object.entries(apportionedFees.byFranchisee).forEach(([fid, fees]) => {
        if (!map[fid]) return;
        map[fid].fee = fees.fee;
        map[fid].paid = fees.paid;
        map[fid].outstanding = fees.outstanding;
      });
    } else {
      filteredInvoices.forEach((inv) => {
        if (!map[inv.franchisee_id]) return;
        map[inv.franchisee_id].fee += Number(inv.fee_amount);
        if (inv.status === 'paid') map[inv.franchisee_id].paid += Number(inv.fee_amount);
        else map[inv.franchisee_id].outstanding += Number(inv.fee_amount);
      });
    }

    return Object.values(map).filter((r) => r.gross > 0).sort((a, b) => b.gross - a.gross);
  }, [filteredReports, filteredInvoices, apportionedFees, franchisees]);

  // ── Weekly trend
  const weeklyTrend = useMemo(() => {
    const map: Record<string, { week: string; gross: number; fee: number }> = {};
    filteredReports.forEach((r) => {
      if (!map[r.week_start_date]) map[r.week_start_date] = { week: r.week_start_date, gross: 0, fee: 0 };
      map[r.week_start_date].gross += Number(r.gross_revenue);
    });
    if (apportionedFees) {
      Object.entries(apportionedFees.byWeek).forEach(([week, fee]) => {
        if (!map[week]) map[week] = { week, gross: 0, fee: 0 };
        map[week].fee += fee;
      });
    } else {
      filteredInvoices.forEach((inv) => {
        if (!map[inv.week_start_date]) map[inv.week_start_date] = { week: inv.week_start_date, gross: 0, fee: 0 };
        map[inv.week_start_date].fee += Number(inv.fee_amount);
      });
    }
    return Object.values(map)
      .sort((a, b) => a.week.localeCompare(b.week))
      .map((d) => ({ ...d, weekLabel: shortDate(d.week) }));
  }, [filteredReports, filteredInvoices, apportionedFees]);

  // ── Platform breakdown
  const platformData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredReports.forEach((r) => {
      map[r.platform] = (map[r.platform] ?? 0) + Number(r.gross_revenue);
    });
    return Object.entries(map)
      .map(([platform, gross]) => ({ platform, label: PLATFORM_LABELS[platform] ?? platform, gross }))
      .sort((a, b) => b.gross - a.gross);
  }, [filteredReports]);


  // ── Invoice status breakdown
  const statusBreakdown = useMemo(() => {
    const source = apportionedFees ? apportionedFees.byStatus : (() => {
      const map: Record<string, { count: number; amount: number }> = {};
      filteredInvoices.forEach((inv) => {
        if (!map[inv.status]) map[inv.status] = { count: 0, amount: 0 };
        map[inv.status].count++;
        map[inv.status].amount += Number(inv.fee_amount);
      });
      return map;
    })();
    const order = ['draft', 'sent', 'processing', 'paid'];
    return order.filter((s) => source[s]).map((s) => ({ status: s, ...source[s] }));
  }, [filteredInvoices, apportionedFees]);

  const STATUS_STYLES: Record<string, string> = {
    draft: 'bg-yellow-100 text-yellow-800',
    sent: 'bg-blue-100 text-blue-800',
    processing: 'bg-amber-100 text-amber-800',
    paid: 'bg-green-100 text-green-800',
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-slate-400 dark:text-neutral-500">Loading analytics…</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-neutral-100">Finance Analytics</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-neutral-400">Network performance across all brands and locations</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Period */}
          <select
            value={periodWeeks}
            onChange={(e) => setPeriodWeeks(Number(e.target.value))}
            className="rounded-lg border border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.weeks} value={o.weeks}>{o.label}</option>
            ))}
          </select>
          {/* Brand */}
          <select
            value={brandFilter}
            onChange={(e) => { setBrandFilter(e.target.value); setLocationFilter('all'); }}
            className="rounded-lg border border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
          {/* Location — scoped to selected brand */}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All locations</option>
            {(brandFilter === 'all'
              ? franchisees
              : franchisees.filter((f) => f.brands.includes(brandFilter))
            ).map((f) => (
              <option key={f.id} value={f.id}>{f.location}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Network Gross Revenue" value={formatCurrency(kpis.networkGross)} sub="all brands combined" />
        {brandFilter === 'all' && (
          <KpiCard label="HT Fee Income" value={formatCurrency(kpis.htFees)} accent />
        )}
        <KpiCard
          label="External Brand Fee"
          value={formatCurrency(kpis.externalFees)}
          sub={brandFilter !== 'all' ? brandFilter : (brands.filter((b) => b.is_external).map((b) => b.name).join(', ') || 'No external brands')}
          purple
        />
        <KpiCard label="Outstanding Fees" value={formatCurrency(kpis.feesOutstanding)} sub="unpaid invoices" warn={kpis.feesOutstanding > 0} />
        <KpiCard
          label="Collection Rate"
          value={`${kpis.collectionRate.toFixed(1)}%`}
          sub={`${formatCurrency(kpis.feesCollected)} collected`}
        />
      </div>

      {/* Revenue by brand + platform split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Brand table */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-neutral-100">Revenue by Brand</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-neutral-800 text-left text-xs uppercase text-slate-400 dark:text-neutral-500">
                  <th className="pb-2 pr-4">Brand</th>
                  <th className="pb-2 pr-4 text-right">Gross Revenue</th>
                  <th className="pb-2 pr-4 text-right">Fee</th>
                  <th className="pb-2 pr-4 text-right">Fee goes to</th>
                  <th className="pb-2 text-right">Franchisee keeps</th>
                </tr>
              </thead>
              <tbody>
                {revenueByBrand.map((b) => (
                  <tr key={b.name} className="border-b border-slate-50 dark:border-neutral-800 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-800 dark:text-neutral-100">
                      <div className="flex items-center gap-2">
                        {b.name}
                        {b.isExternal && (
                          <span className="rounded-full bg-violet-100 dark:bg-violet-900/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                            external
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-slate-700 dark:text-neutral-300">{formatCurrency(b.gross)}</td>
                    <td className="py-2.5 pr-4 text-right font-medium text-primary">{formatCurrency(b.fee)}</td>
                    <td className="py-2.5 pr-4 text-right text-slate-500 dark:text-neutral-400 text-xs">
                      {b.isExternal ? (
                        <span className="font-medium text-violet-600 dark:text-violet-400">{b.feeBeneficiary}</span>
                      ) : (
                        <span className="text-orange-500">Hungry Tum</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-slate-600 dark:text-neutral-300">{formatCurrency(b.net)}</td>
                  </tr>
                ))}
                {revenueByBrand.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-400 dark:text-neutral-500">No data for this period</td></tr>
                )}
              </tbody>
              {revenueByBrand.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 dark:border-neutral-700 font-semibold text-slate-800 dark:text-neutral-100">
                    <td className="pt-3 pr-4">Total</td>
                    <td className="pt-3 pr-4 text-right">{formatCurrency(revenueByBrand.reduce((s, b) => s + b.gross, 0))}</td>
                    <td className="pt-3 pr-4 text-right text-primary">{formatCurrency(revenueByBrand.reduce((s, b) => s + b.fee, 0))}</td>
                    <td className="pt-3 pr-4" />
                    <td className="pt-3 text-right">{formatCurrency(revenueByBrand.reduce((s, b) => s + b.net, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Platform donut */}
        <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-neutral-100">Platform Split</h2>
          {platformData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={platformData} dataKey="gross" nameKey="label" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                    {platformData.map((entry) => (
                      <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {platformData.map((p) => (
                  <div key={p.platform} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLATFORM_COLORS[p.platform] ?? '#94a3b8' }} />
                      <span className="text-slate-600 dark:text-neutral-300">{p.label}</span>
                    </div>
                    <span className="font-medium text-slate-800 dark:text-neutral-100">{formatCurrency(p.gross)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-slate-400 dark:text-neutral-500">No data</p>
          )}
        </div>
      </div>

      {/* Weekly trend */}
      <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-neutral-100">Weekly Trend</h2>
        {weeklyTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={weeklyTrend} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
              <Legend />
              <Line type="monotone" dataKey="gross" name="Gross Revenue" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="fee" name="Fees" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-12 text-center text-sm text-slate-400 dark:text-neutral-500">No weekly data for this period</p>
        )}
      </div>

      {/* Revenue by location */}
      <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-neutral-100">Revenue by Location</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-neutral-800 text-left text-xs uppercase text-slate-400 dark:text-neutral-500">
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4 text-right">Gross</th>
                <th className="pb-2 pr-4 text-right">Fee</th>
                <th className="pb-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {revenueByLocation.map((row) => (
                <tr key={row.name} className="border-b border-slate-50 dark:border-neutral-800 last:border-0">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-slate-800 dark:text-neutral-100">{row.location}</div>
                    <div className="text-xs text-slate-400 dark:text-neutral-500">{row.name}</div>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-700 dark:text-neutral-300">{formatCurrency(row.gross)}</td>
                  <td className="py-2.5 pr-4 text-right text-primary font-medium">{formatCurrency(row.fee)}</td>
                  <td className="py-2.5 text-right">
                    {row.outstanding > 0 ? (
                      <span className="font-medium text-amber-600">{formatCurrency(row.outstanding)}</span>
                    ) : (
                      <span className="text-green-600 text-xs">✓ clear</span>
                    )}
                  </td>
                </tr>
              ))}
              {revenueByLocation.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-slate-400 dark:text-neutral-500">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fee collection health */}
      <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-800 dark:text-neutral-100">Fee Collection Health</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {statusBreakdown.map((s) => (
            <div key={s.status} className="rounded-lg bg-slate-50 dark:bg-neutral-800 p-4">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[s.status]}`}>
                {s.status}
              </span>
              <p className="mt-2 text-xl font-bold text-slate-800 dark:text-neutral-100">{formatCurrency(s.amount)}</p>
              <p className="text-xs text-slate-400 dark:text-neutral-500">{s.count} invoice{s.count !== 1 ? 's' : ''}</p>
            </div>
          ))}
          {statusBreakdown.length === 0 && (
            <p className="col-span-4 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">No invoices for this period</p>
          )}
        </div>

        {/* Stacked bar: paid vs outstanding per location */}
        {revenueByLocation.some((r) => r.fee > 0) && (
          <div className="mt-6">
            <p className="mb-2 text-xs uppercase text-slate-400 dark:text-neutral-500 font-medium">Fees by location</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={revenueByLocation} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="location" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `£${v}`} />
                <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                <Bar dataKey="paid" name="Paid" stackId="a" fill="#22c55e" />
                <Bar dataKey="outstanding" name="Outstanding" stackId="a" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
  purple,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  purple?: boolean;
  warn?: boolean;
}) {
  const valueClass = accent
    ? 'text-primary'
    : purple
    ? 'text-violet-600 dark:text-violet-400'
    : warn
    ? 'text-amber-600'
    : 'text-slate-800 dark:text-neutral-100';

  return (
    <div className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <p className="text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400 dark:text-neutral-500">{sub}</p>}
    </div>
  );
}
