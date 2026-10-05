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
- Novas empresas ficam sempre `DRAFT`. Não existe endpoint de ativação,
  exclusão ou acesso aos dados operacionais de outra empresa.
- No painel do Criador, "Administradores de …" abre o cadastro de uma conta
  nova com nome, e-mail e senha (16–128 caracteres). POST
  `/platform/companies/:id/admins` cria somente ADMIN inativo e vínculo inativo
  em transação, exclusivamente em empresa DRAFT. GET na mesma rota lista
  administradores com projeção sem segredos. Nenhuma conta existente é promovida
  ou tem credenciais alteradas; duplicidade de e-mail é recusada.
- A senha usa Argon2id; não é devolvida pela API, salva no navegador ou enviada
  por e-mail. O formulário limpa a senha ao enviar. Não há sessão criada nem
  login permitido para a conta pendente. A migração adiciona User.displayName.
  Futuro fluxo de ativação deverá exigir definição segura de credencial e MFA;
  não entregar uma conta pendente como acesso operacional pronto.

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
legadas sem vínculo preservam o comportamento anterior. O filtro `q` de viagens
consulta título, origem e destino somente da própria empresa.
GET `/admin/search` pesquisa clientes (nome/e-mail/telefone), viagens e reservas
somente da empresa da sessão, verificando também os pais das reservas. ADMIN e
AGENT recebem até oito resultados por categoria, sem documentos, notas, hashes
ou códigos de acesso. FINANCE não acessa essa busca operacional. Pesquisa com
menos de dois caracteres retorna listas vazias; filtro tem limite de 160
caracteres e rejeita formatos não textuais. Contas legadas mantêm a busca anterior.

POST `/admin/clients` e PATCH `/admin/clients/:id` também recebem escopo de empresa
para ADMIN/AGENT. Campos de posse são rejeitados pelo DTO. CPF é validado,
criptografado e verificado por duplicidade apenas dentro da própria empresa;
o mesmo CPF pode representar perfis privados distintos em empresas diferentes.
O e-mail de cliente ainda tem unicidade global legada; conflitos retornam uma
mensagem genérica, sem informar a existência de outra empresa. Alterar essa
restrição depende de escopar primeiro o portal e as consultas públicas.

A transação revalida e bloqueia sessão, usuário, empresa e vínculo até o commit,
serializa a conferência de CPF na empresa e inclui o evento de auditoria sem
valores pessoais. IDs externos retornam 404. Respostas mantêm projeção mínima,
sem notas privadas, documentos, hashes ou credenciais. CPF omitido na edição
é preservado; vazio explicitamente limpa o campo. No cadastro inicial, até 80
acompanhantes podem ser criados atomicamente sob o novo cliente da empresa.
IDs e campos de posse fornecidos pelo navegador são recusados; documentos são
criptografados. O detalhe do próprio cliente inclui acompanhantes sem documentos,
hashes ou IDs de posse. POST `/admin/clients/:id/companions` e PATCH
`/admin/clients/:id/companions/:companionId` permitem ADMIN/AGENT cadastrar e editar
acompanhantes do próprio cliente. Revalidam autorização na transação e bloqueiam
o cliente contra reassociação; IDs que não pertencem ao cliente retornam 404.
Até 80 acompanhantes por cliente, inclusive sob concorrência. Documento omitido
é preservado; vazio limpa a cifra e o hash. Auditoria não guarda valores pessoais.
As novas rotas recusam sessões legadas sem empresa. Reassociação/exclusão e cópia
automática de dados para passageiros de reserva não estão habilitadas.
Falha de auditoria desfaz cliente e acompanhantes juntos. Nenhuma conta de cliente ou
sessão de portal é criada por esse cadastro.

POST `/admin/trips` e PATCH `/admin/trips/:id` permitem ADMIN/AGENT cadastrar
e editar somente viagens DRAFT da própria empresa. Publicação é recusada;
editar viagem com reservas ou assentos atribuídos também é recusado. Datas,
preço, modelo, capacidade, andares, instalações e assentos bloqueados são
validados. GET `/admin/trips/bus-templates` libera somente o catálogo estático
de modelos após validação da sessão. Upload, atribuição e movimento de assentos,
embarque, cancelamento e conclusão continuam bloqueados para contas de empresa.
Gravação e auditoria são atômicas; o bloqueio de autorização transacional é
compartilhado com o cadastro de clientes. Não existe conta operacional ativa
criada pelo Criador nesta etapa.

