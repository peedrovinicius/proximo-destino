# Arquitetura

## Visão geral

O Próximo Destino segue uma arquitetura web em três camadas, com frontend React, API NestJS e PostgreSQL. Frontend e backend são implantados separadamente e se comunicam exclusivamente pela API versionada em `/api/v1`.

## Domínios

### Autenticação e segurança

Responsável por login administrativo, sessões, refresh token, MFA TOTP, códigos de recuperação, RBAC, rate limiting, auditoria e proteção HTTP.

### Clientes e viagens

Centraliza clientes, acompanhantes, viagens, reservas, status operacionais e busca administrativa.

### Comercial e financeiro

Mantém cotações versionadas, itens, aprovação pelo viajante, serviços contratados, planos financeiros e parcelas.

### Documentos

Gera passagem/voucher e comprovante em PDF. Os documentos ficam associados à reserva e podem ser acessados tanto pela administração quanto pelo portal do viajante conforme autorização.

### Portal do viajante

Oferece uma visão restrita ao cliente sobre sua reserva, cotação, serviços, situação financeira e documentos emitidos.

### Privacidade

Fornece exportação estruturada dos dados de um cliente e um relatório de retenção que identifica vínculos operacionais ativos antes de uma eventual revisão de anonimização.

## Fluxo de requisição

1. O navegador acessa o frontend publicado.
2. O frontend consome a API via HTTPS.
3. A API atribui um `X-Request-ID` à requisição.
4. Middleware de segurança aplica headers, CORS e proteção de origem.
5. Guards executam autenticação, autorização e throttling quando aplicável.
6. Controllers validam o contrato de entrada.
7. Services executam regras de negócio.
8. Prisma acessa o PostgreSQL.
9. O log estruturado registra método, caminho, status, duração e request ID, sem registrar corpo ou credenciais.

## Persistência

O Prisma é a camada de acesso a dados. Alterações de schema são versionadas em migrations e aplicadas em produção por `prisma migrate deploy` antes da inicialização da nova versão.

## Disponibilidade

A rota `/api/v1/health` informa a disponibilidade do processo. A rota `/api/v1/readiness` também testa a conectividade com o banco e é usada como healthcheck de implantação.

## Implantação

- frontend: Railway;
- backend: Railway;
- PostgreSQL: Neon;
- código: GitHub;
- CI: GitHub Actions.

O Railway só promove uma nova instância da API após o healthcheck de readiness responder com sucesso.

## Decisões de segurança

- senhas armazenadas apenas como hash Argon2;
- refresh tokens controlados por sessão;
- MFA obrigatório para administradores;
- códigos de recuperação armazenados como hash;
- segredos de MFA criptografados;
- cookies de autenticação configurados para uso seguro;
- headers de segurança e CORS explícito;
- validação global de DTOs;
- auditoria de operações sensíveis;
- exportação de privacidade restrita a ADMIN;
- logs de acesso sem payloads ou segredos.
