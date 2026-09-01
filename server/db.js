const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: '212.85.3.212',
  port: 3306,
  user: 'u815496249_soscar',
  password: 'Sda481@sud',
  database: 'u815496249_soscar',
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

function paraDataHoraMysql(valor) {
  if (!valor) return null;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return valor;
  }

  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  const horas = String(data.getHours()).padStart(2, '0');
  const minutos = String(data.getMinutes()).padStart(2, '0');
  const segundos = String(data.getSeconds()).padStart(2, '0');

  return `${ano}-${mes}-${dia} ${horas}:${minutos}:${segundos}`;
}

function aplicarEstadoPadrao() {
  db.categorias = [
    { id: 1, nome: 'Mecanico' },
    { id: 2, nome: 'borracheiro' },
    { id: 3, nome: 'Auto eletrica' }
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
      senha_hash TEXT NOT NULL,
      telefone VARCHAR(50) NULL,
      cpf VARCHAR(20) NOT NULL UNIQUE,
      data_cadastro DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS prestadores (
      id VARCHAR(36) PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      telefone VARCHAR(50) NULL,
      cpf VARCHAR(20) NOT NULL UNIQUE,
      categoria_id INT NOT NULL,
      disponivel BOOLEAN NOT NULL DEFAULT FALSE,
      latitude DOUBLE NULL,
      longitude DOUBLE NULL,
      data_cadastro DATETIME NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chamados (
      id VARCHAR(36) PRIMARY KEY,
      cliente_id VARCHAR(36) NOT NULL,
      categoria_id INT NOT NULL,
      prestador_id VARCHAR(36) NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      endereco TEXT NULL,
      descricao TEXT NULL,
      status VARCHAR(50) NOT NULL,
      data_abertura DATETIME NOT NULL,
      data_aceite DATETIME NULL,
      data_conclusao DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS avaliacoes (
      id VARCHAR(36) PRIMARY KEY,
      chamado_id VARCHAR(36) NOT NULL UNIQUE,
      nota INT NOT NULL,
      comentario TEXT NULL,
      data_avaliacao DATETIME NOT NULL
    )`
  ];

  for (const consulta of consultas) {
    await conn.query(consulta);
  }

  const [totalCategorias] = await conn.query('SELECT COUNT(*) AS total FROM categorias');
  if (Number(totalCategorias[0].total) === 0) {
    await conn.query(
      'INSERT INTO categorias (id, nome) VALUES (1, ?), (2, ?), (3, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)',
      ['Mecanico', 'borracheiro', 'Auto eletrica']
    );
  }
}

function normalizarCliente(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    senhaHash: row.senha_hash,
    telefone: row.telefone,
    cpf: row.cpf,
    dataCadastro: row.data_cadastro
  };
}

function normalizarPrestador(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    senhaHash: row.senha_hash,
    telefone: row.telefone,
    cpf: row.cpf,
    categoriaId: row.categoria_id,
    disponivel: !!row.disponivel,
    latitude: row.latitude,
    longitude: row.longitude,
    dataCadastro: row.data_cadastro
  };
}

function normalizarChamado(row) {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    categoriaId: row.categoria_id,
    prestadorId: row.prestador_id,
    latitude: row.latitude,
    longitude: row.longitude,
    endereco: row.endereco,
    descricao: row.descricao,
    status: row.status,
    dataAbertura: row.data_abertura,
    dataAceite: row.data_aceite,
    dataConclusao: row.data_conclusao
  };
}

function normalizarAvaliacao(row) {
  return {
    id: row.id,
    chamadoId: row.chamado_id,
    nota: row.nota,
    comentario: row.comentario,
    dataAvaliacao: row.data_avaliacao
  };
}

async function carregar() {
  try {
    await garantirEstrutura();
    const conn = await obterPool();

    const [categorias] = await conn.query('SELECT * FROM categorias ORDER BY id');
    const [clientes] = await conn.query('SELECT * FROM clientes ORDER BY data_cadastro');
    const [prestadores] = await conn.query('SELECT * FROM prestadores ORDER BY data_cadastro');
    const [chamados] = await conn.query('SELECT * FROM chamados ORDER BY data_abertura');
    const [avaliacoes] = await conn.query('SELECT * FROM avaliacoes ORDER BY data_avaliacao');

    modoFallback = false;
    Object.assign(db, {
      categorias,
      clientes: clientes.map(normalizarCliente),
      prestadores: prestadores.map(normalizarPrestador),
      chamados: chamados.map(normalizarChamado),
      avaliacoes: avaliacoes.map(normalizarAvaliacao)
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
            'INSERT INTO clientes (id, nome, email, senha_hash, telefone, cpf, data_cadastro) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cliente.id, cliente.nome, cliente.email, cliente.senhaHash, cliente.telefone, cliente.cpf, paraDataHoraMysql(cliente.dataCadastro)]
          );
        }
      }

      if (Array.isArray(db.prestadores) && db.prestadores.length > 0) {
        for (const prestador of db.prestadores) {
          await conn.query(
            'INSERT INTO prestadores (id, nome, email, senha_hash, telefone, cpf, categoria_id, disponivel, latitude, longitude, data_cadastro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [prestador.id, prestador.nome, prestador.email, prestador.senhaHash, prestador.telefone, prestador.cpf, prestador.categoriaId, !!prestador.disponivel, prestador.latitude ?? null, prestador.longitude ?? null, paraDataHoraMysql(prestador.dataCadastro)]
          );
        }
      }

      if (Array.isArray(db.chamados) && db.chamados.length > 0) {
        for (const chamado of db.chamados) {
          await conn.query(
            'INSERT INTO chamados (id, cliente_id, categoria_id, prestador_id, latitude, longitude, endereco, descricao, status, data_abertura, data_aceite, data_conclusao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [chamado.id, chamado.clienteId, chamado.categoriaId, chamado.prestadorId, chamado.latitude, chamado.longitude, chamado.endereco ?? null, chamado.descricao ?? null, chamado.status, paraDataHoraMysql(chamado.dataAbertura), paraDataHoraMysql(chamado.dataAceite), paraDataHoraMysql(chamado.dataConclusao)]
          );
        }
      }

      if (Array.isArray(db.avaliacoes) && db.avaliacoes.length > 0) {
        for (const avaliacao of db.avaliacoes) {
          await conn.query(
            'INSERT INTO avaliacoes (id, chamado_id, nota, comentario, data_avaliacao) VALUES (?, ?, ?, ?, ?)',
            [avaliacao.id, avaliacao.chamadoId, avaliacao.nota, avaliacao.comentario ?? null, paraDataHoraMysql(avaliacao.dataAvaliacao)]
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
