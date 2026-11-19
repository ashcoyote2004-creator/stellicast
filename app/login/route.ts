import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Legacy /login entry point — sends visitors to the sign-in page.
 *
 * The redirect is built from the incoming request URL so it works on any host
 * (local, preview or production) without needing NEXT_PUBLIC_APP_URL.
 */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/auth', request.url));
}
