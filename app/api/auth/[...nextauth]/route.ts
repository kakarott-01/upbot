import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth-options"

// NextAuth's catch-all route must always run at request time.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }
