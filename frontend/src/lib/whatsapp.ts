const defaultWhatsAppNumber = '5585994284379'
const configuredWhatsAppNumber = import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, '') ?? ''
const whatsappNumber = configuredWhatsAppNumber || defaultWhatsAppNumber

export function getWhatsAppUrl(message: string) {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`
}

export function openWhatsApp(message: string) {
  window.open(getWhatsAppUrl(message), '_blank', 'noopener,noreferrer')
}


export function getWhatsAppUrlForPhone(phone: string, message: string) {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return getWhatsAppUrl(message)

  const normalized =
    digits.startsWith('55')
      ? digits
      : '55' + digits

  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`
}

export function openWhatsAppTo(phone: string, message: string) {
  window.open(
    getWhatsAppUrlForPhone(phone, message),
    '_blank',
    'noopener,noreferrer',
  )
}
