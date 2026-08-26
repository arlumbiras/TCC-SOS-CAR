// =================================================================
// "Banco de dados" do MVP.
//
// Em vez de um SGBD relacional de verdade (PostgreSQL/SQL Server, como
// nos scripts DDL da pasta raiz do TCC), o MVP guarda os dados em um
// único arquivo JSON no disco (data/db.json). Isso evita ter que instalar
// e configurar um servidor de banco só para rodar a demonstração — o
// "banco" inteiro é um objeto JavaScript que é lido na inicialização e
// regravado no arquivo sempre que algo muda.
//
// As "tabelas" viram simplesmente listas (arrays) dentro desse objeto:
// categorias, clientes, prestadores, chamados e avaliacoes — os mesmos
// nomes e campos documentados em banco-dados-explicacao.md.
// =================================================================
const fs = require('fs');
const path = require('path');

// Caminho do arquivo que guarda os dados: sos-barbie/data/db.json
const CAMINHO_DB = path.join(__dirname, '..', 'data', 'db.json');

// Estado inicial do banco, usado apenas na primeira execução (quando o
// arquivo data/db.json ainda não existe). Já vem com as 3 categorias
// fixas do sistema cadastradas, igual ao INSERT de seed do script SQL.
const ESTADO_INICIAL = {
  categorias: [
    { id: 1, nome: 'Mecânico' },
    { id: 2, nome: 'Auto Elétrico' },
    { id: 3, nome: 'Borracheiro' }
  ],
  clientes: [],
  prestadores: [],
  chamados: [],
  avaliacoes: []
};

// Lê o arquivo do disco e devolve o objeto JavaScript correspondente.
// Se o arquivo ainda não existir (primeira vez que o servidor roda),
// cria a pasta "data" e o arquivo com o estado inicial antes de ler.
function carregar() {
  if (!fs.existsSync(CAMINHO_DB)) {
    fs.mkdirSync(path.dirname(CAMINHO_DB), { recursive: true });
    fs.writeFileSync(CAMINHO_DB, JSON.stringify(ESTADO_INICIAL, null, 2));
  }
  return JSON.parse(fs.readFileSync(CAMINHO_DB, 'utf-8'));
}

// "db" é carregado uma única vez, quando o servidor sobe, e fica em
// memória durante toda a execução. Todas as rotas em server.js recebem
// essa mesma referência e mexem diretamente nos arrays dela (por isso
// funções como "salvar()" não recebem parâmetro: elas sempre gravam o
// estado atual desse objeto compartilhado).
const db = carregar();

// Regrava o objeto "db" inteiro no arquivo JSON. Deve ser chamada depois
// de qualquer alteração (inserir, atualizar) para não perder os dados
// quando o servidor for reiniciado.
function salvar() {
  fs.writeFileSync(CAMINHO_DB, JSON.stringify(db, null, 2));
}

module.exports = { db, salvar };
