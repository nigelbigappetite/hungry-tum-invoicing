'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Franchisee, BrandRecord } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Plus, Pencil, Trash2, MapPin, Mail, ChevronRight } from 'lucide-react';
import FranchiseeForm from '@/components/FranchiseeForm';
import { getBrandLogo } from '@/lib/logos';

function FranchiseesPageContent() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFranchisee, setEditingFranchisee] = useState<Franchisee | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [brandRecords, setBrandRecords] = useState<BrandRecord[]>([]);

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
    supabase.from('brands').select('*').eq('active', true).order('name').then(({ data }) => {
      if (data) setBrandRecords(data as BrandRecord[]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (searchParams.get('edit')) {
      window.history.replaceState({}, '', '/franchisees');
    }
  };

  const handleFormSaved = () => {
    setShowForm(false);
    setEditingFranchisee(null);
    if (searchParams.get('edit')) {
      window.history.replaceState({}, '', '/franchisees');
    }
    fetchFranchisees();
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
          <p className="text-lg font-medium text-slate-500 dark:text-neutral-400">No franchisees yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-neutral-400">
            Click &ldquo;Add Franchisee&rdquo; to get started
          </p>
        </div>
      ) : (
        <>
          {brandRecords.length > 0 && (
            <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-neutral-400">Brand:</span>
                <select
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All brands</option>
                  {brandRecords.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                  <option value="none">No brands</option>
                </select>
              </div>
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

              <div className="rounded-lg bg-gray-50 dark:bg-neutral-800/50 p-3">
                {f.payment_model === 'percentage' ? (
                  <div>
                    <span className="text-xs font-medium uppercase text-gray-500 dark:text-neutral-500">
                      Fee Model
                    </span>
                    <p className="text-lg font-bold text-primary">
                      {f.percentage_rate}% <span className="text-sm font-normal text-slate-500 dark:text-neutral-400">of gross sales</span>
                    </p>
                  </div>
                ) : f.payment_model === 'percentage_per_platform' ? (
                  <div>
                    <span className="text-xs font-medium uppercase text-gray-500 dark:text-neutral-500">
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
                    <span className="text-xs font-medium uppercase text-gray-500 dark:text-neutral-500">
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

              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-neutral-400">Added {formatDate(f.created_at)}</p>
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
