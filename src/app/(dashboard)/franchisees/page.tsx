'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Franchisee, BRAND_OPTIONS } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Plus, Pencil, Trash2, MapPin, Mail, Building2, CheckCircle, ChevronRight, Banknote } from 'lucide-react';
import FranchiseeForm from '@/components/FranchiseeForm';
import { getBrandLogo } from '@/lib/logos';

function FranchiseesPageContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFranchisee, setEditingFranchisee] = useState<Franchisee | null>(null);
  const [settingUpBacsId, setSettingUpBacsId] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('all');

  const fetchFranchisees = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('franchisees')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setFranchisees(data);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchFranchisees();
  }, [fetchFranchisees]);

  useEffect(() => {
    if (searchParams.get('bacs_setup') === '1') {
      fetchFranchisees();
      window.history.replaceState({}, '', '/franchisees');
    }
  }, [searchParams, fetchFranchisees]);

  const editId = searchParams.get('edit');
  useEffect(() => {
    if (editId && franchisees.length > 0) {
      const f = franchisees.find((x) => x.id === editId);
      if (f) {
        setEditingFranchisee(f);
        setShowForm(true);
      }
    }
  }, [editId, franchisees]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this franchisee? This will also delete all their reports and invoices.')) {
      return;
    }
    await supabase.from('franchisees').delete().eq('id', id);
    fetchFranchisees();
  };

  const handleEdit = (franchisee: Franchisee) => {
    setEditingFranchisee(franchisee);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingFranchisee(null);
  };

  const handleFormSaved = () => {
    setShowForm(false);
    setEditingFranchisee(null);
    fetchFranchisees();
  };

  const setupBacs = async (franchiseeId: string) => {
    setSettingUpBacsId(franchiseeId);
    try {
      const res = await fetch('/api/setup-bacs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseeId }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.message) {
        alert(data.message);
        fetchFranchisees();
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
      setSettingUpBacsId(null);
    }
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-neutral-100">Franchisees</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Locations and payment settings
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary-dark"
        >
          <Plus className="h-4 w-4" />
          Add Franchisee
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : franchisees.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 dark:border-neutral-800 py-16 text-center">
          <p className="text-lg font-medium text-slate-400 dark:text-neutral-500">No franchisees yet</p>
          <p className="mt-1 text-sm text-slate-400 dark:text-neutral-500">
            Click &ldquo;Add Franchisee&rdquo; to get started
          </p>
        </div>
      ) : (
        <>
          {BRAND_OPTIONS.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm text-slate-500 dark:text-neutral-400">Brand:</span>
              <select
                value={brandFilter}
                onChange={(e) => setBrandFilter(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">All brands</option>
                {BRAND_OPTIONS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="none">No brands</option>
              </select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {franchisees
            .filter((f) => {
              const fBrands = Array.isArray(f.brands) ? f.brands : [];
              if (brandFilter === 'all') return true;
              if (brandFilter === 'none') return fBrands.length === 0;
              return fBrands.includes(brandFilter);
            })
            .map((f) => (
            <div
              key={f.id}
              className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm transition-shadow hover:shadow-md dark:shadow-none"
            >
              <div className="mb-3 flex items-start justify-between">
                <Link
                  href={`/franchisees/${f.id}`}
                  className="text-base font-semibold text-slate-900 dark:text-neutral-100 hover:text-primary"
                >
                  {f.name}
                </Link>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEdit(f)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-600 dark:hover:text-neutral-300"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mb-4 space-y-1.5">
                {Array.isArray(f.brands) && f.brands.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {f.brands.map((b) => {
                      const logo = getBrandLogo(b);
                      return (
                        <span key={b} className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
                          {logo ? <img src={logo} alt="" className="h-5 w-5 rounded object-contain" /> : null}
                          {b}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-neutral-400">
                  <MapPin className="h-3.5 w-3.5" />
                  {f.location}
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-neutral-400">
                  <Mail className="h-3.5 w-3.5" />
                  {f.email}
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-neutral-800/50 p-3">
                {f.payment_model === 'percentage' ? (
                  <div>
                    <span className="text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">
                      Fee Model
                    </span>
                    <p className="text-lg font-bold text-primary">
                      {f.percentage_rate}% <span className="text-sm font-normal text-slate-500 dark:text-neutral-400">of gross sales</span>
                    </p>
                  </div>
                ) : f.payment_model === 'percentage_per_platform' ? (
                  <div>
                    <span className="text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">
                      Fee per platform
                    </span>
                    <p className="text-sm font-bold text-primary">
                      {f.deliveroo_percentage ?? 0}% Deliveroo · {f.ubereats_percentage ?? 0}% Uber Eats · {f.justeat_percentage ?? 0}% Just Eat
                      {f.slerp_percentage != null && (
                        <> · {f.slerp_percentage}% Slerp (Direct)</>
                      )}
                    </p>
                  </div>
                ) : (
                  <div>
                    <span className="text-xs font-medium uppercase text-slate-400 dark:text-neutral-500">
                      Monthly Fee
                    </span>
                    <p className="text-lg font-bold text-primary">
                      {formatCurrency(f.monthly_fee || 0)}
                      <span className="text-sm font-normal text-slate-500 dark:text-neutral-400"> /month</span>
                    </p>
                  </div>
                )}
                {f.slerp_percentage != null && f.payment_model !== 'percentage_per_platform' && (
                  <p className="mt-2 text-xs font-medium text-slate-600 dark:text-neutral-300">
                    Slerp (Direct): {f.slerp_percentage}%
                  </p>
                )}
                {f.payment_direction === 'pay_them' && (
                  <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                    We pay: Deliveroo payout minus Uber Eats, Deliveroo & Just Eat commission.
                  </p>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                {f.payment_direction === 'pay_them' ? (
                  <Link
                    href={`/franchisees/${f.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                  >
                    <Banknote className="h-3.5 w-3.5" />
                    Send payment
                  </Link>
                ) : f.bacs_payment_method_id ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <CheckCircle className="h-3.5 w-3.5" />
                    BACS set up
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setupBacs(f.id)}
                    disabled={settingUpBacsId === f.id}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {settingUpBacsId === f.id ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                    ) : (
                      <Building2 className="h-3.5 w-3.5" />
                    )}
                    Set up BACS
                  </button>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-400 dark:text-neutral-500">Added {formatDate(f.created_at)}</p>
                <Link
                  href={`/franchisees/${f.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  View reports & invoices
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      {showForm && (
        <FranchiseeForm
          franchisee={editingFranchisee}
          onClose={handleFormClose}
          onSaved={handleFormSaved}
        />
      )}
    </div>
  );
}

export default function FranchiseesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <FranchiseesPageContent />
    </Suspense>
  );
}
