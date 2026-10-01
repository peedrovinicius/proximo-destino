const defaultWhatsAppNumber = '5585994284379'
const configuredWhatsAppNumber = import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, '') ?? ''
const whatsappNumber = configuredWhatsAppNumber || defaultWhatsAppNumber

export function getWhatsAppUrl(message: string) {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`
}

export function openWhatsApp(message: string) {
  window.open(getWhatsAppUrl(message), '_blank', 'noopener,noreferrer')
}
