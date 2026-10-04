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
- [x] Chromium no CI validou layouts públicos e telas de login com dados fictícios em viewports de 320, 390 e 768 px. Os nove cenários passaram após corrigir o corte horizontal do diálogo de assentos. Fluxos autenticados e dados reais em mobile continuam pendentes.
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
| P1 | Fluxos autenticados e dados reais em mobile | Revisão pública isolada concluída em Chromium; validar área interna e portal com dados reais e acesso autorizado |
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

## Validação da rotina externa e controles de execução

- [x] CI 36d2ab83 aprovado: testes de criptografia age e falhas, builds, ensaio de recuperação PostgreSQL 18 e smoke test. CodeQL aprovado. Banco e armazenamento desses testes são fictícios/isolados.
- [x] Workflow de backup restrito a main e BACKUP_ENABLED=true em b2f3ecbb. Execuções sem ativação ou fora da branch principal apresentam aviso e resumo explícitos: nenhum ponto de recuperação criado. Falhas apresentam erro e não devem ser registradas como backup verificado. YAML e guardas validados localmente.
- [ ] Executar o workflow externo configurado e comprovar arquivo real, retenção, custódia e restore isolado. Os controles preparados não ativam o armazenamento nem encerram P0.

## Revisão mobile em Chromium — 2026-10-04

- [x] Workflow Mobile browser checks com nove cenários em 320, 390 e 768 px: home, detalhes, login do cliente e administrador, mapas 2+1/2+2 com dois andares, bloqueios/ocupações, controles de pelo menos 44 px, Tab/Shift+Tab, confirmação, Escape e retorno do foco. API inteiramente simulada; nenhuma reserva ou pagamento enviado. Imagens/fontes/mapas externos não são requisitados pelo ensaio.
- [x] O primeiro ensaio detectou corte do diálogo e das poltronas em 320/390 px. Corrigido o dimensionamento mínimo da grade e do diálogo em dbf3f036. Nove de nove cenários passaram no run 37200827073, com screenshots de evidência fictícia por sete dias.
- [x] CI e CodeQL dbf3f036 aprovados. Frontend publicado no Railway, deployment 2c7788c5-1cb9-4f27-911b-e084d720a98e SUCCESS em 2026-10-04T12:06:53Z. Navegador de produção abriu home, detalhes de Maceió e mapa; estilos corrigidos confirmados, Escape e retorno ao botão verificados. Nenhuma solicitação foi enviada.
- [ ] A verificação isolada não comprova MFA, permissões, uploads e demais operações na área autenticada de produção, nem pagamento/e-mail real ou uso em aparelhos físicos.

## Recuperação MFA sob concorrência — 2026-10-04

- [x] Corrigido consumo de código de recuperação: atualização atômica exige ID, usuário e usedAt=null; somente a solicitação que altera um registro autentica. Impede duas verificações concorrentes de aceitarem o mesmo código previamente lido.
- [x] Dois testes com Argon2 e AES-GCM reais e persistência simulada: ambas as solicitações leem o mesmo código disponível, apenas uma vence; reutilização é negada; tentativas inválidas não consomem o código. Não é teste de carga no banco de produção.
- [x] CI 4a6b5d581 aprovado: 97 testes em 29 suítes, zero falhas; builds, smoke test, criptografia de backup e ensaio de recuperação passaram. CodeQL aprovado.
- [x] API publicada no deployment f5b5f7a0-fac1-4330-809f-72c4e01b9ba5, SHA 4a6b5d581, SUCCESS em 2026-10-04T12:15:19Z. Checagem pública pós-deploy: seis de seis verificações passaram, incluindo readiness/banco, headers e negativas 401.
- [ ] Login/MFA com contas reais e escopo autenticado em produção continuam pendentes. Nenhum código de recuperação, conta ou credencial de produção foi utilizado pelos testes deste bloco.

## Refinamento do rodapé — 2026-10-04

- [x] Rodapé compartilhado da home e páginas institucionais reorganizado em Empresa, Sua viagem e Políticas e compromissos; todos os 15 destinos institucionais preservados. Marca e nome alinhados, texto/contraste/espaçamento ampliados, canais sociais e acesso administrativo na faixa inferior.
- [x] Chromium: dez de dez cenários passaram em 320, 390, 768 e 1440 px, incluindo os 19 controles do rodapé com altura mínima de 44 px, limites horizontais e navegação para privacidade. API simulada, sem reservas ou transações reais. CI e CodeQL 6653315b aprovados.
- [x] Frontend 6653315b publicado no deployment d2ad4acb-9d8e-4b6c-9542-b56d689bcb79, SUCCESS em 2026-10-04T12:32:41Z. Rodapé conferido visualmente e link de privacidade aberto no navegador de produção; screenshot registrado. Pendências comerciais e autenticadas continuam abertas.

