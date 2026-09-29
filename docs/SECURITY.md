# Segurança

O Próximo Destino deve tratar segurança como requisito arquitetural, não como ajuste visual.

## Separação de superfícies

- Portal do cliente e painel administrativo usam sessões e permissões distintas.
- O cliente acessa somente recursos ligados ao próprio cadastro e às próprias viagens.
- Dados financeiros, comerciais, operacionais e de outros clientes nunca são enviados ao portal do viajante.
- O painel administrativo usa RBAC e menor privilégio por função.

## Autenticação

- Sessão baseada em cookie `HttpOnly`, `Secure` e `SameSite`.
- Tokens de autenticação não devem ser armazenados em `localStorage` ou `sessionStorage`.
- MFA obrigatório para administradores e recomendado para operadores financeiros.
- Rotação de sessão depois de autenticação, troca de senha e elevação de privilégio.
- Expiração por inatividade e revogação de dispositivos.
- Proteção contra credential stuffing, brute force e enumeração de contas.

## Dados

- Criptografia em trânsito com TLS.
- Criptografia de dados sensíveis em repouso.
- Campos altamente sensíveis podem usar criptografia em nível de aplicação com chaves externas ao banco.
- Logs nunca registram senha, token de sessão, cartão, CVV, documento completo ou payload sensível.
- Backups criptografados e testados periodicamente para restauração.

## Pagamentos

- Dados completos de cartão não passam pelo backend da aplicação quando o provedor suportar tokenização/hosted fields.
- CVV nunca é armazenado.
- Segredos do provedor ficam somente no backend/secret manager.
- Webhooks exigem validação de assinatura, timestamp, idempotência e prevenção de replay.
- Cada cobrança possui identificador interno imutável e trilha de auditoria.
- Conciliação não confia apenas no retorno do navegador do cliente.

## Autorização

- Toda consulta protegida deve filtrar pelo identificador do usuário/cliente autorizado no servidor.
- O frontend nunca é fonte de verdade para permissões.
- Ações financeiras e administrativas críticas exigem autorização explícita do backend.
- Operações sensíveis devem produzir evento de auditoria.

## Controles HTTP

- Content-Security-Policy restritiva.
- HSTS em produção.
- X-Content-Type-Options: nosniff.
- Referrer-Policy.
- Permissions-Policy.
- Proteção CSRF quando aplicável.
- CORS limitado às origens oficiais.
- Rate limiting por IP, conta e operação.

## Auditoria e fraude

Registrar, com retenção definida:

- login e logout;
- falhas de autenticação;
- MFA;
- alteração de senha;
- mudança de e-mail ou telefone;
- criação e edição de cliente;
- alteração de valores;
- criação, cancelamento e estorno de cobrança;
- emissão de voucher;
- exportação de dados;
- alteração de permissões;
- acesso administrativo a informações sensíveis.

Alertas devem considerar comportamento anômalo, como novo dispositivo, volume incomum de exportações, muitas falhas de login, alteração financeira fora do padrão e tentativas repetidas de pagamento.

## LGPD

- Coletar apenas o necessário.
- Definir finalidade e retenção por categoria de dado.
- Implementar exportação, correção e exclusão/anominização quando juridicamente aplicável.
- Separar consentimentos de marketing de dados necessários à execução da viagem.
