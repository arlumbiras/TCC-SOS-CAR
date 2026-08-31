// =================================================================
// API do SOS Barbie — servidor Express (Node.js).
//
// Este arquivo define todas as rotas HTTP da aplicação: cadastro/login,
// abertura de chamados, aceite por prestadores, andamento do
// atendimento e avaliação. As regras de negócio do TCC (documentadas em
// banco-dados-explicacao.md) são implementadas aqui, na camada da API,
// já que o "banco" (db.js) é só um arquivo JSON sem lógica própria.
// =================================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const os = require('os');

const { db, salvar, inicializarBanco } = require('./db');
const { criarSessao, encerrarSessao, autenticar } = require('./auth-middleware');
const { distanciaKm } = require('./utils/distancia');

const app = express();
const PORTA = process.env.PORT || 8080;

function paraDataHoraMysql(valor = new Date()) {
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

// express.json() lê o corpo das requisições (ex.: os dados de um
// formulário enviados em JSON) e disponibiliza em req.body.
app.use(express.json());

// express.static serve os arquivos da pasta "public" diretamente (HTML,
// CSS, JS do frontend). Como o frontend e a API rodam no mesmo servidor
// e na mesma porta, não é preciso configurar CORS.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------
// Categorias (equivalente à tabela categoria_servico do banco relacional)
// ---------------------------------------------------------------

// Lista as 3 categorias fixas do sistema. Usada pelo frontend para
// montar os <select> de categoria no cadastro de prestador e na
// abertura de chamado.
app.get('/api/categorias', (req, res) => {
  res.json(db.categorias);
});

// ---------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------

// Cria uma nova conta de cliente OU de prestador (o campo "tipo" no
// corpo da requisição decide qual). Depois de cadastrar, já efetua o
// login automaticamente (devolve um token), para o usuário não precisar
// preencher o formulário de login logo em seguida.
app.post('/api/auth/registrar', async (req, res) => {
  const { tipo, nome, email, senha, telefone, cpf, categoriaId } = req.body;

  // --- validações básicas de entrada ---
  if (!['cliente', 'prestador'].includes(tipo)) {
    return res.status(400).json({ erro: 'Tipo de usuário inválido.' });
  }
  if (!nome || !email || !senha || !cpf) {
    return res.status(400).json({ erro: 'Preencha nome, email, senha e CPF.' });
  }
  if (tipo === 'prestador' && !db.categorias.some((c) => c.id === Number(categoriaId))) {
    return res.status(400).json({ erro: 'Selecione uma categoria de atendimento válida.' });
  }

  // "colecao" aponta para o array certo (clientes ou prestadores),
  // evitando duplicar o código de cadastro para os dois casos.
  const colecao = tipo === 'cliente' ? db.clientes : db.prestadores;

  // Equivalente às restrições UNIQUE (email, cpf) do banco relacional:
  // aqui quem garante que não existam duplicados é o próprio código.
  const jaExiste = colecao.some((u) => u.email === email || u.cpf === cpf);
  if (jaExiste) {
    return res.status(409).json({ erro: 'Já existe um cadastro com este email ou CPF.' });
  }

  // Nunca guardamos a senha em texto puro: bcrypt gera um hash (texto
  // embaralhado e irreversível) a partir da senha. No login, comparamos
  // a senha digitada com esse hash (ver bcrypt.compare mais abaixo),
  // sem nunca precisar "descriptografar" nada.
  const senhaHash = await bcrypt.hash(senha, 10);

  const usuario = {
    id: crypto.randomUUID(), // identificador único (equivalente ao SERIAL/IDENTITY do SQL)
    nome,
    email,
    senhaHash,
    telefone: telefone || null,
    cpf,
    dataCadastro: paraDataHoraMysql()
  };

  // Prestador tem campos extras que cliente não tem (ver
  // banco-dados-explicacao.md, seção 3.3): categoria, disponibilidade e
  // localização atual.
  if (tipo === 'prestador') {
    usuario.categoriaId = Number(categoriaId);
    usuario.disponivel = false;
    usuario.latitude = null;
    usuario.longitude = null;
  }

  colecao.push(usuario); // "INSERT" na tabela em memória
  salvar(); // grava a mudança no arquivo data/db.json

  const token = criarSessao(tipo, usuario.id);
  // "paraPublico" remove a senhaHash antes de devolver o usuário — o
  // frontend nunca deve receber esse dado, nem por engano.
  res.status(201).json({ token, usuario: paraPublico(tipo, usuario) });
});

// Login: recebe tipo + email + senha, confere a senha contra o hash
// salvo e, se bater, devolve um novo token de sessão.
app.post('/api/auth/login', async (req, res) => {
  const { tipo, email, senha } = req.body;
  const colecao = tipo === 'cliente' ? db.clientes : tipo === 'prestador' ? db.prestadores : null;
  const usuario = colecao && colecao.find((u) => u.email === email);

  // bcrypt.compare faz o hash da senha digitada com o mesmo algoritmo e
  // compara com o hash salvo — sem nunca reverter o hash original.
  const senhaValida = usuario && (await bcrypt.compare(senha, usuario.senhaHash));

  if (!senhaValida) {
    // Mensagem genérica de propósito: não dizemos se foi o email ou a
    // senha que errou, para não ajudar quem estiver tentando adivinhar
    // credenciais de outra pessoa.
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });
  }

  const token = criarSessao(tipo, usuario.id);
  res.json({ token, usuario: paraPublico(tipo, usuario) });
});

