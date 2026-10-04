# Checklist de prontidão operacional

Auditoria de 2026-10-04. Não equivale a aprovação integral para operação comercial.

## Verificado

- [x] API publicada no commit ad5ec077, incluindo escopo de documentos por papel, negativa por padrão, remoção da instrumentação temporária e validação/normalização dos uploads de fotos.
- [x] Readiness de produção HTTP 200 e banco disponível.
- [x] CI da correção 7221f063: 77 testes, 26 suítes, zero falhas ou testes ignorados; frontend e backend compilados; smoke test passou; CodeQL passou.
- [x] GET sem autenticação em reservas, clientes, pagamentos, documentos, integridade, notificações e portal do cliente retorna 401.
- [x] 27 migrations concluídas na produção e zero migrations pendentes.
- [x] RLS habilitada nas 12 tabelas sensíveis. Limitação: neondb_owner tem BYPASSRLS; autorização da API continua necessária.
- [x] Um administrador ativo, com MFA habilitado.
- [x] Snapshot manual disponível, branch original preservada e prévia com expiração. Ver RECOVERY.md para a restauração finalizada observada.
- [x] Configuração de headers do frontend corrigida em 7221f063, build e resposta local validados.

## Ativação pelo administrador

Mercado Pago e e-mail serão configurados pelo administrador da página, conforme decisão do proprietário em 2026-10-04. Não cadastrar contas, remetentes ou credenciais em seu nome. A conexão e os testes reais são etapas de ativação e não bloqueiam o desenvolvimento técnico.

## Dependências para encerrar os testes comerciais

- [x] Headers confirmados na resposta HTTPS de produção após deploy bem-sucedido de 7221f063, em 2026-10-04T09:50:51Z. CSP de enquadramento/objetos/base aplicada; política mais restritiva de recursos em Report-Only.
- [ ] Conectar Mercado Pago no Admin: produção retorna configured=false e não há configuração de plataforma ou conta conectada no banco. PIX, cartão, boleto e transferência online estão desativados.
- [ ] Verificar e-mail por login autorizado no Admin. Não há conexão persistida de provedor; há variáveis de ambiente de e-mail com valores ocultos. A entrega por fallback não foi comprovada. Configurar remetente e destinatário da cópia administrativa com dados do proprietário.
- [ ] Validar sessão administrativa e portal em navegador, com MFA fornecido pelo proprietário; não contornar MFA.
- [ ] Executar compra em modo de teste do provedor, incluindo webhook assinado, conciliação e PDFs; depois confirmar ativação comercial pelo proprietário.
- [ ] Confirmar entrega de e-mail a cliente e agência; não inferir entrega pela presença de variáveis.
- [x] Nove testes HTTP isolados passaram com os guards, verificação JWT e serviços reais de autenticação e documentos, usando persistência simulada: ADMIN/AGENT/FINANCE, CLIENT negado, PDFs fora do escopo, token inválido/refresh, sessão revogada, usuário inexistente, papel atual prevalecendo sobre o JWT e negativa de CLIENT diretamente no serviço. O serviço exige papel explícito e nega por padrão. CI do commit 6b474867: 86 testes em 27 suítes, zero falhas ou testes ignorados.
- [ ] Validar permissões autenticadas com contas e dados de produção e acesso a recursos de outro cliente. Os testes isolados não comprovam configuração ou comportamento do banco de produção.
- [ ] Validar os fluxos móveis, upload, modelos de ônibus e acessibilidade em navegador autenticado.
- [ ] Definir política recorrente de backup e alertas com destino do proprietário. O estado observado tem janela de recuperação de 6 horas e um snapshot manual, sem garantia de backup externo recorrente.

## Blocos de seletor e portal de 2026-10-04

