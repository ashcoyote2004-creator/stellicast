import { NextResponse } from 'next/server';
import { describeStorage } from '@/../lib/video-storage';
import { isMuxConfigured } from '@/../lib/mux';
import { isVidaraConfigured } from '@/../lib/vidara';
import { adminPassword } from '@/../lib/admin';

export const dynamic = 'force-dynamic';

/**
 * Read-only integration diagnostics.
 *
 * Reports only booleans and provider names — never a key, token or password.
 * The Mux probe is a single authenticated GET on the assets list, which does
 * not create an asset or start any processing (no Mux charges).
 */
export async function GET() {
  const muxConfigured = isMuxConfigured();
  const vidaraConfigured = isVidaraConfigured();

  const adminConfigured = Boolean(adminPassword());

  let mux: { configured: boolean; reachable: boolean | null; status: number | null; error?: string } = {
    configured: muxConfigured,
    reachable: null,
    status: null,
  };

  if (muxConfigured) {
    try {
      const tokenId = process.env.MUX_TOKEN_ID || '';
      const tokenSecret = process.env.MUX_TOKEN_SECRET || '';
      const res = await fetch('https://api.mux.com/video/v1/assets?limit=1', {
        headers: {
          Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });
      mux = {
        configured: true,
        reachable: res.ok,
        status: res.status,
        ...(res.ok ? {} : { error: res.status === 401 ? 'Mux rejected the token id/secret pair' : `Mux returned ${res.status}` }),
      };
    } catch (error) {
      mux = {
        configured: true,
        reachable: false,
        status: null,
        error: error instanceof Error ? error.message : 'Mux request failed',
      };
    }
  }

  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  return NextResponse.json(
    {
      storage: describeStorage(),
      providers: {
        mux,
        vidara: {
          configured: vidaraConfigured,
          hasBaseUrl: Boolean(process.env.VIDARA_API_BASE),
          hasKey: Boolean(process.env.VIDARA_API_KEY),
        },
        admin: { configured: adminConfigured, emailSet: Boolean(process.env.ADMIN_EMAIL) },
        supabase: { configured: supabaseConfigured },
      },
      bunny: false,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
