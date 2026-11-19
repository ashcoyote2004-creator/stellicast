import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export default async function proxy(req: NextRequest) {
  const res = NextResponse.next()

  // Without Supabase configuration there is no session to refresh. Let the
  // request through instead of failing (and crashing) every matched route.
  if (!supabaseUrl || !supabaseAnonKey) {
    return res
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options) {
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options) {
          res.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  try {
    await supabase.auth.getUser()
  } catch (error) {
    console.error('Supabase session refresh failed:', error)
  }

  return res
}

export const config = {
  matcher: ['/watch/:path*', '/api/:path*'],
}
