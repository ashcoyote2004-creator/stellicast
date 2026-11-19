import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_MAX_AGE,
  adminEmail,
  adminPassword,
  checkAdminCredentials,
  createAdminToken,
  getAdminSession,
} from '@/../lib/admin';

/** Current admin sign-in state. */
export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({ authenticated: Boolean(session), email: session?.email ?? null });
}

/** Admin sign-in: validates credentials from Settings and sets a signed cookie. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email ?? '');
  const password = String(body?.password ?? '');

  if (!adminPassword()) {
    return NextResponse.json(
      {
        error:
          'Admin sign-in is not configured yet. Add ADMIN_EMAIL and ADMIN_PASSWORD in Settings → Environment variables.',
      },
      { status: 503 },
    );
  }

  if (!(await checkAdminCredentials(email, password))) {
    return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
  }

  const token = createAdminToken(adminEmail());
  if (!token) {
    return NextResponse.json({ error: 'Could not create an admin session.' }, { status: 500 });
  }

  const response = NextResponse.json({ success: true, email: adminEmail() });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ADMIN_COOKIE_MAX_AGE,
  });
  return response;
}

/** Admin sign-out. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
