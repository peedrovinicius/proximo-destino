import { useEffect } from 'react'
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
          'Pindoretama - CE',
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
  payments: {
    eyebrow: 'Financeiro',
    title: 'Formas de pagamento',
    intro:
      'As formas disponíveis dependem da contratação registrada na reserva e das condições apresentadas ao cliente antes da aprovação.',
    sections: [
      {
        title: 'Meios aceitos',
        items: [
          'PIX.',
          'Cartão.',
          'Dinheiro.',
          'Transferência bancária.',
          'Boleto.',
        ],
      },
      {
        title: 'Condições da contratação',
        paragraphs: [
          'Entrada, quantidade de parcelas, vencimentos e eventuais condições específicas são informados na cotação e no plano financeiro da reserva.',
          'O pagamento somente é considerado quitado após a efetiva confirmação do recebimento. Em operações processadas por bancos, emissores, adquirentes ou outros intermediários financeiros, a confirmação pode depender do processamento do respectivo meio de pagamento.',
        ],
      },
      {
        title: 'Segurança',
        paragraphs: [
          'Antes de realizar qualquer pagamento, o cliente deve conferir os dados da reserva, os valores aprovados e o canal oficial utilizado no atendimento.',
        ],
      },
    ],
    action: 'both',
  },
  cancellation: {
    eyebrow: 'Legal',
    title: 'Política de Cancelamento e Reembolso',
    intro:
      'Pedidos de alteração, cancelamento e reembolso são tratados conforme a legislação aplicável, as condições informadas antes da contratação e as regras dos fornecedores efetivamente envolvidos na reserva.',
    sections: [
      {
        title: '1. Como solicitar',
        paragraphs: [
          'O pedido deve ser feito por um canal oficial da Próximo Destino, com identificação suficiente da reserva. A agência registrará a solicitação e informará as condições aplicáveis antes de concluir a alteração ou o cancelamento, sempre que isso for possível.',
        ],
      },
      {
        title: '2. Direito de arrependimento',
        paragraphs: [
          'Quando o direito de arrependimento previsto na legislação brasileira for aplicável à contratação realizada fora do estabelecimento comercial, ele será respeitado nos termos legais, sem criação de renúncia ou restrição indevida ao consumidor.',
        ],
      },
      {
        title: '3. Passagens aéreas',
        paragraphs: [
          'Nas passagens aéreas sujeitas à regulamentação da ANAC, serão observadas as regras vigentes do transporte aéreo e as condições tarifárias previamente informadas.',
          'Quando preenchidos os requisitos da regulamentação da ANAC, a desistência comunicada em até 24 horas do recebimento do comprovante da passagem, para compra realizada com antecedência igual ou superior a 7 dias do embarque, será tratada sem ônus ao passageiro.',
          'Nos demais pedidos voluntários de alteração ou cancelamento, poderão incidir diferença tarifária, multa ou restrição prevista na tarifa contratada, desde que previamente informada e permitida pela legislação.',
        ],
      },
      {
        title: '4. Cancelamento ou alteração pelo fornecedor',
        paragraphs: [
          'Quando transportadora, hospedagem, operadora ou outro fornecedor cancelar ou alterar o serviço, a Próximo Destino auxiliará o cliente na aplicação das alternativas e direitos previstos na legislação e nas condições do serviço.',
          'A atuação como intermediadora não elimina responsabilidades que a lei atribua à Próximo Destino ou aos demais integrantes da cadeia de fornecimento.',
        ],
      },
      {
        title: '5. Hotéis, passeios, transfers, seguros e outros serviços',
        paragraphs: [
          'Cada serviço pode possuir prazo próprio de cancelamento, condição reembolsável ou não reembolsável, multa, retenção ou regra de alteração. Essas condições devem ser informadas ao cliente antes da aprovação da cotação quando forem relevantes à decisão de compra.',
          'Valores cobrados por fornecedores em razão de cancelamento ou alteração somente serão repassados quando vinculados à contratação e juridicamente aplicáveis.',
        ],
      },
      {
        title: '6. Serviços já prestados e despesas efetivas',
        paragraphs: [
          'Quando permitido pela legislação, poderão ser considerados serviços efetivamente prestados, custos já incorridos e valores não recuperáveis de fornecedores, desde que relacionados à reserva e devidamente informados ou demonstráveis.',
          'Não será aplicada cláusula genérica destinada a afastar direitos obrigatórios do consumidor.',
        ],
      },
      {
        title: '7. Reembolso',
        paragraphs: [
          'O valor efetivamente reembolsável será apurado conforme a natureza de cada item da reserva, os direitos legais do consumidor, as condições previamente informadas e os valores recuperados ou devidos pelos fornecedores.',
          'O processamento observará o meio de pagamento utilizado e os prazos legais aplicáveis. Quando a regulamentação do transporte aéreo estabelecer prazo específico, esse prazo será respeitado.',
          'Em compras com cartão, depois de processado o estorno, a visualização do crédito pode depender do ciclo de fechamento e das regras do emissor do cartão.',
        ],
      },
      {
        title: '8. Não comparecimento',
        paragraphs: [
          'O não comparecimento ao embarque, hospedagem, passeio ou outro serviço poderá sujeitar a reserva às regras de no-show do fornecedor e da tarifa contratada, sem prejuízo de direitos que não possam ser afastados por contrato.',
        ],
      },
      {
        title: '9. Prazo e comunicação',
        paragraphs: [
          'O cliente deve comunicar o pedido o quanto antes. A proximidade da data de viagem pode reduzir alternativas disponíveis e aumentar custos impostos pelos fornecedores.',
        ],
      },
      {
        title: '10. Análise individual',
        paragraphs: [
          'Como uma mesma reserva pode reunir fornecedores e regras diferentes, o cálculo de eventual reembolso é feito por item. A agência apresentará ao cliente a composição aplicável ao caso concreto.',
        ],
      },
      {
        title: 'Última atualização',
        paragraphs: ['30 de setembro de 2026.'],
      },
    ],
    action: 'both',
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
          'A Próximo Destino aceita PIX, cartão, dinheiro, transferência bancária e boleto. A disponibilidade de cada meio, entrada, número de parcelas e vencimentos é a informada na contratação e registrada no plano financeiro da reserva.',
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
          'Pedidos de alteração, cancelamento ou reembolso serão analisados conforme a Política de Cancelamento e Reembolso, a legislação aplicável, as condições informadas antes da contratação e as regras dos fornecedores envolvidos.',
          'Taxas, multas, diferenças tarifárias, retenções e prazos somente serão aplicados quando juridicamente permitidos e vinculados às condições da contratação.',
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
          'Confira endereço e horário do embarque no voucher ou documento informado pelo fornecedor.',
          'Confira o terminal, rodoviária ou ponto de embarque informado pela transportadora ou pelo prestador responsável.',
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    document.title = `${current.title} | Próximo Destino`

    return () => {
      document.title = 'Próximo Destino'
    }
  }, [current.title])


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
