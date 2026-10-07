# Três níveis — etapa de cadastro de empresas

## Disponível nesta mudança (não publicado em produção)

- `CREATOR` é um perfil distinto de `ADMIN`. Não foi incluído nas listas de
  acesso a viagens, reservas, financeiro, integrações ou privacidade da empresa.
- Login separado `/auth/creator/login`, MFA obrigatório, bloqueio por tentativas
  reaproveitado e sessão validada no servidor. Não há auto-cadastro do Criador.
- Cadastro e edição de empresas e provisionamento de ADMIN pendente revalidam o
  Criador e a sessão MFA dentro da transação, mantendo os bloqueios até o commit.
  Revogação, expiração, desativação ou mudança de papel/MFA negam a gravação.
  Auditoria e alteração são atômicas, sem nomes, e-mails ou senhas no evento;
  falha de auditoria desfaz empresa, conta e vínculo. Isso não ativa empresas.
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
de modelos após validação da sessão.
GET `/admin/trips/:id` disponibiliza detalhe da própria empresa para ADMIN/AGENT;
lista e detalhe mantêm capacidade, modelo, andares, instalações, layout e assentos
bloqueados, sem imagem binária, identificadores internos de posse ou passageiros.
IDs externos ou inexistentes retornam 404. A nova consulta exige sessão de empresa.
ADMIN pode consultar GET `/admin/trips/:id/seats` somente em viagem DRAFT da própria
empresa com atribuições preparatórias válidas. O mapa contém configuração, bloqueios,
disponibilidade e os nomes mínimos das reservas da própria empresa. PATCH `/admin/trips/:id/seats/:seatNumber` bloqueia
ou libera assento somente em rascunho sem reservas nem atribuições, com autorização
e viagem bloqueadas na transação. Concorrência preserva ambos os bloqueios; falha de
auditoria desfaz a alteração. Este mapa preparatório não habilita escolha/atribuição
operacional de assentos ou publicação.
Upload, atribuição e movimento operacionais de assentos, embarque, cancelamento e conclusão
continuam bloqueados para contas de empresa.
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
duplicados e edição de passageiros com assentos atribuídos são recusados. Edição exige reserva PENDING
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
- Concluir ativação somente após todos os
  testes de isolamento ponta a ponta passarem, inclusive dois clientes e duas
  empresas reais em banco isolado.

## Reversão segura desta etapa

Manter/desabilitar `COMPANY_FOUNDATION_ENABLED` e retornar a versão anterior da
aplicação. Preservar as novas tabelas e rascunhos; não apagar dados ou tentar
remover o valor de enum do PostgreSQL durante uma reversão operacional.

## Preparação dos cinco primeiros itens pendentes

1. Hierarquia: estrutura e rotas do Criador nesta proposta; convite expirante para definição de senha incluído; MFA do ADMIN pendente incluído; faltam ativação e aceite ponta a ponta.
2. Ativação: diagnóstico de bloqueios, sem atalho para ativar contas.
3. Isolamento: passageiros, cancelamento e assentos preparatórios adicionados; portal,
   publicação, assentos operacionais, financeiro e integrações ainda impedem ativação.
4. Banco restrito: `backend/scripts/security/check-runtime.sql` consulta somente
   leitura, com a conexão da API: poderes administrativos, propriedade,
   memberships, privilégios, auditoria e migrations. Não provisiona papel nem
   concede permissões. Executar psql `-v ON_ERROR_STOP=1 -f` com conexão pelo
   canal seguro/ambiente, nunca senha em argumento. Doze tabelas com RLS não
   comprovam isolamento entre empresas; validar API/políticas com duas empresas.
