'use client';

import { useEffect, useState, useCallback, Fragment, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Franchisee,
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  STATUS_COLORS,
  PLATFORM_LABELS,
  Platform,
  WeeklyReport,
  BRAND_OPTIONS,
  type AggregatorPlatform,
} from '@/lib/types';
import {
  formatCurrency,
  formatDate,
  formatWeekRange,
  getPlatformFeeRate,
  cn,
} from '@/lib/utils';
import {
  isExtendedInvoiceRange,
  reportFallsInExtendedInvoiceRange,
  sumRevenueRowsForExtendedInvoice,
} from '@/lib/monthly-invoice-revenue';
import { getPlatformLogo, getBrandLogo } from '@/lib/logos';
import { format, parseISO } from 'date-fns';
import {
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  FileText,
  Download,
  ChevronDown,
  ChevronUp,
  Send,
  Pencil,
  MapPin,
  Mail,
  Banknote,
  Trash2,
  Eye,
} from 'lucide-react';

const TEST_INVOICE_EMAIL = 'nigelwingshackco@gmail.com';

interface InvoiceWithFranchisee extends Invoice {
  franchisees: {
    name: string;
    location: string;
    email: string;
  } | null;
}

type RevenueSyncRow = {
  gross_revenue: number | null;
  week_end_date: string;
};

