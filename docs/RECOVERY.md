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