**Contexto transacional derivado da sessão (preparado, não publicado):**
`company-db-context.ts` instala `app.company_id`, `app.user_id` e
`app.session_id` com `set_config(..., true)`, portanto os valores existem
somente dentro da transação. O contexto é instalado por `lockCompanyRead` e
`lockCompanyWrite` **depois** de revalidar, no PostgreSQL, a sessão persistida,
usuário ativo, empresa ACTIVE, vínculo ativo e papel compatível. Valores de
body/query/header não são aceitos como origem desse contexto.

As leituras administrativas centrais de clientes, viagens, reservas, dashboard,
pesquisa, mapa preparatório e passageiros agora executam dentro de transação
com essa revalidação. Os fluxos de escrita que já passam por
`lockCompanyWrite` recebem o mesmo contexto automaticamente. Testes específicos
confirmam que uma combinação forjada de empresa/sessão é recusada antes de
instalar o contexto e que os valores desaparecem ao final da transação.

Esse GUC é **defesa em profundidade e preparação para RLS**, não uma credencial:
qualquer role SQL com liberdade para executar `set_config` poderia tentar
definir esses valores. Portanto, não criar política de produção que confie
somente em `app.company_id`. A liberação continua exigindo role runtime
restrita, políticas revisadas que validem a sessão/vínculo persistidos e testes
negativos com duas empresas usando as credenciais efetivas da API.

**RLS da tabela de viagens (preparado, não publicado):** a migração
`202610070300_trip_rls_default_deny` habilita RLS para `Trip` e instala
uma política `USING(false)/WITH CHECK(false)` para usuários sem bypass de
proprietário, seguindo a estratégia fail-closed já usada nas outras tabelas.
A alteração não ativa empresas, não modifica viagens existentes e preserva o
acesso legado do proprietário da tabela. O gate `assert-runtime.sql` exige
RLS também em `Trip`; a ausência de RLS ou políticas universais de ensaio
fazem o gate falhar.

O teste `tenant-rls-isolation.spec.ts` utiliza duas empresas e um LOGIN
PostgreSQL temporário com políticas A/B **exclusivamente sintéticas** para
`Client`, `Trip` e `Reservation`, conferindo negação de leitura e escrita
entre empresas. A política temporária usa `app.company_id` apenas no ensaio;
essa variável seria controlável por qualquer conexão direta ao banco e
**não constitui autorização segura na produção**. Falta concluir conexão
runtime restrita, política de tenant revisada com origem de sessão confiável
e testes HTTP ponta a ponta com dois tenants antes de ativar operações reais.
Nenhuma política permissiva de ensaio pode ser implantada em produção.