POST `/admin/reservations` permite ADMIN/AGENT preparar uma reserva PENDING
de um passageiro em viagem futura DRAFT, somente com cliente e viagem da
mesma empresa. Verifica duplicidade, capacidade e assentos bloqueados, com
bloqueio dos pais e serialização transacional. Cria passageiro principal sem
copiar documento ou atribuir assento. Auditoria é atômica. Não gera código de
portal, pedido de compra, financeiro, documento ou mensagem. Confirmação
e qualquer movimentação financeira permanecem bloqueadas.

GET/PATCH `/admin/reservations/:id/passengers` isolam leitura e edição por
reserva, cliente e viagem da própria empresa. ADMIN edita nome, nascimento e
documento; documento é criptografado e não aparece na resposta. IDs externos,
duplicados e atribuição de assentos são recusados. Edição exige reserva PENDING
e viagem DRAFT, sem código de portal, financeiro, pedido, documentos, cotações,
serviços, pagamentos ou créditos.

POST `/admin/reservations/:id/cancel` permite ADMIN cancelar somente esse mesmo
tipo de reserva preparatória. Não gera bônus, estorno ou comunicação; mantém
passageiro e histórico. Alteração e auditoria são atômicas, com autorização
revalidada e bloqueio de viagem/reserva. Cancelamento operacional segue bloqueado.

GET `/platform/companies/:id/readiness`, exclusivo do Criador com MFA, informa
contagem de administradores e bloqueios. `activationAllowed` permanece false;
essa consulta não ativa empresa ou conta. Login do Criador incorpora o proxy
de autenticação no próprio domínio, como a correção de sessão da main.
Este registro pendente ainda não é uma compra ou reserva operacional entregue
ao cliente; é preparação em ambiente isolado.

GET `/admin/dashboard` usa métricas somente da empresa persistida na sessão.
Contagem de reservas exige cliente e viagem da mesma empresa; aniversariantes
limitam-se aos próprios clientes e não são retornados para FINANCE. As consultas
do painel compartilham um snapshot RepeatableRead, sem valores financeiros ou
documentos. Sessão sem empresa ou vínculo revogado não recorre ao painel legado.

O guard nega às contas de empresa todas as outras rotas administrativas
protegidas por ele, incluindo confirmação/cancelamento operacional de reservas, publicação de viagens e
financeiro. Consultar/revogar as próprias sessões e logout também permanecem
disponíveis. O marcador
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

## Preparação dos cinco primeiros itens pendentes

1. Hierarquia: estrutura e rotas do Criador nesta proposta; faltam convite
   expirante, ativação e aceite ponta a ponta.
2. Ativação: diagnóstico de bloqueios, sem atalho para ativar contas.
3. Isolamento: passageiros e cancelamento preparatório adicionados; portal,
   publicação, assentos, financeiro e integrações ainda impedem ativação.
4. Banco restrito: `backend/scripts/security/check-runtime.sql` consulta somente
   leitura, com a conexão da API: poderes administrativos, propriedade,
   memberships, privilégios, auditoria e migrations. Não provisiona papel nem
   concede permissões. Executar psql `-v ON_ERROR_STOP=1 -f` com conexão pelo
   canal seguro/ambiente, nunca senha em argumento. Doze tabelas com RLS não
   comprovam isolamento entre empresas; validar API/políticas com duas empresas.
5. Backup: `python3 scripts/backup-preflight.py` valida configuração offline,
   sem acessar banco/bucket nem iniciar subprocessos. Emite nomes de campos
   ausentes e nunca declara ponto de recuperação. Faltam destino privado,
   retenção, credenciais seguras e custódia de chave definidos pelo proprietário;
   depois executar backup real e restore isolado. A execução local sem variáveis
   confirma somente que esta estação não está configurada.

Esses preparativos não equivalem à ativação em produção. A correção de sessão
do PR39 está incorporada. Não publicar antes do isolamento completo e plano de
backfill/aceite revisado.

Limitações já conhecidas (Mercado Pago/e-mail não ativados e backup externo
pendente) não são resolvidas nem alteradas por esta mudança.
