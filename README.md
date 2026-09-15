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

Por padrão a API se conecta a um banco MySQL remoto já configurado em
`server/db.js`. Se a conexão com o MySQL falhar por qualquer motivo, o
servidor sobe mesmo assim, guardando os dados apenas em memória (modo
fallback) — ou seja, eles se perdem ao reiniciar.

Depois abra `http://localhost:3000` no navegador.

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
| `APP_URL` | Endereço público usado para montar o link enviado por e-mail |
| `PORT`, `HOST` | Porta/host onde o servidor escuta |

## Como usar

1. Na tela inicial, escolha **"Sou cliente"** ou **"Sou prestador"** e crie
   uma conta (aba "Criar conta"). Prestadores também escolhem uma categoria
   (Mecânico, Borracheiro ou Auto Elétrica).
2. **Como cliente:** preencha o endereço, clique em "Usar minha localização"
   (o navegador vai pedir permissão de GPS) e solicite o socorro. Acompanhe
   o status do chamado (com mapa) na mesma tela.
3. **Como prestador:** ative o interruptor "Disponível", permita o acesso à
   localização e aguarde os chamados aparecerem na lista. Clique em
   "Aceitar" — se dois prestadores tentarem aceitar o mesmo chamado, só o
   primeiro consegue (essa é a regra central do TCC).
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
  execução (mesmo desenho de tabelas do script `sos_veiculos_mysql.sql`, na
  raiz do projeto). Se o MySQL estiver indisponível, o servidor usa um
  modo de fallback em memória só para não travar a demonstração — nesse
  modo os dados não são persistidos entre reinicializações.
- **Sessão simples por token em memória** (`server/auth-middleware.js`):
  no login, o servidor gera um token aleatório e o associa ao usuário; o
  navegador guarda esse token e o envia em cada requisição. Não usa JWT
  nem grava sessão em disco, mantendo o código simples de explicar — o
  efeito colateral é que todos precisam logar de novo se o servidor for
  reiniciado. As sessões expiram após 24 horas. A conta de administrador usa
  exatamente o mesmo mecanismo e compara a senha com bcrypt.
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
.env.example             lista comentada de todas as variáveis de ambiente
```

Para reiniciar os dados do zero, apague e recrie o banco (`DROP DATABASE` +
rodar o servidor de novo, que recria a estrutura e as 3 categorias
automaticamente), ou apague as linhas das tabelas diretamente no MySQL.
