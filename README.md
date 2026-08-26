# SOS Barbie — MVP

MVP do TCC "Sistema de SOS para Veículos Automotores". Frontend em HTML/CSS/
JavaScript puro (sem framework) e API em Node.js (JavaScript), seguindo o
modelo de dados descrito em `../banco-dados-explicacao.md`.

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org) 16 ou superior instalado.

```
cd sos-barbie
npm install
npm start
```

Depois abra `http://localhost:3000` no navegador.

## Como usar

1. Na tela inicial, escolha **"Sou cliente"** ou **"Sou prestador"** e crie
   uma conta (aba "Criar conta"). Prestadores também escolhem uma categoria
   (Mecânico, Auto Elétrico ou Borracheiro).
2. **Como cliente:** preencha o endereço, clique em "Usar minha localização"
   (o navegador vai pedir permissão de GPS) e solicite o socorro. Acompanhe
   o status do chamado na mesma tela.
3. **Como prestador:** ative o interruptor "Disponível", permita o acesso à
   localização e aguarde os chamados aparecerem na lista. Clique em
   "Aceitar" — se dois prestadores tentarem aceitar o mesmo chamado, só o
   primeiro consegue (essa é a regra central do TCC).
4. Depois de aceitar, o prestador marca "Cheguei ao local" e depois
   "Concluir atendimento". O cliente pode então avaliar o atendimento.

Abra duas abas do navegador (uma logada como cliente, outra como prestador)
para simular o fluxo completo sozinho.

## Decisões técnicas (para citar no TCC)

- **"Banco de dados" em arquivo JSON** (`data/db.json`): o MVP guarda os
  dados em um arquivo local em vez de um SGBD relacional, para não exigir
  a instalação de PostgreSQL/SQL Server só para rodar a demonstração. A
  estrutura dos dados (campos e relacionamentos) é a mesma documentada em
  `banco-dados-explicacao.md` e implementada nos scripts SQL da pasta
  raiz — a migração para um banco relacional de verdade reaproveitaria o
  mesmo desenho de tabelas.
- **Sessão simples por token em memória** (`server/auth-middleware.js`):
  no login, o servidor gera um token aleatório e o associa ao usuário; o
  navegador guarda esse token e o envia em cada requisição. Não usa JWT
  nem grava sessão em disco, mantendo o código simples de explicar — o
  efeito colateral é que todos precisam logar de novo se o servidor for
  reiniciado.
- **Regra "primeiro que aceita, pega"**: implementada em
  `POST /api/chamados/:id/aceitar` (`server/server.js`). O handler é
  síncrono — não há `await` entre checar se o chamado ainda está livre e
  gravar o prestador vencedor — o que impede duas aceitações simultâneas
  do mesmo chamado.
- **Busca por proximidade simples**: distância calculada por Haversine
  (`server/utils/distancia.js`), sem roteirização — como definido no
  escopo do TCC.
- **Senhas com hash** via `bcryptjs`, nunca armazenadas em texto puro.

## Estrutura de pastas

```
sos-barbie/
  server/            API (Node.js/Express)
    server.js         rotas da aplicação
    db.js             persistência em JSON
    auth-middleware.js sessão/token
    utils/distancia.js cálculo de distância (Haversine)
  public/             frontend estático
    index.html
    css/style.css
    js/theme.js        alternância claro/escuro
    js/api.js           chamadas à API
    js/app.js            lógica das telas
  data/db.json        gerado automaticamente na primeira execução
```

Para reiniciar os dados do zero, apague o arquivo `data/db.json` (ele é
recriado automaticamente, já com as 3 categorias de serviço cadastradas).
