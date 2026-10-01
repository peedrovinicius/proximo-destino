import { ArrowLeft, ExternalLink, Mail, MessageCircle } from 'lucide-react'
import { Brand } from '../../components/Brand'
import {
  PublicFooter,
  type InstitutionalPageKey,
} from '../../components/PublicFooter'

type InstitutionalPageProps = {
  page: InstitutionalPageKey
  onBack: () => void
  onNavigate: (page: InstitutionalPageKey) => void
  onAdminAccess: () => void
}

type PageContent = {
  eyebrow: string
  title: string
  intro: string
  sections: Array<{
    title: string
    paragraphs?: string[]
    items?: string[]
  }>
  action?: 'email' | 'whatsapp' | 'both'
}

const content: Record<InstitutionalPageKey, PageContent> = {
  about: {
    eyebrow: 'A Empresa',
    title: 'Sobre a Próximo Destino',
    intro:
      'A Próximo Destino é uma agência de turismo voltada ao planejamento, intermediação e acompanhamento de viagens, com atendimento humano e ferramentas digitais para organizar cada etapa da jornada.',
    sections: [
      {
        title: 'Como trabalhamos',
        paragraphs: [
          'A agência reúne informações de viagens, cotações, reservas, serviços, pagamentos e documentos em uma experiência única para o cliente.',
          'Passagens, hospedagens, transfers, passeios, seguros e demais serviços podem ser prestados por fornecedores terceiros. A Próximo Destino atua na organização e intermediação desses serviços conforme a contratação realizada.',
        ],
      },
      {
        title: 'Identificação',
        items: [
          'Próximo Destino Turismo e Viagens',
          'CNPJ 59.239.955/0001-49',
          'Atendimento digital pelo site, e-mail, Instagram e WhatsApp',
        ],
      },
    ],
  },
  culture: {
    eyebrow: 'A Empresa',
    title: 'Nossa cultura',
    intro:
      'Atendimento próximo, organização e transparência orientam a forma como conduzimos cada viagem.',
    sections: [
      {
        title: 'Princípios',
        items: [
          'Comunicação clara antes, durante e depois da contratação.',
          'Respeito às escolhas, necessidades e orçamento de cada viajante.',
          'Registro organizado das condições comerciais e serviços contratados.',
          'Relacionamento responsável com clientes, parceiros e fornecedores.',
          'Melhoria contínua da experiência digital e do atendimento humano.',
        ],
      },
    ],
  },
  purpose: {
    eyebrow: 'A Empresa',
    title: 'Nosso propósito',
    intro:
      'Facilitar a realização de viagens com planejamento, clareza e acompanhamento próximo.',
    sections: [
      {
        title: 'O que buscamos entregar',
        paragraphs: [
          'Queremos reduzir a complexidade de organizar uma viagem, centralizando informações importantes e deixando cada etapa mais fácil de acompanhar.',
          'A tecnologia apoia o atendimento, mas decisões comerciais, confirmações e orientações continuam vinculadas às condições reais de cada serviço e fornecedor.',
        ],
      },
    ],
  },
  careers: {
    eyebrow: 'A Empresa',
    title: 'Trabalhe conosco',
    intro:
      'Interessados em oportunidades profissionais podem encaminhar uma apresentação ou currículo pelo canal de e-mail da agência.',
    sections: [
      {
        title: 'Envio de currículo',
        paragraphs: [
          'O envio espontâneo não representa promessa de contratação. Os dados recebidos serão utilizados apenas para avaliação de oportunidades compatíveis e poderão ser eliminados quando deixarem de ser necessários.',
        ],
      },
    ],
    action: 'email',
  },
  contact: {
    eyebrow: 'Atendimento',
    title: 'Fale conosco',
    intro:
      'Use nossos canais oficiais para dúvidas sobre destinos, cotações, reservas, pagamentos ou documentos da viagem.',
    sections: [
      {
        title: 'Canais oficiais',
        items: [
          'WhatsApp para atendimento e suporte comercial.',
          'E-mail para solicitações que precisam de registro por escrito.',
          'Instagram para conteúdo, novidades e contato inicial.',
        ],
      },
    ],
    action: 'both',
  },
  sales: {
    eyebrow: 'Links Úteis',
    title: 'Canais de vendas',
    intro:
      'Solicitações e contratações devem acontecer apenas pelos canais oficiais da Próximo Destino.',
    sections: [
      {
        title: 'Como contratar',
        items: [
          'Site oficial: consulta de viagens e solicitação de reserva.',
          'WhatsApp oficial: atendimento, orientação e suporte comercial.',
          'Portal do viajante: acompanhamento de cotação, aprovação, documentos e pagamentos.',
        ],
      },
      {
        title: 'Atenção',
        paragraphs: [
          'Antes de efetuar qualquer pagamento, confirme se a proposta está vinculada à sua reserva e se os dados apresentados correspondem à Próximo Destino.',
        ],
      },
    ],
    action: 'whatsapp',
  },
  terms: {
    eyebrow: 'Legal',
    title: 'Termos de Uso e Condições de Serviço',
    intro:
      'Estes Termos disciplinam o uso do site, do portal do viajante e dos canais digitais da Próximo Destino, bem como as solicitações, cotações e contratações intermediadas pela agência.',
    sections: [
      {
        title: '1. Aceitação e escopo',
        paragraphs: [
          'Ao utilizar o site, solicitar uma reserva, aprovar uma cotação ou acessar o portal do viajante, o cliente declara ter lido e compreendido estes Termos.',
          'O uso dos serviços também está sujeito às condições específicas informadas em cada cotação, reserva, voucher, fornecedor ou meio de pagamento.',
        ],
      },
      {
        title: '2. Papel da Próximo Destino',
        paragraphs: [
          'A Próximo Destino presta serviços de agência de turismo, planejamento e intermediação. Transporte, hospedagem, seguro, passeios, transfers e outros itens podem ser executados por fornecedores independentes.',
          'As regras operacionais de cada fornecedor, incluindo horários, franquias, documentação, alterações e cancelamentos, integram a contratação quando aplicáveis.',
        ],
      },
      {
        title: '3. Cotações, disponibilidade e confirmação',
        paragraphs: [
          'Valores e disponibilidade podem variar até a efetiva confirmação do serviço. Uma solicitação enviada pelo site não representa, por si só, emissão ou garantia de vaga.',
          'A cotação apresentada no portal contém os serviços, preços, descontos e validade aplicáveis naquele momento. Depois de aprovada, a versão aceita fica registrada e não é alterada retroativamente.',
        ],
      },
      {
        title: '4. Dados do viajante',
        paragraphs: [
          'O cliente deve fornecer dados corretos, completos e atualizados, especialmente nome, documentos, datas de nascimento e demais informações exigidas por fornecedores.',
          'Erros fornecidos pelo próprio cliente podem gerar custos de correção, reemissão ou até impossibilidade de utilização do serviço, conforme regras do fornecedor.',
        ],
      },
      {
        title: '5. Menores e capacidade civil',
        paragraphs: [
          'Menores de idade devem estar representados ou assistidos por seus responsáveis legais quando exigido pela legislação.',
          'O responsável deve verificar documentos, autorizações e exigências específicas da viagem antes do embarque.',
        ],
      },
      {
        title: '6. Pagamentos',
        paragraphs: [
          'Valores, entrada, número de parcelas, vencimentos e formas de pagamento são os informados na contratação e registrados no plano financeiro da reserva.',
          'A confirmação financeira depende da efetiva identificação do pagamento. Serviços de terceiros podem adotar procedimentos próprios de análise, autorização ou antifraude.',
        ],
      },
      {
        title: '7. Passagens, vouchers e comprovantes',
        paragraphs: [
          'Os documentos emitidos pela Próximo Destino registram informações da reserva e da compra. O voucher da agência não substitui bilhete eletrônico, cartão de embarque ou documento oficial emitido diretamente pela transportadora quando esses documentos forem exigidos.',
          'O cliente deve conferir nomes, datas, horários, locais, franquias e demais dados assim que receber o documento.',
        ],
      },
      {
        title: '8. Alterações, cancelamentos e reembolsos',
        paragraphs: [
          'Pedidos de alteração, cancelamento ou reembolso serão analisados conforme a legislação aplicável, as condições informadas na contratação e as regras dos fornecedores envolvidos.',
          'Taxas, multas, diferenças tarifárias e prazos de estorno, quando existentes e permitidos, devem ser informados ao cliente antes da conclusão do procedimento.',
        ],
      },
      {
        title: '9. Documentação, saúde e requisitos de entrada',
        paragraphs: [
          'É responsabilidade do viajante verificar os documentos exigidos para o destino e para cada serviço, incluindo documento de identidade, passaporte, visto, autorizações, vacinas e demais requisitos oficiais.',
          'A agência pode orientar o cliente, mas exigências governamentais e sanitárias podem mudar sem aviso prévio.',
        ],
      },
      {
        title: '10. Plataforma digital',
        paragraphs: [
          'O site pode receber atualizações, manutenções ou indisponibilidades temporárias. A Próximo Destino adota medidas razoáveis para manter segurança e continuidade, sem garantir operação ininterrupta em situações fora de seu controle.',
          'É proibido usar meios automatizados para explorar, copiar ou interferir no funcionamento da plataforma sem autorização.',
        ],
      },
      {
        title: '11. Privacidade e segurança',
        paragraphs: [
          'O tratamento de dados pessoais segue a Política de Privacidade e a legislação brasileira aplicável, inclusive a Lei Geral de Proteção de Dados.',
          'Credenciais, códigos de reserva e acessos individuais não devem ser compartilhados com terceiros.',
        ],
      },
      {
        title: '12. Atualizações destes Termos',
        paragraphs: [
          'Estes Termos podem ser atualizados para refletir mudanças legais, operacionais ou tecnológicas. Condições específicas já contratadas permanecem regidas pela versão aplicável e pelos documentos da respectiva reserva.',
        ],
      },
      {
        title: '13. Legislação aplicável',
        paragraphs: [
          'A relação é regida pela legislação brasileira, inclusive pelas normas de proteção do consumidor quando aplicáveis. Eventuais conflitos serão tratados respeitando as regras legais de competência e os direitos do consumidor.',
        ],
      },
      {
        title: 'Última atualização',
        paragraphs: ['30 de setembro de 2026.'],
      },
    ],
  },
  privacy: {
    eyebrow: 'Legal',
    title: 'Política de Privacidade',
    intro:
      'Esta Política explica como a Próximo Destino trata dados pessoais necessários ao atendimento, planejamento, contratação e acompanhamento de viagens.',
    sections: [
      {
        title: 'Dados que podemos tratar',
        items: [
          'Identificação e contato, como nome, e-mail e telefone.',
          'Dados necessários à reserva e aos serviços contratados.',
          'Informações financeiras relacionadas a valores, parcelas e situação de pagamento.',
          'Registros técnicos de acesso e segurança da plataforma.',
        ],
      },
      {
        title: 'Finalidades',
        items: [
          'Atender solicitações e preparar cotações.',
          'Gerenciar reservas, fornecedores, pagamentos e documentos.',
          'Cumprir obrigações legais e regulatórias.',
          'Prevenir fraude, proteger contas e manter a segurança do sistema.',
          'Atender solicitações do titular e prestar suporte.',
        ],
      },
      {
        title: 'Compartilhamento',
        paragraphs: [
          'Dados podem ser compartilhados com fornecedores necessários à execução da viagem, como transportadoras, hospedagens, operadoras, seguradoras, meios de pagamento e prestadores envolvidos na reserva.',
          'Não comercializamos dados pessoais para fins publicitários de terceiros.',
        ],
      },
      {
        title: 'Retenção e segurança',
        paragraphs: [
          'Os dados são mantidos pelo período necessário às finalidades da contratação, às obrigações legais e à defesa de direitos. Aplicamos controles técnicos e organizacionais para reduzir riscos de acesso indevido, perda ou alteração.',
        ],
      },
      {
        title: 'Direitos do titular',
        paragraphs: [
          'O titular pode solicitar confirmação de tratamento, acesso, correção e outras providências previstas na LGPD, observadas as hipóteses legais de retenção.',
        ],
      },
      {
        title: 'Contato de privacidade',
        paragraphs: [
          'Solicitações relacionadas a dados pessoais podem ser encaminhadas pelo link de e-mail disponível no rodapé do site.',
        ],
      },
    ],
    action: 'email',
  },
  cookies: {
    eyebrow: 'Legal',
    title: 'Política de Cookies',
    intro:
      'A Próximo Destino utiliza apenas os recursos técnicos necessários ao funcionamento e à segurança das áreas autenticadas do sistema.',
    sections: [
      {
        title: 'Cookies essenciais',
        paragraphs: [
          'A área administrativa utiliza cookie técnico seguro para manter e renovar a sessão autenticada. Esse cookie é necessário para o funcionamento do acesso e não tem finalidade publicitária.',
        ],
      },
      {
        title: 'Portal do viajante',
        paragraphs: [
          'O token de acesso do portal do viajante é mantido apenas durante a sessão ativa no navegador e não é utilizado para publicidade comportamental.',
        ],
      },
      {
        title: 'Medição e publicidade',
        paragraphs: [
          'No estado atual do site, não utilizamos cookies de publicidade ou rastreamento comportamental de terceiros. Se essa prática mudar, esta Política será atualizada e os controles de consentimento aplicáveis serão adotados.',
        ],
      },
    ],
  },
  'who-can-travel': {
    eyebrow: 'Orientações',
    title: 'Quem pode viajar',
    intro:
      'As condições de viagem dependem da idade do passageiro, do destino, do meio de transporte e das regras do fornecedor.',
    sections: [
      {
        title: 'Adultos',
        paragraphs: [
          'Devem portar documento válido e atender às exigências do destino e do serviço contratado.',
        ],
      },
      {
        title: 'Crianças e adolescentes',
        paragraphs: [
          'Podem existir exigências específicas de acompanhamento e autorização. O responsável deve conferir as regras aplicáveis ao trecho e ao destino antes da viagem.',
        ],
      },
      {
        title: 'Viagens internacionais',
        paragraphs: [
          'Passaporte, visto, autorizações, vacinas e requisitos migratórios devem ser verificados diretamente nas fontes oficiais competentes.',
        ],
      },
    ],
  },
  'anti-harassment': {
    eyebrow: 'Compromisso',
    title: 'Antiassédio e Não Discriminação',
    intro:
      'A Próximo Destino não tolera assédio, violência, intimidação ou discriminação em seus canais de atendimento e relações profissionais.',
    sections: [
      {
        title: 'Compromisso',
        items: [
          'Tratamento respeitoso independentemente de origem, raça, gênero, orientação sexual, idade, deficiência, religião ou qualquer outra condição protegida por lei.',
          'Comunicação profissional com clientes, colaboradores e parceiros.',
          'Análise responsável de relatos recebidos pelos canais oficiais.',
        ],
      },
    ],
    action: 'email',
  },
  sustainability: {
    eyebrow: 'Compromisso',
    title: 'Sustentabilidade',
    intro:
      'Buscamos reduzir desperdícios e incentivar escolhas responsáveis na operação da agência.',
    sections: [
      {
        title: 'Práticas',
        items: [
          'Prioridade para documentos digitais quando possível.',
          'Organização de informações para reduzir reemissões e retrabalho.',
          'Incentivo ao planejamento consciente da viagem.',
          'Valorização de fornecedores que adotem boas práticas ambientais e sociais quando disponíveis.',
        ],
      },
    ],
  },
  'boarding-points': {
    eyebrow: 'Orientações',
    title: 'Terminais e locais de embarque',
    intro:
      'A Próximo Destino não opera terminais próprios. O local de embarque é definido pelo fornecedor responsável pelo transporte e deve ser conferido no documento da viagem.',
    sections: [
      {
        title: 'Antes de sair',
        items: [
          'Confira endereço e horário do embarque no voucher ou bilhete oficial.',
          'Observe terminal, portão, aeroporto, rodoviária ou ponto indicado pelo fornecedor.',
          'Chegue com antecedência compatível com o serviço contratado.',
          'Em caso de divergência, entre em contato com a agência antes do horário de embarque.',
        ],
      },
    ],
    action: 'whatsapp',
  },
  ethics: {
    eyebrow: 'A Empresa',
    title: 'Ética e Conduta',
    intro:
      'Nossas relações comerciais devem ser conduzidas com legalidade, transparência, respeito e registro adequado das condições oferecidas.',
    sections: [
      {
        title: 'Diretrizes',
        items: [
          'Não prometer serviço que não esteja confirmado.',
          'Não alterar valores aprovados sem nova negociação.',
          'Preservar documentos e histórico da contratação.',
          'Proteger dados pessoais e informações financeiras.',
          'Tratar conflitos de interesse e reclamações com transparência.',
          'Rejeitar fraude, corrupção, discriminação e práticas abusivas.',
        ],
      },
    ],
    action: 'email',
  },
}

