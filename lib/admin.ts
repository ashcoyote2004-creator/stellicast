import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// -------- admin identity --------
// Two ways to be an admin:
//  1. Env admin sign-in (works without Supabase auth):
//       ADMIN_EMAIL (default Admin@gmail.com), ADMIN_PASSWORD, optional
//       ADMIN_SESSION_SECRET for signing the session cookie.
//  2. A signed-in Supabase user whose email is in ADMIN_EMAILS (or ADMIN_EMAIL)
//     or whose id is in the legacy allowlist below.
//
// Credentials are only ever read from Settings → Environment variables. They are
// never written into the repository.

export const ADMIN_COOKIE = 'stellicast_admin';
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

const LEGACY_ADMIN_USER_IDS: string[] = [
  'b34ab82d-1d0e-4d78-ac2b-4897a2e55a02',
  '7d7396d4-4af2-4460-ab9d-bd1e85159004',
  '5df2363f-ce6f-4df9-ba8e-0af6a69a69f7',
];

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'Admin@gmail.com').trim().toLowerCase();
}

export function adminEmails(): string[] {
  const configured = (process.env.ADMIN_EMAILS || '').split(',');
  const list = [...configured, process.env.ADMIN_EMAIL || 'Admin@gmail.com']
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

export function adminPassword(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  return password && password.trim() ? password : null;
}

export function isAdminUser(userId: string): boolean {
  return LEGACY_ADMIN_USER_IDS.includes(userId);
}

function sessionSecret(): string | null {
  const configured = process.env.ADMIN_SESSION_SECRET;
  if (configured && configured.trim()) return configured.trim();
  const password = adminPassword();
  if (!password) return null;
  // Fall back to a deterministic secret derived from the admin password so the
  // panel works without configuring an extra variable.
  return createHmac('sha256', 'stellicast-admin-session').update(password).digest('hex');
}

function sign(payload: string): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createAdminToken(email: string): string | null {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + ADMIN_COOKIE_MAX_AGE * 1000 }),
  ).toString('base64url');
  const signature = sign(payload);
  return signature ? `${payload}.${signature}` : null;
}

export function verifyAdminToken(token?: string | null): string | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  if (!expected) return null;

  try {
    const provided = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null;

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.email || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (!adminEmails().includes(String(data.email).toLowerCase())) return null;
    return String(data.email);
  } catch {
    return null;
  }
}

/** Compares the submitted credentials with the configured admin credentials. */
export async function checkAdminCredentials(email: string, password: string): Promise<boolean> {
  const expectedPassword = adminPassword();
  if (!expectedPassword) return false;

  const emailOk = (email || '').trim().toLowerCase() === adminEmail();

  const provided = Buffer.from(password || '');
  const wanted = Buffer.from(expectedPassword);
  const passwordOk = provided.length === wanted.length && timingSafeEqual(provided, wanted);

  return emailOk && passwordOk;
}

export async function getAdminSession(): Promise<{ email: string } | null> {
  try {
    const store = await cookies();
    const email = verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
    return email ? { email } : null;
  } catch {
    return null;
  }
}

// -------- shared helper for admin route guards --------
// Returns an admin identity if the caller is an admin, or null otherwise.
export async function requireAdmin(supabase: SupabaseClient) {
  const session = await getAdminSession();
  if (session) {
    return { id: `env-admin:${session.email}`, email: session.email } as any;
  }

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  if (isAdminUser(user.id)) return user;
  if (user.email && adminEmails().includes(user.email.toLowerCase())) return user;

  return null;
}
