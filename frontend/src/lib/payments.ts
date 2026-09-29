const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''

export type CheckoutRequest = {
  tripId: string
  installmentId: string
  method: 'pix' | 'card' | 'boleto'
}

export type CheckoutResponse = {
  checkoutUrl?: string
  pixCopyPaste?: string
  expiresAt?: string
}

export async function createPaymentCheckout(
  payload: CheckoutRequest,
): Promise<CheckoutResponse> {
  if (!apiUrl) {
    throw new Error('API de pagamentos ainda não configurada.')
  }

  const response = await fetch(`${apiUrl}/api/v1/payments/checkout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error('Não foi possível iniciar o pagamento.')
  }

  return response.json() as Promise<CheckoutResponse>
}
