const whatsappNumber = import.meta.env.VITE_WHATSAPP_NUMBER?.replace(/\D/g, '') ?? ''

export function openWhatsApp(message: string) {
  const encoded = encodeURIComponent(message)
  const target = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`

  window.open(target, '_blank', 'noopener,noreferrer')
}
