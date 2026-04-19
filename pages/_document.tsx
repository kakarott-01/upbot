import { Head, Html, Main, NextScript } from "next/document"

// Compatibility shim for Next.js build tooling that still probes Pages Router internals.
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
