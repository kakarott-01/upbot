import CryptoJS from 'crypto-js'

const getKey = () => {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY not set in environment')
  return key
}

export function encrypt(plaintext: string): string {
  return CryptoJS.AES.encrypt(plaintext, getKey()).toString()
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, getKey())
  return bytes.toString(CryptoJS.enc.Utf8)
}

export function encryptJSON(obj: Record<string, string>): string {
  return encrypt(JSON.stringify(obj))
}

export function decryptJSON(ciphertext: string): Record<string, string> {
  return JSON.parse(decrypt(ciphertext))
}