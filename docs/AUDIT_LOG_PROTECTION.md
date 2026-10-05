# Proteção de auditoria e alertas

## Alertas internos

O Admin recebe avisos persistentes no sino de notificações. Apenas ADMIN ativo
pode ler ou marcar alertas de segurança, inclusive após rebaixamento de papel.
Cada janela UTC fixa de dez minutos gera no máximo um alerta por administrador;
a janela anterior também é consultada para tolerar a virada do período/reinício
curto. Sincronização ocorre a cada minuto e ao abrir a lista. Após mais de vinte
minutos sem sincronização, este mecanismo não garante recuperar janelas antigas.

Gatilhos: um bloqueio de conta, dez falhas de login, oito falhas MFA ou cinco
negativas de perfil. A mensagem contém somente totais e horário, sem nomes,
credenciais, IPs, hashes ou metadados. O aviso leva à auditoria. A deduplicação usa
a restrição única existente de usuário/sourceKey; marcar como lido não é revertido
pelas sincronizações. Não são enviados e-mails, webhooks ou mensagens externas.

O primeiro aviso registra o estado do período ao atingir o limiar; novos eventos
na mesma janela não atualizam esse resumo. Consultar a auditoria para os totais
mais recentes. Isso não detecta toda forma de abuso nem substitui monitor externo.

## Proteção dos registros

O script backend/scripts/security/protect-audit.sql é um procedimento opt-in,
fora das migrations e do deploy. Exige papel runtime já preparado e distinto do
proprietário; recusa superuser, BYPASSRLS, papel proprietário/membro e privilégios
herdados que ainda permitam alteração. Em uma transação, mantém SELECT/INSERT e
retira UPDATE/DELETE/TRUNCATE de AuthAuditEvent. Qualquer falha faz rollback.

Não foi aplicado em produção. Antes de aplicá-lo, ensaiar permissões mínimas de
todas as tabelas, autenticação e relações em PostgreSQL isolado; revisar operações
que excluem usuários (FK ON DELETE SET NULL da auditoria exige atualização).
Preparar papel administrativo separado para retenção, sem expô-lo ao runtime.
Nunca remover BYPASSRLS do papel atual sem preparar as políticas de dados.

O procedimento não impede um proprietário/superuser de modificar registros.
Ainda é necessário definir retenção, exportação para destino externo protegido
contra alteração, custódia e alertas de falha de exportação. Hash de email/IP não
prova integridade dos logs. Somente ativação e ensaio reais encerram esse item.

## Aceite

### Ensaio do papel runtime

`backend/scripts/security/rehearse-runtime.sql` é exclusivamente um ensaio opt-in
fora das migrations. Exige um papel NOLOGIN novo, sem propriedade, memberships,
superuser, BYPASSRLS, criação de bancos/papéis ou replicação. Não cria credenciais.
Concede SELECT/INSERT/UPDATE nas tabelas explicitamente listadas, DELETE apenas
nas oito tabelas onde a API o usa hoje, e SELECT/INSERT na auditoria. Nega acesso
à tabela de migrations, DELETE de User (inclusive para evitar alterar a auditoria
pela FK), CREATE no schema e TRUNCATE/TRIGGER/REFERENCES. Concessões via PUBLIC que
excedam essas verificações fazem rollback. Tabelas novas exigem revisão explícita.

Cria políticas RLS apenas para esse papel nas doze tabelas já protegidas, mantendo
RLS ativado e as políticas atuais. Essas políticas autorizam a API confiável a
trabalhar com as linhas; não isolam clientes/empresas dentro da conexão. Os guards
e filtros da API continuam indispensáveis. O ensaio não é uma implantação de
isolamento multiempresa. Referência: https://www.postgresql.org/docs/current/ddl-rowsecurity.html.

O CI usa banco local descartável, papéis aleatórios e transações revertidas para
testar clientes/auditoria, bloqueio de outro papel, DDL, privilégios e recusa de
papéis inadequados. O script não é idempotente: reaplicação das mesmas políticas
falha e reverte. A limpeza do teste remove políticas/papéis criados.

O teste `runtime-operational-flow.spec.ts` abre uma conexão Prisma com LOGIN e
senha aleatórios exclusivos do PostgreSQL local descartável. Confere current_user
e session_user e usa os serviços reais, sem mocks: matrícula MFA/TOTP, código de
recuperação usado uma vez, refresh/logout, reserva/troca/colisão/cancelamento de
assentos, cotação/aprovação, parcelas, recebimento e estorno. O proprietário só
prepara o papel e limpa os dados no final. As operações da aplicação usam a conexão
restrita, incluindo transações e auditoria.

O mesmo teste também inicia `dist/main.js` em processo separado com apenas a URL
runtime, porta local e segredos sintéticos. Por HTTP, verifica readiness e o
diagnóstico de privilégios, MFA, refresh em cookie HttpOnly/SameSite=Strict sem
refreshToken no JSON, acesso anônimo e token de cliente recusados no Admin,
origem inválida, campo inesperado, reserva/login do cliente, troca de assento,
recebimento/estorno e revogação no logout. Não cobre navegador, cookies Secure em
HTTPS de produção, todos os módulos/integradores ou concorrência entre processos.

`npm run prisma:deploy:isolated` exige MIGRATION_DATABASE_URL explícita e passa
essa conexão somente ao subprocesso Prisma; nunca usa DATABASE_URL como fallback.
O ensaio executa migrations com essa conexão administrativa enquanto DATABASE_URL
aponta ao papel restrito, e recusa execução sem a URL administrativa. O comando
existente `prisma:deploy` e o predeploy atual permanecem como estão. A URL de
migrations não deve ser disponibilizada no ambiente do processo API.

**Não aplicado em produção.** Ainda faltam revisão de privilégios públicos/defaults,
provisionamento seguro e separação efetiva da execução de migrations e
plano de troca/retorno. Só depois preparar LOGIN/credenciais por canal seguro e
considerar a mudança da conexão runtime. Não alterar o papel proprietário atual.

Na inicialização, a API consulta os privilégios efetivos da conexão e registra
DATABASE_SECURITY_CHECK: somente booleanos sobre superuser, BYPASSRLS, vínculo
ao proprietário e SELECT/INSERT/UPDATE/DELETE/TRUNCATE da auditoria. Não registra
credenciais, nomes de papéis ou dados de usuários. restrictedAuditWriter só é
verdadeiro com leitura/inserção e sem esses poderes administrativos ou de edição.
Uma falha emite DATABASE_SECURITY_CHECK_UNAVAILABLE sem detalhes do erro e não
impede a inicialização. O diagnóstico não altera permissões nem comprova políticas
RLS, isolamento de linhas ou retenção externa. O teste PostgreSQL confirma que ele
reconhece o proprietário, o escritor restrito e uma concessão posterior de UPDATE.

Testes de limiares e de PostgreSQL isolado devem comprovar persistência,
deduplicação concorrente, ausência de dados sensíveis, isolamento por usuário e
revogação de acesso após rebaixamento. O CI não comprova recebimento pelo usuário
real; esse aceite requer abrir as notificações com uma sessão ADMIN autorizada.
