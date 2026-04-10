import { cookies }         from 'next/headers'
import { getServerSession } from 'next-auth/next'
import { authOptions }      from '@/lib/auth-options'
import { verifySession }    from '@/lib/signed-cookie'  // FIX: HMAC-verified parse
import { db } from '@/lib/db'
import { users } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function auth() {
  const cookieStore   = cookies()
  const sessionCookie = cookieStore.get('user_session')?.value

  const signed = verifySession(sessionCookie)
  if (signed?.id && signed?.email) {
    const hasAccess =
      typeof signed.hasAccess === 'boolean'
        ? signed.hasAccess
        : (
            await db.query.users.findFirst({
              where: eq(users.id, signed.id),
              columns: { isWhitelisted: true },
            })
          )?.isWhitelisted ?? false

    return {
      ...signed,
      hasAccess,
      user: {
        id:    signed.id,
        email: signed.email,
        name:  signed.name,
        hasAccess,
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
    hasAccess: nextAuthSession.user.hasAccess ?? false,
    user: {
      id:    userId,
      email: nextAuthSession.user.email,
      name:  userName,
      image: nextAuthSession.user.image,
      hasAccess: nextAuthSession.user.hasAccess ?? false,
    },
  }
}
