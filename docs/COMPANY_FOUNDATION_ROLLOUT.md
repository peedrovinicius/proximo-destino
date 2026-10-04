# Três níveis — etapa de cadastro de empresas

## Disponível nesta mudança (não publicado em produção)

- `CREATOR` é um perfil distinto de `ADMIN`. Não foi incluído nas listas de
  acesso a viagens, reservas, financeiro, integrações ou privacidade da empresa.
- Login separado `/auth/creator/login`, MFA obrigatório, bloqueio por tentativas
  reaproveitado e sessão validada no servidor. Não há auto-cadastro do Criador.
- Tabelas `Company` e `CompanyMembership`, com vínculo único usuário/empresa e
  chaves estrangeiras. A migração é aditiva, sem alterar contas ou dados existentes.
- Tela `?screen=creator`: cadastro e edição de rascunhos, campos comerciais,
  cadastrais, contato, endereço e responsável. Nenhum convite é enviado.
- API `/platform/companies` protegida por sessão, perfil atual do Criador e MFA.
  Campos não previstos, como status, proprietário e vínculos, são rejeitados.
- Novas empresas ficam sempre `DRAFT`. Não existe endpoint de ativação, criação
  de equipe, exclusão ou acesso aos dados operacionais de outra empresa.

## Pré-condições para usar em ambiente isolado

1. Banco exclusivamente de testes: aplicar migrações e gerar Prisma Client.
2. Habilitar `COMPANY_FOUNDATION_ENABLED=true` nesse ambiente. Ausente ou com
   qualquer outro valor, login e rotas de gestão de empresas negam acesso.
3. Provisionar conta nova com `npm run creator:create`, usando `CREATOR_EMAIL`
   e `CREATOR_PASSWORD` fornecidos por canal seguro. Não registrar senha no Git,
   URL ou logs. O script recusa contas existentes e não promove administradores.
4. Acessar `?screen=creator` e concluir a configuração de MFA.

O script de provisionamento não foi executado. Nenhuma migração foi aplicada
ao banco de produção nesta etapa.

## Próxima etapa obrigatória antes de ativar outra empresa

- Atribuir a operação atual a uma empresa inicial, com plano de conferência e
  reversão de dados; não preencher companyId indiscriminadamente por tentativa.
- Escopar todas as entidades e consultas: clientes, acompanhantes, viagens,
  reservas, passageiros, assentos, pedidos, financeiro, documentos, mensagens,
  notificações, créditos, OAuth e conexões de provedores.
- Resolver empresa e vínculo ativo pelo servidor na sessão. Nunca confiar apenas
  em companyId recebido do navegador; vincular cliente à própria empresa.
- Impedir referências cruzadas com restrições compostas e testes negativos.
- Escopar unicidade de integrações por empresa e vincular webhooks à conexão
  confiável; não aceitar empresa livremente declarada no payload do provedor.
- Criar convites expirantes de administrador e ativação somente após todos os
  testes de isolamento ponta a ponta passarem, inclusive dois clientes e duas
  empresas reais em banco isolado.

## Reversão segura desta etapa

Manter/desabilitar `COMPANY_FOUNDATION_ENABLED` e retornar a versão anterior da
aplicação. Preservar as novas tabelas e rascunhos; não apagar dados ou tentar
remover o valor de enum do PostgreSQL durante uma reversão operacional.

Limitações já conhecidas (Mercado Pago/e-mail não ativados e backup externo
pendente) não são resolvidas nem alteradas por esta mudança.
