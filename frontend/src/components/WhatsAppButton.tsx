import { MessageCircle } from 'lucide-react'
import { openWhatsApp } from '../lib/whatsapp'

type WhatsAppButtonProps = {
  message?: string
  label?: string
}

export function WhatsAppButton({
  message = 'Olá! Preciso de ajuda com minha viagem.',
  label = 'Falar no WhatsApp',
}: WhatsAppButtonProps) {
  return (
    <button
      className="whatsapp-float"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => openWhatsApp(message)}
    >
      <MessageCircle size={24} strokeWidth={2.2} />
      <span>{label}</span>
    </button>
  )
}
