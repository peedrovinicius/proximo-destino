# Próximo Destino

Sistema web para operação de agência de turismo, cobrindo a jornada desde a descoberta pública da viagem até cotação, aprovação, reserva, serviços, financeiro, emissão de documentos e acompanhamento pelo viajante.

## Estado atual

A aplicação está implantada em produção com frontend e API separados, PostgreSQL persistente e controles de autenticação administrativa.

- Site: https://proximo-destino-web-production.up.railway.app
- API: https://proximo-destino-api-production.up.railway.app
- Health: `GET /api/v1/health`
- Readiness: `GET /api/v1/readiness`

O catálogo público exibe somente viagens com status `ACTIVE` ou `SCHEDULED`. Dados operacionais, comerciais e financeiros ficam fora da superfície pública.

## Fluxo operacional

```text
Catálogo público
    |
Solicitação de reserva
    |
Cliente + reserva pendente
    |
Cotação versionada
    |
Aprovação do viajante
    |
Reserva confirmada
    |
Serviços contratados
    |
Plano financeiro
    |
Passagem / voucher + comprovante
    |
Viagem e acompanhamento
```

Cotações enviadas são imutáveis. Mudanças comerciais exigem uma nova revisão. A aprovação preserva os valores aceitos e converte os itens aprovados em serviços da reserva.

## Módulos

### Área pública

- busca por origem, destino e data;
- catálogo conectado ao PostgreSQL;
- página de detalhes da viagem;
- solicitação de reserva;
- criação ou reaproveitamento do cliente por e-mail;
- código individual de acesso ao portal.

### Portal do viajante

- autenticação por e-mail e código da reserva;
- sessão temporária;
- dados da própria reserva;
- cotação enviada pela agência;
- aprovação ou solicitação de revisão;
- serviços contratados;
- plano financeiro e parcelas;
- passagem/voucher e comprovante de compra em PDF.

### Administração

- autenticação com senha e MFA;
- dashboard operacional;
- clientes e acompanhantes;
- viagens;
- reservas;
- busca global;
- Construtor de Viagem;
- cotações e revisões;
- serviços;
- financeiro e parcelas;
- emissão de documentos;
- exportação e análise de retenção de dados;
- verificação de integridade operacional.

## Construtor de Viagem

Uma cotação pode combinar:

- passagem;
- hospedagem;
- transfer;
- passeio;
- seguro;
- outros serviços.

Cada item registra quantidade, fornecedor, custo e preço de venda. A API calcula subtotal, desconto, preço final e margem. O navegador não é a fonte de verdade financeira.

## Documentos

O sistema gera dois documentos versionados e imutáveis.

### Passagem / voucher de viagem

Pode registrar companhia ou fornecedor, número do voo, localizador, assento, bagagem, locais de embarque e chegada, horários, terminais e serviços da reserva.

O documento é um voucher emitido pela agência. Quando houver transporte aéreo, ele não se apresenta como bilhete eletrônico ou cartão de embarque oficial da transportadora.

### Comprovante de compra

Registra a cotação aprovada, valor total, valor pago, saldo, parcelas e formas de pagamento já lançadas.

Cada documento possui número próprio, código de verificação, QR Code e snapshot dos dados no momento da emissão.

## Arquitetura

```text
React + Vite
     |
HTTPS / REST
     |
NestJS
     |
Prisma
     |
PostgreSQL 18 / Neon
```

Produção:

- frontend: Railway;
- API: Railway;
- banco: Neon PostgreSQL;
- migrations: Prisma;
- pipeline: GitHub Actions + pre-deploy do Railway.

## Segurança

Controles já implementados:

- RBAC para `ADMIN`, `AGENT`, `FINANCE` e `CLIENT`;
- MFA obrigatório para administrador;
- Argon2 para senhas e códigos sensíveis;
- access token curto e refresh token rotacionado;
- sessões por dispositivo e revogação;
- bloqueio após tentativas inválidas;
- CORS restrito à origem oficial;
- proteção de origem em operações mutáveis;
- Helmet, CSP e HSTS em produção;
- rate limiting;
- request ID;
- respostas de erro padronizadas;
- auditoria de autenticação;
- PDFs protegidos por autorização;
- código público de verificação de documento sem exposição de dados pessoais;
- logs sem corpo de requisição, senha, token ou código de acesso.

Detalhes: [docs/SECURITY.md](docs/SECURITY.md)

## Proteção de dados

O painel oferece exportação estruturada dos dados associados ao cliente e relatório de retenção antes de qualquer processo de anonimização. Exclusão automática não é feita quando há vínculos operacionais ativos.

Detalhes: [docs/DATA_PROTECTION.md](docs/DATA_PROTECTION.md)

## Integridade

O PostgreSQL possui constraints para valores financeiros, quantidades e consistência aritmética. Além das constraints, o endpoint administrativo:

```text
GET /api/v1/admin/system/integrity
```

confere totais de cotações e planos financeiros contra seus itens e parcelas.

## Observabilidade

A API expõe:

- health com versão, uptime e timestamp;
- readiness com teste real do PostgreSQL e latência do banco;
- logs estruturados de requisição;
- `requestId` em cada chamada;
- classificação de HTTP 5xx como erro;
- alerta em log para requisições acima de 1 segundo;
- shutdown gracioso.

## Testes e CI

O workflow em `.github/workflows/ci.yml` executa:

- PostgreSQL isolado;
- geração do Prisma Client;
- validação do schema Prisma;
- todas as migrations em banco limpo;
- build do backend;
- testes unitários;
- smoke test de readiness;
- build TypeScript/Vite do frontend.

Os testes financeiros verificam conservação do total, distribuição de centavos, limites e vencimentos mensais em fim de mês.

## Desenvolvimento local

Backend:

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Variáveis sensíveis devem permanecer fora do repositório. Em produção, segredos são configurados no ambiente do serviço.

## Operação e recuperação

O procedimento de deploy, validação, backup e recuperação está em:

[docs/OPERATIONS.md](docs/OPERATIONS.md)
