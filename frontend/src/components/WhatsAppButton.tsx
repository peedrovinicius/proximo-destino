import { Phone } from 'lucide-react'
import { openWhatsApp } from '../lib/whatsapp'

type WhatsAppButtonProps = {
  message?: string
}

export function WhatsAppButton({
  message = 'Olá! Preciso de ajuda com minha viagem.',
}: WhatsAppButtonProps) {
  return (
    <button
      className="whatsapp-float"
      type="button"
      aria-label="Falar no WhatsApp"
      title="WhatsApp"
      onClick={() => openWhatsApp(message)}
    >
      <Phone size={23} strokeWidth={2.15} aria-hidden="true" />
    </button>
  )
}
