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

O início desta etapa adiciona `AuthSession.companyId` opcional e um resolvedor
server-only `CompanyScopeService`. Ele verifica sessão vigente e do usuário,
empresa ativa, conta ativa e vínculo vigente compatível com o papel atual.
Não recebe companyId do navegador e não atribui sessões antigas a uma empresa.
Sessões antigas sem vínculo são recusadas pelo resolvedor. O resolvedor está
ligado às leituras administrativas descritas abaixo; não representa isolamento
operacional concluído.

O bloco seguinte adiciona `companyId` opcional em Client, Trip e Reservation,
sem atribuir registros existentes automaticamente. `CompanyDataService` faz
leituras de lista e detalhe com o escopo resolvido novamente a cada chamada.
Reservas também verificam o escopo dos seus pais, com projeções limitadas e
identidade reduzida para FINANCE. IDs de outra empresa retornam 404.
Constraints adiáveis, null-safe e com bloqueio de leitura dos pais impedem
referências inconsistentes e permitem um futuro backfill transacional revisado.
As listas GET `/admin/clients`, `/admin/trips`, `/admin/reservations` e o detalhe
GET `/admin/clients/:id` usam esses leitores para sessões de empresa. Contas
legadas sem vínculo preservam o comportamento anterior. A busca textual de
viagens ainda não é aplicada ao leitor de empresa.

O guard nega às contas de empresa todas as outras rotas administrativas
protegidas por ele, incluindo gravações, dashboard e financeiro. As únicas
exceções são consultar/revogar as próprias sessões e logout. O marcador
persistente `User.companyManaged` é definido pelo vínculo e não pode voltar a
false: revogar ou apagar o vínculo nunca restaura acesso global pelas rotas
legadas. O contexto vem da sessão persistida, não de claims de empresa do JWT.
Testes HTTP com JWT assinado e PostgreSQL isolado cobrem esses limites.

**Não cadastrar dados de empresas operacionais nem ativar contas antes de
escopar todas as APIs legadas,
rotas públicas, portal, gravações, entidades derivadas e integrações.**

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