**Gate de segurança do runtime (novo, não executado em produção):** depois de
configurar um papel de API realmente restrito em banco isolado, rodar
`psql -X -v ON_ERROR_STOP=1 -f backend/scripts/security/assert-runtime.sql`
a partir da raiz do repositório (ou `scripts/security/assert-runtime.sql`
a partir de `backend/`). A conexão precisa usar as mesmas credenciais e o mesmo
papel **efetivo** da API. O script é somente leitura e falha em privilégios
administrativos, ownership/DDL, escrita da auditoria, acesso a migrations, RLS
ausente ou políticas universais `USING(true)`/`WITH CHECK(true)` aplicáveis
ao runtime/PUBLIC. O teste de ensaio propositalmente usa uma política permissiva,
que **deve falhar** neste gate. Uma aprovação não demonstra, por si só, o
isolamento tenant: é indispensável validar leitura e gravação com empresas A/B
e políticas RLS específicas; acompanhar em [issue #44](https://github.com/peedrovinicius/proximo-destino/issues/44).

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

## Assentos de reservas preparatórias

GET `/admin/payments/orders` permite ADMIN/FINANCE consultar somente um resumo
dos pedidos online e recebimentos manuais da própria empresa, com reserva, cliente e viagem no mesmo
escopo. A agregação inclui todos os pedidos, sem o corte de 200 itens da lista
legada; valores negativos ou estornos acima do total recusam a resposta.
Recebimentos manuais exigem plano, parcela e cotação compatíveis com a própria
reserva quando esses vínculos existem; valores negativos ou vínculos incoerentes
recusam a consulta inteira, em vez de omitir silenciosamente um recebimento.
Autorização é revalidada na transação e mantida por SELECT locks, sem gravação
ou acesso ao provedor. A resposta marca summaryOnly e coverage ONLINE_AND_MANUAL_PAYMENTS;
não inclui contatos, IDs de pedidos, identificadores do provedor ou notas.
Totais incluem recebimentos e reversões manuais, sem o corte de 200 registros.
Saldos de crédito e parcelas em aberto não estão incluídos, e a interface informa isso.
Se uma atualização falhar, a tela identifica os números mantidos como o último
resumo carregado, não atualizado; o aviso desaparece após uma consulta bem-sucedida.
Detalhes, lançamentos, conciliação e estornos permanecem bloqueados para empresas.

GET `/admin/trips/:id/audit` permite somente ADMIN consultar criação/configuração
de viagem DRAFT própria e atribuição/movimento/liberação de assentos preparatórios.
Exige companyId e tripId no evento e uma lista explícita de tipos permitidos;
recusa viagem externa, operacional ou autorização revogada. A consulta revalida
e mantém autorização por bloqueios SELECT até terminar, sem gravar eventos.
Retorna até 100 eventos com ordenação estável e hasMore explícito; projeta apenas
números válidos de poltrona, sem contatos, operador, IDs internos ou metadados livres.
Não equivale a histórico completo de reservas, pagamentos ou embarques.

ADMIN pode atribuir a poltrona do passageiro principal de reserva PENDING existente,
de um passageiro, na própria empresa e em viagem DRAFT futura. POST na rota de
assignment aceita somente clientId; não cria cliente/reserva automaticamente.
PATCH move para poltrona livre e não bloqueada. DELETE libera apenas a atribuição
preparatória, preservando reserva e passageiro. A interface distingue este mapa,
oculta cadastro implícito e permite liberar a poltrona preparatória.

Autorização, viagem, cliente, reserva e passageiro são bloqueados na transação.
Compra, portal, financeiro, documentos, serviços e créditos impedem a alteração.
Concorrência não sobrepõe ocupantes; alteração e auditoria são atômicas. O mapa usa
snapshot RepeatableRead, omite documentos e contatos e recusa vínculos inconsistentes.
Não habilita publicação, compra, embarque nem alocação em viagens operacionais.
É preciso liberar a atribuição antes de editar passageiros ou cancelar essa reserva.

## Convite para definir senha do ADMIN pendente

O Criador autenticado com MFA gera ou revoga o código no painel de administradores.
POST `/platform/companies/:id/admins/:membershipId/invitation` emite 32 bytes aleatórios,
exibidos uma vez, válidos por 24 horas. O banco guarda apenas SHA-256 e validade.
Reemissão invalida o anterior; revogação limpa o hash. Empresa deve ser DRAFT, conta
ADMIN gerenciada e inativa, vínculo ADMIN inativo e convite ainda não consumido.

O destinatário abre `?screen=company-invite` e envia código e senha no corpo do
POST `/company-invitations/accept`, nunca em URL ou armazenamento do navegador.
O endpoint exige a flag da fundação, valida entrada e limita tentativas. Consumo,
senha Argon2id e auditoria são atômicos; bloqueios impedem consumo duplo. Respostas
não permitem cache. Auditoria omite código, hash, senha e dados pessoais.

Não envia e-mail, cria sessão, ativa empresa/usuário/vínculo ou promove contas existentes. O acesso permanece bloqueado. O Criador entrega o código por
canal privado; definição de senha não conclui o onboarding ou o checklist de ativação.

## MFA do administrador pendente (sem acesso operacional)

Aceitar o convite gera um código opaco separado para preparar MFA, válido por 15 minutos;
apenas SHA-256 fica no vínculo. Não é JWT, sessão ou cookie de login. O código é enviado
no corpo de `/company-invitations/mfa/setup` e `/company-invitations/mfa/confirm`.
MFA exige empresa DRAFT, conta/vínculo ADMIN inativos, senha definida pelo convite,
conta gerenciada e MFA ainda não configurado. Estado, papel, validade e bloqueio de senha
são revalidados com bloqueios no PostgreSQL até o commit.

QR code e chave manual são exibidos apenas durante configuração. Cinco códigos errados
invalidam a preparação e limpam o segredo pendente. Confirmação única grava segredo AES-GCM,
MFA habilitado e dez hashes Argon2 de recuperação, limpa o código temporário e audita tudo
atomicamente. Conta, vínculo e empresa continuam inativos/DRAFT; nenhuma sessão é criada.
Códigos de recuperação são exibidos uma vez, apenas em memória, com controle para ocultar.

Se a página for fechada ou a preparação expirar, `/company-invitations/resume` permite
retomar usando e-mail e a senha definida, somente antes de concluir MFA. Invalida a
preparação anterior; cinco erros de senha bloqueiam a conta por 15 minutos, com contador
serializado e auditoria sem dados pessoais. O Criador pode revogar a preparação pendente.
Endpoints exigem a flag, limitam tentativas e enviam Cache-Control no-store. Segredos não
entram em URLs, storage ou auditoria. MFA legado de contas ativas permanece separado.

## Catálogo público por empresa (API somente leitura)

GET `/public/companies/:slug/trips`, `/:id` e `/:id/seats` exigem a flag estritamente
habilitada, empresa ACTIVE e viagem da mesma empresa ACTIVE/SCHEDULED e futura.
Respostas usam Cache-Control no-store e snapshot RepeatableRead, mantendo o estado
da empresa por bloqueio SELECT. Não ativam empresas ou viagens e não gravam eventos.
O catálogo aceita origem, destino e data UTC válida; retorna até 100 viagens,
ordenação estável e hasMore explícito. Empresa expõe somente slug e nome comercial.
Disponibilidade expõe números e configuração pública do veículo, nunca ocupantes,
contatos ou IDs de reservas. Vínculos incoerentes de ocupação resultam em 409.

As rotas públicas legadas de catálogo, detalhe, imagem e assentos agora atendem
somente viagens sem companyId. A solicitação anônima legada de reserva também
recusa viagens de empresa, inclusive na revalidação antes da gravação.
Não equivale à conclusão do isolamento de todo o portal ou das compras.
A interface `?screen=company&company=<slug>` consulta essas APIs sem cookies,
cache ou fallback global. Cards abrem detalhes por `&trip=<id>`, preservando
empresa em links, recarregamento e navegação pelo histórico. Filtros de origem,
destino e data UTC são enviados ao servidor; hasMore orienta a refinar a consulta.
Poltronas são uma lista de disponibilidade somente leitura, não uma seleção ou
garantia de reserva. Falha de atualização remove valores anteriores; falha no
mapa não inventa disponibilidade. Empresa indisponível não mostra viagens globais.
A tela não solicita dados pessoais nem chama pagamentos, portal ou gravações.
Não usa identidade/contatos/marca da agência legada como se fossem da empresa.
Imagem binária por empresa, compra, portal do cliente, ativação e validação
operacional continuam pendentes. Esta interface permanece fora de produção.

## Pré-requisito de reservas e portal: impedir reutilização legada

A solicitação anônima legada bloqueia a linha do cliente encontrado por e-mail
antes de conferir seu companyId e atualizar dados. Cliente vinculado a empresa
é recusado com mensagem genérica, sem alterar nome/telefone ou criar reserva,
assento ou compra. O upsert exige companyId null; a unicidade global do e-mail
permanece, não foi afrouxada para habilitar reservas de empresas.

Login legado por e-mail/código consulta somente reserva, cliente e viagem sem
empresa. O guard de todas as rotas do portal legado verifica esses três vínculos
no banco em cada requisição; um JWT assinado com IDs de empresa ou cliente/reserva
incompatíveis é recusado. Não transforma token legado em sessão de empresa.
Esses bloqueios não implementam o novo portal nem sua autorização transacional.
Reserva pública por empresa ainda exige identidade verificada, unicidade de
contato por escopo, proteção contra abuso e gravações/auditoria atômicas, além
dos gates operacionais. Nenhuma reserva por empresa foi habilitada nesta etapa.

## Portal do cliente por empresa: API de consulta

As rotas `/public/companies/:slug/client/login`, `/portal` e `/logout` exigem
COMPANY_FOUNDATION_ENABLED=true e COMPANY_CLIENT_PORTAL_ENABLED=true exatamente.
A segunda flag fica desabilitada por padrão. Login recebe reservationId, e-mail
e código da reserva no corpo, com DTO fechado; não aceita companyId ou clientId.
Exige empresa ACTIVE, cliente/viagem/reserva próprios e código com validade futura; recusa
reserva CANCELLED e viagem DRAFT/CANCELLED. Não gera códigos, reservas ou clientes.

Sessão opaca de 32 bytes aleatórios vale 30 minutos. Banco guarda apenas SHA-256,
empresa/cliente/reserva e versão derivada do hash do código; não é JWT legado.
Novo login revoga sessões anteriores dessa reserva. Logout persistido invalida
o token. Cinco falhas serializadas por reserva bloqueiam por 15 minutos, mesmo
entre IPs. Falhas, login e logout são auditados sem códigos, tokens ou contatos;
falha de auditoria reverte contadores, emissão e revogação na mesma transação.
Throttle por IP complementa o bloqueio persistido. Respostas usam no-store.

Cada leitura mantém bloqueios da empresa, reserva, cliente, viagem e sessão
até terminar e revalida status, vínculos, validade, revogação e versão do código.
O token vai somente em Authorization Bearer. Retorna nome comercial/slug,
status/quantidade da própria reserva, descrição/datas da viagem e números das
poltronas. Não retorna nomes/documentos/contatos de passageiros, financeiro,
IDs internos, hashes ou outros dados da empresa. Não permite alterar assentos,
passageiros, cancelamento, documentos ou pagamentos. Sessões legadas não servem
nesse portal, e seus tokens não servem nas rotas legadas.

Migration aditiva cria CompanyClientPortalSession com RLS e política PUBLIC
deny-all, além dos contadores na reserva. Não foi aplicada em produção. O papel
restrito efetivo precisa de concessões/política revisadas para esta tabela antes
da ativação; não concede privilégios automaticamente. A API administrativa de
provisionamento está implementada abaixo; interface administrativa de entrega e
reserva pública com identidade verificada continuam pendentes.
O e-mail informado e o código não equivalem à verificação
da posse da caixa de e-mail para um cadastro público novo.

## Interface do portal por empresa

`?screen=company-client&company=<slug>` apresenta login com identificador da
reserva, e-mail e código. O catálogo oferece "Acessar minha reserva" preservando
empresa. Código é enviado no corpo e limpo ao enviar; token só em memória e no
header Authorization, sem URL, localStorage ou sessionStorage. Recarregar ou sair
da tela exige novo login, informado na interface. Não há restauração de sessão
do cliente neste bloco; a sessão administrativa existente não foi alterada.

Consulta mostra apenas a projeção autorizada da própria reserva. Atualização
remove dados anteriores; erro transitório permite repetir a consulta. 401/404
ou expiração local removem token e dados. Logout espera revogação confirmada;
falha transitória mantém somente a capacidade de tentar sair/atualizar novamente
e informa que a saída não foi confirmada. Sucesso limpa os campos. AbortController
impede respostas antigas após saída da tela; botões impedem ações simultâneas.
Não há alteração de poltronas, passageiros, pagamentos ou cancelamento.
Interface segue fora de produção e a API conserva as duas flags obrigatórias.

## Emissão e revogação de código por administrador da empresa

`POST /admin/reservations/:id/company-portal-code` exige sessão administrativa
persistida, perfil ADMIN atual, associação e empresa ACTIVE, as duas flags do
portal e corpo fechado `{ "confirmedPrivateDelivery": true }`. Não aceita
companyId, código escolhido nem contato alternativo. Recusa sessões legadas,
FINANCE/AGENT, vínculos externos, reserva cancelada, viagem DRAFT/CANCELLED ou
cliente sem e-mail. Não publica viagem nem confirma/cria reserva.

Gera 24 bytes aleatórios (48 caracteres hexadecimais) e armazena somente Argon2.
Retorna código, reservationId, expiresAt e delivery=MANUAL_PRIVATE uma única vez,
com no-store. Validade é de 24 horas; login e sessões existentes recusam código
expirado. A migration aditiva deixa códigos antigos de empresas sem validade:
devem ser reemitidos antes de acessar. Acesso legado permanece inalterado.

Reemissão revoga todas as sessões anteriores e zera o bloqueio por falhas.
`POST /admin/reservations/:id/company-portal-code/revoke` remove hash/validade e
revoga sessões, inclusive para reserva cancelada própria. Autorização, vínculos,
mutação e auditoria são mantidos na mesma transação; falha de auditoria preserva
o código e as sessões anteriores. Auditoria contém somente IDs, sem códigos,
hashes, tokens ou contatos. Não há endpoint para recuperar o código original.

Não envia mensagens nem verifica posse do e-mail. Antes da entrega manual,
o operador deve verificar o destinatário por canal privado; a confirmação no
corpo registra intenção, não comprova identidade ou recebimento. Se a resposta
de emissão se perder, reemitir invalida o código anterior. Interface para essa
entrega, ativação controlada e concessões do papel de banco seguem pendentes;
nenhuma migration, flag ou serviço foi alterado em produção.

## Cadastro guiado e alteração da própria senha

O Criador segue três etapas: empresa, administrador e convite. Salvar uma nova
empresa abre imediatamente o formulário do administrador com nome/e-mail do
responsável para revisão; edição de rascunho não cria outro administrador.
Empresa e administrador são salvos separadamente. Falha no segundo cadastro
preserva a empresa; tentar novamente não repete a criação da empresa. Continuar
depois mantém o cadastro salvo e pode ser retomado pelo botão Administradores.
Após cadastrar o administrador, a tela orienta gerar e entregar o convite por
canal privado; não gera/envia automaticamente nem ativa conta/empresa.

Criador e funcionários autenticados têm Alterar minha senha. A rota própria
`POST /auth/password/change` aceita somente currentPassword/newPassword, exige
Bearer e sessão persistida própria vigente, usuário ativo e senha atual. Recusa
CLIENT, senha nova igual à atual e nova senha fora de 16–128 caracteres. Cinco
erros da senha atual persistem bloqueio de 15 minutos por usuário; throttle por
IP complementa. Alteração de hash Argon2, incremento de authVersion, revogação
de todas as sessões e auditoria são atômicos. Falha de auditoria reverte também
contadores e revogações. Eventos não contêm senhas ou hashes. MFA é preservado.

Access, refresh e desafios MFA novos carregam authVersion. Tokens antigos sem
versão são compatíveis somente com versão zero; após trocar a senha, eles e
desafios anteriores são inválidos, inclusive para sessão criada tardiamente por
login em andamento. A resposta apaga o cookie de refresh; UI limpa os campos,
confirma o encerramento das sessões e oferece entrar novamente. Senhas não
entram em estado React, URL, storage ou notificações. Cancelar não altera senha.
Migration aditiva e telas permanecem somente no PR, fora de produção.
