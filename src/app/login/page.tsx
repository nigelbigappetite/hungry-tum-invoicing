'use client';

import { Suspense, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { LOGOS } from '@/lib/logos';

function LoginPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const resetSuccess = searchParams.get('reset') === '1';

  useEffect(() => {
    if (resetSuccess) setError('');
  }, [resetSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (isForgotPassword) {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : '';
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      setLoading(false);
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setResetSent(true);
      return;
    }

    let result;
    if (isSignUp) {
      result = await supabase.auth.signUp({ email, password });
    } else {
      result = await supabase.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    if (isSignUp) {
      setError('');
      setIsSignUp(false);
      if (result.data.session) {
        router.push('/');
        router.refresh();
      } else {
        setError('Account created! Please check your email to confirm, then sign in.');
      }
    } else {
      router.push('/');
      router.refresh();
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-md px-4">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-lg shadow-orange-200">
            <img
              src={LOGOS.app}
              alt="Hungry Tum"
              className="h-full w-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hungry Tum</h1>
          <p className="mt-1 text-sm text-slate-600">
            Franchise Invoicing System
          </p>
        </div>

        {/* Login form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-center text-lg font-semibold text-slate-900">
            {isForgotPassword ? 'Reset password' : isSignUp ? 'Create Account' : 'Sign In'}
          </h2>

          {resetSuccess && (
            <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
              Password updated. Sign in with your new password below.
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {resetSent ? (
            <div className="space-y-4">
              <p className="text-center text-sm text-slate-600">
                Check your email for a link to reset your password. The link may take a few minutes to arrive.
              </p>
              <button
                type="button"
                onClick={() => {
                  setResetSent(false);
                  setIsForgotPassword(false);
                  setError('');
                }}
                className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="you@hungrytum.com"
                  />
                </div>

                {!isForgotPassword && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required={!isForgotPassword}
                      minLength={6}
                      className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Enter your password"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading
                    ? 'Please wait...'
                    : isForgotPassword
                    ? 'Send reset link'
                    : isSignUp
                    ? 'Create Account'
                    : 'Sign In'}
                </button>
              </form>

              <div className="mt-4 flex flex-col items-center gap-2 text-center">
                {!isForgotPassword && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setError('');
                    }}
                    className="text-sm text-slate-600 hover:text-primary"
                  >
                    Forgot password?
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setIsForgotPassword(false);
                    setResetSent(false);
                    setError('');
                  }}
                  className="text-sm text-slate-600 hover:text-primary"
                >
                  {isSignUp
                    ? 'Already have an account? Sign in'
                    : 'Need an account? Sign up'}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          Hungry Tum Franchise Invoicing &bull; Internal Use Only
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
