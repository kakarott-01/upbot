import { cookies }         from 'next/headers'
import { getServerSession } from 'next-auth/next'
import { authOptions }      from '@/lib/auth-options'
import { verifySession }    from '@/lib/signed-cookie'  // FIX: HMAC-verified parse

/**
 * lib/auth.ts — v2
 * =================
 * FIX: The legacy user_session cookie is now parsed via verifySession()
 *      which performs HMAC-SHA256 signature verification before trusting
 *      the payload.  Unsigned/legacy cookies are still accepted for backward
 *      compatibility but will be replaced with signed cookies on next login.
 */

export async function auth() {
  const cookieStore   = cookies()
  const sessionCookie = cookieStore.get('user_session')?.value

  // ── Legacy cookie path (email/OTP login) ──────────────────────────────────
  // verifySession checks HMAC signature; returns null if invalid/unsigned
  const legacy = verifySession(sessionCookie)
  if (legacy?.id && legacy?.email) {
    return {
      ...legacy,
      user: {
        id:    legacy.id,
        email: legacy.email,
        name:  legacy.name,
      },
    }
  }

  // ── NextAuth JWT path (Google OAuth login) ────────────────────────────────
  const nextAuthSession = await getServerSession(authOptions)
  if (!nextAuthSession?.user?.email) return null

  const userId   = (nextAuthSession.user as any).id as string | undefined
  const userName = nextAuthSession.user.name ?? nextAuthSession.user.email.split('@')[0]

  if (!userId) return null

  return {
    id:    userId,
    email: nextAuthSession.user.email,
    name:  userName,
    user: {
      id:    userId,
      email: nextAuthSession.user.email,
      name:  userName,
      image: nextAuthSession.user.image,
    },
  }
}