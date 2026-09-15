// =================================================================
// API do SOS Car — servidor Express (Node.js).
//
// Este arquivo define todas as rotas HTTP da aplicação: cadastro/login,
// abertura de chamados, aceite por prestadores, andamento do
// atendimento e avaliação. As regras de negócio do TCC (o modelo de
// dados está documentado em sos_veiculos_mysql.sql, na raiz do projeto)
// são implementadas aqui, na camada da API — o db.js só cuida de
// carregar/gravar esses dados no MySQL.
// =================================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const os = require('os');

const { db, salvar, inicializarBanco } = require('./db');
const { criarSessao, encerrarSessao, autenticar } = require('./auth-middleware');
const { distanciaKm } = require('./utils/distancia');
const { enviarEmailRedefinicao } = require('./email');
const { geocodificar } = require('./geocodificacao');

const app = express();
const PORTA = process.env.PORT || 3000;

// Conta única de administrador, sem tela pública de cadastro — só existe
// via estas duas variáveis de ambiente. Os valores abaixo são apenas um
// fallback para não travar quem sobe o projeto sem configurar nada (igual
// ao espírito do fallback de banco em server/db.js): troque-os em
// produção definindo ADMIN_EMAIL/ADMIN_SENHA antes de rodar `npm start`.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@soscar.com';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'admin123';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_SENHA) {
  console.warn(
    `Usando credenciais padrão de administrador (${ADMIN_EMAIL} / ${ADMIN_SENHA}). Defina ADMIN_EMAIL e ADMIN_SENHA antes de usar em produção.`
  );
}

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

