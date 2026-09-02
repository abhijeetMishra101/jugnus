import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/w/')) return NextResponse.next()

  // Read the Supabase session cookie
  const accessToken = request.cookies.get('sb-access-token')?.value
    ?? extractTokenFromAuthCookie(request)

  if (!accessToken) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Lightweight token verification via Supabase REST (no DB round-trip)
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )
    const { error } = await db.auth.getUser(accessToken)
    if (error) throw error
  } catch {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

function extractTokenFromAuthCookie(request: NextRequest): string | undefined {
  // Supabase stores the session as sb-<project-ref>-auth-token (JSON)
  for (const [name, cookie] of request.cookies) {
    if (name.includes('-auth-token')) {
      try {
        const parsed = JSON.parse(decodeURIComponent(cookie.value))
        return parsed?.access_token ?? undefined
      } catch {
        return undefined
      }
    }
  }
}

export const config = {
  matcher: ['/w/:path*'],
}
