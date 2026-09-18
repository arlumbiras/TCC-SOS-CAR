const mysql = require('mysql2/promise');

// Credenciais vêm de variáveis de ambiente (DB_HOST, DB_PORT, DB_USER,
// DB_PASSWORD, DB_NAME). Os valores fixos abaixo são só um fallback para
// não quebrar quem já rodava o projeto sem configurar nada — em produção,
// defina as variáveis de ambiente e, principalmente, troque a senha do
// banco (ela não deveria nunca ter ficado hardcoded/versionada aqui).
const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sos_car',
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
  avaliacoes: [],
  redefinicoesSenha: []
};

let pool;
// true = MySQL indisponível na inicialização; tudo fica só em memória. Não
// volta a false sozinho de propósito: gravar o estado em memória (vazio) por
// cima de um banco que não conseguimos ler apagaria os dados reais.
let modoFallback = false;
// Mensagem do último erro ao gravar no MySQL (null = última gravação ok).
let ultimaFalhaPersistencia = null;

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
    { id: 1, nome: 'Mecânico' },
    { id: 2, nome: 'Borracheiro' },
    { id: 3, nome: 'Auto Elétrica' },
    { id: 4, nome: 'Guincho' }
  ];
  db.clientes = [];
  db.prestadores = [];
  db.chamados = [];
  db.avaliacoes = [];
  db.redefinicoesSenha = [];
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
  try {
    await criarBancoSeNecessario();
  } catch (erro) {
    // Em hospedagem compartilhada (ex.: Hostinger) o banco já vem criado pelo
    // painel e o usuário não tem permissão de CREATE DATABASE — o erro é
    // esperado e não impede o uso. Se o banco realmente não existir ou o
    // servidor estiver inacessível, a conexão logo abaixo falha com a
    // mensagem certa.
    console.warn(`Não foi possível criar/verificar o banco "${DB_CONFIG.database}" (seguindo com o banco existente):`, erro.message);
  }
  const conn = await obterPool();

  // A ordem importa: cada tabela só pode referenciar (FOREIGN KEY) uma que já
  // foi criada. Bancos que já existiam antes das chaves estrangeiras recebem
  // as mesmas regras por migrations/001_integridade.sql — o IF NOT EXISTS
  // abaixo não altera tabelas antigas.
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
      aprovado BOOLEAN NOT NULL DEFAULT FALSE,
      disponivel BOOLEAN NOT NULL DEFAULT FALSE,
      latitude DOUBLE NULL,
      longitude DOUBLE NULL,
      data_cadastro DATETIME NOT NULL,
      CONSTRAINT fk_prestadores_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id)
    )`,
    `ALTER TABLE prestadores ADD COLUMN IF NOT EXISTS aprovado BOOLEAN NOT NULL DEFAULT FALSE`,
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
      data_conclusao DATETIME NULL,
      CONSTRAINT fk_chamados_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      CONSTRAINT fk_chamados_prestador FOREIGN KEY (prestador_id) REFERENCES prestadores(id),
      CONSTRAINT fk_chamados_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id),
      CONSTRAINT chk_chamados_status CHECK (status IN ('aberto','aceito','em_andamento','concluido','cancelado'))
    )`,
    `CREATE TABLE IF NOT EXISTS avaliacoes (
      id VARCHAR(36) PRIMARY KEY,
      chamado_id VARCHAR(36) NOT NULL UNIQUE,
      nota INT NOT NULL,
      comentario TEXT NULL,
      data_avaliacao DATETIME NOT NULL,
      CONSTRAINT fk_avaliacoes_chamado FOREIGN KEY (chamado_id) REFERENCES chamados(id),
      CONSTRAINT chk_avaliacoes_nota CHECK (nota BETWEEN 1 AND 5)
    )`,
    `CREATE TABLE IF NOT EXISTS redefinicoes_senha (
      token VARCHAR(64) PRIMARY KEY,
      tipo VARCHAR(20) NOT NULL,
      usuario_id VARCHAR(36) NOT NULL,
      expira_em DATETIME NOT NULL
    )`
  ];

  for (const consulta of consultas) {
    await conn.query(consulta);
  }

  // Sempre reafirma o nome oficial das categorias (id fixo), mesmo que
  // elas já existam — corrige automaticamente qualquer nome gravado antes
  // sem acento/capitalização errada (ex.: "Mecanico", "auto eletrica"),
  // sem duplicar linhas nem afetar chamados/prestadores já vinculados ao
  // mesmo id.
  await conn.query(
    'INSERT INTO categorias (id, nome) VALUES (1, ?), (2, ?), (3, ?), (4, ?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)',
    ['Mecânico', 'Borracheiro', 'Auto Elétrica', 'Guincho']
  );
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
    aprovado: row.aprovado === undefined ? true : !!row.aprovado,
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

