/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@neondatabase/serverless'],
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
}

module.exports = nextConfig