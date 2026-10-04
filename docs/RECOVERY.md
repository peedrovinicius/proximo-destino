# Recuperação do banco de dados

Este projeto usa PostgreSQL no Neon. O objetivo deste procedimento é recuperar dados sem substituir a produção antes de validar o estado restaurado.

## Estado atual

- Branch principal: `production`.
- Histórico de restauração instantânea: 6 horas, que é o limite máximo do plano Free.
- Snapshot manual de referência: `proximo-destino-recovery-baseline-20261004`.
- O plano Free permite um snapshot manual e não oferece agendamento automático de snapshots.
- A branch original anterior ao teste de recuperação foi preservada como `recovery-backup-original-20261004`.

## Regra principal

Nunca testar uma restauração com `finalize: true`.

Para inspeção e recuperação segura, sempre criar primeiro uma branch de prévia com `finalize: false`. A produção só deve ser substituída depois de comparar dados, schema e migrations e após uma decisão explícita de recuperação.

## Procedimento seguro

1. Confirmar que a aplicação está saudável e registrar o estado atual.
2. Criar ou identificar um snapshot válido.
3. Restaurar o snapshot em uma branch de prévia com `finalize: false`.
4. Definir expiração para a branch temporária.
5. Comparar:
   - schema;
   - número de migrations;
   - contagens das tabelas críticas;
   - timestamps de atualização mais recentes;
   - dados financeiros e reservas, quando existirem.
6. Executar consultas somente leitura na branch restaurada.
7. Somente em um incidente real, e depois da validação, decidir se a restauração deve substituir a produção.
8. Após a recuperação, validar `/api/v1/readiness` e os principais fluxos da aplicação.

## Tabelas mínimas para validação

- `User`
- `Client`
- `Trip`
- `Reservation`
- `PurchaseOrder`
- `TravelDocument`
- `_prisma_migrations`

## Teste executado em 2026-10-04

Foi criado um snapshot manual e realizado um restore de prévia.

Resultado validado:

- schema sem diferenças;
- 27 migrations em ambos os lados;
- mesmas contagens nas tabelas críticas;
- mesmos timestamps máximos de atualização;
- API permaneceu saudável;
- branch de prévia configurada para expirar automaticamente após 24 horas.

## Limitações do plano atual

No plano Free do Neon:

- a janela de histórico é limitada a 6 horas;
- há limite de 1 snapshot manual;
- snapshots automáticos agendados exigem plano pago;
- proteção da branch de produção não está disponível neste projeto.

Enquanto o projeto permanecer no Free, criar um novo snapshot manual antes de mudanças de alto risco e manter este procedimento como referência de recuperação.

## Auditoria do estado observado em 2026-10-04

A consulta somente leitura ao Neon confirmou:

- produção atual: `br-green-frost-b5rcfrn1`, com `restore_status: finalized`;
- original preservada: `br-cool-tree-b5d55f02`;
- prévia separada: `br-aged-mud-b5066se1`, com expiração em 2026-10-05T01:20:12Z;
- 27 migrations concluídas, sem migrations pendentes na produção;
- clientes, reservas, pedidos de compra e documentos: zero registros tanto na produção quanto na original preservada.

Portanto, o estado atual inclui uma restauração finalizada, além da prévia. A documentação anterior do teste de prévia não descrevia essa finalização. Estas evidências não estabelecem quem autorizou a finalização, nem permitem inferir perda de registros nas quatro tabelas comparadas.

RLS está habilitada nas 12 tabelas sensíveis, mas o proprietário `neondb_owner` possui `BYPASSRLS`. As políticas existentes protegem papéis sem bypass e sem propriedade; não garantem isolamento por usuário nas consultas da API. Não ativar FORCE RLS ou remover BYPASSRLS sem preparar um papel de execução, políticas compatíveis e validação em ambiente isolado: as políticas atuais negam todas as linhas aos papéis sujeitos a RLS.

Os campos legados de documento não continham valores nas tabelas Client, Companion e ReservationPassenger. Como não havia clientes nem reservas, isso não equivale a um teste de criptografia de cadastros reais.

## Ensaio de dump e restore no CI

O CI executa `node scripts/recovery-drill.mjs` dentro do diretório backend. O script exige GitHub Actions, NODE_ENV=test e o ID do PostgreSQL descartável do job. Usa exclusivamente localhost, ignora DATABASE_URL e recusa sobrescrever bancos existentes.

O ensaio aplica as migrations em recovery_drill_source, insere dados fictícios de cliente, acompanhante, viagem, passageiro, reserva, assento, pedido, cotação, plano financeiro, parcelas e documento. Em seguida executa pg_dump em formato custom e pg_restore, com transação única e parada em erro, em recovery_drill_restored. Compara todas as tabelas por contagem e digest, além de colunas, constraints, índices, RLS e políticas. Confere migrations concluídas, parcelas e descriptografia nas três tabelas de documentos pessoais. A chave errada deve falhar.

Não exporta dados de produção nem publica dumps como artifacts. Os dois bancos e o dump são descartados com o container ao fim do job. O teste não comprova backup recorrente, retenção externa, tempo de recuperação em escala real, restauração de contas ou funcionamento de provedores externos. A restauração deliberadamente não copia proprietários e grants: esses controles exigem validação separada antes de recuperar um ambiente real.

### Chaves e recuperação real

Um dump não contém as chaves mantidas nas variáveis da aplicação. Guardar, separadamente do dump e com acesso restrito, as chaves de PII, MFA, tokens de provedores e auditoria usadas na data do backup. Registrar quais versões correspondem ao ponto de recuperação; não registrar os valores neste documento ou nos logs. Sem as chaves correspondentes, os dados podem voltar ao banco e permanecer ilegíveis.

