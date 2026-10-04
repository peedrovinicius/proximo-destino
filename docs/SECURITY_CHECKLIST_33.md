# Auditoria das 33 verificações de segurança

Data: 2026-10-04. Base revisada: `995092f107b5b31ecd33cacd0293755ddf6ff10f`.

Esta matriz distingue evidência de código de comprovação operacional. “Código” significa controle encontrado por leitura estática, não aprovação integral de produção. “Parcial” significa cobertura incompleta ou validação operacional pendente. “Pendente” significa ausência de evidência suficiente. Nenhuma credencial ou conta real foi usada.

| Nº | Verificação | Estado | Evidência e limite |
| --- | --- | --- | --- |
| 1 | Chaves de API fora do frontend | Parcial | Clientes em frontend/src/lib chamam API; não há auditoria integral de histórico, assets e configuração neste bloco. |
| 2 | Ausência de credenciais no código cliente | Parcial | Refresh removido da resposta por AuthController; access token transitório necessário à sessão. Não confundir token da própria sessão com segredo de serviço. Revisão de bundle integral pendente. |
| 3 | Segredos em variáveis de ambiente | Código | ConfigService para JWT/AUDIT e ambiente em sensitive-data.ts; valores reais não consultados. |
| 4 | Escopo mínimo das chaves | Pendente | Precisa conferir escopos nas contas dos provedores pelo administrador. |
| 5 | Frontend sem acesso direto ao banco | Código | frontend/src/lib usa HTTP; Prisma somente no backend. |
| 6 | Dados pela API/backend | Código | adminApi, publicApi e clientPortal; excluir do critério imagens e links públicos externos. |
| 7 | Validação de acesso no servidor | Código | JwtAuthGuard verifica usuário ativo e sessão; RolesGuard e filtros do portal. Testes de produção autenticados pendentes. |
| 8 | Menor privilégio de usuários/serviços | Parcial | RBAC implementado; READINESS_CHECKLIST registra BYPASSRLS no usuário do banco. Não alterar esse papel sem ensaio isolado. |
| 9 | Minimização por usuário | Parcial | Escopo do portal e documentos presente; revisão campo a campo das respostas por função pendente. |
| 10 | Senhas fora de interfaces | Código | AuthController retorna usuário e token, sem passwordHash; não há comprovação de todas as respostas neste bloco. |
| 11 | Isolamento dos dados de clientes | Parcial | Testes de escopo no repositório, inclusive com PostgreSQL isolado; repetir com contas distintas em produção. |
| 12 | Criptografia em repouso | Parcial | AES-256-GCM e hash para documentos; chave PII permite fallback para chave de pagamentos/JWT, exigindo confirmar separação e custódia reais. |
| 13 | Validação de dados recebidos | Parcial | ValidationPipe com whitelist/forbidNonWhitelisted e DTOs; parâmetros de rota/query e todos os endpoints ainda requerem revisão. |
| 14 | Sanitização contextual | Parcial | Normalização de documentos/e-mail e regravação de fotos; sanitização deve ser específica ao destino, sem remover texto legítimo indiscriminadamente. |
| 15 | SQL Injection | Código | Prisma e consultas parametrizadas; ocorrência de queryRawUnsafe localizada é SELECT 1 constante em readiness. Revisar futuras consultas dinâmicas. |
| 16 | XSS | Parcial | Sem dangerouslySetInnerHTML encontrado em frontend/src; React escapa texto. CSP frontend restritiva de recursos ainda Report-Only segundo checklist; URLs e PDFs exigem revisão contextual. |
| 17 | Tamanho/formato | Parcial | DTOs com MaxLength/Max; upload limitado. Este bloco acrescenta teto de 2048 caracteres ao challengeToken MFA herdado nas três operações. Cobertura integral pendente. |
| 18 | Validação frontend/backend | Parcial | Backend autoritativo; confirmar equivalência dos formulários e casos negativos em todas as telas. |
| 19 | Autenticação no backend | Código | AuthService, JWT e MFA no servidor. |
| 20 | Frontend envia credenciais/exibe resultado | Código | adminAuth.ts chama API; não valida senha ou emite token localmente. |
| 21 | Permissões por requisição | Parcial | Guard verifica estado atual e sessão; matriz de todas as rotas e produção autenticada pendente. |
| 22 | Hash seguro das senhas | Código | Argon2 na autenticação e recuperação MFA; parâmetros de criação e todos os caminhos de troca devem ser conferidos. |
| 23 | MFA | Parcial | ADMIN exige configuração e desafio; ensaios com contas reais pendentes. |
| 24 | Eventos importantes | Código | AuditService e eventos operacionais nos serviços; retenção/totalidade pendentes. |
| 25 | Login falhado monitorado | Parcial | LOGIN_FAILED/LOGIN_LOCKED/LOGIN_BLOCKED registrados; entrega de alerta ainda não comprovada. |
| 26 | Atividades suspeitas registradas | Parcial | LOGIN_ROLE_DENIED e MFA_FAILED; ampliar evidência para negativas RBAC/portal e respostas 429. |
| 27 | Logs protegidos contra alteração | Pendente | AuthAuditEvent gravado no banco; não foi comprovada retenção imutável externa nem papel sem UPDATE/DELETE. Hash de identificadores não torna log imutável. |
| 28 | Alertas de anomalia | Pendente | Monitor de disponibilidade não comprova alertas de abuso/autenticação. Definir destino e testar entrega com evento fictício. |
| 29 | Rate limiting nas APIs | Parcial | SecurityModule registra ThrottlerGuard global (120/min), limites específicos no login/portal; armazenamento padrão em memória não é compartilhado entre réplicas/restarts. |
| 30 | Limite de login consecutivo | Parcial | Cinco falhas/15 min; incremento calculado a partir de leitura prévia pode perder tentativas concorrentes. Corrigir atomicamente e ensaiar em PostgreSQL. |
| 31 | Bloquear/desafiar suspeitos | Parcial | Bloqueio e MFA presentes; não há evidência de detecção adaptativa ou bloqueio distribuído por conta. |
| 32 | CAPTCHA quando necessário | Pendente de avaliação | Sem CAPTCHA localizado. Decisão depende de abuso observado e controles existentes; ausência isolada não significa falha obrigatória. |
| 33 | Endpoints críticos contra automação | Parcial | Throttle em login/MFA/portal e verificação de sessão; comprovar concorrência, múltiplos IPs e limites em ambiente isolado. |

## Ordem de correção

1. Limitar challengeToken MFA e verificar rejeição antes do serviço (alteração local neste bloco).
2. Tornar a contagem de login atômica, com teste concorrente em PostgreSQL e bloqueio por conta; não executar tentativa de ataque em produção.
3. Preparar papel de banco sem bypass, políticas compatíveis e retenção de auditoria em ambiente isolado antes de qualquer mudança operacional.
4. Definir retenção protegida, eventos de abuso e alertas; testar sem provocar indisponibilidade ou enviar mensagens a terceiros sem autorização.
5. Validar MFA e isolamento com contas autorizadas; ativação de pagamentos/e-mail e backup externo continuam dependentes do administrador.

Não há evidência para afirmar “33/33 aprovados” nem segurança absoluta. Alterações locais não significam publicação. A rotina de monitoramento somente leitura permanece separada deste trabalho de desenvolvimento.