function coordenadasValidas(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
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

app.get('/api/localizacao/geocodificar', async (req, res) => {
  const endereco = typeof req.query.endereco === 'string' ? req.query.endereco : '';
  if (endereco.trim().length < 5) {
    return res.status(400).json({ erro: 'Informe um endereço válido para localizar.' });
  }

  try {
    const localizacao = await geocodificar(endereco);
    if (!localizacao) {
      return res.status(404).json({ erro: 'Endereço não encontrado. Confira os dados informados.' });
    }
    res.json(localizacao);
  } catch (erro) {
    console.error('Falha na geocodificação:', erro.message);
    res.status(502).json({ erro: 'Não foi possível localizar o endereço agora. Tente novamente.' });
  }
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
  if (
    typeof nome !== 'string' ||
    !nome.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof senha !== 'string' ||
    senha.length < 4 ||
    typeof cpf !== 'string' ||
    !cpf.trim()
  ) {
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

  // Prestador tem campos extras que cliente não tem (ver tabela
  // "prestador" em sos_veiculos_mysql.sql): categoria, disponibilidade e
  // localização atual.
  if (tipo === 'prestador') {
    usuario.categoriaId = Number(categoriaId);
    usuario.disponivel = false;
    usuario.latitude = null;
    usuario.longitude = null;
  }

  colecao.push(usuario); // "INSERT" na tabela em memória
  salvar(); // persiste a mudança no MySQL (ou mantém só em memória, se o banco estiver indisponível)

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

// Pede a redefinição de senha: gera um token válido por 1 hora e envia
// por e-mail (ver server/email.js). Responde sempre com sucesso
// genérico, exista ou não o e-mail informado — evita que alguém use esta
// rota para descobrir quais e-mails estão cadastrados no sistema.
app.post('/api/auth/esqueci-senha', async (req, res) => {
  const { tipo, email } = req.body;
  const colecao = tipo === 'cliente' ? db.clientes : tipo === 'prestador' ? db.prestadores : null;
  const usuario = colecao && colecao.find((u) => u.email === email);

  if (usuario) {
    const token = crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    db.redefinicoesSenha = db.redefinicoesSenha.filter((r) => r.usuarioId !== usuario.id);
    db.redefinicoesSenha.push({ token, tipo, usuarioId: usuario.id, expiraEm: paraDataHoraMysql(expiraEm) });
    salvar();
    await enviarEmailRedefinicao({ paraEmail: usuario.email, nome: usuario.nome, tipo, token });
  }

  res.json({ mensagem: 'Se o email informado estiver cadastrado, enviaremos um link de redefinição.' });
});

// Conclui a redefinição: valida o token (existe e não expirou) e troca a
// senha. O token é descartado logo em seguida, funcione ou não — um
// token só pode ser usado uma vez.
app.post('/api/auth/redefinir-senha', async (req, res) => {
  const { token, novaSenha } = req.body;
  const redefinicao = db.redefinicoesSenha.find((r) => r.token === token);

  if (!redefinicao || new Date(redefinicao.expiraEm) < new Date()) {
    return res.status(400).json({ erro: 'Link de redefinição inválido ou expirado. Peça um novo.' });
  }
  if (!novaSenha || novaSenha.length < 4) {
    return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 4 caracteres.' });
  }

  const usuario = buscarUsuario(redefinicao.tipo, redefinicao.usuarioId);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  usuario.senhaHash = await bcrypt.hash(novaSenha, 10);
  db.redefinicoesSenha = db.redefinicoesSenha.filter((r) => r.token !== token);
  salvar();

  res.json({ mensagem: 'Senha redefinida com sucesso.' });
});

// Login exclusivo do administrador — não existe cadastro público para
// este tipo de usuário, só as credenciais fixas definidas por variável
// de ambiente (ver ADMIN_EMAIL/ADMIN_SENHA acima).
app.post('/api/auth/login-admin', (req, res) => {
  const { email, senha } = req.body;
  if (email !== ADMIN_EMAIL || senha !== ADMIN_SENHA) {
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });
  }
  const token = criarSessao('admin', 'admin');
  res.json({ token, usuario: { id: 'admin', nome: 'Administrador' } });
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
  if (latitude !== undefined || longitude !== undefined) {
    if (!coordenadasValidas(latitude, longitude)) {
      return res.status(400).json({ erro: 'Informe latitude e longitude válidas.' });
    }
    prestador.latitude = latitude;
    prestador.longitude = longitude;
  }

  salvar();
  res.json(paraPublico('prestador', prestador));
});

// Perfil de avaliações do próprio prestador: nota média, total de
// avaliações e a lista de comentários recebidos (mais recente primeiro)
// — usada na tela "Minhas avaliações" do painel do prestador.
app.get('/api/prestador/me/avaliacoes', autenticar(['prestador']), (req, res) => {
  const { media, total } = calcularNotaPrestador(req.sessao.id);

  const avaliacoes = db.avaliacoes
    .map((a) => ({ avaliacao: a, chamado: db.chamados.find((c) => c.id === a.chamadoId) }))
    .filter(({ chamado }) => chamado && chamado.prestadorId === req.sessao.id)
    .map(({ avaliacao, chamado }) => ({
      nota: avaliacao.nota,
      comentario: avaliacao.comentario,
      data: avaliacao.dataAvaliacao,
      clienteNome: buscarUsuario('cliente', chamado.clienteId)?.nome
    }))
    .sort((a, b) => new Date(b.data) - new Date(a.data));

  res.json({ media, total, avaliacoes });
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
  if (!coordenadasValidas(latitude, longitude)) {
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

  // Para o cliente, um chamado recém-concluído e ainda sem avaliação também
  // conta como "atual": é o que mantém a tela de acompanhamento (com a
  // trilha de progresso e o formulário de avaliação) visível por tempo
  // suficiente para ele avaliar, em vez de o chamado sumir direto para o
  // histórico assim que o prestador conclui o atendimento.
  const chamado =
    req.sessao.tipo === 'cliente'
      ? db.chamados.find(
          (c) =>
            c.clienteId === req.sessao.id &&
            (emAndamento.includes(c.status) ||
              (c.status === 'concluido' && !db.avaliacoes.some((a) => a.chamadoId === c.id)))
        )
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

// Cliente cancela o próprio chamado — permitido enquanto ninguém aceitou
// (status "aberto") ou até 1 minuto após o aceite pelo prestador.
app.post('/api/chamados/:id/cancelar', autenticar(['cliente']), (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.clienteId === req.sessao.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

  // Se ainda não foi aceito, pode cancelar normalmente.
  if (chamado.status === 'aberto') {
    chamado.status = 'cancelado';
    salvar();
    return res.json(montarChamado(chamado));
  }

  // Se foi aceito, permite cancelamento apenas dentro de 1 minuto desde o
  // dataAceite. Depois disso, o cliente não pode mais cancelar.
  if (chamado.status === 'aceito') {
    if (!chamado.dataAceite) {
      return res.status(409).json({ erro: 'Não foi possível verificar o tempo desde o aceite.' });
    }
    const dataAceite = new Date(chamado.dataAceite);
    const agora = new Date();
    const diffMs = agora - dataAceite;
    if (Number.isNaN(dataAceite.getTime()) || diffMs > 60 * 1000) {
      return res.status(409).json({ erro: 'Só é possível cancelar até 1 minuto após o aceite.' });
    }

    // Cancelamento dentro do prazo: liberamos o chamado para outros
    // prestadores e limpamos o prestador vinculado.
    chamado.status = 'cancelado';
    chamado.prestadorId = null;
    chamado.dataAceite = null;
    salvar();
    return res.json(montarChamado(chamado));
  }

  return res.status(409).json({ erro: 'Só é possível cancelar enquanto não aceito ou dentro de 1 minuto após o aceite.' });
});

// Prestador cancela um chamado que havia aceitado (libera para a fila).
app.post('/api/chamados/:id/cancelar-prestador', autenticar(['prestador']), (req, res) => {
  const prestador = buscarUsuario('prestador', req.sessao.id);
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.prestadorId === prestador.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado para este prestador.' });
  if (chamado.status !== 'aceito') {
    return res.status(409).json({ erro: 'Só é possível cancelar um chamado que esteja no estado "aceito".' });
  }

  chamado.prestadorId = null;
  chamado.status = 'aberto';
  chamado.dataAceite = null;
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
// Administração (painel restrito, só acessível pela conta fixa de
// admin — ver ADMIN_EMAIL/ADMIN_SENHA e /api/auth/login-admin acima)
// ---------------------------------------------------------------

// Números gerais do sistema, para os cards do topo do painel admin.
app.get('/api/admin/estatisticas', autenticar(['admin']), (req, res) => {
  const porStatus = {};
  for (const chamado of db.chamados) {
    porStatus[chamado.status] = (porStatus[chamado.status] || 0) + 1;
  }
  res.json({
    totalClientes: db.clientes.length,
    totalPrestadores: db.prestadores.length,
    totalChamados: db.chamados.length,
    chamadosPorStatus: porStatus
  });
});

// Lista todos os clientes e prestadores cadastrados (sem senhaHash),
// para a tabela de usuários do painel admin.
app.get('/api/admin/usuarios', autenticar(['admin']), (req, res) => {
  res.json({
    clientes: db.clientes.map((c) => paraPublico('cliente', c)),
    prestadores: db.prestadores.map((p) => paraPublico('prestador', p))
  });
});

// Lista todos os chamados do sistema (qualquer status), com filtro
// opcional por status via query string — usada na tabela de chamados do
// painel admin.
app.get('/api/admin/chamados', autenticar(['admin']), (req, res) => {
  const { status } = req.query;
  const lista = db.chamados.filter((c) => !status || c.status === status);
  res.json(lista.map(montarChamado).sort((a, b) => new Date(b.dataAbertura) - new Date(a.dataAbertura)));
});

// Cancelamento por moderação: o admin pode encerrar qualquer chamado que
// ainda esteja em andamento, independente de prazos (diferente do
// cancelamento pelo próprio cliente, que tem a regra do 1 minuto).
app.post('/api/admin/chamados/:id/cancelar', autenticar(['admin']), (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!['aberto', 'aceito', 'em_andamento'].includes(chamado.status)) {
    return res.status(409).json({ erro: 'Este chamado já está finalizado.' });
  }
  chamado.status = 'cancelado';
  salvar();
  res.json(montarChamado(chamado));
});

// Categorias: o admin pode ver e renomear (id continua fixo, 1/2/3).
app.get('/api/admin/categorias', autenticar(['admin']), (req, res) => {
  res.json(db.categorias);
});
app.patch('/api/admin/categorias/:id', autenticar(['admin']), (req, res) => {
  const categoria = db.categorias.find((c) => c.id === Number(req.params.id));
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });
  if (typeof req.body.nome !== 'string' || !req.body.nome.trim()) {
    return res.status(400).json({ erro: 'Informe um nome válido.' });
  }
  categoria.nome = req.body.nome.trim();
  salvar();
  res.json(categoria);
});

// ---------------------------------------------------------------
// Funções auxiliares
//
// Ficam depois das rotas só por organização — em JavaScript, funções
// declaradas com "function" são "hoisted" (o interpretador já conhece
// todas elas antes de rodar o arquivo), então a ordem de declaração não
// importa para poder usá-las lá em cima.
// ---------------------------------------------------------------

// Busca um cliente ou prestador pelo id, dentro da coleção certa. O
// admin não fica em nenhuma coleção (é uma conta fixa, ver ADMIN_EMAIL
// acima) — devolvemos um objeto mínimo só para as rotas genéricas
// (como /api/auth/me) funcionarem sem caso especial.
function buscarUsuario(tipo, id) {
  if (tipo === 'admin') return { id: 'admin', nome: 'Administrador' };
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

// Nota média (arredondada a 1 casa) e total de avaliações recebidas por
// um prestador, cruzando avaliacoes -> chamados pelo prestadorId. Usada
// tanto para mostrar a nota ao cliente (assim que o chamado é aceito)
// quanto na tela de perfil do próprio prestador.
function calcularNotaPrestador(prestadorId) {
  const notas = db.avaliacoes
    .filter((a) => db.chamados.some((c) => c.id === a.chamadoId && c.prestadorId === prestadorId))
    .map((a) => a.nota);

  if (notas.length === 0) return { media: null, total: 0 };
  const media = notas.reduce((soma, n) => soma + n, 0) / notas.length;
  return { media: Math.round(media * 10) / 10, total: notas.length };
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
  const notaPrestador = prestador ? calcularNotaPrestador(prestador.id) : null;

  return {
    ...chamado, // todos os campos originais do chamado (id, status, datas, etc.)
    categoriaNome: categoria?.nome,
    clienteNome: cliente?.nome,
    clienteTelefone: cliente?.telefone,
    prestadorNome: prestador?.nome || null,
    prestadorTelefone: prestador?.telefone || null,
    prestadorNotaMedia: notaPrestador?.media ?? null,
    prestadorTotalAvaliacoes: notaPrestador?.total ?? 0,
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
