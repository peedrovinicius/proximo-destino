# Checklist de prontidão operacional

Auditoria de 2026-10-04. Não equivale a aprovação integral para operação comercial.

## Verificado

- [x] API publicada no commit 40fb1ff, incluindo escopo de documentos por papel e remoção da instrumentação temporária.
- [x] Readiness de produção HTTP 200 e banco disponível.
- [x] CI da correção 7221f063: 77 testes, 26 suítes, zero falhas ou testes ignorados; frontend e backend compilados; smoke test passou; CodeQL passou.
- [x] GET sem autenticação em reservas, clientes, pagamentos, documentos, integridade, notificações e portal do cliente retorna 401.
- [x] 27 migrations concluídas na produção e zero migrations pendentes.
- [x] RLS habilitada nas 12 tabelas sensíveis. Limitação: neondb_owner tem BYPASSRLS; autorização da API continua necessária.
- [x] Um administrador ativo, com MFA habilitado.
- [x] Snapshot manual disponível, branch original preservada e prévia com expiração. Ver RECOVERY.md para a restauração finalizada observada.
- [x] Configuração de headers do frontend corrigida em 7221f063, build e resposta local validados.

## Dependências para encerrar os testes comerciais

- [x] Headers confirmados na resposta HTTPS de produção após deploy bem-sucedido de 7221f063, em 2026-10-04T09:50:51Z. CSP de enquadramento/objetos/base aplicada; política mais restritiva de recursos em Report-Only.
- [ ] Conectar Mercado Pago no Admin: produção retorna configured=false e não há configuração de plataforma ou conta conectada no banco. PIX, cartão, boleto e transferência online estão desativados.
- [ ] Verificar e-mail por login autorizado no Admin. Não há conexão persistida de provedor; há variáveis de ambiente de e-mail com valores ocultos. A entrega por fallback não foi comprovada. Configurar remetente e destinatário da cópia administrativa com dados do proprietário.
- [ ] Validar sessão administrativa e portal em navegador, com MFA fornecido pelo proprietário; não contornar MFA.
- [ ] Executar compra em modo de teste do provedor, incluindo webhook assinado, conciliação e PDFs; depois confirmar ativação comercial pelo proprietário.
- [ ] Confirmar entrega de e-mail a cliente e agência; não inferir entrega pela presença de variáveis.
- [ ] Testar permissões por HTTP autenticado com ADMIN, AGENT, FINANCE e CLIENT e recursos de outro cliente.
- [ ] Validar os fluxos móveis, upload, modelos de ônibus e acessibilidade em navegador autenticado.
- [ ] Definir política recorrente de backup e alertas com destino do proprietário. O estado observado tem janela de recuperação de 6 horas e um snapshot manual, sem garantia de backup externo recorrente.

## Limites da validação de dados

As tabelas Client, Reservation, PurchaseOrder e TravelDocument têm zero registros tanto na produção atual quanto na original preservada. As consultas de integridade não encontraram duplicidade de assentos nem divergência entre total do plano financeiro e soma das parcelas, mas a ausência de registros não comprova comportamento sob carga real.

Não houve alteração de permissões ou restauração do banco durante esta auditoria. Não remover BYPASSRLS nem ativar FORCE RLS com as políticas atuais sem preparar papel de execução e políticas compatíveis em ambiente isolado.