## Escala tipográfica proporcional — 2026-10-04

- [x] Normalizadas 526 declarações pequenas em CSS compartilhado, incluindo painel: escala em rem com mínimo de 12 px para metadados, 14 px para texto compacto e 16 px para campos. Títulos principais públicos de 32 a 64 px conforme viewport; títulos de seção até 32 px, subtítulos institucionais 20 px. Rodapé alinhado à mesma hierarquia. Botão Voltar ao início do login do viajante mantém texto legível no mobile.
- [x] Chromium 780a3c92: dez de dez cenários passaram em 320/390/768/1440 px. Verificação inclui texto renderizado >=12 px, títulos principais entre 24 e 64 px, campos visíveis >=16 px, ausência de overflow horizontal, rodapé e mapas de assentos. CI e CodeQL aprovados.
- [x] Frontend 780a3c92 publicado, deployment 034a8b68-c083-4f4e-aeba-fe54fabbd0be SUCCESS em 2026-10-04T12:43:20Z. Conferência visual em produção: título 64 px, seção 32 px, links do rodapé 14 px, campos 16 px. Screenshot registrado.
- [ ] Os estilos compartilhados também afetam a área interna; revisão visual dos fluxos autenticados reais do painel continua pendente. Ensaios de navegador usam dados fictícios e não comprovam produção autenticada.

## Navegação interna responsiva — preparação de 2026-10-04

- [x] Corrigida regra que ocultava as abas administrativas após Viagens em telas até 620 px. Todas as seções permitidas permanecem disponíveis em uma faixa com rolagem horizontal.
- [x] Cabeçalho até 980 px reorganizado em duas linhas: marca/ações e navegação. Abas com alvo mínimo de 44 px, fonte de 14 px, foco visível e indicação aria-current da seção ativa.
- [x] Build local TypeScript/Vite passou; revisão do componente preserva as permissões existentes. Nenhuma conta, reserva ou integração real foi alterada.
- [x] Preparados quatro cenários Chromium em 320/390/768/1440 px para visibilidade das nove abas, alcance por teclado, tamanho de controles e navegação entre Visão geral, Clientes e Reservas. Sessão e API são fictícias.
- [x] Chromium no CI: 14/14 cenários passaram no run 37207557441, incluindo os quatro cenários do Admin. Corrigida também rolagem de foco para trazer a aba inteira à área visível. Sessão e respostas da API fictícias; nenhum acesso real com MFA.
- [x] Publicação autorizada pelo proprietário em 2026-10-04. PR #29 integrado no commit c159141; CI 37207557436 e CodeQL 37207557451 aprovados. Railway deployment 4390cd62-5a24-4c8d-b4f8-5a67e62cc825 SUCCESS em 2026-10-04T14:02:13Z; CSS e handler de foco confirmados nos assets HTTPS.
- [ ] Validar o painel publicado com MFA e contas autorizadas; o ensaio simulado não comprova autenticação ou permissões em produção.

- [ ] Dependency review da PR #29 não executou a análise: Dependency graph desativado no repositório. Nenhuma dependência alterada neste bloco; auditorias npm de produção e desenvolvimento do CI passaram. Não registrar esse check como aprovado.

- [x] Checagem pública após implantação: 6/6 passaram (readiness/banco, frontend/headers e quatro negativas 401). Não comprova uso autenticado em produção.

## Portal preenchido e hierarquia visual — preparação local de 2026-10-04

- [x] Ajustes locais limitados ao portal: títulos de 32–56 px, resumo em 16 px,
  status do contador em 16 px e informações comerciais de 13–14 px. Cabeçalho
  mobile em duas linhas, ações com alvo mínimo de 44 px e foco visível.
- [x] Preparados quatro novos cenários de Chromium em 320/390/768/1440 px,
  com login e reserva inteiramente fictícios: textos longos, cotação, documentos,
  parcelas, edição de passageiros, abertura/fechamento do pedido de cancelamento
  e saída. Escritas comerciais não são permitidas pelo mock.
- [x] Build local TypeScript/Vite e verificação de sintaxe do script passaram.
- [ ] Executar os quatro cenários e a regressão existente em Chromium. Instalação
  local do navegador falhou; não registrar os testes preparados como aprovados.
- [x] Envio, CI e publicação autorizados diretamente pelo proprietário em 2026-10-04.
- [ ] Concluir CI/CodeQL, cenários Chromium e publicação; registrar evidências após aprovação.
- [ ] Conferir o portal com contas reais autorizadas após publicação. Dados fictícios
  não validam autenticação, configuração de produção ou operação comercial.
