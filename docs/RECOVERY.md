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
