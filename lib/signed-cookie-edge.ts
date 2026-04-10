import type { SessionPayload } from '@/lib/signed-cookie'

const SECRET = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
if (!SECRET) {
  throw new Error('NEXTAUTH_SECRET or ENCRYPTION_KEY must be set for signed cookies')
}

// TTL for signed session payloads (ms). Keep in sync with server setting.
const SIGNED_COOKIE_TTL_MS = Number(process.env.SIGNED_COOKIE_TTL_MS) || 7 * 24 * 60 * 60 * 1000

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return atob(padded)
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return diff === 0
}

export async function verifySessionCookieEdge(cookie: string | undefined): Promise<SessionPayload | null> {
  if (!cookie) return null

  const dotIdx = cookie.lastIndexOf('.')
  if (dotIdx <= 0) return null

  const data = cookie.slice(0, dotIdx)
  const providedSig = cookie.slice(dotIdx + 1)
  const expectedSig = await sign(data)

  if (!constantTimeEqual(providedSig, expectedSig)) {
    return null
  }

  try {
    const parsed = JSON.parse(fromBase64Url(data)) as any
    const iat = typeof parsed.iat === 'number' ? parsed.iat : null
    if (!iat || Date.now() - iat > SIGNED_COOKIE_TTL_MS) return null
    const { iat: _ignored, ...rest } = parsed
    return rest as SessionPayload
  } catch {
    return null
  }
}
