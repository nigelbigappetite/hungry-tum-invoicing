'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Franchisee,
  Invoice,
  InvoiceStatus,
  STATUS_COLORS,
  PLATFORM_LABELS,
  Platform,
  WeeklyReport,
  BRAND_OPTIONS,
  AGGREGATOR_PLATFORMS,
  type AggregatorPlatform,
} from '@/lib/types';
import {
  formatCurrency,
  formatDate,
  formatWeekRange,
  formatRecommendedBacsDateFromInvoiceDate,
  getPlatformFeeRate,
  getSlerpSalesPeriodEndForInvoiceWeek,
  getWeekRangeFromDate,
  cn,
} from '@/lib/utils';
import { getPlatformLogo } from '@/lib/logos';
import { startOfWeek, endOfWeek, format, addDays, parseISO } from 'date-fns';
import FileUpload from '@/components/FileUpload';
import {
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  Upload,
  FileText,
  Download,
  ChevronDown,
  ChevronUp,
  Building2,
  Send,
  Pencil,
  MapPin,
  Mail,
  X,
  Banknote,
  Trash2,
  Eye,
} from 'lucide-react';

const TEST_INVOICE_EMAIL = 'nigelwingshackco@gmail.com';

interface PlatformResult {
  platform: Platform;
  gross_revenue: number;
  file: File;
  file_type: 'csv' | 'pdf';
  confidence: string;
  file_name: string;
  /** When Deliveroo PDF has multiple Hungry Tum brands (e.g. Bethnal Green), per-brand Total Order Value. */
  deliveroo_brand_breakdown?: Record<string, number>;
}

interface InvoiceWithFranchisee extends Invoice {
  franchisees: {
    name: string;
    location: string;
    email: string;
    bacs_payment_method_id: string | null;
  } | null;
}