// Logout: apenas invalida o token atual (ver auth-middleware.js).
app.post('/api/auth/logout', autenticar(), (req, res) => {
  encerrarSessao(req.token);
  res.status(204).end(); // 204 = "sucesso, sem conteúdo para devolver"
});

// Usada pelo frontend ao carregar a página: se já existir um token
// salvo no navegador (localStorage), essa rota confirma se ele ainda é
// válido e devolve os dados do usuário logado, evitando pedir login de
// novo a cada vez que a página é recarregada.
app.get('/api/auth/me', autenticar(), (req, res) => {
  const usuario = buscarUsuario(req.sessao.tipo, req.sessao.id);
  res.json({ tipo: req.sessao.tipo, usuario: paraPublico(req.sessao.tipo, usuario) });
});

// Atualiza dados do usuário logado (nome, telefone e/ou senha).
app.patch('/api/auth/atualizar', autenticar(), async (req, res) => {
  const usuario = buscarUsuario(req.sessao.tipo, req.sessao.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const { nome, telefone, senha } = req.body;
  if (typeof nome === 'string' && nome.trim()) usuario.nome = nome.trim();
  if (typeof telefone === 'string') usuario.telefone = telefone.trim() || null;
  if (senha) {
    usuario.senhaHash = await bcrypt.hash(senha, 10);
  }

  salvar();
  res.json(paraPublico(req.sessao.tipo, usuario));
});

// ---------------------------------------------------------------
// Prestador: disponibilidade e localização
// ---------------------------------------------------------------

// O prestador chama essa rota sempre que liga/desliga o interruptor de
// disponibilidade, e também em segundo plano quando o navegador consegue
// uma nova localização GPS. Só atualiza os campos que vierem preenchidos
// no corpo da requisição (permite atualizar só a localização, ou só a
// disponibilidade, sem precisar mandar tudo de novo).
app.patch('/api/prestador/disponibilidade', autenticar(['prestador']), (req, res) => {
  const prestador = buscarUsuario('prestador', req.sessao.id);
  const { disponivel, latitude, longitude } = req.body;

  if (typeof disponivel === 'boolean') prestador.disponivel = disponivel;
  if (typeof latitude === 'number') prestador.latitude = latitude;
  if (typeof longitude === 'number') prestador.longitude = longitude;

  salvar();
  res.json(paraPublico('prestador', prestador));
});

// ---------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------

// Cliente abre um novo chamado de socorro. Nasce sempre com
// status "aberto" e prestadorId nulo — ninguém foi vinculado ainda.
app.post('/api/chamados', autenticar(['cliente']), (req, res) => {
  const { categoriaId, latitude, longitude, endereco, descricao } = req.body;

  if (!db.categorias.some((c) => c.id === Number(categoriaId))) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ erro: 'Informe a localização (latitude/longitude).' });
  }

  // Regra simples de bom uso: um cliente não pode abrir um segundo
  // chamado enquanto já tiver um em andamento (aberto, aceito ou a
  // caminho). Evita pedidos duplicados por engano.
  const jaTemChamadoAberto = db.chamados.some(
    (c) => c.clienteId === req.sessao.id && ['aberto', 'aceito', 'em_andamento'].includes(c.status)
  );
  if (jaTemChamadoAberto) {
    return res.status(409).json({ erro: 'Você já tem um chamado em andamento.' });
  }

  const chamado = {
    id: crypto.randomUUID(),
    clienteId: req.sessao.id,
    categoriaId: Number(categoriaId),
    prestadorId: null, // preenchido só quando um prestador aceitar (ver rota /aceitar)
    latitude,
    longitude,
    endereco: endereco || null,
    descricao: descricao || null,
    status: 'aberto', // ciclo de vida: aberto -> aceito -> em_andamento -> concluido (ou cancelado)
    dataAbertura: paraDataHoraMysql(),
    dataAceite: null,
    dataConclusao: null
  };
  db.chamados.push(chamado);
  salvar();

  res.status(201).json(montarChamado(chamado));
});

