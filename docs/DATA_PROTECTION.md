# Proteção de dados e retenção

O Próximo Destino trata dados pessoais de clientes, acompanhantes e usuários administrativos. O projeto adota minimização de exposição por padrão: hashes de credenciais e códigos de acesso não são retornados nas rotas administrativas de privacidade.

## Acesso aos dados

A rota administrativa `GET /api/v1/admin/privacy/clients/:id/export` gera uma visão estruturada dos dados do cliente e do histórico operacional associado. O acesso é restrito ao papel `ADMIN`.

## Revisão de retenção

A rota `GET /api/v1/admin/privacy/clients/:id/retention` identifica bloqueios operacionais antes de qualquer processo de anonimização. Reservas pendentes ou confirmadas e viagens ainda não encerradas impedem a indicação de elegibilidade.

O relatório não executa exclusão nem anonimização automática. Obrigações legais, fiscais, contratuais e de defesa de direitos precisam ser avaliadas antes de qualquer descarte definitivo.

## Observabilidade

A API registra `requestId`, método, caminho sem query string, status HTTP e duração. Corpos de requisição, tokens, códigos de acesso, senhas e parâmetros de query não entram no log de acesso.

## Credenciais

A senha temporária usada para criar o primeiro administrador é apenas um bootstrap. Depois da criação do administrador, o valor de `ADMIN_PASSWORD` deve permanecer vazio ou ser removido do ambiente de produção. O MFA continua obrigatório para administradores.
