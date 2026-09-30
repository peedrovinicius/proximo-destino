# Arquitetura e invariantes

## Superfícies

A aplicação possui três superfícies com responsabilidades distintas:

- pública: descoberta e solicitação de reserva;
- viajante: acesso apenas à própria reserva;
- administrativa: operação da agência com RBAC.

A autorização é aplicada no servidor. Ocultar um botão no frontend não é tratado como controle de acesso.

## Estado comercial

```text
Reserva PENDING
  -> Cotação DRAFT
  -> Cotação SENT
  -> APPROVED ou REJECTED/EXPIRED

APPROVED
  -> Reserva CONFIRMED
  -> ReservationService
  -> FinancePlan
  -> Installment
  -> TravelDocument
```

Uma cotação enviada não pode receber alteração de item. Uma nova negociação cria nova revisão.

## Invariantes financeiros

- valores monetários são armazenados em centavos inteiros;
- o desconto não pode superar o subtotal de venda;
- total da cotação = subtotal de venda - desconto;
- margem = total - custo;
- total de um item = valor unitário x quantidade;
- entrada deve ser menor que o total;
- plano possui de 1 a 36 parcelas após a entrada;
- soma de entrada e parcelas deve reproduzir exatamente o total aprovado.

O cálculo de parcelamento distribui centavos sem perda e trata corretamente vencimentos no fim do mês.

## Documentos

Documentos emitidos usam snapshot JSON imutável. O PDF é renderizado a partir do snapshot, e não do estado atual da reserva.

Tipos atuais:

- `TRAVEL_VOUCHER`;
- `PURCHASE_RECEIPT`.

Cada reemissão incrementa a versão da combinação reserva/tipo.

## Segurança de domínio

- senha e códigos de recuperação: Argon2;
- código de acesso do viajante: Argon2;
- segredo TOTP: AES-256-GCM;
- sessões administrativas: persistidas e revogáveis;
- cliente não utiliza token administrativo;
- PDFs administrativos exigem RBAC;
- PDFs do cliente validam simultaneamente documento, reserva e clientId;
- verificação pública de documento retorna apenas metadados não sensíveis.
