# Pagamentos

A plataforma usa Mercado Pago para PIX e cartão. Segredos do provedor nunca são enviados ao frontend.

## Responsabilidades

A configuração é dividida em dois níveis:

- plataforma: cadastra uma única aplicação Mercado Pago e mantém as credenciais centrais no ambiente de produção;
- administrador da agência: conecta a conta Mercado Pago pelo painel em **Configurações > Pagamentos**, sem copiar tokens ou chaves.

## Configuração central

Variáveis protegidas no backend:

- `MERCADO_PAGO_CLIENT_ID`
- `MERCADO_PAGO_CLIENT_SECRET`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_OAUTH_REDIRECT_URI`

Callback de produção:

`https://proximo-destino-api-production.up.railway.app/api/v1/payments/mercado-pago/oauth/callback`

Webhook de produção:

`https://proximo-destino-api-production.up.railway.app/api/v1/payments/mercado-pago/webhook`

## Conexão da agência

1. O administrador acessa **Configurações > Pagamentos**.
2. Clica em **Conectar Mercado Pago**.
3. O backend cria um `state` de uso único com expiração curta.
4. O administrador autoriza a conta diretamente no Mercado Pago.
5. O callback troca o código OAuth por tokens.
6. Access token e refresh token são armazenados criptografados.
7. O administrador volta ao painel e a sessão é restaurada pelo refresh cookie seguro.
8. A plataforma informa separadamente se a conta está conectada e se os pagamentos já estão prontos.

## Compra online

1. O cliente escolhe uma viagem publicada, quantidade de passageiros e assentos.
2. O backend calcula o valor usando o preço armazenado da viagem.
3. A compra só é liberada quando a conta está conectada e o webhook central está configurado.
4. Para PIX, o backend gera QR Code e código copia e cola.
5. Para cartão, o cliente continua no Checkout Pro hospedado pelo Mercado Pago.
6. O retorno do navegador nunca confirma pagamento.
7. O webhook assinado consulta o recurso real no Mercado Pago e confere o valor.
8. Somente então o pedido passa para pago e a reserva é confirmada.
9. Cancelamento ou expiração encerram a compra e liberam os assentos conforme a regra operacional.

## Segurança

- Nunca confiar em valor informado pelo frontend.
- Nunca expor access token, refresh token, Client Secret ou segredo de webhook.
- Usar idempotência na criação de cobranças.
- Validar assinatura do webhook.
- Conferir o valor recebido antes de confirmar a compra.
- Manter tokens OAuth criptografados em repouso.
- Renovar access token por refresh token quando necessário.
- Não coletar número de cartão no sistema da agência.