// Lista, para o prestador logado, os chamados abertos da categoria dele
// que estejam dentro de um raio de distância (busca simples por
// proximidade, sem roteirização — ver utils/distancia.js).
//
// Importante: aqui usamos "montarResumoChamado" (não "montarChamado"),
// que NÃO inclui nome/telefone do cliente. Igual em apps de corrida
// reais, o prestador só vê os dados de contato do cliente depois de
// aceitar o chamado — antes disso, veria só endereço/descrição/distância.
app.get('/api/chamados/disponiveis', autenticar(['prestador']), (req, res) => {
  const prestador = buscarUsuario('prestador', req.sessao.id);
  const raioKm = Number(req.query.raio) || 15; // raio padrão: 15 km

  const disponiveis = db.chamados
    .filter((c) => c.status === 'aberto' && c.categoriaId === prestador.categoriaId)
    .map((c) => ({
      ...montarResumoChamado(c),
      distanciaKm: distanciaKm(prestador.latitude, prestador.longitude, c.latitude, c.longitude)
    }))
    // Se não der para calcular a distância (prestador sem GPS ainda),
    // deixamos o chamado aparecer mesmo assim, para não travar o uso do
    // sistema por falta de permissão de localização.
    .filter((c) => c.distanciaKm === null || c.distanciaKm <= raioKm)
    .sort((a, b) => (a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity));

  res.json(disponiveis);
});

// Aceitar chamado: a regra de negócio central do TCC ("o primeiro
// prestador que aceitar fica com o chamado").
//
// Por que isso é seguro mesmo com vários prestadores tentando aceitar ao
// mesmo tempo: o Node.js executa apenas um "pedaço" de código JavaScript
// por vez (é single-threaded). Como esta função não tem nenhum "await"
// entre a linha que CONFERE se o chamado ainda está livre e a linha que
// GRAVA o prestador vencedor, o Node não consegue "pausar" no meio dela
// para atender outra requisição. Ou seja: mesmo que duas requisições de
// "aceitar" cheguem quase no mesmo instante, elas são processadas uma
// de cada vez, nunca ao mesmo tempo — a segunda sempre vai encontrar
// chamado.prestadorId já preenchido e recebe o erro 409.
app.post('/api/chamados/:id/aceitar', autenticar(['prestador']), (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

  const prestador = buscarUsuario('prestador', req.sessao.id);
  if (chamado.categoriaId !== prestador.categoriaId) {
    return res.status(403).json({ erro: 'Este chamado não é da sua categoria de atendimento.' });
  }
  // Checagem que implementa a regra central: só aceita se NINGUÉM
  // ainda tiver aceitado (status ainda "aberto" e prestadorId nulo).
  if (chamado.status !== 'aberto' || chamado.prestadorId !== null) {
    return res.status(409).json({ erro: 'Este chamado já foi aceito por outro prestador.' });
  }

  chamado.prestadorId = prestador.id; // "trava" o chamado para este prestador
  chamado.status = 'aceito';
  chamado.dataAceite = paraDataHoraMysql();
  salvar();

  res.json(montarChamado(chamado));
});

