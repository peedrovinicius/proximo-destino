# Operação, release e recuperação

Este documento descreve o procedimento operacional da aplicação Próximo Destino.

## Produção

Serviços:

- frontend: `proximo-destino-web` no Railway;
- API: `proximo-destino-api` no Railway;
- banco: projeto Neon `proximo-destino`;
- branch principal do banco: `production`;
- banco PostgreSQL: `neondb`.

A API deve ser considerada disponível somente quando:

```text
GET /api/v1/readiness
```

responder `200` com `status: ready` e `database: ok`.

## Pipeline de release

Ordem recomendada:

1. CI valida schema Prisma.
2. CI aplica todas as migrations em PostgreSQL limpo.
3. CI compila o backend.
4. CI executa testes unitários.
5. CI executa smoke test de readiness.
6. CI compila o frontend.
7. Railway constrói o backend.
8. O pre-deploy executa `npm run prisma:deploy`.
9. Railway inicia a API.
10. O healthcheck exige `/api/v1/readiness`.
11. O frontend é publicado somente com a URL oficial da API.

Uma migration aplicada em produção nunca deve ser reescrita. Ajustes posteriores recebem uma nova migration.

## Verificações pós-deploy

Conferir:

- status `SUCCESS` do backend;
- status `SUCCESS` do frontend quando houver alteração de interface;
- `/api/v1/health`;
- `/api/v1/readiness`;
- ausência de loop de restart;
- logs sem erro 5xx recorrente;
- migrations concluídas;
- integridade financeira pelo endpoint administrativo `/api/v1/admin/system/integrity`.

## Observabilidade

Cada requisição registra:

- request ID;
- método;
- caminho sem query string;
- status HTTP;
- duração;
- indicador de requisição lenta.

Requisições com duração igual ou superior a 1 segundo são registradas como warning. Respostas 5xx são registradas como error.

Corpos de requisição, tokens, senhas, códigos de reserva e parâmetros de query não são incluídos no log de acesso.

## Banco e recuperação

### Histórico contínuo

Em 30/09/2026, o projeto Neon Free reporta retenção contínua de histórico de 6 horas.

Esse valor pertence ao plano e pode mudar. Antes de uma recuperação, deve ser conferido novamente na configuração efetiva do projeto.

### Snapshot agendado

O projeto Free atualmente não permite configurar o agendamento automático de snapshots pela API do Neon. A tentativa de ativação foi rejeitada pelo próprio provedor.

Por isso, releases relevantes devem manter um ponto de recuperação explícito por branch do Neon ou outro mecanismo de backup externo antes de alterações de alto risco.

### Ponto de recuperação desta release

Foi criada a branch sem compute:

```text
backup-pre-release-2026-09-30
```

Ela foi derivada da branch `production` em 30/09/2026 antes do fechamento da release. Não possui compute ativo.

Uma branch de recuperação é um ponto de referência operacional, não substitui uma política permanente de backup externo.

## Procedimento de recuperação

Nunca sobrescrever a branch `production` diretamente como primeira ação.

Procedimento recomendado:

1. identificar a janela do incidente;
2. interromper operações mutáveis se houver risco de ampliar a inconsistência;
3. criar ou abrir uma branch de recuperação;
4. validar schema e dados na branch isolada;
5. executar consultas de reconciliação;
6. validar a aplicação contra a branch restaurada em ambiente isolado;
7. registrar exatamente o conjunto de dados a recuperar;
8. somente depois decidir entre correção transacional, restore ou troca controlada de branch;
9. validar `readiness`, integridade e funções críticas;
10. documentar a causa e as ações tomadas.

Operações destrutivas como reset, exclusão de branch ou restore sobre produção exigem revisão explícita.

## Documentos emitidos

Passagens/vouchers e comprovantes usam snapshots imutáveis. Reemissão cria nova versão e não altera o conteúdo de documentos anteriores.

O código de verificação e o QR Code permitem verificar a existência do documento sem tornar públicos dados pessoais ou financeiros.

## Segredos

Nunca colocar em commit:

- `DATABASE_URL`;
- JWT secrets;
- chave de MFA;
- chave de hash de auditoria;
- senhas administrativas;
- credenciais de provedores.

Segredos devem permanecer nas variáveis protegidas do ambiente de produção.

## Incidentes

Para um incidente de autenticação:

1. revogar as sessões afetadas;
2. rotacionar o segredo comprometido quando aplicável;
3. revisar eventos de auditoria;
4. verificar tentativas de login e origem;
5. exigir novo login.

Para um incidente financeiro:

1. não apagar lançamentos para “corrigir” o histórico;
2. identificar reserva, cotação, plano e parcelas envolvidos;
3. comparar com o endpoint de integridade;
4. registrar a correção com rastreabilidade;
5. reemitir comprovante quando necessário, preservando a versão anterior.

Para documentos incorretos:

1. não alterar o snapshot já emitido;
2. corrigir os dados operacionais;
3. emitir nova versão;
4. manter as versões anteriores para rastreabilidade.

## Checagem pública repetível

Executar com Node.js 22 ou superior:

```sh
node scripts/check-production.mjs
```

Também disponível em Actions → Production read-only checks → Run workflow. O workflow pode ser iniciado manualmente, executa a cada hora (minuto 17 UTC, sujeito à fila do GitHub) e roda em pushes que alterem a checagem. Usa permissão apenas de leitura do repositório, sem segredos. Não cria reservas ou pagamentos, nem acessa dados privados. Falha com código de saída 1 quando readiness, headers ou rejeição de acesso anônimo não atendem ao esperado. Respostas não são impressas nos logs.

Se falhar, conferir o status dos serviços e o resultado individual antes de qualquer alteração. Não relaxar guards, CSP ou autenticação para fazer a checagem passar. Uma falha de rede também pode produzir resultado negativo. Esta checagem não comprova fluxos autenticados, entrega de e-mail, webhook ou backup. Uma automação horária no ChatGPT acompanha os serviços e resultados atuais de CI/checagem, avisa incidentes e sua resolução, sem modificar produção. A automação está habilitada; a entrega de um alerta de falha ainda não foi comprovada. Retenção externa e backup real continuam pendentes.

A correção do foco de assentos de 2026-10-04 preserva o botão de abertura antes da atualização assíncrona de disponibilidade. Pode ser revertida pelo commit correspondente ou rollback do frontend no Railway, sem migration ou alteração de dados.

## Fotos enviadas pelo administrador

Uploads JPG, PNG ou WebP estáticos têm limite de 2,5 MB e 16 megapixels. O servidor confere os bytes, decodifica o arquivo e regrava WebP sem metadados, com lado máximo de 2400 px. O MIME e tamanho gravados na auditoria correspondem à saída normalizada. Fotos inválidas, truncadas, animadas ou acima dos limites recebem erro 400 antes de gravar dados. O frontend já otimiza fotos antes do envio; a verificação no servidor protege acessos diretos à API.

A correção de upload de ad5ec077 é reversível por rollback da API. Não altera o schema nem exige reprocessar fotos anteriores; os bytes normalizados permanecem compatíveis com o endpoint público de imagens. Manter a validação ao fazer correções posteriores.
