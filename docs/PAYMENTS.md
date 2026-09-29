# Pagamentos

A interface de pagamento do cliente nunca deve receber segredo do provedor.

## Fluxo

1. O cliente escolhe uma parcela e forma de pagamento.
2. O frontend chama `POST /api/v1/payments/checkout`.
3. O backend valida usuário, viagem, parcela, valor e estado da cobrança.
4. O backend cria a cobrança no provedor com chave privada armazenada em secret manager.
5. O cliente é direcionado para checkout seguro, PIX ou boleto.
6. O provedor envia webhook assinado ao backend.
7. O backend valida assinatura, timestamp e idempotência.
8. Somente após confirmação do webhook a parcela muda para paga.
9. A alteração é gravada em trilha de auditoria.

## Regras

- Nunca confiar em valor vindo do frontend.
- Nunca marcar pagamento como confirmado apenas porque o navegador voltou de uma URL de sucesso.
- Cada tentativa recebe `idempotencyKey`.
- Estorno exige permissão específica e justificativa.
- Alteração manual de status financeiro deve ser auditada.
- Dados de cartão devem ser tokenizados pelo provedor.