// Devolve o chamado "ativo" do usuário logado (cliente ou prestador),
// ou seja, o que ainda não terminou (aberto, aceito ou a caminho). Usada
// pelo frontend para decidir se mostra o formulário de "pedir socorro" /
// lista de chamados disponíveis, ou a tela de acompanhamento.
app.get('/api/chamados/atual', autenticar(), (req, res) => {
  const emAndamento = ['aberto', 'aceito', 'em_andamento'];
  const chamado =
    req.sessao.tipo === 'cliente'
      ? db.chamados.find((c) => c.clienteId === req.sessao.id && emAndamento.includes(c.status))
      : db.chamados.find((c) => c.prestadorId === req.sessao.id && emAndamento.includes(c.status));

  res.json(chamado ? montarChamado(chamado) : null);
});

// Prestador avisa que chegou ao local e vai começar o atendimento
// (aceito -> em_andamento).
app.post('/api/chamados/:id/iniciar', autenticar(['prestador']), (req, res) => {
  const chamado = pegarChamadoDoPrestador(req);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (chamado.status !== 'aceito') {
    return res.status(409).json({ erro: 'Este chamado não está aguardando início de atendimento.' });
  }
  chamado.status = 'em_andamento';
  salvar();
  res.json(montarChamado(chamado));
});

// Prestador marca o atendimento como concluído (aceito ou em_andamento
// -> concluido). Permite concluir direto a partir de "aceito" também,
// caso o prestador esqueça de marcar "cheguei ao local" antes.
app.post('/api/chamados/:id/concluir', autenticar(['prestador']), (req, res) => {
  const chamado = pegarChamadoDoPrestador(req);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!['aceito', 'em_andamento'].includes(chamado.status)) {
    return res.status(409).json({ erro: 'Este chamado não pode ser concluído neste momento.' });
  }
  chamado.status = 'concluido';
  chamado.dataConclusao = paraDataHoraMysql();
  salvar();
  res.json(montarChamado(chamado));
});

// Cliente cancela o próprio chamado — só é permitido enquanto nenhum
// prestador tiver aceitado ainda (status "aberto").
app.post('/api/chamados/:id/cancelar', autenticar(['cliente']), (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.clienteId === req.sessao.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (chamado.status !== 'aberto') {
    return res.status(409).json({ erro: 'Só é possível cancelar um chamado que ainda não foi aceito.' });
  }
  chamado.status = 'cancelado';
  salvar();
  res.json(montarChamado(chamado));
});

// Histórico de chamados já finalizados (concluídos ou cancelados) do
// usuário logado — cliente vê os que ele abriu, prestador vê os que ele
// atendeu. Ordenado do mais recente para o mais antigo.
app.get('/api/chamados/historico', autenticar(), (req, res) => {
  const finalizados = ['concluido', 'cancelado'];
  const lista =
    req.sessao.tipo === 'cliente'
      ? db.chamados.filter((c) => c.clienteId === req.sessao.id && finalizados.includes(c.status))
      : db.chamados.filter((c) => c.prestadorId === req.sessao.id && finalizados.includes(c.status));

  res.json(
    lista
      .map(montarChamado)
      .sort((a, b) => new Date(b.dataAbertura) - new Date(a.dataAbertura))
  );
});

// Cliente avalia um chamado já concluído (nota de 1 a 5 + comentário
// opcional). A checagem "já foi avaliado?" é o que garante, no código,
// o mesmo efeito da restrição UNIQUE(id_chamado) do banco relacional:
// no máximo uma avaliação por chamado.
app.post('/api/chamados/:id/avaliacao', autenticar(['cliente']), (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.clienteId === req.sessao.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (chamado.status !== 'concluido') {
    return res.status(409).json({ erro: 'Só é possível avaliar um chamado concluído.' });
  }
  if (db.avaliacoes.some((a) => a.chamadoId === chamado.id)) {
    return res.status(409).json({ erro: 'Este chamado já foi avaliado.' });
  }

  const notaNum = Number(req.body.nota);
  if (!Number.isInteger(notaNum) || notaNum < 1 || notaNum > 5) {
    return res.status(400).json({ erro: 'A nota deve ser um número inteiro de 1 a 5.' });
  }

  const avaliacao = {
    id: crypto.randomUUID(),
    chamadoId: chamado.id,
    nota: notaNum,
    comentario: req.body.comentario || null,
    dataAvaliacao: paraDataHoraMysql()
  };
  db.avaliacoes.push(avaliacao);
  salvar();

  res.status(201).json(avaliacao);
});