export default function FranchiseeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;
  const supabase = createClient();

  const [franchisee, setFranchisee] = useState<Franchisee | null>(null);
  const [loadingFranchisee, setLoadingFranchisee] = useState(true);
  const [activeTab, setActiveTab] = useState<'upload' | 'invoices'>('invoices');
  const [settingUpBacs, setSettingUpBacs] = useState(false);
  const [clearingBacs, setClearingBacs] = useState(false);

  // Upload state: multiple rows per platform so multi-brand sites can upload several reports per week
  const [weekDate, setWeekDate] = useState(() => {
    const now = new Date();
    const monday = startOfWeek(now, { weekStartsOn: 1 });
    return format(monday, 'yyyy-MM-dd');
  });
  type UploadRow = {
    rowId: string;
    platform: Platform;
    brand: string;
    result: PlatformResult | null;
    editableRevenue: string;
  };
  const [uploadRows, setUploadRows] = useState<UploadRow[]>(() =>
    AGGREGATOR_PLATFORMS.map((platform) => ({
      rowId: `init-${platform}`,
      platform,
      brand: '',
      result: null,
      editableRevenue: '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Invoices state (fetch all for metrics; filter in UI for table)
  const [invoices, setInvoices] = useState<InvoiceWithFranchisee[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, WeeklyReport[]>>({});
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [previewingPdfId, setPreviewingPdfId] = useState<string | null>(null);
  const [chargingBacsId, setChargingBacsId] = useState<string | null>(null);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceWithFranchisee | null>(null);
  const [editInvoiceSaving, setEditInvoiceSaving] = useState(false);
  const [editInvoiceForm, setEditInvoiceForm] = useState({ total_gross_revenue: '', fee_amount: '', fee_percentage: '', week_start_date: '' });

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

  // Slerp upload (Wing Shack Direct)
  type SlerpPreviewRow = { weekStart: string; weekEnd: string; payoutDate: string; grossRevenue: number; feePercentage: number; feeAmount: number };
  const [slerpFile, setSlerpFile] = useState<File | null>(null);
  const [slerpPreview, setSlerpPreview] = useState<SlerpPreviewRow[]>([]);
  const [slerpParsing, setSlerpParsing] = useState(false);
  const [slerpSaving, setSlerpSaving] = useState(false);
  const [slerpError, setSlerpError] = useState('');
  const [slerpSuccess, setSlerpSuccess] = useState(false);
  const slerpBrand = 'Wing Shack';

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
    const { data, error } = await supabase
      .from('invoices')
      .select('*, franchisees(name, location, email, bacs_payment_method_id)')
      .eq('franchisee_id', id)
      .order('created_at', { ascending: false });
    if (!error && data) setInvoices(data as InvoiceWithFranchisee[]);
    setLoadingInvoices(false);
  }, [id, supabase]);

  const fetchPlatformRevenue = useCallback(async () => {
    if (!id) return;
    setLoadingPlatformRevenue(true);
    const { data: invoiceWeeks } = await supabase
      .from('invoices')
      .select('brand, week_start_date, week_end_date')
      .eq('franchisee_id', id);
    const weekKeys = new Set(
      (invoiceWeeks || []).map(
        (r: { brand: string | null; week_start_date: string; week_end_date: string }) =>
          `${(r.brand ?? '').trim()}|${r.week_start_date}|${r.week_end_date}`
      )
    );
    // Slerp uses Tue–Mon weeks; map each invoice week to its Slerp pay-week key so Slerp revenue is included
    const slerpWeekKeys = new Set<string>();
    (invoiceWeeks || []).forEach((r: { brand: string | null; week_start_date: string; week_end_date: string }) => {
      const brand = (r.brand ?? '').trim();
      if (!brand) return;
      const slerpWeekEnd = getSlerpSalesPeriodEndForInvoiceWeek(r.week_end_date);
      const slerpWeekStart = format(addDays(parseISO(slerpWeekEnd), -6), 'yyyy-MM-dd');
      slerpWeekKeys.add(`${brand}|${slerpWeekStart}|${slerpWeekEnd}`);
    });
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
      const isSlerp = normalizePlatform(row.platform) === 'slerp';
      const matchesInvoice = isSlerp ? slerpWeekKeys.has(key) : weekKeys.has(key);
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

  const setupBacs = async () => {
    if (!id) return;
    setSettingUpBacs(true);
    try {
      const res = await fetch('/api/setup-bacs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseeId: id }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.message) {
        alert(data.message);
        fetchFranchisee();
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      alert(data.error || 'Failed to start BACS setup');
    } catch {
      alert('Failed to start BACS setup');
    } finally {
      setSettingUpBacs(false);
    }
  };

  const clearBacs = async () => {
    if (!id || !confirm('Clear stored BACS details? The franchisee will need to complete "Set up BACS" again (e.g. for live mode).')) return;
    setClearingBacs(true);
    try {
      const res = await fetch('/api/clear-bacs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseeId: id }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(data.message ?? 'BACS cleared.');
        fetchFranchisee();
      } else {
        alert(data.error || 'Failed to clear BACS');
      }
    } catch {
      alert('Failed to clear BACS');
    } finally {
      setClearingBacs(false);
    }
  };

  const uploadBrandOptions =
    Array.isArray(franchisee?.brands) && franchisee.brands.length > 0
      ? franchisee.brands
      : [...BRAND_OPTIONS];

  /** For Deliveroo: use statement breakdown if present, else synthesize one (total under Wing Shack) so three lines always show. */
  const getDeliverooBreakdown = (row: UploadRow): Record<string, number> | undefined => {
    if (row.platform !== 'deliveroo' || !row.result) return undefined;
    const bd = row.result.deliveroo_brand_breakdown;
    if (bd && Object.keys(bd).length > 0) return bd;
    const rev = row.result.gross_revenue ?? (parseFloat(row.editableRevenue || '0') || 0);
    return { 'Eggs n Stuff': 0, 'SMSH BN': 0, 'Wing Shack': Math.round(rev * 100) / 100 };
  };

  const isPercentageBased =
    franchisee?.payment_model === 'percentage' ||
    franchisee?.payment_model === 'percentage_per_platform';

  const handleResult = (result: PlatformResult, rowId: string) => {
    setUploadRows((prev) =>
      prev.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              result,
              editableRevenue: result.gross_revenue.toString(),
              brand:
                row.platform === 'deliveroo'
                  ? '__multibrand__'
                  : row.brand?.trim() || uploadBrandOptions[0] || '',
            }
          : row
      )
    );
  };
  const handleClear = (rowId: string) => {
    setUploadRows((prev) =>
      prev.map((row) =>
        row.rowId === rowId ? { ...row, result: null, editableRevenue: '' } : row
      )
    );
  };
  const addUploadRow = (platform: Platform) => {
    setUploadRows((prev) => [
      ...prev,
      {
        rowId: `row-${Date.now()}-${platform}`,
        platform,
        brand: uploadBrandOptions[0] || '',
        result: null,
        editableRevenue: '',
      },
    ]);
  };
  const removeUploadRow = (rowId: string) => {
    setUploadRows((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const weekStart = startOfWeek(new Date(weekDate), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(weekDate), { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
  const rowsWithData = uploadRows.filter((r) => r.result !== null);
  const totalGross = rowsWithData.reduce((sum, r) => {
    const bd = getDeliverooBreakdown(r);
    if (bd) return sum + Object.values(bd).reduce((a, b) => a + b, 0);
    const val = parseFloat(r.editableRevenue || '0');
    return sum + (isNaN(val) ? 0 : val);
  }, 0);
  const feeRate = franchisee?.percentage_rate ?? 6;
  const feeAmount =
    franchisee?.payment_model === 'percentage_per_platform'
      ? Math.round(
          rowsWithData.reduce(
            (sum, r) => {
              const bd = getDeliverooBreakdown(r);
              if (bd) {
                const rowTotal = Object.values(bd).reduce((a, b) => a + b, 0);
                return sum + rowTotal * (getPlatformFeeRate(franchisee, r.platform) / 100);
              }
              const rev = parseFloat(r.editableRevenue || '0') || 0;
              return sum + rev * (getPlatformFeeRate(franchisee, r.platform) / 100);
            },
            0
          ) * 100
        ) / 100
      : Math.round(totalGross * (feeRate / 100) * 100) / 100;

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

  const handleSaveUpload = async () => {
    if (!id || !franchisee) return;
    if (rowsWithData.length === 0) {
      setUploadError('Please upload at least one platform report');
      return;
    }
    if (!isPercentageBased) {
      setUploadError('Upload is only available for percentage-based franchisees.');
      return;
    }
    for (const row of rowsWithData) {
      const isDeliverooWithResult = row.platform === 'deliveroo' && row.result;
      if (!isDeliverooWithResult && !row.brand?.trim()) {
        setUploadError(`Please select a brand for ${PLATFORM_LABELS[row.platform]}.`);
        return;
      }
    }
    setSaving(true);
    setUploadError('');
    try {
      for (const row of rowsWithData) {
        const result = row.result!;
        const bd = getDeliverooBreakdown(row);
        const hasBreakdown = Boolean(bd && row.platform === 'deliveroo');

        if (hasBreakdown && bd) {
          const filePath = `reports/${id}/${weekStartStr}/deliveroo-multibrand-${result.file.name}`;
          await supabase.storage.from('invoicing').upload(filePath, result.file, { upsert: true });
          for (const [brand, amount] of Object.entries(bd)) {
            await supabase
              .from('weekly_reports')
              .delete()
              .eq('franchisee_id', id)
              .eq('brand', brand)
              .eq('platform', 'deliveroo')
              .eq('week_start_date', weekStartStr)
              .eq('week_end_date', weekEndStr);
            const { error: insertError } = await supabase.from('weekly_reports').insert({
              franchisee_id: id,
              brand,
              platform: 'deliveroo',
              week_start_date: weekStartStr,
              week_end_date: weekEndStr,
              gross_revenue: Math.round(amount * 100) / 100,
              file_path: filePath,
              file_type: result.file_type,
            });
            if (insertError) throw insertError;
          }
        } else {
          const revenue = parseFloat(row.editableRevenue || '0');
          const brand = row.brand.trim();
          await supabase
            .from('weekly_reports')
            .delete()
            .eq('franchisee_id', id)
            .eq('brand', brand)
            .eq('platform', row.platform)
            .eq('week_start_date', weekStartStr)
            .eq('week_end_date', weekEndStr);
          const filePath = `reports/${id}/${weekStartStr}/${brand}-${row.platform}-${result.file.name}`;
          await supabase.storage.from('invoicing').upload(filePath, result.file, { upsert: true });
          const { error: insertError } = await supabase.from('weekly_reports').insert({
            franchisee_id: id,
            brand,
            platform: row.platform,
            week_start_date: weekStartStr,
            week_end_date: weekEndStr,
            gross_revenue: revenue,
            file_path: filePath,
            file_type: result.file_type,
          });
          if (insertError) throw insertError;
        }
      }
      const brandsInBatch = [
        ...new Set(
          rowsWithData.flatMap((r) => {
            const bd = getDeliverooBreakdown(r);
            if (bd && r.platform === 'deliveroo') return Object.keys(bd);
            return r.brand.trim() ? [r.brand.trim()] : [];
          })
        ),
      ].filter(Boolean);
      for (const brand of brandsInBatch) {
        const { data: allReports } = await supabase
          .from('weekly_reports')
          .select('platform, gross_revenue')
          .eq('franchisee_id', id)
          .eq('brand', brand)
          .eq('week_start_date', weekStartStr)
          .eq('week_end_date', weekEndStr)
          .in('platform', ['deliveroo', 'ubereats', 'justeat']);
        const totalGrossBrand =
          (allReports || []).reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
        const totalFeeBrand =
          franchisee.payment_model === 'percentage_per_platform'
            ? (allReports || []).reduce(
                (s, r) =>
                  s +
                  Math.round(
                    Number(r.gross_revenue ?? 0) * (getPlatformFeeRate(franchisee, r.platform) / 100) * 100
                  ) / 100,
                0
              )
            : Math.round(totalGrossBrand * ((franchisee.percentage_rate ?? 6) / 100) * 100) / 100;
        const roundedGross = Math.round(totalGrossBrand * 100) / 100;
        const roundedFee = Math.round(totalFeeBrand * 100) / 100;
        const effectivePct =
          roundedGross > 0 ? Math.round((roundedFee / roundedGross) * 10000) / 100 : (franchisee.percentage_rate ?? 6);
        const { data: existing } = await supabase
          .from('invoices')
          .select('id, status')
          .eq('franchisee_id', id)
          .eq('brand', brand)
          .eq('week_start_date', weekStartStr)
          .eq('week_end_date', weekEndStr)
          .maybeSingle();
        if (existing) {
          const { error: updateError } = await supabase
            .from('invoices')
            .update({
              total_gross_revenue: roundedGross,
              fee_percentage: effectivePct,
              fee_amount: roundedFee,
            })
            .eq('id', existing.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertInvoiceError } = await supabase.from('invoices').insert({
            franchisee_id: id,
            brand,
            week_start_date: weekStartStr,
            week_end_date: weekEndStr,
            total_gross_revenue: roundedGross,
            fee_percentage: effectivePct,
            fee_amount: roundedFee,
            status: 'draft',
          });
          if (insertInvoiceError) throw insertInvoiceError;
        }
      }
      setUploadSuccess(true);
      setUploadRows(AGGREGATOR_PLATFORMS.map((platform) => ({
        rowId: `init-${platform}-${Date.now()}`,
        platform,
        brand: '',
        result: null,
        editableRevenue: '',
      })));
      fetchInvoices();
      fetchPlatformRevenue();
      setActiveTab('invoices');
      setTimeout(() => setUploadSuccess(false), 3000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to save reports');
    }
    setSaving(false);
  };

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
    const brand = (invoice.brand ?? '').trim();
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
        .eq('brand', brand)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .in('platform', ['deliveroo', 'ubereats', 'justeat']);
      const totalGrossBrand = (allReports || []).reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
      const totalFeeBrand =
        franchisee.payment_model === 'percentage_per_platform'
          ? (allReports || []).reduce(
              (s, r) =>
                s +
                Math.round(Number(r.gross_revenue ?? 0) * (getPlatformFeeRate(franchisee, r.platform) / 100) * 100) / 100,
              0
            )
          : Math.round(totalGrossBrand * ((franchisee.percentage_rate ?? 6) / 100) * 100) / 100;
      const roundedGross = Math.round(totalGrossBrand * 100) / 100;
      const roundedFee = Math.round(totalFeeBrand * 100) / 100;
      const effectivePct = roundedGross > 0 ? Math.round((roundedFee / roundedGross) * 10000) / 100 : (franchisee.percentage_rate ?? 6);
      const { error: updateErr } = await supabase
        .from('invoices')
        .update({ total_gross_revenue: roundedGross, fee_percentage: effectivePct, fee_amount: roundedFee })
        .eq('id', invoice.id);
      if (updateErr) throw updateErr;
      setManualAddAmount('');
      fetchReports(invoice.id, weekStartStr, weekEndStr, invoice.brand ?? null);
      fetchInvoices();
      fetchPlatformRevenue();
    } catch (err) {
      setManualAddError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setManualAddSaving(false);
    }
  };

  const handleSlerpFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSlerpFile(file ?? null);
    setSlerpPreview([]);
    setSlerpError('');
    if (!file || !id) return;
    setSlerpParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('franchiseeId', id);
      formData.append('brand', slerpBrand);
      const res = await fetch('/api/parse-slerp', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parse failed');
      setSlerpPreview(
        (data.preview ?? []).map((p: { weekStart: string; weekEnd: string; payoutDate: string; grossRevenue: number; feePercentage: number; feeAmount: number }) => ({
          weekStart: p.weekStart,
          weekEnd: p.weekEnd,
          payoutDate: p.payoutDate,
          grossRevenue: p.grossRevenue,
          feePercentage: p.feePercentage,
          feeAmount: p.feeAmount,
        }))
      );
      if (data.errors?.length) setSlerpError(data.errors.join('; '));
    } catch (err) {
      setSlerpError(err instanceof Error ? err.message : 'Failed to parse Slerp file');
    } finally {
      setSlerpParsing(false);
    }
  };

  const handleSaveSlerpReports = async () => {
    if (!id || slerpPreview.length === 0) return;
    setSlerpSaving(true);
    setSlerpError('');
    try {
      const res = await fetch('/api/save-slerp-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          franchiseeId: id,
          brand: slerpBrand,
          payWeeks: slerpPreview.map((p) => ({ weekStart: p.weekStart, weekEnd: p.weekEnd, grossRevenue: p.grossRevenue })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSlerpSuccess(true);
      setSlerpPreview([]);
      setSlerpFile(null);
      fetchInvoices();
      fetchPlatformRevenue();
      setTimeout(() => setSlerpSuccess(false), 3000);
    } catch (err) {
      setSlerpError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSlerpSaving(false);
    }
  };

  const fetchReports = async (
    invoiceId: string,
    weekStart: string,
    weekEnd: string,
    invoiceBrand: string | null
  ) => {
    if (!id) return;
    const { data } = await supabase
      .from('weekly_reports')
      .select('*')
      .eq('franchisee_id', id)
      .eq('week_start_date', weekStart)
      .eq('week_end_date', weekEnd)
      .order('platform');
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
      fetchReports(
        invoice.id,
        invoice.week_start_date,
        invoice.week_end_date,
        invoice.brand ?? null
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

  const chargeBacs = async (invoiceId: string) => {
    setChargingBacsId(invoiceId);
    try {
      const response = await fetch('/api/charge-invoice-bacs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || 'Failed to collect via BACS');
        return;
      }
      alert(data.message ?? 'BACS collection started.');
      fetchInvoices();
    } catch {
      alert('Failed to collect via BACS');
    } finally {
      setChargingBacsId(null);
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
            {franchisee.bacs_payment_method_id && (
              <span className="ml-3 flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
                <CheckCircle className="h-3.5 w-3.5" />
                BACS set up
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!franchisee.bacs_payment_method_id && (
            <button
              type="button"
              onClick={setupBacs}
              disabled={settingUpBacs}
              className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm font-medium text-slate-600 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-50"
            >
              {settingUpBacs ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 dark:border-neutral-500 border-t-slate-600 dark:border-t-neutral-400" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
              Set up BACS
            </button>
          )}
          {franchisee.bacs_payment_method_id && (
            <button
              type="button"
              onClick={clearBacs}
              disabled={clearingBacs}
              className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title="Clear stored BACS so you can set up again (e.g. after switching to live Stripe)"
            >
              {clearingBacs ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
              ) : null}
              Re-set up BACS
            </button>
          )}
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
          <p className="mt-1 text-xl font-bold text-amber-600 dark:text-amber-400">
            {loadingInvoices ? '—' : formatCurrency(outstandingFees)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-neutral-400">Oldest unpaid invoice</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-neutral-100">
            {loadingInvoices ? '—' : oldestUnpaid ? `Week ending ${formatDate(oldestUnpaid)}` : 'None'}
          </p>
        </div>
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

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200 dark:border-neutral-600">
        <nav className="flex gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={cn(
              'flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
              activeTab === 'upload'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200'
            )}
          >
            <Upload className="h-4 w-4" />
            Upload reports
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('invoices')}
            className={cn(
              'flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors',
              activeTab === 'invoices'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 dark:text-neutral-400 hover:text-slate-700 dark:hover:text-neutral-200'
            )}
          >
            <FileText className="h-4 w-4" />
            Invoices
          </button>
        </nav>
      </div>

      {activeTab === 'upload' && (
        <div className="mx-auto max-w-4xl">
          {franchisee.payment_model !== 'percentage' && (
            <p className="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
              Available for percentage-based fee models only.
            </p>
          )}

          {uploadSuccess && (
            <div className="mb-6 flex items-center gap-2 rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
              Reports saved and invoice created. View it in the Invoices tab.
            </div>
          )}

          {uploadError && (
            <div className="mb-6 flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              {uploadError}
            </div>
          )}

          <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-neutral-100">Week</h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">Week starting (Monday)</label>
              <input
                type="date"
                value={weekDate}
                onChange={(e) => setWeekDate(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-slate-400 dark:text-neutral-400">
                {formatDate(weekStartStr)} – {formatDate(weekEndStr)}
              </p>
            </div>
          </div>

          <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-neutral-100">Upload platform reports</h2>
            <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">
              Upload platform reports and choose a brand for each.
            </p>
            <div className="grid gap-6 sm:grid-cols-3">
              {AGGREGATOR_PLATFORMS.map((platform) => {
                const platformRows = uploadRows.filter((r) => r.platform === platform);
                return (
                  <div key={platform} className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-neutral-300">
                      {getPlatformLogo(platform) ? (
                        <img src={getPlatformLogo(platform)} alt="" className="h-5 w-5 object-contain" />
                      ) : null}
                      {PLATFORM_LABELS[platform]}
                    </h3>
                    {platformRows.map((row) => (
                      <div key={row.rowId} className="flex flex-col gap-2 rounded-lg border border-slate-100 dark:border-neutral-600 bg-slate-50/50 dark:bg-neutral-700/50 p-2">
                        <div className="flex items-center gap-2">
                          {platform === 'deliveroo' ? (
                            <span className="text-xs text-slate-500 dark:text-neutral-400">Brands from statement</span>
                          ) : (
                            <select
                              value={row.brand}
                              onChange={(e) =>
                                setUploadRows((prev) =>
                                  prev.map((r) =>
                                    r.rowId === row.rowId ? { ...r, brand: e.target.value } : r
                                  )
                                )
                              }
                              className="rounded border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="">Brand</option>
                              {uploadBrandOptions.map((b) => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </select>
                          )}
                          {platformRows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeUploadRow(row.rowId)}
                              className="ml-auto rounded p-1 text-slate-400 dark:text-neutral-400 hover:bg-slate-200 dark:hover:bg-neutral-600 hover:text-slate-600 dark:hover:text-neutral-100"
                              title="Remove this report"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <FileUpload
                          platform={platform}
                          onResult={(result) => handleResult(result, row.rowId)}
                          onClear={() => handleClear(row.rowId)}
                          result={
                            row.result
                              ? {
                                  gross_revenue: row.result.gross_revenue,
                                  file_name: row.result.file_name,
                                  confidence: row.result.confidence,
                                }
                              : null
                          }
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addUploadRow(platform)}
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-neutral-600 py-2 text-xs font-medium text-slate-500 dark:text-neutral-400 hover:border-primary hover:text-primary"
                    >
                      {getPlatformLogo(platform) ? (
                        <img src={getPlatformLogo(platform)} alt="" className="h-4 w-4 object-contain" />
                      ) : null}
                      + Add report for {PLATFORM_LABELS[platform]}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {franchisee?.slerp_percentage != null && franchisee.brands?.includes('Wing Shack') && (
            <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-6 shadow-sm">
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-neutral-100">Wing Shack Direct (Slerp)</h2>
              <p className="mb-3 text-sm text-slate-500 dark:text-neutral-400">
                Upload the full Slerp statement (xlsx). Only <strong>{franchisee?.location ?? 'this location'}</strong> sales are used; the spreadsheet has all locations. Saved data appears on the invoice PDF in the Slerp block when the pay week matches the invoice week.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 dark:border-neutral-600 bg-slate-50 dark:bg-neutral-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-600">
                  <Upload className="h-4 w-4" />
                  {slerpParsing ? 'Parsing…' : slerpFile ? slerpFile.name : 'Choose xlsx file'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleSlerpFileChange}
                    disabled={slerpParsing}
                  />
                </label>
                {slerpPreview.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveSlerpReports}
                    disabled={slerpSaving}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
                  >
                    {slerpSaving ? 'Saving…' : `Save ${slerpPreview.length} pay week(s)`}
                  </button>
                )}
              </div>
              {slerpError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{slerpError}</p>}
              {slerpSuccess && <p className="mt-2 text-sm text-green-600 dark:text-green-400">Slerp reports saved.</p>}
              {slerpPreview.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-neutral-600 text-left">
                        <th className="py-2 pr-4 font-medium text-slate-600 dark:text-neutral-400">Sales period</th>
                        <th className="py-2 pr-4 font-medium text-slate-600 dark:text-neutral-400">Payout date</th>
                        <th className="py-2 pr-4 font-medium text-slate-600 dark:text-neutral-400 text-right">Gross (GMV)</th>
                        <th className="py-2 pr-4 font-medium text-slate-600 dark:text-neutral-400 text-right">Fee ({franchisee.slerp_percentage}%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slerpPreview.map((p, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-neutral-700">
                          <td className="py-2 pr-4 text-slate-700 dark:text-neutral-300">{formatDate(p.weekStart)} – {formatDate(p.weekEnd)}</td>
                          <td className="py-2 pr-4 text-slate-700 dark:text-neutral-300">{formatDate(p.payoutDate)}</td>
                          <td className="py-2 pr-4 text-right font-medium">{formatCurrency(p.grossRevenue)}</td>
                          <td className="py-2 pr-4 text-right font-medium">{formatCurrency(p.feeAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {rowsWithData.length > 0 && isPercentageBased && (
            <div className="mb-8 rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-neutral-100">Review & confirm</h2>
              <div className="space-y-3">
                {rowsWithData.flatMap((row) => {
                  const bd = getDeliverooBreakdown(row);
                  if (bd && row.platform === 'deliveroo') {
                    return Object.entries(bd).map(([brand, amount]) => (
                      <div key={`${row.rowId}-${brand}`} className="flex items-center gap-4 rounded-lg bg-slate-50 dark:bg-neutral-700 p-3">
                        <span className="w-40 shrink-0 text-sm font-medium text-slate-700 dark:text-neutral-200">
                          {brand} · {PLATFORM_LABELS[row.platform]}
                        </span>
                        <span className="text-sm font-medium text-slate-900 dark:text-neutral-100">
                          {formatCurrency(amount)}
                        </span>
                      </div>
                    ));
                  }
                  return (
                    <div key={row.rowId} className="flex items-center gap-4 rounded-lg bg-slate-50 dark:bg-neutral-700 p-3">
                      <span className="w-40 shrink-0 text-sm font-medium text-slate-700 dark:text-neutral-200">
                        {row.brand || '—'} · {PLATFORM_LABELS[row.platform]}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-slate-500 dark:text-neutral-300">£</span>
                        <input
                          type="number"
                          step="0.01"
                          value={row.editableRevenue}
                          onChange={(e) =>
                            setUploadRows((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId ? { ...r, editableRevenue: e.target.value } : r
                              )
                            )
                          }
                          className="w-36 rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-600 dark:text-neutral-100 px-3 py-1.5 text-sm font-medium focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  );
                })}
                {/* Per-platform fee breakdown */}
                {franchisee.payment_model === 'percentage_per_platform' && rowsWithData.length > 0 && (
                  <div className="rounded-lg border border-slate-200 dark:border-neutral-600 bg-slate-50/50 dark:bg-neutral-700/50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">Fee breakdown by platform</p>
                    <ul className="space-y-1.5">
                      {rowsWithData.map((row) => {
                        const bd = getDeliverooBreakdown(row);
                        const rev = bd
                          ? Object.values(bd).reduce((a, b) => a + b, 0)
                          : parseFloat(row.editableRevenue || '0') || 0;
                        const pct = getPlatformFeeRate(franchisee, row.platform);
                        const platformFee = Math.round(rev * (pct / 100) * 100) / 100;
                        return (
                          <li key={row.rowId} className="flex items-center justify-between text-sm">
                            <span className="text-slate-600 dark:text-neutral-300">
                              {PLATFORM_LABELS[row.platform]} ({pct}%)
                            </span>
                            <span className="font-medium text-slate-900 dark:text-neutral-100">{formatCurrency(platformFee)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="border-t border-slate-200 dark:border-neutral-600 pt-3">
                  <div className="flex items-center justify-between rounded-lg bg-slate-100 dark:bg-neutral-700 p-3">
                    <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Total gross revenue</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-neutral-100">{formatCurrency(totalGross)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-primary/10 dark:bg-primary/20 p-3">
                    <span className="text-sm font-semibold text-primary-dark dark:text-primary-light">
                      Fee{franchisee.payment_model === 'percentage_per_platform' ? ' (per platform)' : ` (${feeRate}%)`}
                    </span>
                    <span className="text-lg font-bold text-primary-dark dark:text-primary-light">{formatCurrency(feeAmount)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveUpload}
                  disabled={saving}
                  className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-dark disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save reports & create invoice'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'invoices' && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-500 dark:text-neutral-400">Invoices for this franchisee</p>
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
            </select>
          </div>

          {loadingInvoices ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-neutral-600 dark:bg-neutral-800 py-16 text-center">
              <FileText className="mx-auto h-12 w-12 text-slate-300 dark:text-neutral-500" />
              <p className="mt-3 text-lg font-medium text-slate-400 dark:text-neutral-200">
                {invoices.length === 0
                  ? 'No invoices yet'
                  : `No ${statusFilter} invoices`}
              </p>
              <p className="mt-1 text-sm text-slate-400 dark:text-neutral-400">
                {invoices.length === 0
                  ? 'Upload weekly reports in the Upload reports tab to create an invoice.'
                  : 'Try a different status filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 shadow-sm">
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
                      Week
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
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400" title="Recommended BACS collection date (Friday after the invoice week) — when we collect payment from the franchisee">
                      <span className="cursor-help border-b border-dotted border-slate-400 dark:border-neutral-500">Collect from</span>
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice) => (
                    <Fragment key={invoice.id}>
                      <tr
                        key={invoice.id}
                        className="border-b border-slate-50 dark:border-neutral-600 transition-colors hover:bg-slate-50/50 dark:hover:bg-neutral-700/50"
                      >
                        <td className="px-5 py-3.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{invoice.invoice_number}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-slate-600 dark:text-neutral-300">
                            {invoice.brand?.trim() || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-sm text-slate-500 dark:text-neutral-400">
                            {formatWeekRange(invoice.week_start_date, invoice.week_end_date)}
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
                          </select>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 dark:text-neutral-400">
                          {invoice.status === 'processing' ? (
                            <span className="text-xs text-amber-700 dark:text-amber-400">Processing…</span>
                          ) : franchisee.payment_direction === 'pay_them' ? (
                            <span className="text-xs text-slate-500 dark:text-neutral-400">Pay them</span>
                          ) : invoice.status !== 'paid' && franchisee.bacs_payment_method_id && invoice.created_at ? (
                            <span className="text-xs dark:text-neutral-300" title="BACS collection day is Friday">
                              {formatRecommendedBacsDateFromInvoiceDate(invoice.created_at)}
                            </span>
                          ) : (
                            <span className="text-xs">—</span>
                          )}
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
                            {invoice.status !== 'paid' && invoice.status !== 'processing' && franchisee.payment_direction !== 'pay_them' && franchisee.bacs_payment_method_id && (
                              <button
                                onClick={() => chargeBacs(invoice.id)}
                                disabled={chargingBacsId === invoice.id}
                                className="rounded-lg p-1.5 text-blue-600 dark:text-neutral-200 dark:hover:bg-neutral-600 dark:hover:text-white hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                                title="Collect via BACS"
                              >
                                {chargingBacsId === invoice.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 dark:border-neutral-300 border-t-transparent" />
                                ) : (
                                  <Building2 className="h-4 w-4" />
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
                          <td colSpan={8} className="bg-slate-50 dark:bg-neutral-700/50 px-5 py-4">
                            <div className="rounded-lg bg-white dark:bg-neutral-800 p-4 shadow-sm">
                              {invoice.status === 'processing' && (
                                <p className="mb-3 rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                                  BACS collection in progress. The invoice will be marked paid when the bank confirms (typically a few business days).
                                </p>
                              )}
                              {invoice.status !== 'paid' && invoice.status !== 'processing' && franchisee.payment_direction === 'pay_them' && (
                                <p className="mb-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                                  We pay them. Use &quot;Pay due funds&quot; above when you have paid this invoice.
                                </p>
                              )}
                              {invoice.status !== 'paid' && invoice.status !== 'processing' && franchisee.payment_direction !== 'pay_them' && franchisee.bacs_payment_method_id && invoice.created_at && (
                                <p className="mb-3 rounded-md bg-blue-50 dark:bg-neutral-700 dark:text-neutral-200 px-3 py-2 text-xs text-blue-800">
                                  <strong>Collect BACS from:</strong>{' '}
                                  {formatRecommendedBacsDateFromInvoiceDate(invoice.created_at)} — Friday.
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
                              <h4 className="mb-3 text-sm font-semibold text-slate-700 dark:text-neutral-200">Revenue breakdown</h4>
                              {reports[invoice.id] ? (
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
                                    const mismatch = Math.abs(breakdownTotal - invoiceTotal) > 0.02;
                                    return (
                                      <>
                                        {mismatch && (
                                          <p className="mb-3 rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                                            Breakdown total ({formatCurrency(breakdownTotal)}) doesn’t match invoice total. Upload any missing platform reports for week {formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the Upload reports tab (same week, correct brand).
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
                                          <p className="text-sm text-slate-500 dark:text-neutral-400">No reports found for this invoice’s week. Upload platform reports for week {formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the Upload reports tab.</p>
                                        )}
                                        <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-neutral-600 px-4 pt-3">
                                          <span className="text-sm font-semibold text-slate-700 dark:text-neutral-200">Total</span>
                                          <span className="text-sm font-bold text-slate-900 dark:text-neutral-100">
                                            {formatCurrency(invoice.total_gross_revenue)}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between px-4">
                                          <span className="text-sm font-semibold text-primary-dark dark:text-primary-light">
                                            Fee ({invoice.fee_percentage}%)
                                          </span>
                                          <span className="text-sm font-bold text-primary-dark dark:text-primary-light">
                                            {formatCurrency(invoice.fee_amount)}
                                          </span>
                                        </div>
                                        {rows.length > 0 && (
                                          <p className="mt-3 text-xs text-slate-500 dark:text-neutral-400">
                                            Missing a platform (e.g. Uber Eats)? Upload its report for week {formatWeekRange(invoice.week_start_date, invoice.week_end_date)} in the <button type="button" onClick={() => setActiveTab('upload')} className="underline hover:text-slate-700 dark:hover:text-neutral-200">Upload reports</button> tab — same week and brand. The invoice will update automatically.
                                          </p>
                                        )}
                                        {(() => {
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
          )}
        </div>
      )}

      {editingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !editInvoiceSaving && setEditingInvoice(null)}>
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-neutral-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-neutral-100 mb-4">Edit invoice {editingInvoice.invoice_number}</h3>
            <p className="text-sm text-slate-500 dark:text-neutral-400 mb-4">Only draft invoices can be edited. You can change the week, gross revenue and fee.</p>
            <div className="space-y-4">
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