export function InstitutionalPage({
  page,
  onBack,
  onNavigate,
  onAdminAccess,
}: InstitutionalPageProps) {
  const current = content[page]

  return (
    <div className="institutional-page">
      <header className="public-header">
        <button
          className="public-brand-button"
          type="button"
          onClick={onBack}
          aria-label="Voltar para a Próximo Destino"
        >
          <Brand compact />
        </button>

        <button className="institutional-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          Voltar para o site
        </button>

        <div className="public-header-actions">
          <button className="public-admin-access" type="button" onClick={onAdminAccess}>
            Administração
          </button>
        </div>
      </header>

      <main className="institutional-main">
        <section className="institutional-hero">
          <span className="public-kicker">{current.eyebrow}</span>
          <h1>{current.title}</h1>
          <p>{current.intro}</p>
        </section>

        <article className="institutional-content">
          {current.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.items ? (
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
            </section>
          ))}

          {current.action ? (
            <div className="institutional-actions">
              {(current.action === 'email' || current.action === 'both') ? (
                <a href="mailto:proximodestinoviagens7@gmail.com">
                  <Mail size={16} />
                  Enviar e-mail
                </a>
              ) : null}

              {(current.action === 'whatsapp' || current.action === 'both') ? (
                <a
                  href="https://wa.me/5585994284379"
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={16} />
                  Falar no WhatsApp
                  <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          ) : null}
        </article>
      </main>

      <PublicFooter onNavigate={onNavigate} onAdminAccess={onAdminAccess} />
    </div>
  )
}