export default function FranchiseeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const supabase = createClient();

  const [franchisee, setFranchisee] = useState<Franchisee | null>(null);
  const [loadingFranchisee, setLoadingFranchisee] = useState(true);

  const [monthlyInvoiceSaving, setMonthlyInvoiceSaving] = useState(false);
  const [monthlyInvoiceMessage, setMonthlyInvoiceMessage] = useState('');
  const [monthlyInvoiceError, setMonthlyInvoiceError] = useState('');
  const [backfillStartMonth, setBackfillStartMonth] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  });
  const [backfillArrears, setBackfillArrears] = useState('6500');
  const [backfillingInvoices, setBackfillingInvoices] = useState(false);

  // Invoices state (fetch all for metrics; filter in UI for table)
  const [invoices, setInvoices] = useState<InvoiceWithFranchisee[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, WeeklyReport[]>>({});
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [previewingPdfId, setPreviewingPdfId] = useState<string | null>(null);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [regeneratingAllPdfs, setRegeneratingAllPdfs] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceWithFranchisee | null>(null);
  const [editInvoiceSaving, setEditInvoiceSaving] = useState(false);
  const [editInvoiceForm, setEditInvoiceForm] = useState({ total_gross_revenue: '', fee_amount: '', fee_percentage: '', week_start_date: '', invoice_date: '' });

  // Manual add missing platform (when CSV download from platform is blank)
  const [manualAddPlatform, setManualAddPlatform] = useState<AggregatorPlatform>('ubereats');
  const [manualAddAmount, setManualAddAmount] = useState('');
  const [manualAddSaving, setManualAddSaving] = useState(false);
  const [manualAddError, setManualAddError] = useState('');

  // Platform revenue for metrics (all time)
  const [platformRevenue, setPlatformRevenue] = useState<Record<Platform, number>>({
    deliveroo: 0,
    ubereats: 0,
    justeat: 0,
    slerp: 0,
  });
  const [loadingPlatformRevenue, setLoadingPlatformRevenue] = useState(false);

  const fetchFranchisee = useCallback(async () => {
    if (!id) return;
    setLoadingFranchisee(true);
    const { data, error } = await supabase
      .from('franchisees')
      .select('*')
      .eq('id', id)
      .single();
    if (!error && data) setFranchisee(data as Franchisee);
    setLoadingFranchisee(false);
  }, [id, supabase]);

  const fetchInvoices = useCallback(async () => {
    if (!id) return;
    setLoadingInvoices(true);
    const [{ data, error }, { data: revenueRows, error: revenueError }] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, franchisees(name, location, email)')
        .eq('franchisee_id', id)
        .order('week_start_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('weekly_reports')
        .select('gross_revenue, week_end_date')
        .eq('franchisee_id', id),
    ]);
    if (!error && data) {
      const rows = (revenueRows || []) as RevenueSyncRow[];
      const correctedInvoices = (data as InvoiceWithFranchisee[]).map((invoice) => {
        if (!isExtendedInvoiceRange(invoice.week_start_date, invoice.week_end_date)) return invoice;
        const syncedGrossRevenue = sumRevenueRowsForExtendedInvoice(rows, invoice);
        return Math.abs(syncedGrossRevenue - Number(invoice.total_gross_revenue || 0)) > 0.01
          ? { ...invoice, total_gross_revenue: syncedGrossRevenue }
          : invoice;
      });
      setInvoices(correctedInvoices);

      if (!revenueError) {
        const invoicesNeedingSync = correctedInvoices.filter(
          (invoice, index) =>
            isExtendedInvoiceRange(invoice.week_start_date, invoice.week_end_date) &&
            Math.abs(Number(invoice.total_gross_revenue || 0) - Number((data as InvoiceWithFranchisee[])[index].total_gross_revenue || 0)) > 0.01
        );
        if (invoicesNeedingSync.length > 0) {
          await Promise.all(
            invoicesNeedingSync.map((invoice) =>
              supabase
                .from('invoices')
                .update({ total_gross_revenue: invoice.total_gross_revenue })
                .eq('id', invoice.id)
            )
          );
        }
      }
    }
    setLoadingInvoices(false);
  }, [id, supabase]);

  const fetchPlatformRevenue = useCallback(async () => {
    if (!id) return;
    setLoadingPlatformRevenue(true);
    const { data: invoiceWeeks } = await supabase
      .from('invoices')
      .select('brand, brands, week_start_date, week_end_date')
      .eq('franchisee_id', id);
    const weekKeys = new Set<string>();
    const extendedInvoiceRanges: Array<{ week_start_date: string; week_end_date: string }> = [];
    (invoiceWeeks || []).forEach(
      (r: {
        brand: string | null;
        brands?: string[] | null;
        week_start_date: string;
        week_end_date: string;
      }) => {
        if (isExtendedInvoiceRange(r.week_start_date, r.week_end_date)) {
          extendedInvoiceRanges.push({
            week_start_date: r.week_start_date,
            week_end_date: r.week_end_date,
          });
          return;
        }
        const brandsList =
          r.brands && r.brands.length > 0 ? r.brands : r.brand?.trim() ? [r.brand.trim()] : [];
        brandsList.forEach((brand) => {
          weekKeys.add(`${brand}|${r.week_start_date}|${r.week_end_date}`);
        });
      }
    );
    const { data: reportRows, error } = await supabase
      .from('weekly_reports')
      .select('platform, gross_revenue, brand, week_start_date, week_end_date')
      .eq('franchisee_id', id);
    if (error) {
      setLoadingPlatformRevenue(false);
      return;
    }
    const sums: Record<Platform, number> = {
      deliveroo: 0,
      ubereats: 0,
      justeat: 0,
      slerp: 0,
    };
    const normalizePlatform = (p: string): Platform | null => {
      const s = String(p ?? '').toLowerCase().replace(/\s+/g, '');
      if (s === 'deliveroo' || s === 'ubereats' || s === 'justeat' || s === 'slerp') return s as Platform;
      if (s === 'uber_eats' || s === 'uber') return 'ubereats';
      if (s === 'just_eat') return 'justeat';
      return null;
    };
    (reportRows || []).forEach((row: { platform: string; gross_revenue: number; brand?: string | null; week_start_date: string; week_end_date: string }) => {
      const key = `${(row.brand ?? '').trim()}|${row.week_start_date}|${row.week_end_date}`;
      const matchesExtendedInvoice = extendedInvoiceRanges.some((invoice) =>
        reportFallsInExtendedInvoiceRange(row.week_end_date, invoice)
      );
      const matchesInvoice = matchesExtendedInvoice || weekKeys.has(key);
      if (!matchesInvoice) return;
      const platformKey = normalizePlatform(row.platform);
      if (platformKey) sums[platformKey] += Number(row.gross_revenue) || 0;
    });
    setPlatformRevenue(sums);
    setLoadingPlatformRevenue(false);
  }, [id, supabase]);

  useEffect(() => {
    fetchFranchisee();
  }, [fetchFranchisee]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    fetchPlatformRevenue();
  }, [fetchPlatformRevenue]);

  // Metrics (from all invoices + platform revenue)
  const totalGrossRevenue = invoices.reduce((s, i) => s + Number(i.total_gross_revenue || 0), 0);
  const totalFees = invoices.reduce((s, i) => s + Number(i.fee_amount || 0), 0);
  const totalInvoicesCount = invoices.length;
  const averageFeePerInvoice =
    totalInvoicesCount > 0 ? Math.round((totalFees / totalInvoicesCount) * 100) / 100 : 0;
  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid');
  const outstandingFees = unpaidInvoices.reduce((s, i) => s + Number(i.fee_amount || 0), 0);
  const oldestUnpaid =
    unpaidInvoices.length > 0
      ? unpaidInvoices.reduce((oldest, i) => {
          const d = i.week_end_date || i.created_at;
          return !oldest || (d && d < oldest) ? d : oldest;
        }, null as string | null)
      : null;
  const filteredInvoices =
    statusFilter === 'all' ? invoices : invoices.filter((i) => i.status === statusFilter);
  const standardFilteredInvoices = filteredInvoices.filter(
    (invoice) => !Array.isArray(invoice.line_items) || invoice.line_items.length === 0
  );
  const catchUpFilteredInvoices = filteredInvoices.filter(
    (invoice) => Array.isArray(invoice.line_items) && invoice.line_items.length > 0
  );
  const isMonthlyFixedSite = franchisee?.payment_model === 'monthly_fixed';
  const formatMonthLabel = (dateStr: string) => {
    const d = parseISO(dateStr);
    return isNaN(d.getTime()) ? dateStr : format(d, 'MMM yyyy');
  };
  const formatInvoicePeriodLabel = (invoice: Pick<Invoice, 'week_start_date' | 'week_end_date'>) =>
    isMonthlyFixedSite ? formatMonthLabel(invoice.week_start_date) : formatWeekRange(invoice.week_start_date, invoice.week_end_date);
  const isMaidstoneSite = useMemo(() => {
    if (!franchisee) return false;
    const location = (franchisee.location || '').toLowerCase();
    const name = (franchisee.name || '').toLowerCase();
    return location.includes('maidstone') || name.includes('maidstone');
  }, [franchisee]);
  const maidstoneTrackerStartMonth = '2025-06';
  const maidstoneTrackerInitialArrears = 6500;
  const invoiceDebtSnapshots = useMemo(() => {
    if (!isMonthlyFixedSite || !isMaidstoneSite) return {} as Record<string, { waivedAmount: number; balanceAfter: number }>;
    const monthlyFee = Number(franchisee?.monthly_fee ?? 0);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) return {} as Record<string, { waivedAmount: number; balanceAfter: number }>;

    const start = parseISO(`${maidstoneTrackerStartMonth}-01`);
    if (isNaN(start.getTime())) return {} as Record<string, { waivedAmount: number; balanceAfter: number }>;
    let remaining = Math.max(0, Math.round(maidstoneTrackerInitialArrears * 100) / 100);
    const map: Record<string, { waivedAmount: number; balanceAfter: number }> = {};
    const monthlyInvoicesAsc = [...invoices]
      .filter((inv) => parseISO(inv.week_start_date) >= start)
      .sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));
    for (const inv of monthlyInvoicesAsc) {
      const waivedAmount = Math.min(monthlyFee, remaining);
      const balanceAfter = Math.max(0, Math.round((remaining - waivedAmount) * 100) / 100);
      map[inv.id] = {
        waivedAmount: Math.round(waivedAmount * 100) / 100,
        balanceAfter,
      };
      remaining = balanceAfter;
    }
    return map;
  }, [isMonthlyFixedSite, isMaidstoneSite, franchisee?.monthly_fee, maidstoneTrackerStartMonth, maidstoneTrackerInitialArrears, invoices]);
  const debtTracker = useMemo(() => {
    if (!isMonthlyFixedSite || !isMaidstoneSite) return null;
    const monthlyFee = Number(franchisee?.monthly_fee ?? 0);
    if (!Number.isFinite(monthlyFee) || monthlyFee <= 0) return null;
    const snapshots = Object.values(invoiceDebtSnapshots);
    const amountLeft = snapshots.length > 0
      ? snapshots[snapshots.length - 1].balanceAfter
      : Math.max(0, Math.round(maidstoneTrackerInitialArrears * 100) / 100);
    const monthsApplied = snapshots.filter((s) => s.waivedAmount > 0).length;
    const paymentsRemaining = amountLeft <= 0 ? 0 : Math.ceil(amountLeft / monthlyFee);
    return { amountLeft, monthsApplied, paymentsRemaining };
  }, [isMonthlyFixedSite, isMaidstoneSite, franchisee?.monthly_fee, invoiceDebtSnapshots, maidstoneTrackerInitialArrears]);

  const saveManualReport = async (invoice: InvoiceWithFranchisee, platformOverride?: AggregatorPlatform) => {
    if (!id || !franchisee) return;
    const amount = parseFloat(manualAddAmount.replace(/[£,\s]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      setManualAddError('Please enter a valid amount (e.g. 849.73)');
      return;
    }
    setManualAddError('');
    setManualAddSaving(true);
    const platform = platformOverride ?? manualAddPlatform;
    const isCombined = invoice.brands && invoice.brands.length > 0;
    const brand = isCombined ? (invoice.brands![0] ?? '').trim() : (invoice.brand ?? '').trim();
    const weekStartStr = invoice.week_start_date;
    const weekEndStr = invoice.week_end_date;
    try {
      await supabase.from('weekly_reports').delete().eq('franchisee_id', id).eq('brand', brand).eq('platform', platform).eq('week_start_date', weekStartStr).eq('week_end_date', weekEndStr);
      const { error: insertErr } = await supabase.from('weekly_reports').insert({
        franchisee_id: id,
        brand: brand || null,
        platform,
        week_start_date: weekStartStr,
        week_end_date: weekEndStr,
        gross_revenue: Math.round(amount * 100) / 100,
        file_path: null,
        file_type: 'manual' as const,
      });
      if (insertErr) throw insertErr;
      const { data: allReports } = await supabase
        .from('weekly_reports')
        .select('platform, gross_revenue')
        .eq('franchisee_id', id)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .in('platform', ['deliveroo', 'ubereats', 'justeat']);
      const { data: slerpReports } = await supabase
        .from('weekly_reports')
        .select('platform, gross_revenue')
        .eq('franchisee_id', id)
        .eq('platform', 'slerp')
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr);
      const combinedReports = [...(allReports || []), ...(slerpReports || [])];
      const totalGrossAll = combinedReports.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
      const totalFeeAll =
        franchisee.payment_model === 'percentage_per_platform'
          ? combinedReports.reduce(
              (s, r) =>
                s +
                Math.round(Number(r.gross_revenue ?? 0) * (getPlatformFeeRate(franchisee, r.platform) / 100) * 100) / 100,
              0
            )
          : Math.round(totalGrossAll * ((franchisee.percentage_rate ?? 6) / 100) * 100) / 100;
      const roundedGross = Math.round(totalGrossAll * 100) / 100;
      const roundedFee = Math.round(totalFeeAll * 100) / 100;
      const effectivePct = roundedGross > 0 ? Math.round((roundedFee / roundedGross) * 10000) / 100 : (franchisee.percentage_rate ?? 6);
      const { error: updateErr } = await supabase
        .from('invoices')
        .update({ total_gross_revenue: roundedGross, fee_percentage: effectivePct, fee_amount: roundedFee })
        .eq('id', invoice.id);
      if (updateErr) throw updateErr;
      setManualAddAmount('');
      fetchReports(invoice.id, weekStartStr, weekEndStr, isCombined ? null : (invoice.brand ?? null));
      fetchInvoices();
      fetchPlatformRevenue();
    } catch (err) {
      setManualAddError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setManualAddSaving(false);
    }
  };

  const recalculateInvoiceForWeek = async (weekStartStr: string, weekEndStr: string) => {
    if (!id || !franchisee) return;

    const [aggregatorReportsRes, slerpReportsRes, invoicesRes] = await Promise.all([
      supabase
        .from('weekly_reports')
        .select('platform, gross_revenue')
        .eq('franchisee_id', id)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .in('platform', ['deliveroo', 'ubereats', 'justeat']),
      supabase
        .from('weekly_reports')
        .select('platform, gross_revenue')
        .eq('franchisee_id', id)
        .eq('platform', 'slerp')
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr),
      supabase
        .from('invoices')
        .select('id')
        .eq('franchisee_id', id)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .order('created_at', { ascending: true }),
    ]);

    const allReports = [...(aggregatorReportsRes.data || []), ...(slerpReportsRes.data || [])];
    const totalGrossAll = allReports.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
    const totalFeeAll =
      franchisee.payment_model === 'percentage_per_platform'
        ? allReports.reduce(
            (s, r) =>
              s +
              Math.round(Number(r.gross_revenue ?? 0) * (getPlatformFeeRate(franchisee, r.platform) / 100) * 100) /
                100,
            0
          )
        : Math.round(totalGrossAll * ((franchisee.percentage_rate ?? 6) / 100) * 100) / 100;

    const roundedGross = Math.round(totalGrossAll * 100) / 100;
    const roundedFee = Math.round(totalFeeAll * 100) / 100;
    const effectivePct =
      roundedGross > 0 ? Math.round((roundedFee / roundedGross) * 10000) / 100 : (franchisee.percentage_rate ?? 6);

    const existingInvoices = invoicesRes.data || [];
    if (existingInvoices.length === 0) {
      // If no weekly invoice exists yet, create one so Slerp-only weeks are fully allocatable.
      if (roundedGross <= 0) return;
      const franchiseeBrands = Array.isArray(franchisee.brands) && franchisee.brands.length > 0
        ? franchisee.brands
        : null;
      const invoiceBrands = franchiseeBrands && franchiseeBrands.includes('Wing Shack') ? ['Wing Shack'] : null;
      await supabase.from('invoices').insert({
        franchisee_id: id,
        brand: null,
        brands: invoiceBrands,
        week_start_date: weekStartStr,
        week_end_date: weekEndStr,
        total_gross_revenue: roundedGross,
        fee_percentage: effectivePct,
        fee_amount: roundedFee,
        status: 'draft',
      });
      return;
    }

    const invoiceToKeep = existingInvoices[0];
    const duplicates = existingInvoices.slice(1);
    for (const inv of duplicates) {
      await supabase.from('invoices').delete().eq('id', inv.id);
    }

    await supabase
      .from('invoices')
      .update({
        total_gross_revenue: roundedGross,
        fee_percentage: effectivePct,
        fee_amount: roundedFee,
      })
      .eq('id', invoiceToKeep.id);
  };

  const fetchReports = async (
    invoiceId: string,
    weekStart: string,
    weekEnd: string,
    invoiceBrand: string | null
  ) => {
    if (!id) return;
    let query = supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', id)
      .order('platform');
    if (isExtendedInvoiceRange(weekStart, weekEnd)) {
      query = query.gte('week_end_date', weekStart).lte('week_end_date', weekEnd);
    } else {
      query = query.eq('week_start_date', weekStart).eq('week_end_date', weekEnd);
    }
    const { data } = await query;
    const invoiceBrandTrimmed = (invoiceBrand ?? '').trim().toLowerCase();
    const filtered =
      data && invoiceBrandTrimmed
        ? data.filter((r: { brand?: string | null }) => {
            const rBrand = (r.brand ?? '').trim();
            return rBrand.toLowerCase() === invoiceBrandTrimmed || !rBrand;
          })
        : data ?? [];
    setReports((prev) => ({ ...prev, [invoiceId]: filtered }));
  };

  const toggleExpand = (invoice: InvoiceWithFranchisee) => {
    if (expandedId === invoice.id) setExpandedId(null);
    else {
      setExpandedId(invoice.id);
      if (Array.isArray(invoice.line_items) && invoice.line_items.length > 0) return;
      const isCombined = invoice.brands && invoice.brands.length > 0;
      fetchReports(
        invoice.id,
        invoice.week_start_date,
        invoice.week_end_date,
        isCombined ? null : (invoice.brand ?? null)
      );
    }
  };

  const updateStatus = async (invoiceId: string, status: InvoiceStatus) => {
    await supabase.from('invoices').update({ status }).eq('id', invoiceId);
    fetchInvoices();
  };

  const generateAndDownloadPdf = async (invoiceId: string) => {
    setGeneratingPdf(invoiceId);
    try {
      const response = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = response.headers.get('content-type')?.includes('application/json')
          ? (await response.json()).error
          : await response.text();
        alert(err || 'Failed to generate PDF');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? `invoice-${invoiceId}.pdf`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate PDF');
    } finally {
      setGeneratingPdf(null);
    }
  };

  const previewInvoicePdf = async (invoiceId: string) => {
    setPreviewingPdfId(invoiceId);
    try {
      const response = await fetch('/api/generate-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
        credentials: 'include',
      });
      if (!response.ok) {
        const err = response.headers.get('content-type')?.includes('application/json')
          ? (await response.json()).error
          : await response.text();
        alert(err || 'Failed to generate PDF');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      alert('Failed to generate PDF');
    } finally {
      setPreviewingPdfId(null);
    }
  };

  const regenerateAllInvoicePdfs = async () => {
    if (invoices.length === 0) return;
    setRegeneratingAllPdfs(true);
    try {
      let successCount = 0;
      let failCount = 0;
      for (const invoice of invoices) {
        try {
          const response = await fetch('/api/generate-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: invoice.id }),
          });
          if (response.ok) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        } catch {
          failCount += 1;
        }
      }
      if (failCount === 0) {
        setMonthlyInvoiceMessage(`Regenerated ${successCount} invoice PDF${successCount === 1 ? '' : 's'}.`);
        setMonthlyInvoiceError('');
      } else {
        setMonthlyInvoiceError(`Regenerated ${successCount} PDF${successCount === 1 ? '' : 's'}, ${failCount} failed.`);
      }
    } finally {
      setRegeneratingAllPdfs(false);
    }
  };

  const sendInvoiceEmail = async (invoice: InvoiceWithFranchisee, testEmail?: string) => {
    const to = testEmail ?? invoice.franchisees?.email;
    if (!to) {
      alert('This franchisee has no email set.');
      return;
    }
    setSendingEmailId(invoice.id);
    try {
      const response = await fetch('/api/send-invoice-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, ...(testEmail && { testEmail }) }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || 'Failed to send invoice email');
        return;
      }
      alert(data.message ?? 'Invoice sent.');
      fetchInvoices();
    } catch {
      alert('Failed to send invoice email');
    } finally {
      setSendingEmailId(null);
    }
  };

  const recordPayment = async (invoiceId: string) => {
    setRecordingPaymentId(invoiceId);
    try {
      const response = await fetch('/api/record-invoice-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || 'Failed to record payment');
        return;
      }
      alert(data.message ?? 'Invoice marked as paid.');
      fetchInvoices();
    } catch {
      alert('Failed to record payment');
    } finally {
      setRecordingPaymentId(null);
    }
  };

  const openEditInvoice = (invoice: InvoiceWithFranchisee) => {
    if (invoice.status !== 'draft') return;
    setEditingInvoice(invoice);
    setEditInvoiceForm({
      total_gross_revenue: String(invoice.total_gross_revenue ?? ''),
      fee_amount: String(invoice.fee_amount ?? ''),
      fee_percentage: String(invoice.fee_percentage ?? ''),
      week_start_date: invoice.week_start_date ?? '',
      invoice_date: invoice.invoice_date ?? new Date().toISOString().slice(0, 10),
    });
  };

  const saveEditInvoice = async () => {
    if (!editingInvoice) return;
    const gross = parseFloat(editInvoiceForm.total_gross_revenue);
    const fee = parseFloat(editInvoiceForm.fee_amount);
    const pct = parseFloat(editInvoiceForm.fee_percentage);
    if (isNaN(gross) || gross < 0 || isNaN(fee) || fee < 0) {
      alert('Please enter valid numbers for gross revenue and fee.');
      return;
    }
    if (!editInvoiceForm.week_start_date.trim()) {
      alert('Please select the week beginning (Monday).');
      return;
    }
    if (!editInvoiceForm.invoice_date.trim()) {
      alert('Please select the invoice date.');
      return;
    }
    setEditInvoiceSaving(true);
    try {
      const res = await fetch('/api/update-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: editingInvoice.id,
          total_gross_revenue: gross,
          fee_amount: fee,
          ...(isNaN(pct) || pct < 0 ? {} : { fee_percentage: pct }),
          week_start_date: editInvoiceForm.week_start_date.trim(),
          invoice_date: editInvoiceForm.invoice_date.trim(),
        }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to update invoice');
        return;
      }
      setEditingInvoice(null);
      fetchInvoices();
    } catch {
      alert('Failed to update invoice');
    } finally {
      setEditInvoiceSaving(false);
    }
  };

  const deleteInvoice = async (invoice: InvoiceWithFranchisee) => {
    if (!confirm(`Delete invoice ${invoice.invoice_number} (${invoice.brand ?? '—'} week ${invoice.week_start_date})? This cannot be undone.`)) return;
    setDeletingInvoiceId(invoice.id);
    try {
      const response = await fetch('/api/delete-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || 'Failed to delete invoice');
        return;
      }
      fetchInvoices();
      if (expandedId === invoice.id) setExpandedId(null);
    } catch {
      alert('Failed to delete invoice');
    } finally {
      setDeletingInvoiceId(null);
    }
  };

  const generateMonthlyInvoice = async () => {
    if (!id || franchisee?.payment_model !== 'monthly_fixed') return;
    setMonthlyInvoiceSaving(true);
    setMonthlyInvoiceMessage('');
    setMonthlyInvoiceError('');
    try {
      const response = await fetch('/api/create-monthly-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseeId: id, invoiceMonth: backfillStartMonth }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMonthlyInvoiceError(data.error || 'Failed to generate monthly invoice');
        return;
      }
      setMonthlyInvoiceMessage(data.message || 'Monthly invoice generated.');
      fetchInvoices();
    } catch {
      setMonthlyInvoiceError('Failed to generate monthly invoice');
    } finally {
      setMonthlyInvoiceSaving(false);
    }
  };

  const backfillMonthlyInvoices = async () => {
    if (!id || franchisee?.payment_model !== 'monthly_fixed') return;
    const arrearsValue = parseFloat(backfillArrears);
    if (isNaN(arrearsValue) || arrearsValue < 0) {
      setMonthlyInvoiceError('Please enter a valid arrears amount.');
      return;
    }
    if (!backfillStartMonth) {
      setMonthlyInvoiceError('Please select a start month.');
      return;
    }
    setBackfillingInvoices(true);
    setMonthlyInvoiceError('');
    setMonthlyInvoiceMessage('');
    try {
      const response = await fetch('/api/backfill-monthly-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          franchiseeId: id,
          startMonth: backfillStartMonth,
          initialArrears: arrearsValue,
        }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMonthlyInvoiceError(data.error || 'Failed to backfill monthly invoices');
        return;
      }
      const adjustedNote = data.adjustedStartMonth ? ` Start month auto-adjusted to ${data.adjustedStartMonth}.` : '';
      setMonthlyInvoiceMessage(`${data.message || 'Backfill complete.'}${adjustedNote} Remaining arrears: ${formatCurrency(Number(data.remainingArrears ?? 0))}.`);
      fetchInvoices();
    } catch {
      setMonthlyInvoiceError('Failed to backfill monthly invoices');
    } finally {
      setBackfillingInvoices(false);
    }
  };

  if (!id) {
    return (
      <div className="py-12 text-center text-slate-500">
        <p>Invalid franchisee.</p>
        <Link href="/franchisees" className="mt-2 inline-block text-primary hover:underline">
          Back to Franchisees
        </Link>
      </div>
    );
  }

  if (loadingFranchisee) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!franchisee) {
    return (
      <div className="py-12 text-center text-slate-500">
        <p>Franchisee not found.</p>
        <Link href="/franchisees" className="mt-2 inline-block text-primary hover:underline">
          Back to Franchisees
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/franchisees"
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Franchisees
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          {Array.isArray(franchisee.brands) && franchisee.brands.length > 0 && (
            <p className="text-sm font-medium uppercase tracking-wider text-primary">
              {franchisee.brands.join(', ')}
            </p>
          )}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-neutral-100">{franchisee.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-neutral-400">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {franchisee.location}
            </span>
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {franchisee.email}
            </span>
          </div>
          <div className="mt-2">
            {franchisee.payment_model === 'percentage' && (
              <span className="text-sm font-medium text-primary">
                {franchisee.percentage_rate}% of gross sales
              </span>
            )}
            {franchisee.payment_model === 'percentage_per_platform' && (
              <span className="text-sm font-medium text-primary">
                {franchisee.deliveroo_percentage ?? 0}% Deliveroo, {franchisee.ubereats_percentage ?? 0}% Uber Eats, {franchisee.justeat_percentage ?? 0}% Just Eat
              </span>
            )}
            {franchisee.payment_model === 'monthly_fixed' && (
              <span className="text-sm font-medium text-primary">
                {formatCurrency(franchisee.monthly_fee || 0)} / month
              </span>
            )}
            {franchisee.payment_direction === 'pay_them' && (
              <span className="ml-3 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                We pay them
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/franchisees?edit=${franchisee.id}`}
            className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm font-medium text-slate-600 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Total gross revenue</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-neutral-100">
            {loadingInvoices ? '—' : formatCurrency(totalGrossRevenue)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Total fees</p>
          <p className="mt-1 text-xl font-bold text-primary-dark dark:text-primary-light">
            {loadingInvoices ? '—' : formatCurrency(totalFees)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Average fee per invoice</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-neutral-100">
            {loadingInvoices ? '—' : formatCurrency(averageFeePerInvoice)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Total invoices</p>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-neutral-100">{loadingInvoices ? '—' : totalInvoicesCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Outstanding fees</p>
          <p className="mt-1 text-xl font-bold text-primary dark:text-primary">
            {loadingInvoices ? '—' : formatCurrency(outstandingFees)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Oldest unpaid invoice</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-neutral-100">
            {loadingInvoices ? '—' : oldestUnpaid ? (isMonthlyFixedSite ? formatMonthLabel(oldestUnpaid) : `Week ending ${formatDate(oldestUnpaid)}`) : 'None'}
          </p>
        </div>
        {debtTracker && (
          <div className="rounded-xl border border-primary/20 dark:border-primary/30 bg-primary/5 dark:bg-primary/10 p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-primary-dark dark:text-primary">Maidstone debt tracker</p>
            <p className="mt-1 text-xl font-bold text-primary-dark dark:text-primary">{formatCurrency(debtTracker.amountLeft)} left</p>
            <p className="mt-1 text-xs text-primary-dark dark:text-primary">
              {debtTracker.monthsApplied} waived {debtTracker.monthsApplied === 1 ? 'month' : 'months'} applied · {debtTracker.paymentsRemaining} payments remaining
            </p>
          </div>
        )}
      </div>

      {/* Revenue by platform + % split */}
      <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Revenue by platform</p>
        {loadingPlatformRevenue ? (
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <div className="flex flex-wrap gap-4 sm:gap-6">
            {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => {
              const rev = platformRevenue[platform] ?? 0;
              const totalRev =
                platformRevenue.deliveroo + platformRevenue.ubereats + platformRevenue.justeat + platformRevenue.slerp;
              const pct = totalRev > 0 ? Math.round((rev / totalRev) * 100) : 0;
              return (
                <div key={platform} className="flex items-center gap-2">
                  {getPlatformLogo(platform) ? (
                    <img src={getPlatformLogo(platform)} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  ) : null}
                  <span className="text-sm text-slate-600 dark:text-neutral-400">{PLATFORM_LABELS[platform]}</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-neutral-100">
                    {formatCurrency(rev)}
                  </span>
                  <span className="text-sm text-slate-400 dark:text-neutral-400">({pct}%)</span>
                </div>
              );
            })}
          </div>
        )}
      </div>


        <div>
          {monthlyInvoiceMessage && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
              <CheckCircle className="h-4 w-4 flex-shrink-0" />
              {monthlyInvoiceMessage}
            </div>
          )}
          {monthlyInvoiceError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {monthlyInvoiceError}
            </div>
          )}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500 dark:text-neutral-400">Invoices for this franchisee</p>
            </div>
            <div className="flex items-center gap-2">
              {franchisee.payment_model === 'monthly_fixed' && (
                <>
                  <button
                    type="button"
                    onClick={generateMonthlyInvoice}
                    disabled={monthlyInvoiceSaving || backfillingInvoices}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    {monthlyInvoiceSaving ? 'Generating...' : 'Generate monthly invoice'}
                  </button>
                  <input
                    type="month"
                    value={backfillStartMonth}
                    onChange={(e) => setBackfillStartMonth(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 px-2 py-2 text-sm"
                    title="Invoice month (and backfill start month)"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={backfillArrears}
                    onChange={(e) => setBackfillArrears(e.target.value)}
                    className="w-28 rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 px-2 py-2 text-sm"
                    title="Starting arrears amount"
                  />
                  <button
                    type="button"
                    onClick={backfillMonthlyInvoices}
                    disabled={backfillingInvoices || monthlyInvoiceSaving}
                    className="rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                    title="Create backdated monthly invoices and waive fee against arrears"
                  >
                    {backfillingInvoices ? 'Backfilling...' : 'Backfill waived invoices'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={regenerateAllInvoicePdfs}
                disabled={regeneratingAllPdfs || invoices.length === 0}
                className="rounded-lg border border-slate-300 dark:border-neutral-600 px-3 py-2 text-sm font-medium text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-700 disabled:opacity-50"
                title="Rebuild and store PDFs for all invoices in this franchisee"
              >
                {regeneratingAllPdfs ? 'Regenerating PDFs…' : 'Regenerate all PDFs'}
              </button>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
                className="rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="processing">Processing</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {loadingInvoices ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : standardFilteredInvoices.length === 0 && catchUpFilteredInvoices.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-neutral-600 dark:bg-neutral-800 py-16 text-center">
              <FileText className="mx-auto h-12 w-12 text-slate-300 dark:text-neutral-500" />
              <p className="mt-3 text-lg font-medium text-slate-400 dark:text-neutral-200">
                {invoices.length === 0
                  ? 'No invoices yet'
                  : `No ${statusFilter} invoices`}
              </p>
              <p className="mt-1 text-sm text-slate-400 dark:text-neutral-400">
                {invoices.length === 0
                  ? franchisee.payment_model === 'monthly_fixed'
                    ? 'Use "Generate monthly invoice" to create an invoice for the last full month.'
                    : 'Upload weekly reports in the Weekly Hub to create an invoice.'
                  : 'Try a different status filter.'}
              </p>
            </div>
          ) : standardFilteredInvoices.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 shadow-sm">
              <div className="border-b border-slate-200 dark:border-neutral-600 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Weekly invoices</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-neutral-600 bg-slate-50 dark:bg-neutral-700">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Invoice
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Brand
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      {isMonthlyFixedSite ? 'Month' : 'Week'}
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Gross revenue
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Fee
                    </th>
                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Status
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {standardFilteredInvoices.map((invoice) => (
                    <Fragment key={invoice.id}>
                      <tr
                        key={invoice.id}
                        className="border-b border-slate-50 dark:border-neutral-600 transition-colors hover:bg-slate-50/50 dark:hover:bg-neutral-700/50"
                      >
                        <td className="px-5 py-3.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{invoice.invoice_number}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          {(() => {
                            const brandsList =
                              (invoice.brands && invoice.brands.length > 0
                                ? invoice.brands
                                : invoice.brand?.trim()
                                  ? [invoice.brand.trim()]
                                  : Array.isArray(franchisee.brands) && franchisee.brands.length > 0
                                    ? franchisee.brands
                                    : []) as string[];
                            if (brandsList.length === 0)
                              return <span className="text-sm text-slate-500 dark:text-neutral-400">—</span>;
                            return (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {brandsList.map((b) => {
                                  const logo = getBrandLogo(b);
                                  return logo ? (
                                    <img
                                      key={b}
                                      src={logo}
                                      alt={b}
                                      title={b}
                                      className="h-6 w-6 rounded object-contain"
                                    />
                                  ) : (
                                    <span key={b} className="text-xs text-slate-600 dark:text-neutral-300">
                                      {b}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-slate-500 dark:text-neutral-400">
                            {formatInvoicePeriodLabel(invoice)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-medium text-slate-700 dark:text-neutral-200">
                            {formatCurrency(invoice.total_gross_revenue)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                            {formatCurrency(invoice.fee_amount)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <select
                            value={invoice.status}
                            onChange={(e) => updateStatus(invoice.id, e.target.value as InvoiceStatus)}
                            className={cn(
                              'rounded-full border-0 px-3 py-1 text-xs font-semibold cursor-pointer',
                              STATUS_COLORS[invoice.status as InvoiceStatus]
                            )}
                          >
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="processing">Processing</option>
                            <option value="paid">Paid</option>
                            <option value="failed">Failed</option>
                          </select>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {invoice.status === 'draft' && (
                              <button
                                onClick={() => openEditInvoice(invoice)}
                                className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100"
                                title="Edit invoice (draft only)"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleExpand(invoice)}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100"
                              title="View details"
                            >
                              {expandedId === invoice.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                            {invoice.status !== 'paid' && invoice.status !== 'processing' && franchisee.payment_direction === 'pay_them' && (
                              <button
                                onClick={() => recordPayment(invoice.id)}
                                disabled={recordingPaymentId === invoice.id}
                                className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                                title="Pay due funds (mark as paid)"
                              >
                                {recordingPaymentId === invoice.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                                ) : (
                                  <Banknote className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            {franchisee.email && (
                              <button
                                onClick={() => sendInvoiceEmail(invoice)}
                                disabled={sendingEmailId === invoice.id}
                                className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                                title={`Send PDF to ${franchisee.email}`}
                              >
                                {sendingEmailId === invoice.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => previewInvoicePdf(invoice.id)}
                              disabled={previewingPdfId === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100 disabled:opacity-50"
                              title="Preview PDF"
                            >
                              {previewingPdfId === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => generateAndDownloadPdf(invoice.id)}
                              disabled={generatingPdf === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100 disabled:opacity-50"
                              title="Download PDF"
                            >
                              {generatingPdf === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => deleteInvoice(invoice)}
                              disabled={deletingInvoiceId === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                              title="Delete invoice"
                            >
                              {deletingInvoiceId === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === invoice.id && (
                        <tr key={`${invoice.id}-detail`}>
                          <td colSpan={7} className="bg-slate-50 dark:bg-neutral-700/50 px-5 py-4">
                            <div className="rounded-lg bg-white dark:bg-neutral-800 p-4 shadow-sm">
                              {invoice.status !== 'paid' && invoice.status !== 'processing' && franchisee.payment_direction === 'pay_them' && (
                                <p className="mb-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                                  We pay them. Use &quot;Pay due funds&quot; above when you have paid this invoice.
                                </p>
                              )}
                              {franchisee.email && (
                                <p className="mb-3">
                                  <button
                                    type="button"
                                    onClick={() => sendInvoiceEmail(invoice, TEST_INVOICE_EMAIL)}
                                    disabled={sendingEmailId === invoice.id}
                                    className="text-xs text-slate-500 dark:text-neutral-400 underline hover:text-slate-700 dark:hover:text-neutral-200 disabled:opacity-50"
                                  >
                                    Send test copy to {TEST_INVOICE_EMAIL}
                                  </button>
                                </p>
                              )}
                              <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">
                                {Array.isArray(invoice.line_items) && invoice.line_items.length > 0
                                  ? 'Catch-up breakdown'
                                  : isMonthlyFixedSite
                                    ? 'Invoice summary'
                                    : 'Revenue breakdown'}
                              </h4>
                              {Array.isArray(invoice.line_items) && invoice.line_items.length > 0 ? (
                                <div className="space-y-2">
                                  {invoice.line_items.map((item, idx) => (
                                    <div
                                      key={`${item.source_invoice_id ?? item.label}-${idx}`}
                                      className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-neutral-700 px-4 py-2"
                                    >
                                      <div>
                                        <p className="text-sm text-slate-700 dark:text-neutral-200">{item.label}</p>
                                        {item.source_invoice_number && (
                                          <p className="text-xs text-slate-500 dark:text-neutral-400">{item.source_invoice_number}</p>
                                        )}
                                      </div>
                                      <div className="text-right">
                                        <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                                          {formatCurrency(item.fee_amount)}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-neutral-400">
                                          Gross {formatCurrency(item.gross_revenue)}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                  <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-neutral-600 px-4 pt-3">
                                    <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Total gross revenue</span>
                                    <span className="text-sm font-bold text-slate-900 dark:text-neutral-100">
                                      {formatCurrency(invoice.total_gross_revenue)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between px-4">
                                    <span className="text-sm font-semibold text-primary-dark dark:text-primary-light">
                                      Total amount due
                                    </span>
                                    <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                                      {formatCurrency(invoice.fee_amount)}
                                    </span>
                                  </div>
                                </div>
                              ) : reports[invoice.id] ? (
                                <div className="space-y-2">
                                  {(() => {
                                    const normalizePlatformForDisplay = (p: string): Platform => {
                                      const s = String(p ?? '').toLowerCase().replace(/\s+/g, '');
                                      if (s === 'deliveroo' || s === 'ubereats' || s === 'justeat' || s === 'slerp') return s as Platform;
                                      if (s === 'uber_eats' || s === 'uber') return 'ubereats';
                                      if (s === 'just_eat') return 'justeat';
                                      return 'deliveroo';
                                    };
                                    const list = reports[invoice.id];
                                    const byKey = new Map<string, { brand: string; platform: Platform; gross_revenue: number }>();
                                    for (const report of list) {
                                      const platformNorm = normalizePlatformForDisplay(report.platform);
                                      const key = `${platformNorm}|${(report.brand ?? '').trim()}`;
                                      const existing = byKey.get(key);
                                      const rev = Number(report.gross_revenue) || 0;
                                      if (existing) existing.gross_revenue += rev;
                                      else byKey.set(key, { brand: (report.brand ?? '').trim(), platform: platformNorm, gross_revenue: rev });
                                    }
                                    const rows = Array.from(byKey.values()).sort((a, b) => a.platform.localeCompare(b.platform));
                                    const breakdownTotal = rows.reduce((s, r) => s + r.gross_revenue, 0);
                                    const invoiceTotal = Number(invoice.total_gross_revenue) || 0;
                                    const mismatch = !isMonthlyFixedSite && Math.abs(breakdownTotal - invoiceTotal) > 0.02;
                                    return (
                                      <>
                                        {isMaidstoneSite && invoiceDebtSnapshots[invoice.id] && (
                                          <p className="mb-3 rounded-md bg-orange-50 dark:bg-orange-900/20 px-3 py-2 text-xs text-orange-800 dark:text-orange-200">
                                            Fee waived toward arrears this month: {formatCurrency(invoiceDebtSnapshots[invoice.id].waivedAmount)}. Balance after this month: {formatCurrency(invoiceDebtSnapshots[invoice.id].balanceAfter)}.
                                          </p>
                                        )}
                                        {mismatch && (
                                          <p className="mb-3 rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                                            Breakdown total ({formatCurrency(breakdownTotal)}) doesn’t match invoice total. Upload any missing platform reports for week {formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the Weekly Hub (same week, correct brand).
                                          </p>
                                        )}
                                        {rows.length > 0 ? rows.map((item, idx) => (
                                          <div
                                            key={`${item.platform}-${item.brand}-${idx}`}
                                            className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-neutral-700 px-4 py-2"
                                          >
                                            <span className="text-sm text-slate-600 dark:text-neutral-300">
                                              {item.brand ? `${item.brand} – ${PLATFORM_LABELS[item.platform]}` : PLATFORM_LABELS[item.platform]}
                                            </span>
                                            <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                                              {formatCurrency(item.gross_revenue)}
                                            </span>
                                          </div>
                                        )) : (
                                          <p className="text-sm text-slate-500 dark:text-neutral-400">
                                            {isMonthlyFixedSite
                                              ? 'Monthly fixed invoice (no uploaded platform reports required).'
                                              : `No reports found for this invoice’s week. Upload platform reports for week ${formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the Weekly Hub.`}
                                          </p>
                                        )}
                                        <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-neutral-600 px-4 pt-3">
                                          <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Total</span>
                                          <span className="text-sm font-bold text-slate-900 dark:text-neutral-100">
                                            {formatCurrency(invoice.total_gross_revenue)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between px-4">
                                          <span className="text-sm font-semibold text-primary-dark dark:text-primary-light">
                                            {isMonthlyFixedSite ? 'Fee (monthly fixed)' : `Fee (${invoice.fee_percentage}%)`}
                                          </span>
                                          <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                                            {formatCurrency(invoice.fee_amount)}
                                          </span>
                                        </div>
                                        {rows.length > 0 && (
                                          <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">
                                            Missing a platform (e.g. Uber Eats)? Upload its report for week {formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the <Link href="/weekly" className="underline hover:text-slate-700 dark:hover:text-neutral-200">Weekly Hub</Link> — same week and brand. The invoice will update automatically.
                                          </p>
                                        )}
                                        {(() => {
                                          if (isMonthlyFixedSite) return null;
                                          const missingAggregator = (['deliveroo', 'ubereats', 'justeat'] as const).filter((p) => !rows.some((r) => r.platform === p));
                                          if (missingAggregator.length === 0) return null;
                                          const platformValue: AggregatorPlatform = missingAggregator.includes(manualAddPlatform) ? manualAddPlatform : missingAggregator[0];
                                          return (
                                            <div className="mt-4 rounded-lg border border-slate-200 dark:border-neutral-600 bg-slate-50/50 dark:bg-neutral-700/30 p-3">
                                              <p className="text-xs font-medium text-slate-600 dark:text-neutral-300 mb-2">
                                                CSV download blank? Enter the gross revenue from the platform dashboard (e.g. Sales incl. VAT) and we’ll update the invoice.
                                              </p>
                                              <div className="flex flex-wrap items-end gap-2">
                                                <div>
                                                  <label className="sr-only">Platform</label>
                                                  <select
                                                    value={platformValue}
                                                    onChange={(e) => setManualAddPlatform(e.target.value as AggregatorPlatform)}
                                                    className="rounded border border-slate-300 dark:border-neutral-500 bg-white dark:bg-neutral-700 text-sm text-slate-900 dark:text-neutral-100 px-2 py-1.5"
                                                  >
                                                    {missingAggregator.map((p) => (
                                                      <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="sr-only">Amount (£)</label>
                                                  <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    placeholder="e.g. 849.73"
                                                    value={manualAddAmount}
                                                    onChange={(e) => { setManualAddAmount(e.target.value); setManualAddError(''); }}
                                                    className="w-28 rounded border border-slate-300 dark:border-neutral-500 bg-white dark:bg-neutral-700 text-sm text-slate-900 dark:text-neutral-100 px-2 py-1.5"
                                                  />
                                                </div>
                                                <button
                                                  type="button"
                                                  disabled={manualAddSaving}
                                                  onClick={() => saveManualReport(invoice, platformValue)}
                                                  className="rounded bg-primary text-white text-sm px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
                                                >
                                                  {manualAddSaving ? 'Saving…' : 'Add and update invoice'}
                                                </button>
                                              </div>
                                              {manualAddError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{manualAddError}</p>}
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="flex justify-center py-4">
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Weekly invoices</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
                No weekly invoices match the current filter.
              </p>
            </div>
          )}

          {catchUpFilteredInvoices.length > 0 && (
            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 shadow-sm">
              <div className="border-b border-slate-200 dark:border-neutral-600 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Catch-up invoices</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-neutral-400">
                  Combined invoices created from older unpaid weeks.
                </p>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-neutral-600 bg-slate-50 dark:bg-neutral-700">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Invoice
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Coverage
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Amount due
                    </th>
                    <th className="px-5 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Status
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {catchUpFilteredInvoices.map((invoice) => (
                    <Fragment key={invoice.id}>
                      <tr className="border-b border-slate-50 dark:border-neutral-600 transition-colors hover:bg-slate-50/50 dark:hover:bg-neutral-700/50">
                        <td className="px-5 py-3.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{invoice.invoice_number}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-slate-500 dark:text-neutral-400">
                            {formatInvoicePeriodLabel(invoice)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                            {formatCurrency(invoice.fee_amount)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <select
                            value={invoice.status}
                            onChange={(e) => updateStatus(invoice.id, e.target.value as InvoiceStatus)}
                            className={cn(
                              'rounded-full border-0 px-3 py-1 text-xs font-semibold cursor-pointer',
                              STATUS_COLORS[invoice.status as InvoiceStatus]
                            )}
                          >
                            <option value="draft">Draft</option>
                            <option value="sent">Sent</option>
                            <option value="processing">Processing</option>
                            <option value="paid">Paid</option>
                            <option value="failed">Failed</option>
                          </select>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {invoice.status === 'draft' && (
                              <button
                                onClick={() => openEditInvoice(invoice)}
                                className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100"
                                title="Edit invoice (draft only)"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleExpand(invoice)}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100"
                              title="View details"
                            >
                              {expandedId === invoice.id ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>
                            {franchisee.email && (
                              <button
                                onClick={() => sendInvoiceEmail(invoice)}
                                disabled={sendingEmailId === invoice.id}
                                className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                                title={`Send PDF to ${franchisee.email}`}
                              >
                                {sendingEmailId === invoice.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => previewInvoicePdf(invoice.id)}
                              disabled={previewingPdfId === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100 disabled:opacity-50"
                              title="Preview PDF"
                            >
                              {previewingPdfId === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => generateAndDownloadPdf(invoice.id)}
                              disabled={generatingPdf === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-slate-100 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100 disabled:opacity-50"
                              title="Download PDF"
                            >
                              {generatingPdf === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              onClick={() => deleteInvoice(invoice)}
                              disabled={deletingInvoiceId === invoice.id}
                              className="rounded-lg p-1.5 text-slate-400 dark:text-neutral-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                              title="Delete invoice"
                            >
                              {deletingInvoiceId === invoice.id ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === invoice.id && (
                        <tr key={`${invoice.id}-catch-up-detail`}>
                          <td colSpan={5} className="bg-slate-50 dark:bg-neutral-700/50 px-5 py-4">
                            <div className="rounded-lg bg-white dark:bg-neutral-800 p-4 shadow-sm">
                              {franchisee.email && (
                                <p className="mb-3">
                                  <button
                                    type="button"
                                    onClick={() => sendInvoiceEmail(invoice, TEST_INVOICE_EMAIL)}
                                    disabled={sendingEmailId === invoice.id}
                                    className="text-xs text-slate-500 dark:text-neutral-400 underline hover:text-slate-700 dark:hover:text-neutral-200 disabled:opacity-50"
                                  >
                                    Send test copy to {TEST_INVOICE_EMAIL}
                                  </button>
                                </p>
                              )}
                              <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">Catch-up breakdown</h4>
                              <div className="space-y-2">
                                {invoice.line_items?.map((item, idx) => (
                                  <div
                                    key={`${item.source_invoice_id ?? item.label}-${idx}`}
                                    className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-neutral-700 px-4 py-2"
                                  >
                                    <div>
                                      <p className="text-sm text-slate-700 dark:text-neutral-200">{item.label}</p>
                                      {item.source_invoice_number && (
                                        <p className="text-xs text-slate-500 dark:text-neutral-400">{item.source_invoice_number}</p>
                                      )}
                                    </div>
                                    <div className="text-right">
                                      <p className="text-sm font-semibold text-slate-900 dark:text-neutral-100">
                                        {formatCurrency(item.fee_amount)}
                                      </p>
                                      <p className="text-xs text-slate-500 dark:text-neutral-400">
                                        Gross {formatCurrency(item.gross_revenue)}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                                <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-neutral-600 px-4 pt-3">
                                  <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Total gross revenue</span>
                                  <span className="text-sm font-bold text-slate-900 dark:text-neutral-100">
                                    {formatCurrency(invoice.total_gross_revenue)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between px-4">
                                  <span className="text-sm font-semibold text-primary-dark dark:text-primary-light">
                                    Total amount due
                                  </span>
                                  <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                                    {formatCurrency(invoice.fee_amount)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {editingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !editInvoiceSaving && setEditingInvoice(null)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-neutral-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100 mb-4">Edit invoice {editingInvoice.invoice_number}</h3>
            <p className="text-sm text-slate-500 dark:text-neutral-400 mb-4">Only draft invoices can be edited. You can change the invoice date, period, gross revenue and fee.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Invoice date</label>
                <input
                  type="date"
                  value={editInvoiceForm.invoice_date}
                  onChange={(e) => setEditInvoiceForm((f) => ({ ...f, invoice_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Week beginning (Monday)</label>
                <input
                  type="date"
                  value={editInvoiceForm.week_start_date}
                  onChange={(e) => setEditInvoiceForm((f) => ({ ...f, week_start_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Total gross revenue (£)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editInvoiceForm.total_gross_revenue}
                  onChange={(e) => setEditInvoiceForm((f) => ({ ...f, total_gross_revenue: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Fee (£)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editInvoiceForm.fee_amount}
                  onChange={(e) => setEditInvoiceForm((f) => ({ ...f, fee_amount: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-neutral-300 mb-1">Fee % (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={editInvoiceForm.fee_percentage}
                  onChange={(e) => setEditInvoiceForm((f) => ({ ...f, fee_percentage: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                disabled={editInvoiceSaving}
                className="rounded-lg border border-slate-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditInvoice}
                disabled={editInvoiceSaving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {editInvoiceSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
