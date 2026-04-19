import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { verifySessionCookieEdge } from '@/lib/signed-cookie-edge'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ✅ Public routes — no auth needed
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/access')
  ) {
    return NextResponse.next()
  }

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  })

  const cookieSession = await verifySessionCookieEdge(req.cookies.get('user_session')?.value)

  const tokenSession = token
    ? {
        id: (token.id as string | undefined) ?? token.sub ?? '',
        hasAccess: token.hasAccess as boolean | undefined,
      }
    : null

  // ❌ Not logged in at all → LOGIN
  // Check BOTH sources: either a valid NextAuth JWT or a valid signed cookie is sufficient
  const isLoggedIn = !!(tokenSession?.id || cookieSession?.id)
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // ❌ Logged in but NO access → ACCESS page
  //
  // BUG FIX: Previously used `session = tokenSession ?? cookieSession` and checked
  // only that single value. The NextAuth JWT is cached and NOT updated when
  // /api/access/verify whitelists a user — it only refreshes on next token rotation.
  // The signed user_session cookie IS updated immediately by /api/access/verify.
  //
  // Fix: treat EITHER source having hasAccess=true as sufficient.
  // Both sources are cryptographically verified (JWT signature / HMAC-SHA256).
  const hasAccess = !!(tokenSession?.hasAccess || cookieSession?.hasAccess)

  if (!hasAccess && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/access', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'], // ✅ ONLY protect dashboard
}