- [x] Seletor descarta poltronas ocupadas, bloqueadas, duplicadas ou fora da capacidade antes de habilitar e enviar a confirmação; isso não substitui a checagem transacional de disponibilidade no backend.
- [x] Diálogo recebe foco inicial, mantém o ciclo de Tab, fecha por Escape e devolve foco ao controle anterior. Quantidade selecionada anunciada por região de status; andares usam botões com estado pressionado.
- [x] Teste de comportamento em DOM simulado: seleção desatualizada, nova seleção, confirmação, ciclo de foco, Escape e restauração de rolagem passaram. Build passou. Revisão visual desktop do site público e mapa concluída no navegador em produção. Mobile e área autenticada continuam pendentes.
- [x] Três novos testes HTTP isolados do portal passaram localmente: PDF de outro cliente, PDF de outra reserva e rejeição de tipo de token incorreto ou sem reserva. Total do bloco HTTP: 12 testes com persistência simulada. CI do commit 450ac20de: 89 testes em 27 suítes, zero falhas ou testes ignorados; CodeQL passou.

## Limites da validação de dados

As tabelas Client, Reservation, PurchaseOrder e TravelDocument têm zero registros tanto na produção atual quanto na original preservada. As consultas de integridade não encontraram duplicidade de assentos nem divergência entre total do plano financeiro e soma das parcelas, mas a ausência de registros não comprova comportamento sob carga real.

Não houve alteração de permissões ou restauração do banco durante esta auditoria. Não remover BYPASSRLS nem ativar FORCE RLS com as políticas atuais sem preparar papel de execução e políticas compatíveis em ambiente isolado.

## Verificação pública e operacional de 2026-10-04

- [x] Site público desktop e detalhes de Maceió carregaram; compra online aparece desabilitada enquanto o provedor não está configurado.
- [x] Modal de poltronas: foco inicial, ciclo de Tab, seleção, confirmação e Escape verificados no navegador de produção. Nenhuma solicitação de reserva foi enviada.
- [x] Corrigida perda de foco causada pelo carregamento assíncrono antes da abertura: controle de origem preservado na página de viagem e no portal. Frontend 6e205d30 com deploy SUCCESS; build local passou. Retorno ao botão confirmado por Escape e confirmação na página pública. Portal autenticado ainda não verificado visualmente.
- [x] Script scripts/check-production.mjs executado contra produção: seis verificações passaram (readiness com banco, frontend com headers e quatro rotas protegidas retornando 401). Workflow Production read-only checks disponível. Execução no GitHub em 2026-10-04 no commit a549beb0 passou, além da execução local (seis verificações).
- [x] Checagem pública horária configurada no GitHub e monitor horário habilitado para avisos ao proprietário no ChatGPT. A entrega de uma notificação de incidente ainda precisa ser comprovada.
- [ ] Backup externo recorrente, retenção e guarda recuperável das chaves continuam pendentes. Monitoramento não substitui backup.

## Ensaio de recuperação e ajuste mobile de 2026-10-04

- [x] CI do commit 8d1d2d47 passou, incluindo o novo ensaio de pg_dump/pg_restore com dados fictícios em dois bancos descartáveis. CodeQL passou.
- [x] Ensaio preservou as 27 migrations, schema, contagens e digests de todas as tabelas, constraints, índices e as 12 tabelas com RLS/políticas. Campos de documento de cliente, acompanhante e passageiro descriptografados com a chave correta; chave errada rejeitada; parcelas reconciliadas.
- [x] Script recusa execução fora do CI antes de acessar banco; não aceita conexão de produção, não sobrescreve bancos existentes e não publica dump como artifact. Ver RECOVERY.md.
- [x] Grade mobile de assentos ajustada para manter largura mínima de 44 px e caber no espaço de uma tela de 320 px, considerando corredor, bordas e paddings. Build local e no CI passaram. Frontend 8d1d2d47 com deploy SUCCESS; CSS corrigido confirmado em HTTPS de produção no asset index-Cg16D8wV.css.
- [ ] Validação visual em viewport mobile continua pendente: o navegador disponível não oferece controle de viewport. A inspeção do CSS e o build não substituem essa validação.
- [ ] Ensaio com dados fictícios não encerra backup externo recorrente, retenção, alertas, recuperação de chaves reais ou testes autenticados/comerciais.

