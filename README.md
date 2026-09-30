<div align="center">
  <img src="frontend/public/proximo-destino-logo-retina.jpg" alt="Próximo Destino" width="360">
</div>

# Próximo Destino

Plataforma web para operação de uma agência de viagens, com experiência pública para consulta de viagens, área administrativa, portal do viajante, cotações, financeiro e emissão de documentos em PDF.

## Produção

- Aplicação: https://proximo-destino-web-production.up.railway.app
- API: https://proximo-destino-api-production.up.railway.app
- Readiness: https://proximo-destino-api-production.up.railway.app/api/v1/readiness

## Principais recursos

- catálogo público de viagens com detalhes e solicitação de reserva;
- cadastro e gestão de clientes, acompanhantes, viagens e reservas;
- dashboard administrativo e busca global;
- cotações versionadas com itens, desconto, envio, aprovação e rejeição;
- serviços vinculados à reserva;
- plano financeiro com entrada, parcelas, vencimentos, status e forma de pagamento;
- portal do viajante com dados da reserva, orçamento, serviços e financeiro;
- emissão e acesso a passagem/voucher e comprovante em PDF;
- autenticação administrativa com JWT, refresh token, RBAC e MFA TOTP;
- códigos de recuperação de MFA;
- trilha de auditoria;
- rate limiting, headers de segurança, proteção de origem e request ID;
- exportação administrativa de dados pessoais e revisão de retenção;
- healthcheck, readiness e observabilidade estruturada;
- CI com PostgreSQL, migrations, build e smoke test.

## Arquitetura

```text
Browser
  |
  | HTTPS
  v
React + Vite
  |
  | REST /api/v1
  v
NestJS
  |
  +-- Auth / MFA / RBAC / Audit
  +-- Clients / Trips / Reservations
  +-- Commercial / Finance
  +-- Documents / Portal
  +-- Privacy / Observability
  |
  v
Prisma ORM
  |
  v
PostgreSQL (Neon)
```

O frontend e a API são publicados como serviços independentes no Railway. O banco PostgreSQL é hospedado no Neon. Detalhes adicionais estão em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

| Camada | Tecnologias |
| --- | --- |
| Frontend | React 19, TypeScript, Vite |
| Backend | NestJS 11, TypeScript |
| Banco | PostgreSQL, Prisma ORM |
| Autenticação | JWT, cookies HttpOnly, Argon2, MFA TOTP |
| PDFs | PDFKit |
| Infraestrutura | Railway, Neon |
| Qualidade | GitHub Actions, smoke test de readiness |

## Estrutura

```text
.
├── backend/
│   ├── prisma/
│   ├── scripts/
│   └── src/
├── frontend/
│   ├── public/
│   └── src/
├── docs/
└── .github/workflows/
```

## Execução local

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

A API fica disponível em `http://localhost:3000/api/v1`.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

O frontend de desenvolvimento usa `http://localhost:5173`.

## Primeiro administrador

A criação inicial do administrador é feita por script, usando credenciais de bootstrap definidas apenas no ambiente local ou de implantação.

```bash
cd backend
npm run admin:create
```

Depois da criação, a senha temporária de bootstrap deve ser removida do ambiente. Contas administrativas exigem MFA.

## Segurança e privacidade

O projeto inclui validação de payloads, limitação de requisições, headers HTTP de segurança, CORS restrito, proteção de origem, cookies seguros, hashing de senha com Argon2, MFA, auditoria e IDs de requisição.

As rotas administrativas de privacidade permitem exportar os dados associados a um cliente e revisar bloqueios operacionais antes de qualquer processo de anonimização. A política técnica está documentada em [docs/DATA_PROTECTION.md](docs/DATA_PROTECTION.md).

## CI

O workflow de integração contínua executa:

1. instalação das dependências;
2. geração do Prisma Client;
3. migrations em PostgreSQL 16;
4. build do backend;
5. inicialização da API e smoke test de readiness;
6. build do frontend.

Um commit só deve ser considerado pronto para implantação quando backend e frontend concluírem essas verificações.

## API operacional

- `GET /api/v1/health`
- `GET /api/v1/readiness`
- `GET /api/v1/system/release`

As demais rotas são organizadas por domínio e respeitam autenticação e autorização conforme o contexto.

## Versão

Versão atual: `0.5.0`
