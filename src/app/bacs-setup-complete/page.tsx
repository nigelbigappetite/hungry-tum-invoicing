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
          {canceled ? 'Direct Debit setup not completed' : 'Direct Debit set up'}
        </h1>
        <p className="mt-3 text-center text-sm text-slate-600">
          {canceled
            ? 'You chose not to complete the Direct Debit setup just now. If you change your mind, Hungry Tum can send you a new link at any time.'
            : 'Thanks for setting up Direct Debit. We’ll email you an invoice and give you notice before any payments are collected, using the same weekly schedule you see in your Hungry Tum invoices.'}
        </p>
        <p className="mt-6 text-center text-xs text-slate-400">
          Hungry Tum
        </p>
      </div>
    </div>
  );
}
