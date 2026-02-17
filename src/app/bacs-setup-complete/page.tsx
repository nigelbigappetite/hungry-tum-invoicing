import { LOGOS } from '@/lib/logos';

type Props = { searchParams: Promise<{ canceled?: string }> };

export default async function BacsSetupCompletePage({ searchParams }: Props) {
  const { canceled: canceledParam } = await searchParams;
  const canceled = canceledParam === '1';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 p-2">
            <img
              src={LOGOS.app}
              alt="Hungry Tum"
              className="h-full w-full object-contain"
            />
          </div>
        </div>
        <h1 className="text-center text-xl font-semibold text-slate-900">
          {canceled ? 'Setup cancelled' : 'Thank you for setting up your Hungry Tum account'}
        </h1>
        <p className="mt-3 text-center text-sm text-slate-600">
          {canceled
            ? 'You cancelled the setup. You can set up BACS again when Hungry Tum sends you a new link.'
            : 'Your BACS Direct Debit has been set up successfully. Hungry Tum will send you an invoice with up to three days’ notice before collecting payment for the previous week’s gross revenue, once all your payouts have been resolved. You can close this window.'}
        </p>
        <p className="mt-6 text-center text-xs text-slate-400">
          Hungry Tum
        </p>
      </div>
    </div>
  );
}
