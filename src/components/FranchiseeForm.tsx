'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Franchisee, PaymentModel, BRAND_OPTIONS, PLATFORM_LABELS, Platform } from '@/lib/types';
import { getBrandLogo } from '@/lib/logos';
import { X } from 'lucide-react';

interface FranchiseeFormProps {
  franchisee?: Franchisee | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function FranchiseeForm({
  franchisee,
  onClose,
  onSaved,
}: FranchiseeFormProps) {
  const supabase = createClient();
  const isEditing = !!franchisee;

  const [name, setName] = useState(franchisee?.name || '');
  const [location, setLocation] = useState(franchisee?.location || '');
  const [email, setEmail] = useState(franchisee?.email || '');
  const [businessAddress, setBusinessAddress] = useState(franchisee?.business_address ?? '');
  const [siteAddress, setSiteAddress] = useState(franchisee?.site_address ?? '');
  const [brands, setBrands] = useState<string[]>(
    Array.isArray(franchisee?.brands) ? franchisee.brands : []
  );
  const [paymentModel, setPaymentModel] = useState<PaymentModel>(
    franchisee?.payment_model || 'percentage'
  );
  const [percentageRate, setPercentageRate] = useState(
    franchisee?.percentage_rate?.toString() || '6'
  );
  const [monthlyFee, setMonthlyFee] = useState(
    franchisee?.monthly_fee?.toString() || ''
  );
  const [deliverooPct, setDeliverooPct] = useState(
    franchisee?.deliveroo_percentage?.toString() ?? '6'
  );
  const [ubereatsPct, setUbereatsPct] = useState(
    franchisee?.ubereats_percentage?.toString() ?? '6'
  );
  const [justeatPct, setJusteatPct] = useState(
    franchisee?.justeat_percentage?.toString() ?? '6'
  );
  const [slerpPct, setSlerpPct] = useState(
    franchisee?.slerp_percentage?.toString() ?? ''
  );
  const [paymentDirection, setPaymentDirection] = useState<'collect_fees' | 'pay_them'>(
    franchisee?.payment_direction ?? 'collect_fees'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleBrand = (b: string) => {
    setBrands((prev) =>
      prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const data: Record<string, unknown> = {
      name,
      location,
      email,
      business_address: businessAddress.trim() || null,
      site_address: siteAddress.trim() || null,
      brands: brands.filter(Boolean),
      payment_model: paymentModel,
      percentage_rate:
        paymentModel === 'percentage' ? parseFloat(percentageRate) : null,
      monthly_fee:
        paymentModel === 'monthly_fixed' ? parseFloat(monthlyFee) : null,
      deliveroo_percentage: null,
      ubereats_percentage: null,
      justeat_percentage: null,
      slerp_percentage: brands.includes('Wing Shack') && slerpPct.trim() !== '' ? parseFloat(slerpPct) || null : null,
      payment_direction: paymentDirection,
    };
    if (paymentModel === 'percentage_per_platform') {
      data.deliveroo_percentage = parseFloat(deliverooPct) || null;
      data.ubereats_percentage = parseFloat(ubereatsPct) || null;
      data.justeat_percentage = parseFloat(justeatPct) || null;
    }

    try {
      let result;
      if (isEditing) {
        result = await supabase
          .from('franchisees')
          .update(data)
          .eq('id', franchisee!.id);
      } else {
        result = await supabase.from('franchisees').insert(data);
      }

      if (result.error) {
        setError(result.error.message);
        return;
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-neutral-800 p-6 shadow-2xl border border-slate-200 dark:border-neutral-600">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900 dark:text-neutral-100">
            {isEditing ? 'Edit Franchisee' : 'Add Franchisee'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-600 dark:hover:text-neutral-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Business Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. Hungry Tum Manchester"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="e.g. Manchester, UK"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="franchisee@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Business address
            </label>
            <textarea
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Registered / head office address (used on invoices)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Site address
            </label>
            <textarea
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Physical trading address (used on invoices)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Brands (sites can have multiple)
            </label>
            <div className="flex flex-wrap gap-3 rounded-lg border border-slate-300 dark:border-neutral-700 p-3">
              {BRAND_OPTIONS.map((b) => {
                const logo = getBrandLogo(b);
                return (
                  <label key={b} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={brands.includes(b)}
                      onChange={() => toggleBrand(b)}
                      className="rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    {logo ? <img src={logo} alt="" className="h-6 w-6 rounded object-contain" /> : null}
                    <span className="text-sm text-slate-700 dark:text-neutral-200">{b}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Payment Model
            </label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentModel"
                  value="percentage"
                  checked={paymentModel === 'percentage'}
                  onChange={(e) =>
                    setPaymentModel(e.target.value as PaymentModel)
                  }
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-200">% of gross sales (same rate for all platforms)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentModel"
                  value="percentage_per_platform"
                  checked={paymentModel === 'percentage_per_platform'}
                  onChange={(e) =>
                    setPaymentModel(e.target.value as PaymentModel)
                  }
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-200">% per platform (different rate per Deliveroo / Uber Eats / Just Eat)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentModel"
                  value="monthly_fixed"
                  checked={paymentModel === 'monthly_fixed'}
                  onChange={(e) =>
                    setPaymentModel(e.target.value as PaymentModel)
                  }
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-200">Monthly fixed</span>
              </label>
            </div>
          </div>

          {paymentModel === 'percentage' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
                Percentage Rate (%)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={percentageRate}
                onChange={(e) => setPercentageRate(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {paymentModel === 'percentage_per_platform' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-neutral-200">Set fee % for each platform:</p>
              {(['deliveroo', 'ubereats', 'justeat'] as Platform[]).map((platform) => (
                <div key={platform} className="flex items-center gap-3">
                  <label className="w-28 text-sm text-slate-700 dark:text-neutral-200">
                    {PLATFORM_LABELS[platform]}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={
                      platform === 'deliveroo'
                        ? deliverooPct
                        : platform === 'ubereats'
                          ? ubereatsPct
                          : justeatPct
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (platform === 'deliveroo') setDeliverooPct(v);
                      else if (platform === 'ubereats') setUbereatsPct(v);
                      else setJusteatPct(v);
                    }}
                    className="w-24 rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-sm text-slate-500 dark:text-neutral-200">%</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
              Payment direction
            </label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentDirection"
                  value="collect_fees"
                  checked={paymentDirection === 'collect_fees'}
                  onChange={() => setPaymentDirection('collect_fees')}
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-200">We collect fees (franchisee pays us)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentDirection"
                  value="pay_them"
                  checked={paymentDirection === 'pay_them'}
                  onChange={() => setPaymentDirection('pay_them')}
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm text-slate-700 dark:text-neutral-200">We pay them (e.g. we hold Deliveroo, pay them minus our fees)</span>
              </label>
            </div>
          </div>

          {brands.includes('Wing Shack') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
                Slerp (Direct) %
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={slerpPct}
                onChange={(e) => setSlerpPct(e.target.value)}
                className="w-full max-w-[8rem] rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="e.g. 28"
              />
            </div>
          )}

          {paymentModel === 'monthly_fixed' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-neutral-200">
                Monthly Fee (&pound;)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:hover:bg-neutral-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : isEditing
                ? 'Update Franchisee'
                : 'Add Franchisee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
