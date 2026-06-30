'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency, cn } from '@/lib/utils';
import {
  Franchisee,
  Invoice,
  InvoiceStatus,
  Platform,
  PlatformFinancialBreakdown,
  STATUS_COLORS,
  STATUS_LABELS,
} from '@/lib/types';
import { startOfWeek, endOfWeek, format, addDays } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Check,
  Send,
  Loader2,
  FileText,
  AlertCircle,
  ExternalLink,
  Pencil,
  Eye,
  Download,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';

type ReportMap = Record<string, Partial<Record<Platform, number>>>;
type PayoutMap = Record<string, Partial<Record<Platform, number>>>;
type InvoiceMap = Record<string, Invoice>;

interface UploadCell {
  state: 'idle' | 'parsing' | 'ready' | 'saving';
  amount?: number;
  payout?: number;
  breakdown?: PlatformFinancialBreakdown;
  file?: File;
  error?: string;
}

function getLastMonday(): Date {
  const thisMonday = startOfWeek(new Date(), { weekStartsOn: 1 });
  return addDays(thisMonday, -7);
}

export default function WeeklyHubPage() {
  const supabase = createClient();

  const [weekStart, setWeekStart] = useState<Date>(getLastMonday);
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [reports, setReports] = useState<ReportMap>({});
  const [payouts, setPayouts] = useState<PayoutMap>({});
  const [invoices, setInvoices] = useState<InvoiceMap>({});
  const [loading, setLoading] = useState(true);

  // Manual entry for all platforms: key = `${franchiseeId}_${platform}`
  const [manualModes, setManualModes] = useState<Record<string, boolean>>({});
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [payoutInputs, setPayoutInputs] = useState<Record<string, string>>({});
  const [savingManual, setSavingManual] = useState<Record<string, boolean>>({});

  // File upload state: key = `${franchiseeId}_${platform}`
  const [uploadCells, setUploadCells] = useState<Record<string, UploadCell>>({});

  // Per-row invoice actions
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Bulk actions
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadRef = useRef<{ franchiseeId: string; platform: Platform } | null>(null);

  const weekStartStr = format(weekStart, 'yyyy-MM-dd');
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

  const hasSlerp = franchisees.some((f) => f.slerp_percentage != null);

  // ─── Data fetching ───────────────────────────────────────────────

  useEffect(() => {
    supabase
      .from('franchisees')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (data) setFranchisees(data as Franchisee[]);
      });
  }, [supabase]);

  const fetchWeekData = useCallback(async () => {
    setLoading(true);
    const [{ data: reportsData }, { data: invoicesData }] = await Promise.all([
      supabase
        .from('weekly_reports')
        .select('franchisee_id, platform, gross_revenue, platform_payout')
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr),
      supabase
        .from('invoices')
        .select('*')
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr),
    ]);

    const rMap: ReportMap = {};
    const pMap: PayoutMap = {};
    for (const r of reportsData || []) {
      if (!rMap[r.franchisee_id]) rMap[r.franchisee_id] = {};
      if (!pMap[r.franchisee_id]) pMap[r.franchisee_id] = {};
      const p = r.platform as Platform;
      rMap[r.franchisee_id][p] = (rMap[r.franchisee_id][p] || 0) + Number(r.gross_revenue || 0);
      if (r.platform_payout != null) {
        pMap[r.franchisee_id][p] = (pMap[r.franchisee_id][p] || 0) + Number(r.platform_payout || 0);
      }
    }

    const iMap: InvoiceMap = {};
    for (const inv of invoicesData || []) {
      if (!iMap[inv.franchisee_id] || inv.created_at > iMap[inv.franchisee_id].created_at) {
        iMap[inv.franchisee_id] = inv as Invoice;
      }
    }

    setReports(rMap);
    setPayouts(pMap);
    setInvoices(iMap);

    // Pre-fill manual inputs from existing report data (all platforms)
    setManualInputs((prev) => {
      const next = { ...prev };
      for (const fId of Object.keys(rMap)) {
        for (const platform of ['deliveroo', 'ubereats', 'justeat', 'slerp'] as Platform[]) {
          const key = `${fId}_${platform}`;
          const val = rMap[fId]?.[platform];
          if (val != null) next[key] = String(Math.round(val * 100) / 100);
        }
      }
      return next;
    });

    setPayoutInputs((prev) => {
      const next = { ...prev };
      for (const fId of Object.keys(pMap)) {
        for (const platform of ['deliveroo', 'ubereats', 'justeat', 'slerp'] as Platform[]) {
          const key = `${fId}_${platform}`;
          const val = pMap[fId]?.[platform];
          if (val != null) next[key] = String(Math.round(val * 100) / 100);
        }
      }
      return next;
    });

    setLoading(false);
  }, [supabase, weekStartStr, weekEndStr]);

  useEffect(() => {
    if (franchisees.length > 0) fetchWeekData();
  }, [fetchWeekData, franchisees.length]);

  // ─── Invoice generation ──────────────────────────────────────────

  const generateInvoice = useCallback(
    async (franchiseeId: string) => {
      const res = await fetch('/api/generate-weekly-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          franchiseeId,
          weekStartDate: weekStartStr,
          weekEndDate: weekEndStr,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate invoice');
      }
    },
    [weekStartStr, weekEndStr]
  );

  // ─── Save any platform amount (manual or Uber) ───────────────────

  const savePlatformAmount = async (
    franchiseeId: string,
    platform: Platform,
    rawValue: string,
    rawPayoutValue?: string
  ) => {
    const franchisee = franchisees.find((f) => f.id === franchiseeId);
    if (!franchisee) return;

    const amount = parseFloat(rawValue.replace(/[£,\s]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) return;

    const payoutRaw = rawPayoutValue ? parseFloat(rawPayoutValue.replace(/[£,\s]/g, '')) : null;
    const platformPayout =
      payoutRaw != null && Number.isFinite(payoutRaw) && payoutRaw > 0
        ? Math.round(payoutRaw * 100) / 100
        : null;

    const brand =
      platform === 'slerp' ? 'Wing Shack' : franchisee.brands?.[0] || 'Wing Shack';

    await supabase
      .from('weekly_reports')
      .delete()
      .eq('franchisee_id', franchiseeId)
      .eq('week_start_date', weekStartStr)
      .eq('week_end_date', weekEndStr)
      .eq('platform', platform);

    if (amount > 0) {
      const { error } = await supabase.from('weekly_reports').insert({
        franchisee_id: franchiseeId,
        brand,
        platform,
        week_start_date: weekStartStr,
        week_end_date: weekEndStr,
        gross_revenue: Math.round(amount * 100) / 100,
        platform_payout: platformPayout,
        file_type: 'manual',
      });
      if (error) throw error;
    }

    if (franchisee.payment_model !== 'monthly_fixed') {
      await generateInvoice(franchiseeId);
    }
  };

  // ─── Manual save ─────────────────────────────────────────────────

  const saveManual = async (franchiseeId: string, platform: Platform) => {
    const key = `${franchiseeId}_${platform}`;
    const raw = manualInputs[key] || '';
    const rawPayout = payoutInputs[key] || '';
    if (!raw.trim()) return;
    setSavingManual((prev) => ({ ...prev, [key]: true }));
    try {
      await savePlatformAmount(franchiseeId, platform, raw, rawPayout);
      setManualModes((prev) => ({ ...prev, [key]: false }));
      await fetchWeekData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingManual((prev) => ({ ...prev, [key]: false }));
    }
  };

  // ─── File upload ─────────────────────────────────────────────────

  const triggerFileUpload = (franchiseeId: string, platform: Platform) => {
    activeUploadRef.current = { franchiseeId, platform };
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeUploadRef.current) return;
    const { franchiseeId, platform } = activeUploadRef.current;
    const key = `${franchiseeId}_${platform}`;

    setUploadCells((prev) => ({ ...prev, [key]: { state: 'parsing' } }));

    const formData = new FormData();
    formData.append('file', file);
    formData.append('platform', platform);

    try {
      const res = await fetch('/api/parse-file', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.gross_revenue) {
        setUploadCells((prev) => ({
          ...prev,
          [key]: { state: 'idle', error: data.error || 'Could not parse file' },
        }));
        return;
      }

      setUploadCells((prev) => ({
        ...prev,
        [key]: {
          state: 'ready',
          amount: Number(data.gross_revenue),
          payout: data.platform_payout != null ? Number(data.platform_payout) : undefined,
          breakdown: data.financial_breakdown ?? undefined,
          file,
        },
      }));
    } catch {
      setUploadCells((prev) => ({
        ...prev,
        [key]: { state: 'idle', error: 'Parse failed' },
      }));
    }
  };

  const confirmUpload = async (franchiseeId: string, platform: Platform) => {
    const key = `${franchiseeId}_${platform}`;
    const cell = uploadCells[key];
    if (!cell?.file || !cell.amount) return;

    const franchisee = franchisees.find((f) => f.id === franchiseeId);
    if (!franchisee) return;

    setUploadCells((prev) => ({ ...prev, [key]: { ...prev[key], state: 'saving' } }));

    try {
      const brand =
        platform === 'slerp' ? 'Wing Shack' : franchisee.brands?.[0] || 'Wing Shack';
      const filePath = `reports/${franchiseeId}/${weekStartStr}/${platform}-${cell.file.name}`;

      await supabase.storage.from('invoicing').upload(filePath, cell.file, { upsert: true });

      await supabase
        .from('weekly_reports')
        .delete()
        .eq('franchisee_id', franchiseeId)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .eq('platform', platform);

      const { error: insertError } = await supabase.from('weekly_reports').insert({
        franchisee_id: franchiseeId,
        brand,
        platform,
        week_start_date: weekStartStr,
        week_end_date: weekEndStr,
        gross_revenue: Math.round(cell.amount * 100) / 100,
        platform_payout: cell.payout != null ? Math.round(cell.payout * 100) / 100 : null,
        financial_breakdown: cell.breakdown ?? null,
        file_path: filePath,
        file_type: cell.file.name.endsWith('.pdf') ? 'pdf' : 'csv',
      });
      if (insertError) throw insertError;

      if (franchisee.payment_model !== 'monthly_fixed') {
        await generateInvoice(franchiseeId);
      }

      setUploadCells((prev) => ({ ...prev, [key]: { state: 'idle' } }));
      await fetchWeekData();
    } catch (err) {
      setUploadCells((prev) => ({
        ...prev,
        [key]: { state: 'idle', error: err instanceof Error ? err.message : 'Save failed' },
      }));
    }
  };

  const cancelUpload = (franchiseeId: string, platform: Platform) => {
    setUploadCells((prev) => ({ ...prev, [`${franchiseeId}_${platform}`]: { state: 'idle' } }));
  };

  const clearPlatformReport = async (franchiseeId: string, platform: Platform) => {
    await supabase
      .from('weekly_reports')
      .delete()
      .eq('franchisee_id', franchiseeId)
      .eq('week_start_date', weekStartStr)
      .eq('week_end_date', weekEndStr)
      .eq('platform', platform);
    await fetchWeekData();
  };

  // ─── Per-row invoice actions ─────────────────────────────────────

  const handleGenerate = async (franchiseeId: string) => {
    setGeneratingId(franchiseeId);
    try {
      await generateInvoice(franchiseeId);
      await fetchWeekData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSend = async (franchiseeId: string) => {
    const invoice = invoices[franchiseeId];
    if (!invoice) return;
    setSendingId(franchiseeId);
    try {
      const res = await fetch('/api/send-invoice-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send email');
      await fetchWeekData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to send invoice');
    } finally {
      setSendingId(null);
    }
  };


  const handleViewPdf = async (franchiseeId: string) => {
    const invoice = invoices[franchiseeId];
    if (!invoice?.pdf_path) return;
    const { data } = await supabase.storage.from('invoicing').createSignedUrl(invoice.pdf_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  const handleDownloadPdf = async (franchiseeId: string) => {
    const invoice = invoices[franchiseeId];
    if (!invoice?.pdf_path) return;
    setDownloadingId(franchiseeId);
    try {
      const { data } = await supabase.storage.from('invoicing').createSignedUrl(invoice.pdf_path, 60);
      if (data?.signedUrl) {
        const a = document.createElement('a');
        a.href = data.signedUrl;
        a.download = `${invoice.invoice_number}.pdf`;
        a.click();
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteInvoice = async (franchiseeId: string) => {
    const invoice = invoices[franchiseeId];
    if (!invoice) return;
    if (!confirm(`Delete invoice ${invoice.invoice_number}? This cannot be undone.`)) return;
    setDeletingId(franchiseeId);
    try {
      await supabase.from('invoices').delete().eq('id', invoice.id);
      await fetchWeekData();
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Bulk actions ────────────────────────────────────────────────

  const bulkGenerate = async () => {
    setBulkGenerating(true);
    try {
      const targets = franchisees.filter(
        (f) =>
          f.payment_model !== 'monthly_fixed' &&
          reports[f.id] &&
          Object.keys(reports[f.id]).length > 0 &&
          (!invoices[f.id] || invoices[f.id].status === 'draft')
      );
      for (const f of targets) {
        try {
          await generateInvoice(f.id);
        } catch {
          // continue
        }
      }
      await fetchWeekData();
    } finally {
      setBulkGenerating(false);
    }
  };

  const bulkSend = async () => {
    setBulkSending(true);
    try {
      const targets = Object.values(invoices).filter((inv) => inv.status === 'draft');
      for (const inv of targets) {
        try {
          await fetch('/api/send-invoice-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: inv.id }),
            credentials: 'include',
          });
        } catch {
          // continue
        }
      }
      await fetchWeekData();
    } finally {
      setBulkSending(false);
    }
  };

  // ─── Summary stats ───────────────────────────────────────────────

  const totalSites = franchisees.length;
  const sitesWithData = franchisees.filter(
    (f) => reports[f.id] && Object.keys(reports[f.id]).length > 0
  ).length;
  const invoiceList = Object.values(invoices);
  const draftCount = invoiceList.filter((i) => i.status === 'draft').length;
  const sentCount = invoiceList.filter((i) => i.status === 'sent').length;
  const paidCount = invoiceList.filter((i) => i.status === 'paid').length;
  const totalFees = invoiceList.reduce((s, i) => s + Number(i.fee_amount || 0), 0);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.pdf,.doc,.docx,.xlsx"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-neutral-100">Weekly Hub</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Enter platform data, generate and send invoices for the week
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 shadow-sm">
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[200px] text-center text-sm font-semibold text-slate-800 dark:text-neutral-200">
            {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM yyyy')}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Sites', value: `${sitesWithData} / ${totalSites}`, sub: 'have data' },
          { label: 'Draft', value: draftCount, sub: 'invoices' },
          { label: 'Sent', value: sentCount, sub: 'invoices' },
          { label: 'Paid', value: paidCount, sub: 'invoices' },
          { label: 'Total fees', value: formatCurrency(totalFees), sub: 'this week' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
              {s.label}
            </p>
            <p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-neutral-100">{s.value}</p>
            <p className="text-xs text-slate-500 dark:text-neutral-400">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Bulk actions */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={bulkGenerate}
          disabled={bulkGenerating}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {bulkGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Generate All
        </button>
        <button
          type="button"
          onClick={bulkSend}
          disabled={bulkSending || draftCount === 0}
          className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2 text-sm font-medium text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-800 disabled:opacity-50"
        >
          {bulkSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send All ({draftCount})
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-neutral-800 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                <th className="px-4 py-3 text-left">Site</th>
                <th className="px-3 py-3 text-center">Deliveroo</th>
                <th className="px-3 py-3 text-center">Uber Eats</th>
                <th className="px-3 py-3 text-center">Just Eat</th>
                {hasSlerp && <th className="px-3 py-3 text-center">WS Direct</th>}
                <th className="px-3 py-3 text-center">Invoice</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50 dark:divide-neutral-800">
              {franchisees.map((f) => {
                const fReports = reports[f.id] || {};
                const invoice = invoices[f.id];
                const isMonthly = f.payment_model === 'monthly_fixed';
                const isGenerating = generatingId === f.id;
                const isSending = sendingId === f.id;
                const hasAnyData = Object.keys(fReports).length > 0;

                return (
                  <tr key={f.id} className="hover:bg-slate-50/50 dark:hover:bg-neutral-800/30">
                    {/* Site */}
                    <td className="px-4 py-3">
                      <Link href={`/franchisees/${f.id}`} className="group flex items-start gap-1">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-neutral-100 group-hover:text-primary">
                            {f.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-neutral-400">
                            {f.location}
                            {isMonthly && (
                              <span className="ml-1 text-primary">(monthly)</span>
                            )}
                          </p>
                        </div>
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-slate-400 group-hover:text-primary" />
                      </Link>
                    </td>

                    {/* Deliveroo */}
                    <td className="px-3 py-3">
                      <PlatformCell
                        franchiseeId={f.id}
                        platform="deliveroo"
                        amount={fReports.deliveroo}
                        uploadCell={uploadCells[`${f.id}_deliveroo`]}
                        manualMode={!!manualModes[`${f.id}_deliveroo`]}
                        manualValue={manualInputs[`${f.id}_deliveroo`] || ''}
                        payoutValue={payoutInputs[`${f.id}_deliveroo`] || ''}
                        savingManual={!!savingManual[`${f.id}_deliveroo`]}
                        onUpload={() => triggerFileUpload(f.id, 'deliveroo')}
                        onConfirm={() => confirmUpload(f.id, 'deliveroo')}
                        onCancel={() => cancelUpload(f.id, 'deliveroo')}
                        onToggleManual={() =>
                          setManualModes((prev) => ({
                            ...prev,
                            [`${f.id}_deliveroo`]: !prev[`${f.id}_deliveroo`],
                          }))
                        }
                        onManualChange={(v) =>
                          setManualInputs((prev) => ({ ...prev, [`${f.id}_deliveroo`]: v }))
                        }
                        onPayoutChange={(v) =>
                          setPayoutInputs((prev) => ({ ...prev, [`${f.id}_deliveroo`]: v }))
                        }
                        onSaveManual={() => saveManual(f.id, 'deliveroo')}
                        onClear={() => clearPlatformReport(f.id, 'deliveroo')}
                      />
                    </td>

                    {/* Uber Eats */}
                    <td className="px-3 py-3">
                      <PlatformCell
                        franchiseeId={f.id}
                        platform="ubereats"
                        amount={fReports.ubereats}
                        uploadCell={uploadCells[`${f.id}_ubereats`]}
                        manualMode={!!manualModes[`${f.id}_ubereats`]}
                        manualValue={manualInputs[`${f.id}_ubereats`] || ''}
                        payoutValue={payoutInputs[`${f.id}_ubereats`] || ''}
                        savingManual={!!savingManual[`${f.id}_ubereats`]}
                        onUpload={() => triggerFileUpload(f.id, 'ubereats')}
                        onConfirm={() => confirmUpload(f.id, 'ubereats')}
                        onCancel={() => cancelUpload(f.id, 'ubereats')}
                        onToggleManual={() =>
                          setManualModes((prev) => ({
                            ...prev,
                            [`${f.id}_ubereats`]: !prev[`${f.id}_ubereats`],
                          }))
                        }
                        onManualChange={(v) =>
                          setManualInputs((prev) => ({ ...prev, [`${f.id}_ubereats`]: v }))
                        }
                        onPayoutChange={(v) =>
                          setPayoutInputs((prev) => ({ ...prev, [`${f.id}_ubereats`]: v }))
                        }
                        onSaveManual={() => saveManual(f.id, 'ubereats')}
                        onClear={() => clearPlatformReport(f.id, 'ubereats')}
                      />
                    </td>

                    {/* Just Eat */}
                    <td className="px-3 py-3">
                      <PlatformCell
                        franchiseeId={f.id}
                        platform="justeat"
                        amount={fReports.justeat}
                        uploadCell={uploadCells[`${f.id}_justeat`]}
                        manualMode={!!manualModes[`${f.id}_justeat`]}
                        manualValue={manualInputs[`${f.id}_justeat`] || ''}
                        payoutValue={payoutInputs[`${f.id}_justeat`] || ''}
                        savingManual={!!savingManual[`${f.id}_justeat`]}
                        onUpload={() => triggerFileUpload(f.id, 'justeat')}
                        onConfirm={() => confirmUpload(f.id, 'justeat')}
                        onCancel={() => cancelUpload(f.id, 'justeat')}
                        onToggleManual={() =>
                          setManualModes((prev) => ({
                            ...prev,
                            [`${f.id}_justeat`]: !prev[`${f.id}_justeat`],
                          }))
                        }
                        onManualChange={(v) =>
                          setManualInputs((prev) => ({ ...prev, [`${f.id}_justeat`]: v }))
                        }
                        onPayoutChange={(v) =>
                          setPayoutInputs((prev) => ({ ...prev, [`${f.id}_justeat`]: v }))
                        }
                        onSaveManual={() => saveManual(f.id, 'justeat')}
                        onClear={() => clearPlatformReport(f.id, 'justeat')}
                      />
                    </td>

                    {/* WS Direct (Slerp) */}
                    {hasSlerp && (
                      <td className="px-3 py-3">
                        {f.slerp_percentage != null ? (
                          <PlatformCell
                            franchiseeId={f.id}
                            platform="slerp"
                            amount={fReports.slerp}
                            uploadCell={uploadCells[`${f.id}_slerp`]}
                            manualMode={!!manualModes[`${f.id}_slerp`]}
                            manualValue={manualInputs[`${f.id}_slerp`] || ''}
                            payoutValue={payoutInputs[`${f.id}_slerp`] || ''}
                            savingManual={!!savingManual[`${f.id}_slerp`]}
                            onUpload={() => triggerFileUpload(f.id, 'slerp')}
                            onConfirm={() => confirmUpload(f.id, 'slerp')}
                            onCancel={() => cancelUpload(f.id, 'slerp')}
                            onToggleManual={() =>
                              setManualModes((prev) => ({
                                ...prev,
                                [`${f.id}_slerp`]: !prev[`${f.id}_slerp`],
                              }))
                            }
                            onManualChange={(v) =>
                              setManualInputs((prev) => ({ ...prev, [`${f.id}_slerp`]: v }))
                            }
                            onPayoutChange={(v) =>
                              setPayoutInputs((prev) => ({ ...prev, [`${f.id}_slerp`]: v }))
                            }
                            onSaveManual={() => saveManual(f.id, 'slerp')}
                            onClear={() => clearPlatformReport(f.id, 'slerp')}
                          />
                        ) : (
                          <span className="block text-center text-xs text-slate-400 dark:text-neutral-500">—</span>
                        )}
                      </td>
                    )}

                    {/* Invoice */}
                    <td className="px-3 py-3 text-center">
                      {isMonthly ? (
                        <Link
                          href={`/franchisees/${f.id}`}
                          className="text-xs text-slate-500 dark:text-neutral-400 hover:text-primary"
                        >
                          Monthly →
                        </Link>
                      ) : invoice ? (
                        <Link href={`/franchisees/${f.id}`}>
                          <span
                            className={cn(
                              'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              STATUS_COLORS[invoice.status as InvoiceStatus]
                            )}
                          >
                            {STATUS_LABELS[invoice.status as InvoiceStatus]}
                          </span>
                          <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-neutral-400">
                            {formatCurrency(invoice.fee_amount)}
                          </p>
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-neutral-500">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Recalc / Generate */}
                        {!isMonthly && (
                          <button
                            type="button"
                            onClick={() => handleGenerate(f.id)}
                            disabled={!hasAnyData || isGenerating}
                            title={invoice ? 'Recalculate invoice' : 'Generate invoice'}
                            className={cn(
                              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                              hasAnyData
                                ? 'bg-primary/10 text-primary hover:bg-primary hover:text-white'
                                : 'cursor-not-allowed bg-slate-100 dark:bg-neutral-800 text-slate-400 dark:text-neutral-500'
                            )}
                          >
                            {isGenerating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : invoice ? (
                              <Pencil className="h-3.5 w-3.5" />
                            ) : (
                              'Generate'
                            )}
                          </button>
                        )}

                        {/* Send email — available for draft or sent (resend) */}
                        {invoice && (invoice.status === 'draft' || invoice.status === 'sent') && (
                          <button
                            type="button"
                            onClick={() => handleSend(f.id)}
                            disabled={isSending}
                            title="Send invoice email"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary dark:text-neutral-400 dark:hover:bg-neutral-800 disabled:opacity-50"
                          >
                            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          </button>
                        )}

                        {/* View PDF */}
                        {invoice?.pdf_path && (
                          <button
                            type="button"
                            onClick={() => handleViewPdf(f.id)}
                            title="View invoice PDF"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary dark:text-neutral-400 dark:hover:bg-neutral-800"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Download PDF */}
                        {invoice?.pdf_path && (
                          <button
                            type="button"
                            onClick={() => handleDownloadPdf(f.id)}
                            disabled={downloadingId === f.id}
                            title="Download invoice PDF"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary dark:text-neutral-400 dark:hover:bg-neutral-800 disabled:opacity-50"
                          >
                            {downloadingId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          </button>
                        )}

                        {/* Delete invoice */}
                        {invoice && (
                          <button
                            type="button"
                            onClick={() => handleDeleteInvoice(f.id)}
                            disabled={deletingId === f.id}
                            title="Delete invoice"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
                          >
                            {deletingId === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── PlatformCell ─────────────────────────────────────────────────────────────

function PlatformCell({
  platform,
  amount,
  uploadCell,
  manualMode,
  manualValue,
  payoutValue,
  savingManual,
  onUpload,
  onConfirm,
  onCancel,
  onToggleManual,
  onManualChange,
  onPayoutChange,
  onSaveManual,
  onClear,
}: {
  franchiseeId: string;
  platform: Platform;
  amount: number | undefined;
  uploadCell: UploadCell | undefined;
  manualMode: boolean;
  manualValue: string;
  payoutValue: string;
  savingManual: boolean;
  onUpload: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onToggleManual: () => void;
  onManualChange: (v: string) => void;
  onPayoutChange: (v: string) => void;
  onSaveManual: () => void;
  onClear: () => void;
}) {
  const uploadState = uploadCell?.state ?? 'idle';

  // File is being parsed
  if (uploadState === 'parsing') {
    return (
      <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Parsing…
      </div>
    );
  }

  // File parsed, awaiting confirmation
  if (uploadState === 'ready' && uploadCell?.amount != null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-semibold text-slate-700 dark:text-neutral-300">
          {formatCurrency(uploadCell.amount)}
        </span>
        {uploadCell.payout != null && (
          <span className="text-[10px] text-slate-500 dark:text-neutral-400">
            payout {formatCurrency(uploadCell.payout)}
          </span>
        )}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-slate-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Saving uploaded file
  if (uploadState === 'saving') {
    return (
      <div className="flex items-center justify-center gap-1 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </div>
    );
  }

  // Manual entry mode
  if (manualMode) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') onSaveManual();
      if (e.key === 'Escape') onToggleManual();
    };
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex flex-col gap-1 w-28">
          <div>
            <p className="text-[10px] text-slate-500 dark:text-neutral-400 mb-0.5 text-center">Gross revenue</p>
            <div className="relative flex items-center">
              <span className="absolute left-2 text-xs text-slate-500">£</span>
              <input
                type="text"
                inputMode="decimal"
                value={manualValue}
                onChange={(e) => onManualChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0.00"
                autoFocus
                className="w-full rounded-md border border-primary py-1 pl-5 pr-2 text-right text-xs font-medium ring-1 ring-primary/20 bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-200"
              />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 dark:text-neutral-400 mb-0.5 text-center">Platform payout</p>
            <div className="relative flex items-center">
              <span className="absolute left-2 text-xs text-slate-500">£</span>
              <input
                type="text"
                inputMode="decimal"
                value={payoutValue}
                onChange={(e) => onPayoutChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="0.00"
                className="w-full rounded-md border border-slate-300 dark:border-neutral-600 py-1 pl-5 pr-2 text-right text-xs font-medium bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-200"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onSaveManual}
            disabled={savingManual}
            className="flex items-center gap-0.5 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary hover:text-white disabled:opacity-50"
          >
            {savingManual ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={onToggleManual}
            className="rounded bg-slate-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Idle state — data present
  if (amount != null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/20 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-400">
          <Check className="h-3 w-3" />
          {formatCurrency(amount)}
        </span>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button type="button" onClick={onUpload} className="hover:text-primary">
            replace
          </button>
          <span>·</span>
          <button type="button" onClick={onToggleManual} className="hover:text-primary">
            edit
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => { if (confirm('Remove this platform report?')) onClear(); }}
            className="hover:text-red-500"
          >
            clear
          </button>
        </div>
        {uploadCell?.error && (
          <span className="flex items-center gap-0.5 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            {uploadCell.error}
          </span>
        )}
      </div>
    );
  }

  // Idle state — no data
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onUpload}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 dark:border-neutral-600 px-2.5 py-1 text-xs text-slate-500 dark:text-neutral-400 hover:border-primary hover:text-primary transition-colors"
      >
        <Upload className="h-3 w-3" />
        Upload
      </button>
      <button
        type="button"
        onClick={onToggleManual}
        className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400 hover:text-primary"
      >
        <Pencil className="h-3 w-3" />
        manual
      </button>
      {uploadCell?.error && (
        <span className="flex items-center gap-0.5 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" />
          {uploadCell.error}
        </span>
      )}
    </div>
  );
}

