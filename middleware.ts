import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // ✅ Public routes
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

  // ❌ Not logged in → LOGIN
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // ❌ Logged in but NO access → ACCESS page
  if (!token?.hasAccess && pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/access', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'], // ✅ ONLY protect dashboard
}