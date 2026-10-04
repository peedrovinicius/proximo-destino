import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ['proximo-destino-web-production.up.railway.app'],
    headers: {
      'Strict-Transport-Security': 'max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      'Content-Security-Policy-Report-Only': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https: data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' https://proximo-destino-api-production.up.railway.app",
        "frame-src 'self' https://www.google.com https://maps.google.com",
        "form-action 'self'",
      ].join('; '),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'react-vendor'
          }
          if (id.includes('/lucide-react/')) {
            return 'icons-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})
