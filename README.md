# SOS Car

MVP do TCC "Sistema de SOS para Veículos Automotores". Frontend em HTML/CSS/
JavaScript puro (sem framework) e API em Node.js (JavaScript), seguindo o
modelo de dados descrito em `sos_veiculos_mysql.sql`.

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org) 16 ou superior instalado.

```
npm install
npm start
```

A conexão com o banco MySQL é configurada no arquivo `.env` (na raiz do
projeto; se ele não existir, copie `.env.example` para `.env`). Preencha
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` e `DB_PASSWORD` com os dados do seu
banco. As credenciais **nunca** ficam no código, e o `.env` não deve ir para o
GitHub (já está no `.gitignore`).

Bancos criados antes das chaves estrangeiras (2026-09) precisam aplicar uma vez
`migrations/001_integridade.sql` (com o servidor parado e um backup feito);
bancos novos já nascem com elas. Use uma instância do sistema por banco: cada
uma regrava o banco inteiro a partir da própria memória.

Se a conexão com o MySQL falhar na inicialização (host errado, senha errada, IP
não autorizado em "MySQL remoto"…), o servidor sobe mesmo assim, guardando os
dados apenas em memória (modo fallback) — eles se perdem ao reiniciar. O
motivo aparece no terminal, e `GET /health` mostra se o armazenamento atual é
`mysql` ou `memoria`.

Depois abra `https://localhost:3000` no navegador. O servidor gera
automaticamente um certificado local de desenvolvimento na primeira execução.

### Localização no Google Chrome

O Chrome só permite `navigator.geolocation` em um contexto seguro. O endereço
`http://localhost` é uma exceção para desenvolvimento, mas o endereço de rede
local (por exemplo, `http://192.168.x.x:3000`) precisa de `https://`.

Para produção, substitua o certificado local por um certificado válido. Para
testar em uma rede local, gere um certificado confiável para o computador e o
celular (por exemplo, com `mkcert`) e configure no `.env`:

```
TLS_CERT_FILE=C:\caminho\para\cert.pem
TLS_KEY_FILE=C:\caminho\para\key.pem
```

As duas variáveis devem ser informadas juntas. Se elas não forem informadas,
o certificado de desenvolvimento será usado automaticamente. Depois reinicie o servidor e
abra o endereço `https://IP-DA-MAQUINA:3000`. No Chrome, permita a localização
para esse endereço. No primeiro acesso, o certificado automático pode exibir
um aviso de segurança; no celular, instale/confie no certificado para remover
o aviso. Não é possível liberar a localização via JavaScript nem remover esse
aviso sem confiar no certificado no dispositivo.

### Variáveis de ambiente (opcionais)

Veja `.env.example` para a lista completa com comentários. Nenhuma é
obrigatória para rodar localmente — sem configurar nada, tudo funciona em
modo de demonstração (banco em memória se o MySQL falhar, conta de admin
com credenciais padrão, link de redefinição de senha só no console).

| Variável | Para quê |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conectar a outro banco MySQL |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | Login da conta única de administrador (padrão: `admin@soscar.com` / `admin123`) |
| `ADMIN_SENHA_HASH` | Hash bcrypt da senha do administrador; recomendado em produção no lugar de `ADMIN_SENHA` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envio real de e-mail no fluxo "esqueci minha senha" |
| `APP_URL` | Endereço público usado para montar o link enviado por e-mail (padrão: `https://localhost:3000`) |
| `PORT`, `HOST` | Porta/host onde o servidor escuta |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | Caminhos do certificado e da chave privada para ativar HTTPS local |

## Como usar

1. Na tela inicial, escolha **"Sou cliente"** ou **"Sou prestador"** e crie
   uma conta (aba "Criar conta"). Prestadores também escolhem uma categoria
   (Mecânico, Borracheiro, Auto Elétrica ou Guincho).
2. **Como cliente:** preencha o endereço, clique em "Usar minha localização"
   (o navegador vai pedir permissão de GPS) e solicite o socorro. Acompanhe
   o status do chamado (com mapa) na mesma tela.
3. **Como prestador:** ative o interruptor "Disponível" (com ele desligado,
   nenhum chamado aparece nem pode ser aceito), permita o acesso à
   localização. Na primeira entrada os pedidos são carregados uma vez; depois,
   use "Atualizar" para buscar novos pedidos. A lista não é atualizada
   automaticamente. Clique em "Visualizar pedido" para conferir os detalhes
   antes de "Aceitar pedido". Se dois prestadores tentarem aceitar o
   mesmo chamado, só o primeiro consegue (essa é a regra central do TCC).
   Em "Configurações", o prestador também pode trocar sua categoria de
   atendimento após confirmar a alteração. Cada prestador atende um chamado
   por vez: é preciso concluir ou cancelar o atual antes de aceitar outro.
4. Depois de aceitar, o prestador marca "Cheguei ao local" e depois
   "Concluir atendimento". O cliente pode então avaliar o atendimento — a
   nota passa a aparecer no perfil público do prestador. O comentário da
   avaliação pode ter até 500 caracteres.
5. **Esqueceu a senha?** Na tela de login, clique em "Esqueceu sua senha?".
   Sem `SMTP_*` configurado, o link de redefinição aparece no console do
   servidor em vez de ser enviado por e-mail de verdade (procure por
   `[e-mail]` no terminal).
