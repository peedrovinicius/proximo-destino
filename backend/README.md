# Próximo Destino API

Backend do sistema Próximo Destino.

## Stack

- NestJS
- PostgreSQL
- Prisma
- API versionada em `/api/v1`
- validação global de payloads
- CORS restrito por variável de ambiente
- configuração por `.env`

## Endpoint inicial

- `GET /api/v1/health`

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Suba o PostgreSQL com `docker compose up -d`.
3. Execute `npm install`.
4. Execute `npm run prisma:generate`.
5. Execute `npm run prisma:migrate`.
6. Execute `npm run start:dev`.

A API inicia em `http://localhost:3000/api/v1`.

## Segurança

Nunca versione credenciais, chaves privadas ou tokens. O arquivo `.env` permanece ignorado pelo Git.
