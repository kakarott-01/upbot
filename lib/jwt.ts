import jwt from 'jsonwebtoken'

const rawSecret = process.env.SIGNUP_JWT_SECRET || process.env.ENCRYPTION_KEY

if (!rawSecret) {
  throw new Error('SIGNUP_JWT_SECRET or ENCRYPTION_KEY must be set')
}

const SECRET: string = rawSecret // ✅ force type narrowing

export interface SignupTokenPayload {
  accessCodeId: string
  expiresAt: number
}

export function signSignupToken(payload: SignupTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '5m' })
}

export function verifySignupToken(token: string): SignupTokenPayload {
  const decoded = jwt.verify(token, SECRET)

  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid signup token payload')
  }

  const { accessCodeId, expiresAt } = decoded as any

  if (
    !accessCodeId ||
    !expiresAt ||
    typeof accessCodeId !== 'string' ||
    typeof expiresAt !== 'number'
  ) {
    throw new Error('Invalid signup token payload')
  }

  if (Date.now() > expiresAt) {
    throw new Error('Signup token expired')
  }

  return { accessCodeId, expiresAt }
}