6. **Painel administrativo:** link "Acesso administrativo" no rodapé de
   qualquer tela. Login com `ADMIN_EMAIL`/`ADMIN_SENHA` (ou as credenciais
   padrão, se não tiver configurado nada) — mostra estatísticas gerais,
   todos os chamados (com cancelamento por moderação), todos os usuários e
   permite renomear as categorias de atendimento.

Abra duas abas do navegador (uma logada como cliente, outra como prestador)
para simular o fluxo completo sozinho.

## Decisões técnicas (para citar no TCC)

- **Banco de dados relacional (MySQL)** (`server/db.js`): a API se conecta a
  um banco MySQL cuja estrutura é criada automaticamente na primeira
  execução, com as mesmas entidades do modelo descrito em
  `sos_veiculos_mysql.sql` (na raiz do projeto). Atenção: o script SQL é o
  modelo conceitual e **não precisa ser executado** — as tabelas que a API
  cria usam nomes no plural (`clientes`, `prestadores`, `chamados`…) e
  identificadores UUID em texto, então diferem em detalhes do script. Se o
  MySQL estiver indisponível, o servidor usa um
  modo de fallback em memória só para não travar a demonstração — nesse
  modo os dados não são persistidos entre reinicializações.
- **Sessão simples por token em memória** (`server/auth-middleware.js`):
  no login, o servidor gera um token aleatório e o associa ao usuário; o
  navegador guarda esse token e o envia em cada requisição. Não usa JWT
  nem grava sessão em disco, mantendo o código simples de explicar — o
  efeito colateral é que todos precisam logar de novo se o servidor for
  reiniciado. As sessões expiram após 24 horas, e trocar ou redefinir a senha
  derruba as demais sessões da conta. A conta de administrador usa exatamente o
  mesmo mecanismo e compara a senha com bcrypt.
- **Regra "primeiro que aceita, pega"**: implementada em
  `POST /api/chamados/:id/aceitar` (`server/server.js`). O handler é
  síncrono — não há `await` entre checar se o chamado ainda está livre e
  gravar o prestador vencedor — o que impede duas aceitações simultâneas
  do mesmo chamado.
- **Busca por proximidade simples**: distância calculada por Haversine
  (`server/utils/distancia.js`), sem roteirização — como definido no
  escopo do TCC.
- **Senhas com hash** via `bcryptjs`, nunca armazenadas em texto puro —
  vale também para a senha definida no fluxo de redefinição.
- **Recuperação de senha com fallback de e-mail** (`server/email.js`):
  gera um token de uso único, válido por 1 hora. Sem `SMTP_*` configurado,
  o link é apenas registrado no console (mesmo espírito do fallback do
  banco) — passa a enviar e-mails de verdade assim que essas variáveis
  forem preenchidas, sem nenhuma mudança de código.
- **Mapa sem custo**: Leaflet + tiles do OpenStreetMap (`public/js/mapa.js`),
  carregado via CDN — não exige chave de API nem cadastro em serviço pago.
  O endereço do chamado é convertido em latitude/longitude pelo Nominatim
  (`server/geocodificacao.js`) sob demanda. O backend mantém cache em memória,
  limita as consultas a no máximo 1 por segundo e identifica a aplicação com
  `OSM_USER_AGENT`. Atribuição do OpenStreetMap permanece visível no mapa.
  O Nominatim público não deve ser usado para autocomplete, cargas em lote ou
  envio de dados pessoais; para volume maior, use um provedor compatível ou
  uma instância própria.
- **PWA leve** (`public/manifest.json`, `public/sw.js`): torna o app
  instalável e funcional offline de forma básica. Instalação como app
  exige HTTPS (ou `localhost`) — acessando por IP na rede local o
  navegador não oferece a opção de instalar, só de usar normalmente.

## Estrutura de pastas

```
server/                  API (Node.js/Express)
  server.js              rotas da aplicação (inclui admin e recuperação de senha)
  db.js                  conexão/persistência em MySQL (com fallback em memória)
  auth-middleware.js     sessão/token (cliente, prestador e admin)
  email.js               envio de e-mail (recuperação de senha), com fallback de console
  geocodificacao.js      conversão sob demanda de endereço em coordenadas via Nominatim
  utils/distancia.js     cálculo de distância (Haversine)
public/                  frontend estático
  index.html
  manifest.json          manifesto PWA
  sw.js                  service worker (cache do app shell)
  img/logo.svg           logo da marca (usado como ícone, favicon e no app)
  css/style.css
  js/theme.js            alternância claro/escuro
  js/api.js              chamadas à API
  js/masks.js            máscaras de CPF/telefone
  js/mapa.js             mini-mapa (Leaflet + OpenStreetMap)
  js/app.js              lógica das telas
sos_veiculos_mysql.sql   estrutura das tabelas (DDL) do banco MySQL
migrations/              alterações no banco para quem já tem dados (001: chaves estrangeiras)
.env.example             modelo do .env, com todas as variáveis de ambiente comentadas
.env                     sua configuração local (banco, admin, e-mail) — não vai para o GitHub
```

Para reiniciar os dados do zero, apague e recrie o banco (`DROP DATABASE` +
rodar o servidor de novo, que recria a estrutura e as 4 categorias
automaticamente), ou apague as linhas das tabelas diretamente no MySQL.