function normalizarRedefinicao(row) {
  return {
    token: row.token,
    tipo: row.tipo,
    usuarioId: row.usuario_id,
    expiraEm: row.expira_em
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
    const [redefinicoes] = await conn.query('SELECT * FROM redefinicoes_senha');

    modoFallback = false;
    const agora = new Date();
    Object.assign(db, {
      categorias,
      clientes: clientes.map(normalizarCliente),
      prestadores: prestadores.map(normalizarPrestador),
      chamados: chamados.map(normalizarChamado),
      avaliacoes: avaliacoes.map(normalizarAvaliacao),
      // Tokens vencidos são descartados aqui (e somem do banco na próxima
      // gravação). O filtro é feito em JS, não com NOW() no SQL, porque o
      // fuso horário do servidor MySQL pode ser diferente do fuso do Node,
      // que é quem grava as datas.
      redefinicoesSenha: redefinicoes.map(normalizarRedefinicao).filter((r) => new Date(r.expiraEm) > agora)
    });

    return db;
  } catch (erro) {
    console.warn('MySQL indisponível. Usando armazenamento em memória para manter a aplicação aberta.', erro.message);
    aplicarEstadoPadrao();
    return db;
  }
}

// Grava o estado inteiro de "db" no MySQL (DELETE + INSERT de tudo, dentro
// de uma transação). Não lança erro: se falhar, registra o motivo e os dados
// seguem em memória — como cada gravação é um retrato completo do estado, a
// próxima que der certo já recupera tudo o que ficou para trás.
async function gravarSnapshot() {
  let conn;
  try {
    // A transação precisa ficar presa a UMA conexão. Com pool.query(), cada
    // comando pode cair numa conexão diferente, e o START TRANSACTION /
    // COMMIT não valeria para os demais.
    conn = await (await obterPool()).getConnection();
    await conn.beginTransaction();

    try {
      await conn.query('DELETE FROM redefinicoes_senha');
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
            'INSERT INTO prestadores (id, nome, email, senha_hash, telefone, cpf, categoria_id, aprovado, disponivel, latitude, longitude, data_cadastro) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [prestador.id, prestador.nome, prestador.email, prestador.senhaHash, prestador.telefone, prestador.cpf, prestador.categoriaId, prestador.aprovado !== undefined ? !!prestador.aprovado : true, !!prestador.disponivel, prestador.latitude ?? null, prestador.longitude ?? null, paraDataHoraMysql(prestador.dataCadastro)]
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

      if (Array.isArray(db.redefinicoesSenha) && db.redefinicoesSenha.length > 0) {
        for (const redefinicao of db.redefinicoesSenha) {
          await conn.query(
            'INSERT INTO redefinicoes_senha (token, tipo, usuario_id, expira_em) VALUES (?, ?, ?, ?)',
            [redefinicao.token, redefinicao.tipo, redefinicao.usuarioId, paraDataHoraMysql(redefinicao.expiraEm)]
          );
        }
      }

      await conn.commit();
    } catch (erro) {
      await conn.rollback().catch(() => {});
      throw erro;
    }
    ultimaFalhaPersistencia = null;
  } catch (erro) {
    ultimaFalhaPersistencia = erro.message;
    console.error(
      'Falha ao gravar no MySQL. Os dados seguem em memória e serão gravados de novo na próxima alteração:',
      erro.message
    );
  } finally {
    if (conn) conn.release();
  }
  return db;
}

let gravacaoEmAndamento = null;
let gravacaoPendente = null;

// Ponto de entrada das rotas ("await salvar()"). Duas gravações ao mesmo
// tempo — DELETE + INSERT de todas as tabelas em transações concorrentes —
// podem se bloquear (deadlock) no MySQL. Por isso: no máximo uma roda por
// vez, e todos os pedidos que chegam durante ela são agrupados numa única
// gravação seguinte (que já enxerga todas as alterações feitas até ali).
function salvar() {
  if (modoFallback) return Promise.resolve(db);

  if (!gravacaoEmAndamento) {
    gravacaoEmAndamento = gravarSnapshot().finally(() => {
      gravacaoEmAndamento = null;
    });
    return gravacaoEmAndamento;
  }

  if (!gravacaoPendente) {
    gravacaoPendente = gravacaoEmAndamento.then(() => {
      gravacaoPendente = null;
      return salvar();
    });
  }
  return gravacaoPendente;
}

// Estado do armazenamento, para o /health: "mysql" ou "memoria" (fallback),
// e a mensagem do último erro de gravação (null se está tudo certo).
function estadoPersistencia() {
  return {
    armazenamento: modoFallback ? 'memoria' : 'mysql',
    ultimaFalha: ultimaFalhaPersistencia
  };
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

module.exports = { db, salvar, inicializarBanco, testarConexao, estadoPersistencia };