// ---------------------------------------------------------------
// Funções auxiliares
//
// Ficam depois das rotas só por organização — em JavaScript, funções
// declaradas com "function" são "hoisted" (o interpretador já conhece
// todas elas antes de rodar o arquivo), então a ordem de declaração não
// importa para poder usá-las lá em cima.
// ---------------------------------------------------------------

// Busca um cliente ou prestador pelo id, dentro da coleção certa.
function buscarUsuario(tipo, id) {
  const colecao = tipo === 'cliente' ? db.clientes : db.prestadores;
  return colecao.find((u) => u.id === id);
}

// Prepara um usuário para ser enviado ao frontend: tira o campo
// "senhaHash" (nunca deve sair do servidor) e, se for prestador,
// acrescenta o nome da categoria (mais prático para exibir na tela do
// que só o id numérico).
function paraPublico(tipo, usuario) {
  const { senhaHash, ...resto } = usuario; // "..." copia tudo, menos o que foi desestruturado antes
  if (tipo === 'prestador') {
    resto.categoriaNome = db.categorias.find((c) => c.id === usuario.categoriaId)?.nome;
  }
  return resto;
}

// Busca um chamado pelo id, mas só se ele pertencer ao prestador logado
// (evita que um prestador manipule o chamado de outro trocando o id na URL).
function pegarChamadoDoPrestador(req) {
  return db.chamados.find((c) => c.id === req.params.id && c.prestadorId === req.sessao.id);
}

// Versão "pública" de um chamado, sem nenhum dado pessoal do cliente —
// é o que qualquer prestador da categoria certa pode ver antes de aceitar.
function montarResumoChamado(chamado) {
  const categoria = db.categorias.find((c) => c.id === chamado.categoriaId);
  return {
    id: chamado.id,
    categoriaNome: categoria?.nome,
    endereco: chamado.endereco,
    descricao: chamado.descricao,
    status: chamado.status,
    dataAbertura: chamado.dataAbertura
  };
}

// Versão completa do chamado, com os dados de cliente e (se já tiver
// sido aceito) do prestador — usada quando o chamado já "pertence" a
// quem está consultando: o próprio cliente que abriu, ou o prestador
// que aceitou.
function montarChamado(chamado) {
  const cliente = buscarUsuario('cliente', chamado.clienteId);
  const prestador = chamado.prestadorId ? buscarUsuario('prestador', chamado.prestadorId) : null;
  const categoria = db.categorias.find((c) => c.id === chamado.categoriaId);
  const avaliacao = db.avaliacoes.find((a) => a.chamadoId === chamado.id) || null;

  return {
    ...chamado, // todos os campos originais do chamado (id, status, datas, etc.)
    categoriaNome: categoria?.nome,
    clienteNome: cliente?.nome,
    clienteTelefone: cliente?.telefone,
    prestadorNome: prestador?.nome || null,
    prestadorTelefone: prestador?.telefone || null,
    avaliacao
  };
}

const HOST = process.env.HOST || '0.0.0.0';

function obterIpLocal() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // procuramos por IPv4 não-interna (não loopback)
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

inicializarBanco()
  .catch((erro) => {
    console.warn('Inicialização do banco falhou; iniciando servidor em modo fallback.', erro.message);
  })
  .finally(() => {
    app.listen(PORTA, HOST, () => {
      const ipLocal = obterIpLocal();
      if (ipLocal) {
        console.log(`SOS Car rodando em:
  - http://localhost:${PORTA}
  - http://${ipLocal}:${PORTA} (rede local)`);
      } else {
        console.log(`SOS Car rodando em http://localhost:${PORTA} (host ${HOST})`);
      }
    });
  });
