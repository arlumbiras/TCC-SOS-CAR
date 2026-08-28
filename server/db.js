const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: '10.67.22.216',
  port: 3306,
  user: 'us_des225_soscar',
  password: 'sda481sud',
  database: 'bd_tcc_des_225_soscar',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
};

const db = {
  categorias: [],
  clientes: [],
  prestadores: [],
  chamados: [],
  avaliacoes: []
};

let pool;
let modoFallback = false;

function aplicarEstadoPadrao() {
  db.categorias = [
    { id: 1, nome: 'Mecânico' },
    { id: 2, nome: 'Auto Elétrico' },
    { id: 3, nome: 'Borracheiro' }
  ];
  db.clientes = [];
  db.prestadores = [];
  db.chamados = [];
  db.avaliacoes = [];
  modoFallback = true;
}

async function obterPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  return pool;
}

async function criarBancoSeNecessario() {
  const conexaoBase = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    charset: 'utf8mb4'
  });

  try {
    await conexaoBase.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conexaoBase.end();
  }
}

async function garantirEstrutura() {
  await criarBancoSeNecessario();
  const conn = await obterPool();

  const consultas = [
    `CREATE TABLE IF NOT EXISTS categorias (
      id INT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS clientes (
      id VARCHAR(36) PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      senhaHash TEXT NOT NULL,
      telefone VARCHAR(50) NULL,
      cpf VARCHAR(20) NOT NULL UNIQUE,
      dataCadastro DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS prestadores (
      id VARCHAR(36) PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      senhaHash TEXT NOT NULL,
      telefone VARCHAR(50) NULL,
      cpf VARCHAR(20) NOT NULL UNIQUE,
      categoriaId INT NOT NULL,
      disponivel BOOLEAN NOT NULL DEFAULT FALSE,
      latitude DOUBLE NULL,
      longitude DOUBLE NULL,
      dataCadastro DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chamados (
      id VARCHAR(36) PRIMARY KEY,
      clienteId VARCHAR(36) NOT NULL,
      categoriaId INT NOT NULL,
      prestadorId VARCHAR(36) NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      endereco TEXT NULL,
      descricao TEXT NULL,
      status VARCHAR(50) NOT NULL,
      dataAbertura DATETIME NOT NULL,
      dataAceite DATETIME NULL,
      dataConclusao DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS avaliacoes (
      id VARCHAR(36) PRIMARY KEY,
      chamadoId VARCHAR(36) NOT NULL UNIQUE,
      nota INT NOT NULL,
      comentario TEXT NULL,
      dataAvaliacao DATETIME NOT NULL
    )`
  ];

  for (const consulta of consultas) {
    await conn.query(consulta);
  }

  const [totalCategorias] = await conn.query('SELECT COUNT(*) AS total FROM categorias');
  if (Number(totalCategorias[0].total) === 0) {
    await conn.query(
      'INSERT INTO categorias (id, nome) VALUES (1, ?), (2, ?), (3, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)',
      ['Mecânico', 'Auto Elétrico', 'Borracheiro']
    );
  }
}

async function carregar() {
  try {
    await garantirEstrutura();
    const conn = await obterPool();

    const [categorias] = await conn.query('SELECT * FROM categorias ORDER BY id');
    const [clientes] = await conn.query('SELECT * FROM clientes ORDER BY dataCadastro');
    const [prestadores] = await conn.query('SELECT * FROM prestadores ORDER BY dataCadastro');
    const [chamados] = await conn.query('SELECT * FROM chamados ORDER BY dataAbertura');
    const [avaliacoes] = await conn.query('SELECT * FROM avaliacoes ORDER BY dataAvaliacao');

    modoFallback = false;
    Object.assign(db, {
      categorias,
      clientes,
      prestadores,
      chamados,
      avaliacoes
    });

    return db;
  } catch (erro) {
    console.warn('MySQL indisponível. Usando armazenamento em memória para manter a aplicação aberta.', erro.message);
    aplicarEstadoPadrao();
    return db;
  }
}

async function salvar() {
  if (modoFallback) {
    return db;
  }

  try {
    const conn = await obterPool();

    await conn.query('START TRANSACTION');

    try {
      await conn.query('DELETE FROM avaliacoes');
      await conn.query('DELETE FROM chamados');
      await conn.query('DELETE FROM prestadores');
      await conn.query('DELETE FROM clientes');
      await conn.query('DELETE FROM categorias');

      if (Array.isArray(db.categorias) && db.categorias.length > 0) {
        for (const categoria of db.categorias) {
          await conn.query('INSERT INTO categorias (id, nome) VALUES (?, ?)', [categoria.id, categoria.nome]);
        }
      }

      if (Array.isArray(db.clientes) && db.clientes.length > 0) {
        for (const cliente of db.clientes) {
          await conn.query(
            'INSERT INTO clientes (id, nome, email, senhaHash, telefone, cpf, dataCadastro) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cliente.id, cliente.nome, cliente.email, cliente.senhaHash, cliente.telefone, cliente.cpf, cliente.dataCadastro]
          );
        }
      }

      if (Array.isArray(db.prestadores) && db.prestadores.length > 0) {
        for (const prestador of db.prestadores) {
          await conn.query(
            'INSERT INTO prestadores (id, nome, email, senhaHash, telefone, cpf, categoriaId, disponivel, latitude, longitude, dataCadastro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [prestador.id, prestador.nome, prestador.email, prestador.senhaHash, prestador.telefone, prestador.cpf, prestador.categoriaId, !!prestador.disponivel, prestador.latitude ?? null, prestador.longitude ?? null, prestador.dataCadastro]
          );
        }
      }

      if (Array.isArray(db.chamados) && db.chamados.length > 0) {
        for (const chamado of db.chamados) {
          await conn.query(
            'INSERT INTO chamados (id, clienteId, categoriaId, prestadorId, latitude, longitude, endereco, descricao, status, dataAbertura, dataAceite, dataConclusao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [chamado.id, chamado.clienteId, chamado.categoriaId, chamado.prestadorId, chamado.latitude, chamado.longitude, chamado.endereco ?? null, chamado.descricao ?? null, chamado.status, chamado.dataAbertura, chamado.dataAceite, chamado.dataConclusao]
          );
        }
      }

      if (Array.isArray(db.avaliacoes) && db.avaliacoes.length > 0) {
        for (const avaliacao of db.avaliacoes) {
          await conn.query(
            'INSERT INTO avaliacoes (id, chamadoId, nota, comentario, dataAvaliacao) VALUES (?, ?, ?, ?, ?)',
            [avaliacao.id, avaliacao.chamadoId, avaliacao.nota, avaliacao.comentario ?? null, avaliacao.dataAvaliacao]
          );
        }
      }

      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK');
      throw error;
    }
  } catch (erro) {
    console.warn('Falha ao persistir no MySQL. Mantendo dados em memória apenas.', erro.message);
    modoFallback = true;
    return db;
  }
}

async function inicializarBanco() {
  return carregar();
}

async function testarConexao() {
  try {
    const conn = await obterPool();
    const [resultado] = await conn.query('SELECT 1 AS ok');
    return resultado[0]?.ok === 1;
  } catch (erro) {
    return false;
  }
}

module.exports = { db, salvar, inicializarBanco, testarConexao };
