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
