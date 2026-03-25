import { cookies } from "next/headers"
import { getServerSession } from "next-auth/next"
import { authOptions } from '@/lib/auth-options'

export function getSessionFromCookie(cookieValue: string | undefined) {
  if (!cookieValue) return null
  try {
    return JSON.parse(cookieValue) as {
      id: string
      email: string
      name: string
    }
  } catch {
    return null
  }
}

export async function auth() {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get("user_session")?.value

  const legacy = getSessionFromCookie(sessionCookie)
  if (legacy) {
    return {
      ...legacy,
      user: {
        id: legacy.id,
        email: legacy.email,
        name: legacy.name,
      },
    }
  }

  const nextAuthSession = await getServerSession(authOptions)
  if (!nextAuthSession?.user?.email) return null

  const userId = (nextAuthSession.user as any).id as string | undefined
  const userName = nextAuthSession.user.name ?? nextAuthSession.user.email.split('@')[0]

  if (!userId) return null

  return {
    id: userId,
    email: nextAuthSession.user.email,
    name: userName,
    user: {
      id: userId,
      email: nextAuthSession.user.email,
      name: userName,
      image: nextAuthSession.user.image,
    },
  }
}
