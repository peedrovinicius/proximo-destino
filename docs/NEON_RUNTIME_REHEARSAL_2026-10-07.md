# Ensaio isolado de migrations e papel restrito — 2026-10-07

## Ambiente verificado

- Projeto Neon: `mute-mode-81774877` (`proximo-destino`), PostgreSQL 18.6.
- Produção: `br-green-frost-b5rcfrn1` (`production`).
- Cópia: `br-lucky-dawn-b5d1ehsg` (`validation-pr34-runtime-20261007`).
- [Branch do ensaio](https://console.neon.tech/app/projects/mute-mode-81774877/branches/br-lucky-dawn-b5d1ehsg).
- Branch criada em 2026-10-07T23:37:27Z a partir da produção, sem promover a cópia.
- Expiração automática: 2026-10-08T23:37:27Z (20:37:27 em Fortaleza).
- Compute limitado a 0,25 CU. O plano recusou alterar o intervalo de suspensão;
  o ensaio preservou a configuração permitida pelo provedor.
- Código de referência: `e67d09ab2d692d6aad552bf14cec677a198c0e2b`, PR #34.

## Aplicação das migrations

As 13 migrations posteriores a `202610032135_payment_platform_config` foram
aplicadas exclusivamente na cópia, em ordem e em transações separadas. Cada
transação incluiu os comandos originais de migration.sql e seu registro em
_prisma_migrations, com SHA-256 do arquivo original e conclusão da aplicação.
O conector SQL foi utilizado; o Prisma CLI não foi executado nesse banco.

Resultado observado: 40 migrations concluídas, nenhuma incompleta, estrutura
Company/CompanyMembership e funções de autorização por sessão presentes.
Há 16 tabelas com RLS, incluindo as 15 verificadas pelo gate e as sessões do
portal de clientes. Dados legados não foram atribuídos a empresas.

## Papel e gate

Papel `pd_validation_runtime_20261007` criado somente na cópia, com NOLOGIN,
NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION e NOINHERIT.
Não foi gerada senha. O proprietário pode assumir esse papel para o ensaio;
o papel restrito não recebe memberships nem ownership.

Grants mínimos do ensaio: USAGE no schema; SELECT em User/AuthSession/Company/
CompanyMembership; SELECT/INSERT/UPDATE em Client/Trip/Reservation; SELECT nas
tabelas derivadas necessárias às políticas; SELECT/INSERT em AuthAuditEvent.
Não recebeu UPDATE nas tabelas de identidade ou privilégios sobre migrations.
Não foram criadas políticas permissivas USING(true).

O bloco DO de scripts/security/assert-runtime.sql passou sob SET LOCAL ROLE,
confirmando poderes administrativos/ownership ausentes, privilégios protegidos
recusados, RLS e políticas por sessão presentes e ausência de políticas
constantemente permissivas nas tabelas sensíveis.

## Ensaio SQL A/B

Dentro de uma transação foram criados somente dados fictícios: Criador, dois
administradores, duas empresas, vínculos, sessões, clientes e viagens. Sob o
papel restrito, foram verificadas:

- ausência de linhas visíveis sem contexto;
- autorização e bloqueios de gravação válidos sem UPDATE em identidade;
- leitura exclusiva do próprio cliente e viagem em A e B;
- criação e leitura da reserva própria nas duas empresas;
- UPDATE em cliente externo com zero linhas afetadas;
- INSERT em empresa externa recusado por RLS;
- reserva com pais de empresas diferentes recusada;
- contexto de empresa forjado incompatível com sessão persistida recusado;
- sessão revogada recusada nas leituras e na autorização de gravação.

A transação foi encerrada com ROLLBACK. Consulta posterior confirmou zero
usuários, empresas, clientes ou reservas com o prefixo fictício do ensaio.

## Produção e limites

A consulta posterior à produção confirmou 27 migrations concluídas, ausência
da tabela Company e ausência do papel de validação. A conexão da API, flags,
serviços, credenciais e deploys não foram alterados.

Este resultado valida migrations e RLS no PostgreSQL real do Neon sob papel
efetivo restrito. Não é um login PostgreSQL com credencial independente nem
um teste HTTP da aplicação nessa branch. O papel NOLOGIN e os grants acima
não são uma configuração completa de runtime da API: login, sessões, Criador,
portal, integrações e rotas legadas ainda exigem desenho e ensaio dos seus
privilégios e políticas. Não trocar DATABASE_URL por esse papel.

O backup externo real, retenção independente, custódia de todas as chaves e
restauração de um objeto real continuam pendentes. A branch temporária não
substitui backup externo nem aprova publicação ou ativação de empresas.

## Executor HTTP independente preparado

scripts/neon-http-rehearsal.mjs prepara o ensaio com uma conexão PostgreSQL real.
Requer build do backend e NEON_HTTP_OWNER_URL da branch temporária, banco neondb,
papel neondb_owner, conexão direta e TLS. A URL deve ser fornecida apenas no
ambiente do terminal seguro, nunca em argumento de comando, Git ou chat.

O executor fixa o hostname confirmado dessa branch e sua expiração; nenhuma
flag aceita um hostname alternativo. Recusa produção, pooler, database operacional,
parâmetros de redirecionamento, TLS desabilitado, parâmetros duplicados ou branch
expirada. Depois de validar, cria um banco vazio validation_pr34_http_<aleatório>,
aplica migrations com Prisma e executa somente company-restricted-http.spec.js.
Esse teste cria um login independente, valida os fluxos HTTP A/B com Prisma sob
esse login e remove as fixtures e o papel. O executor descarta exclusivamente o
banco que acabou de criar; falha no descarte é informada e invalida o resultado.

Em máquina com acesso PostgreSQL ao Neon, dentro de backend:

```sh
npm install
npm run prisma:generate
npm run build
# Fornecer NEON_HTTP_OWNER_URL no ambiente por canal seguro antes desta linha.
node scripts/neon-http-rehearsal.mjs
```

O processo não herda segredos de provedores, chaves reais de PII ou flags de
backfill; usa segredos fictícios próprios e captura saída dos subprocessos sem
publicá-la. A execução remota está preparada, mas não foi concluída: em
2026-10-07 o ambiente de execução disponível não resolve o hostname PostgreSQL
da branch (gaierror). O conector SQL não oferece seleção de credencial/runtime.
Não foi criada senha ou login remoto desnecessário, nem aberto acesso de rede.
Os testes do guard local passaram; isso não comprova execução HTTP no Neon.

Para ensaio após a expiração, primeiro criar/verificar outra branch pelo conector
e revisar o hostname e prazo fixos no guard. Não apontar esse script à produção.
