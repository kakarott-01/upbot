import { NextResponse } from 'next/server'

const SESSION_COOKIE_NAMES = [
  'user_session',
  'signup_token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.csrf-token',
  '__Host-next-auth.csrf-token',
  'next-auth.callback-url',
  '__Secure-next-auth.callback-url',
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'authjs.callback-url',
  '__Secure-authjs.callback-url',
]

export async function POST() {
  const response = NextResponse.json({ success: true })

  for (const cookieName of SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, '', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
    })
  }

  return response
}
