export const RELEASE = {
  service: 'proximo-destino-api',
  version: '0.5.0',
  apiVersion: 'v1',
  database: 'postgresql',
  capabilities: [
    'public-trips',
    'reservations',
    'client-portal',
    'quotes',
    'finance',
    'documents',
    'mfa',
    'audit',
    'privacy',
  ],
} as const
