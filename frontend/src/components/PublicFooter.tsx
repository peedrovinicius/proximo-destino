import { ArrowUpRight, Instagram, Mail, MessageCircle } from 'lucide-react'
import { Brand } from './Brand'

export type InstitutionalPageKey =
  | 'about' | 'culture' | 'purpose' | 'contact' | 'sales' | 'payments'
  | 'cancellation' | 'terms' | 'privacy' | 'cookies' | 'who-can-travel'
  | 'anti-harassment' | 'sustainability' | 'boarding-points' | 'ethics'

type PublicFooterProps = {
  onNavigate: (page: InstitutionalPageKey) => void
  onAdminAccess: () => void
}

const linkGroups: Array<{
  title: string
  links: Array<[InstitutionalPageKey, string]>
}> = [
  { title: 'Empresa', links: [
    ['about', 'Sobre nós'], ['culture', 'Nossa cultura'],
    ['purpose', 'Nosso propósito'], ['contact', 'Fale conosco'],
  ] },
  { title: 'Sua viagem', links: [
    ['sales', 'Canais de vendas'], ['payments', 'Formas de pagamento'],
    ['boarding-points', 'Locais de embarque'], ['who-can-travel', 'Quem pode viajar'],
    ['cancellation', 'Cancelamento e reembolso'],
  ] },
  { title: 'Políticas e compromissos', links: [
    ['terms', 'Termos de uso'], ['privacy', 'Privacidade'], ['cookies', 'Cookies'],
    ['ethics', 'Ética e conduta'], ['anti-harassment', 'Respeito e não discriminação'],
    ['sustainability', 'Sustentabilidade'],
  ] },
]

export function PublicFooter({ onNavigate, onAdminAccess }: PublicFooterProps) {
  return (
    <footer className="site-footer site-footer--refined" aria-label="Rodapé da Próximo Destino">
      <div className="pd-footer-main">
        <section className="pd-footer-brand" aria-label="Próximo Destino Turismo e Viagens">
          <div className="pd-footer-identity">
            <Brand compact />
            <div className="pd-footer-name">
              <strong>Próximo Destino</strong>
              <span>Turismo e viagens</span>
            </div>
          </div>
          <p>Seu próximo destino começa com uma boa conversa. Conte com a gente para planejar e acompanhar sua viagem.</p>
          <div className="pd-footer-social" aria-label="Canais de atendimento">
            <a href="https://www.instagram.com/proximodestino02/" target="_blank" rel="noopener noreferrer" aria-label="Instagram da Próximo Destino" title="Instagram">
              <Instagram size={18} aria-hidden="true" /><span>Instagram</span>
            </a>
            <a href="mailto:proximodestinoviagens7@gmail.com" aria-label="Enviar e-mail para a Próximo Destino" title="E-mail">
              <Mail size={18} aria-hidden="true" /><span>E-mail</span>
            </a>
            <a href="https://wa.me/5585994284379" target="_blank" rel="noopener noreferrer" aria-label="Falar com a Próximo Destino no WhatsApp" title="WhatsApp">
              <MessageCircle size={18} aria-hidden="true" /><span>WhatsApp</span>
            </a>
          </div>
        </section>
        {linkGroups.map(({ title, links }) => (
          <nav className="pd-footer-nav" key={title} aria-label={title}>
            <h3>{title}</h3>
            <ul>
              {links.map(([key, label]) => (
                <li key={key}><button type="button" onClick={() => onNavigate(key)}>{label}</button></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="pd-footer-bottom">
        <div className="pd-footer-bottom-inner">
          <div className="pd-footer-company">
            <span>Próximo Destino Turismo e Viagens</span>
            <span>Pindoretama · CE <span aria-hidden="true">/</span> CNPJ 59.239.955/0001-49</span>
          </div>
          <p className="pd-footer-copyright">© {new Date().getFullYear()} Próximo Destino.<br />Todos os direitos reservados.</p>
          <button className="pd-footer-admin" type="button" onClick={onAdminAccess}>
            Área administrativa <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  )
}