Antes de promover uma recuperação real, testar descriptografia em ambiente isolado, preservar criptografia e permissões, revogar sessões conforme o incidente e confirmar os fluxos essenciais. Não ativar e-mails ou pagamentos reais no ensaio.

Resultado observado em 2026-10-04: CI do commit 8d1d2d47, job Backend build and smoke test, concluiu o ensaio com sucesso: 27 migrations, 12 tabelas com RLS, schema e registros idênticos, campos criptografados legíveis e financeiro reconciliado. O smoke test posterior também respondeu ready/database=ok.

Em 2026-10-04, a versão principal do PostgreSQL de produção foi confirmada como 18. O CI foi alinhado para postgres:18 no commit a549beb0; o ensaio sintético e o smoke test passaram nessa versão. Isso não comprova restauração de um backup real ou guarda das chaves reais.

## Backup externo criptografado (ativação pelo responsável)

O workflow `Encrypted external backup` prepara uma cópia diária às 08:33 UTC
(05:33 em Fortaleza) e permite execução manual. Permanece **desativado** até
`BACKUP_ENABLED=true` nas variables do repositório. Não cria contas, buckets,
credenciais ou chaves para o proprietário. Execução ignorada não significa backup
bem-sucedido; confirmar o job executado e o objeto verificado antes de operar.

O script `scripts/backup-external.py` usa PostgreSQL 18, conexão direta com TLS,
transação somente leitura e `pg_dump --format=custom`. O dump passa direto para
`age`; apenas o arquivo criptografado é gravado em diretório temporário restrito.
Erros de dump ou criptografia impedem upload. Após enviar para S3 compatível,
baixa os bytes criptografados e compara SHA-256. Apaga os arquivos locais ao
terminar. Não publica artifacts, não registra erros brutos com dados de conexão,
não restaura produção nem apaga backups remotos. Falhas após upload podem deixar
um objeto criptografado sem confirmação; não tratá-lo como ponto validado.

### Configuração e custódia

1. Escolher armazenamento **privado e independente do banco**. Configurar
   retenção/lifecycle no provedor, versionamento quando disponível e permissões
   de acesso restritas. Política inicial sugerida: 30 cópias diárias; o responsável
   deve confirmar prazo e custos antes de ativar. O script não altera lifecycle.
2. Gerar a identidade age em equipamento seguro: `age-keygen -o backup-identity.txt`.
   Guardar a chave privada fora de GitHub/Railway e do bucket, em cofre recuperável,
   com cópia protegida. Usar `age-keygen -y backup-identity.txt` para obter o
   destinatário público. Não enviar a identidade privada ao workflow.
3. Criar o environment `external-backup` no GitHub. Restringir à branch `main` e
   permitir que o agendamento rode sem aprovação humana a cada execução. Usar
   credenciais de armazenamento limitadas a escrita/leitura do prefixo
   `proximo-destino/`, sem exclusão. O papel PostgreSQL deve conseguir ler todas
   as tabelas a recuperar, incluindo as protegidas por RLS, sem permissões de
   escrita desnecessárias; validar o dump completo antes de usar papel limitado.
4. Cadastrar secrets do environment: `BACKUP_DATABASE_URL` (direta, não `-pooler`,
   com `sslmode=require` ou verificação mais forte), `BACKUP_S3_ACCESS_KEY_ID` e
   `BACKUP_S3_SECRET_ACCESS_KEY`.
5. Cadastrar variables do environment: `BACKUP_AGE_RECIPIENT` (público),
   `BACKUP_KEY_VERSION` (identificador sem segredo, por exemplo `keys-2026-10`),
   `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (HTTPS) e `BACKUP_S3_REGION`.
   O identificador deve corresponder ao inventário seguro de **todas** as chaves
   da aplicação usadas nesse ponto; age protege o arquivo, mas não substitui as
   chaves de PII/MFA/provedores/auditoria.
6. Após confirmar custódia, retenção e configuração, definir a variable do
   **repositório** `BACKUP_ENABLED=true`. Executar o workflow manualmente e
   confirmar `Backup stored and verified`, a data e o SHA-256.
7. Validar restauração desse objeto real em banco isolado antes de encerrar a
   pendência. A cópia diária tem RPO de até aproximadamente 24 horas (maior se
   houver falha); não equivale a recuperação contínua/PITR.

### Restore do objeto real

Em ambiente seguro, baixar o objeto criptografado e conferir SHA-256 com a
execução. Descriptografar com `age --decrypt --identity backup-identity.txt
--output backup.dump backup.dump.age`; o arquivo resultante contém dados
sensíveis e exige disco protegido e descarte após o teste. Restaurar exclusivamente
em banco vazio isolado com `pg_restore --exit-on-error --single-transaction`,
configurando conexão direta por variáveis `PG*`. Revisar owners e grants antes de
usar `--no-owner --no-acl`: essas opções removem controles que precisam ser
reaplicados e verificados. Executar as comparações de schema, migrations,
contagens, RLS, financeiro e descriptografia já descritas acima. Registrar somente
evidências agregadas, sem dados pessoais; nunca apontar esse teste à produção.

Para suspender novas cópias, definir `BACKUP_ENABLED=false`. Isso não remove
objetos existentes. GitHub deve notificar o responsável de falhas pelo canal que
ele habilitar; entrega de alerta e recuperação das chaves seguem pendentes até
validação real. Os testes de CI usam dados fictícios e armazenamento simulado,
com age real, sem acessar banco ou bucket de produção.