## Upload de fotos e escopo dos provedores de 2026-10-04

- [x] Corrigido upload que aceitava texto comum apenas por declarar image/webp: o backend agora confere assinatura e formato, decodifica e regrava a imagem em WebP estático sem metadados. Limites de 2,5 MB, 16 megapixels e lado máximo de saída de 2400 px. Nenhuma migration necessária.
- [x] Testes cobrem JPG/PNG/WebP reais, remoção de EXIF, MIME forjado, formato divergente, truncamento, arquivo vazio, tamanho falso e excesso de bytes/pixels.
- [x] Testes HTTP com JWT, sessão e guards reais negaram 11 rotas de leitura/alteração de configurações de Mercado Pago/e-mail para anônimos e AGENT/FINANCE/CLIENT, inclusive JWT declarando ADMIN. Serviços de provedores simulados não foram chamados nas negativas. ADMIN permitido em consultas e início de conexão, com ID autenticado como ator. Nenhuma conta externa foi conectada.
- [x] CI do commit ad5ec077: 95 testes em 28 suítes, zero falhas e zero ignorados; CodeQL e ensaio de recuperação passaram. Auditoria local de dependências de produção: zero vulnerabilidades reportadas.
- [x] Consulta somente leitura em produção: zero fotos armazenadas como upload. Isso não valida os fluxos de upload em navegador autenticado nem os links externos de fotos.

## Prioridades restantes

| Prioridade | Pendência | Evidência para concluir |
| --- | --- | --- |
| P0 antes de operação comercial | Backup externo recorrente, retenção e recuperação das chaves | Arquivo criptografado fora do banco, chaves recuperáveis com acesso restrito e restore isolado do ponto real de backup |
| P1 | Ativação de Mercado Pago e e-mail pelo administrador | Conta/remetente conectados, pagamento em teste, webhook assinado, conciliação, entrega ao cliente e cópia administrativa |
| P1 | Fluxos autenticados e escopo em produção | Login com MFA, contas por papel, recursos de clientes distintos, PDFs e upload em navegador autorizado |
| P1 | Revisão visual mobile | Fluxos públicos e autenticados em viewport mobile, sem corte, com teclado e controles acessíveis |
| P2 | Confirmar entrega de alertas | Checagem horária GitHub e monitor ChatGPT habilitados; validar notificação sem provocar indisponibilidade em produção |

Não há evidência suficiente para declarar encerradas essas pendências. O ensaio de recuperação e os mocks de provedores não ativam contas externas nem comprovam entrega ou transação real.

- [x] API ad5ec077 publicada com deploy SUCCESS; pós-deploy executou seis verificações de produção com sucesso, incluindo readiness do banco, headers do frontend e negativas 401 nas quatro rotas protegidas verificadas.

- [x] CI e CodeQL do commit a549beb0 passaram. Ensaio de dump/restore e smoke test passaram com PostgreSQL 18, alinhado à versão principal observada na produção.

## Preparação de backup externo de 2026-10-04

- [x] Rotina de dump direto com TLS, criptografia age antes de gravação em disco,
  envio S3 compatível e conferência dos bytes armazenados por download/SHA-256.
  Falhas de dump/criptografia impedem upload; temporários removidos ao finalizar.
- [x] Workflow diário com ativação explícita por `BACKUP_ENABLED`, environment
  separado e destinatário público; chave privada age fica fora do CI e do bucket.
- [x] Testes com age real e dump/armazenamento simulados cobrem roundtrip,
  configuração insegura, dump incompleto, destinatário inválido, falha de envio e
  corrupção no download. Não comprovam backup real de produção.
- [ ] Responsável configurar bucket privado, retenção, credenciais e custódia das
  chaves; ativar, verificar primeiro objeto real e restaurá-lo em banco isolado.
  A rotina preparada não encerra a prioridade P0 de backup operacional.
