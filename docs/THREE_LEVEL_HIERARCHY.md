# Criador, empresas e clientes

Escopo solicitado pelo proprietário em 2026-10-04. Esta arquitetura ainda não
está habilitada nas rotas nem no banco de produção.

| Nível | Campos e telas | Acesso |
| --- | --- | --- |
| Criador | Nome, e-mail, senha protegida, MFA; lista de empresas; cadastro de empresa e responsável; status ativa/suspensa; histórico de ações | Criar empresas, convidar administradores e controlar ativação. Sem acesso implícito aos passageiros, documentos ou financeiro das empresas. |
| Empresa | Nome comercial, razão social/CNPJ quando aplicável, identificador público único, logo, contatos, responsável, endereço, equipe e configurações | Administrar apenas viagens, clientes, reservas, assentos, documentos e financeiro próprios. Conectar seu próprio Mercado Pago e remetente de e-mail. |
| Cliente | Nome, e-mail/WhatsApp, documento e nascimento quando necessários à viagem, acompanhantes, reservas, assentos, parcelas, comprovantes e vouchers | Visualizar somente seu perfil e suas reservas naquela empresa; editar apenas campos permitidos pelo fluxo. Sem telas administrativas. |

Dados de passageiros e documentos são privados. Não publicar esses campos no
perfil público da empresa. CNPJ/endereço/documentos exigem validação apropriada,
sem tornar todo campo obrigatório indiscriminadamente.

## Modelo e isolamento necessários

- Company: ID, identificador público, nome comercial, dados cadastrais, marca,
  contatos, status e timestamps. Criador provisionado por processo restrito;
  não há cadastro público de criadores.
- Acesso à plataforma separado da equipe da empresa. A fundação usa o perfil
  exclusivo CREATOR, fora dos papéis operacionais, com MFA obrigatório.
- CompanyMembership vincula User a Company e papel ADMIN/AGENT/FINANCE, com
  status ativo e unicidade por usuário/empresa. Cliente continua vinculado ao
  perfil privado da empresa; um e-mail pode representar clientes em empresas
  diferentes sem compartilhar dados, bônus ou documentos.
- Sessão administrativa e refresh precisam de contexto de empresa validado no
  servidor e consulta ao vínculo atual. Nunca confiar em companyId enviado pelo
  navegador para definir autorização. Suspensão e revogação invalidam o acesso.
- Adicionar escopo de empresa aos dados operacionais, integrações, OAuth,
  mensagens, notificações e auditoria. Relações entre viagem, reserva, cliente,
  passageiro, pagamento e documento devem impedir referências cruzadas.
- Conexões hoje únicas por provider devem se tornar únicas por companyId/provider.
  Callbacks e webhooks devem resolver a empresa pela conexão verificada e preservar
  assinatura, idempotência e limites financeiros. Não escolher empresa pelo payload.
- Busca, exportação, fotos, URLs públicas, códigos de reserva e verificação de
  documentos também precisam de escopo; proteger apenas as telas não basta.
- RLS depende de papel de execução sem bypass e contexto transacional seguro;
  não remover privilégios da produção antes de ensaiar os fluxos da API.

## Implantação controlada

1. Implementar persistência, vínculos e sessão contextual em ambiente isolado.
2. Migrar a operação atual para uma empresa inicial sem descartar registros.
3. Aplicar escopo obrigatório aos serviços e constraints compostas às relações.
4. Construir painel do Criador, configuração da empresa e portal contextual.
5. Testar duas empresas: nenhuma deve ler/alterar reserva, PDF, foto, pagamento,
   bônus, usuário ou configuração da outra. Confirmar papéis e suspensão.
6. Preparar backup, restauração, rollback e aceite antes da migration de produção.

`hierarchy-policy.ts` é uma fundação testável, deliberadamente não conectada às
rotas. Seus testes não comprovam isolamento do banco ou a existência dos painéis.
Não habilitar cadastro de uma segunda empresa enquanto os itens acima faltarem.
