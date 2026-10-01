import {
  Instagram,
  Mail,
  MessageCircle,
} from 'lucide-react'
import { Brand } from './Brand'

export type InstitutionalPageKey =
  | 'about'
  | 'culture'
  | 'purpose'
  | 'contact'
  | 'sales'
  | 'payments'
  | 'cancellation'
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'who-can-travel'
  | 'anti-harassment'
  | 'sustainability'
  | 'boarding-points'
  | 'ethics'

type PublicFooterProps = {
  onNavigate: (page: InstitutionalPageKey) => void
  onAdminAccess: () => void
}

const companyLinks: Array<[InstitutionalPageKey, string]> = [
  ['about', 'Sobre nós'],
  ['culture', 'Cultura'],
  ['purpose', 'Propósito'],
  ['contact', 'Fale conosco'],
]

const usefulLinks: Array<[InstitutionalPageKey, string]> = [
  ['sales', 'Canais de vendas'],
  ['payments', 'Formas de pagamento'],
  ['cancellation', 'Cancelamento e reembolso'],
  ['terms', 'Termos de Uso'],
  ['privacy', 'Política de Privacidade'],
  ['cookies', 'Política de Cookies'],
  ['who-can-travel', 'Quem pode viajar'],
  ['anti-harassment', 'Antiassédio e Não Discriminação'],
  ['sustainability', 'Sustentabilidade'],
  ['boarding-points', 'Terminais e locais de embarque'],
  ['ethics', 'Ética e Conduta'],
]

export function PublicFooter({ onNavigate, onAdminAccess }: PublicFooterProps) {
  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <section className="site-footer-brand">
          <Brand compact />
          <div>
            <strong>Próximo Destino</strong>
            <span>Turismo e viagens</span>
          </div>

          <p>
            Planejamento, reservas, acompanhamento e documentos da sua viagem em um só lugar.
          </p>

          <div className="site-footer-social">
            <a
              href="https://www.instagram.com/proximodestino02/"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram da Próximo Destino"
            >
              <Instagram size={16} />
              <span>Instagram</span>
            </a>
            <a
              href="mailto:proximodestinoviagens7@gmail.com"
              aria-label="Enviar e-mail para a Próximo Destino"
            >
              <Mail size={16} />
              <span>E-mail</span>
            </a>
            <a
              href="https://wa.me/5585994284379"
              target="_blank"
              rel="noreferrer"
              aria-label="Falar com a Próximo Destino no WhatsApp"
            >
              <MessageCircle size={16} />
              <span>WhatsApp</span>
            </a>
          </div>
        </section>

        <section className="site-footer-column">
          <h3>A Empresa</h3>
          {companyLinks.map(([key, label]) => (
            <button type="button" key={key} onClick={() => onNavigate(key)}>
              {label}
            </button>
          ))}
        </section>

        <section className="site-footer-column site-footer-column--wide">
          <h3>Links Úteis</h3>
          <div className="site-footer-link-grid">
            {usefulLinks.map(([key, label]) => (
              <button type="button" key={key} onClick={() => onNavigate(key)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="site-footer-column site-footer-admin">
          <h3>Acesso</h3>
          <button type="button" onClick={onAdminAccess}>Área administrativa</button>
        </section>
      </div>

      <div className="site-footer-bottom">
        <span>Próximo Destino Turismo e Viagens · Pindoretama - CE · CNPJ 59.239.955/0001-49</span>
        <span>Copyright © 2026 Próximo Destino. Todos os direitos reservados.</span>
      </div>
    </footer>
  )
}
