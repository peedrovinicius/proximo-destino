# Próximo Destino API

Backend do sistema Próximo Destino.

## Stack

- NestJS
- PostgreSQL
- Prisma
- API versionada em `/api/v1`
- autenticação administrativa com MFA
- RBAC
- sessões revogáveis
- rate limiting
- headers de segurança
- auditoria de autenticação
- request ID
- validação global de payloads
- CORS restrito por variável de ambiente
- configuração por `.env`

## Endpoints operacionais

- `GET /api/v1/health`: liveness da aplicação.
- `GET /api/v1/readiness`: confirma que a aplicação também consegue acessar o PostgreSQL.

## Produção

Domínio reservado para a API:

`https://proximo-destino-api-production.up.railway.app`

O Railway executa:

1. `npm install`
2. `npm run prisma:generate`
3. `npm run build`
4. `npm run prisma:deploy` antes de promover a nova versão
5. `npm run start:prod`

A aplicação só deve ser considerada pronta quando `/api/v1/readiness` retornar HTTP 200.

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Suba o PostgreSQL com `docker compose up -d`.
3. Execute `npm install`.
4. Execute `npm run prisma:generate`.
5. Execute `npm run prisma:migrate`.
6. Execute `npm run start:dev`.

A API inicia em `http://localhost:3000/api/v1`.

## Primeiro administrador

A criação é operacional, nunca automática nem com senha versionada:

```bash
ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run admin:create
```

A senha deve ter pelo menos 16 caracteres. O primeiro login do administrador exige configuração de MFA.

## Segurança

Nunca versione credenciais, chaves privadas ou tokens. O arquivo `.env` permanece ignorado pelo Git.
