'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(json?.error || 'Sign-in failed.');
        return;
      }

      router.replace('/admin/channel-applications');
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-black px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8">
        <h1 className="text-2xl font-semibold text-white">Admin sign-in</h1>
        <p className="mt-2 text-sm text-white/60">
          Sign in to review channel applications.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-medium uppercase tracking-wide text-white/50">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-xs font-medium uppercase tracking-wide text-white/50">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-white/40"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
