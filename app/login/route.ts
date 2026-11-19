import type { NextRequest } from 'next/server';

/**
 * Legacy /login entry point — sends visitors to the sign-in page.
 *
 * A relative Location header is used on purpose: behind the hosting proxy the
 * incoming request URL is the container's internal address (localhost:3000),
 * so building an absolute redirect from it would send browsers to localhost.
 * A relative redirect always resolves against the public origin.
 */
export function GET(_request: NextRequest) {
  return new Response(null, {
    status: 307,
    headers: {
      Location: '/auth',
      'Cache-Control': 'no-store',
    },
  });
}
