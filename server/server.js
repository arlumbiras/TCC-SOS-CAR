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
// O caminho é explícito para o .env ser encontrado mesmo que o servidor seja
// iniciado de outra pasta (o padrão do dotenv é a pasta atual do terminal).
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const os = require('os');
const fs = require('fs');
const https = require('https');
const selfsigned = require('selfsigned');

const { db, salvar, inicializarBanco, estadoPersistencia } = require('./db');
const { criarSessao, encerrarSessao, encerrarSessoesDoUsuario, autenticar } = require('./auth-middleware');
const { distanciaKm } = require('./utils/distancia');
const { enviarEmailRedefinicao } = require('./email');
const { geocodificar } = require('./geocodificacao');

const app = express();
const PORTA = process.env.PORT || 3000;

// O Express 4 não captura erros de handlers "async": uma Promise rejeitada
// vira "unhandled rejection", que derruba o processo do Node (ou deixa a
// requisição pendurada). Este wrapper repassa o erro para o middleware de
// erro registrado no fim do arquivo, que responde 500 em JSON.
const assincrono = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// Chamados que ainda não terminaram (ciclo de vida: aberto -> aceito ->
// em_andamento -> concluido/cancelado).
const STATUS_ATIVOS = ['aberto', 'aceito', 'em_andamento'];

const limites = new Map();
function limitarRequisicoes(janelaMs, maximo) {
  return (req, res, next) => {
    const chave = `${req.ip}:${req.path}`;
    const agora = Date.now();
    const atual = limites.get(chave);
    if (!atual || agora - atual.inicio >= janelaMs) {
      limites.set(chave, { inicio: agora, total: 1, janelaMs });
      return next();
    }
    if (atual.total >= maximo) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde e tente novamente.' });
    }
    atual.total += 1;
    next();
  };
}
// Descarta contadores vencidos; sem isso o Map cresceria para sempre (um
// item por IP + rota já usados).
setInterval(() => {
  const agora = Date.now();
  for (const [chave, atual] of limites) {
    if (agora - atual.inicio >= atual.janelaMs) limites.delete(chave);
  }
}, 60 * 1000).unref();

// Conta única de administrador, sem tela pública de cadastro — só existe
// via estas duas variáveis de ambiente. Os valores abaixo são apenas um
// fallback para não travar quem sobe o projeto sem configurar nada (igual
// ao espírito do fallback de banco em server/db.js): troque-os em
// produção definindo ADMIN_EMAIL/ADMIN_SENHA antes de rodar `npm start`.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@soscar.com';
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'admin123';
const ADMIN_SENHA_HASH = process.env.ADMIN_SENHA_HASH || bcrypt.hashSync(ADMIN_SENHA, 10);
if (!process.env.ADMIN_EMAIL || (!process.env.ADMIN_SENHA && !process.env.ADMIN_SENHA_HASH)) {
  console.warn(
    `Usando credenciais padrão de administrador (${ADMIN_EMAIL} / ${ADMIN_SENHA}). Defina ADMIN_EMAIL e ADMIN_SENHA antes de usar em produção.`
  );
}

// Datas ficam em memória — e vão para o navegador — como ISO 8601 em UTC
// ("2026-09-18T18:01:52.000Z"), que identifica um instante sem ambiguidade.
// O formato "AAAA-MM-DD HH:MM:SS" do MySQL não tem fuso: o navegador o
// interpretaria no horário DELE, errando horas quando servidor e cliente
// estão em fusos diferentes (e o Safari nem consegue ler esse formato). A
// conversão para o formato do MySQL é feita só ao gravar (ver server/db.js).
function paraIso(valor = new Date()) {
  return new Date(valor).toISOString();
}

// Validações de entrada do cadastro e da troca de senha.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENHA_MINIMA = 4;
const SENHA_MAXIMA = 72; // o bcrypt só considera os 72 primeiros bytes da senha

function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

// Devolve a mensagem de erro (ou null se a senha é aceitável).
function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) {
    return `A senha deve ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  if (senha.length > SENHA_MAXIMA) {
    return `A senha deve ter no máximo ${SENHA_MAXIMA} caracteres.`;
  }
  return null;
}

function telefoneValido(telefone) {
  return telefone === undefined || telefone === null || (typeof telefone === 'string' && telefone.length <= 20);
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

function categoriaValida(categoriaId) {
  const id = Number(categoriaId);
  return Number.isInteger(id) && db.categorias.some((categoria) => Number(categoria.id) === id);
}

// express.json() lê o corpo das requisições (ex.: os dados de um
// formulário enviados em JSON) e disponibiliza em req.body.
app.use(express.json());

// As respostas da API representam estado atual dos chamados e usuários.
// Impede que navegador, proxy ou service worker devolva uma lista antiga
// quando o prestador clicar em "Atualizar".
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Verificação de saúde (usada por monitoramento/hospedagem). Mostra onde os
// dados estão sendo guardados e se a última gravação no MySQL falhou.
app.get('/health', (req, res) => {
  const { armazenamento, ultimaFalha } = estadoPersistencia();
  res.json({ status: ultimaFalha ? 'degradado' : 'ok', armazenamento, persistenciaComFalha: Boolean(ultimaFalha) });
});

// express.static serve os arquivos da pasta "public" diretamente (HTML,
// CSS, JS do frontend). Como o frontend e a API rodam no mesmo servidor
// e na mesma porta, não é preciso configurar CORS.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------
// Categorias (equivalente à tabela categoria_servico do banco relacional)
// ---------------------------------------------------------------

// Lista as categorias fixas do sistema. Usada pelo frontend para
// montar os <select> de categoria no cadastro de prestador e na
// abertura de chamado.
app.get('/api/categorias', (req, res) => {
  res.json(db.categorias);
});

// Exige login de cliente: a rota repassa consultas ao Nominatim público
// (limite de ~1 por segundo para todo o servidor), então não pode ficar
// aberta a qualquer visitante — bastaria um script para travar a fila e
// impedir os clientes de localizar o próprio endereço.
app.get('/api/localizacao/geocodificar', autenticar(['cliente']), limitarRequisicoes(60 * 1000, 30), assincrono(async (req, res) => {
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
}));

// ---------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------

// Cria uma nova conta de cliente OU de prestador (o campo "tipo" no
// corpo da requisição decide qual). Depois de cadastrar, já efetua o
// login automaticamente (devolve um token), para o usuário não precisar
// preencher o formulário de login logo em seguida.
app.post('/api/auth/registrar', limitarRequisicoes(60 * 1000, 10), assincrono(async (req, res) => {
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
    !senha ||
    typeof cpf !== 'string' ||
    !cpf.trim()
  ) {
    return res.status(400).json({ erro: 'Preencha nome, email, senha e CPF.' });
  }
  const emailNormalizado = email.trim().toLowerCase();
  const cpfDigitos = somenteDigitos(cpf);
  if (nome.trim().length > 120) {
    return res.status(400).json({ erro: 'O nome deve ter no máximo 120 caracteres.' });
  }
  if (!EMAIL_REGEX.test(emailNormalizado) || emailNormalizado.length > 150) {
    return res.status(400).json({ erro: 'Informe um email válido.' });
  }
  if (cpfDigitos.length !== 11) {
    return res.status(400).json({ erro: 'Informe um CPF válido, com 11 dígitos.' });
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }
  if (!telefoneValido(telefone)) {
    return res.status(400).json({ erro: 'Informe um telefone válido (até 20 caracteres).' });
  }
  if (tipo === 'prestador' && !categoriaValida(categoriaId)) {
    return res.status(400).json({ erro: 'Selecione uma categoria de atendimento válida.' });
  }

  // "colecao" aponta para o array certo (clientes ou prestadores),
  // evitando duplicar o código de cadastro para os dois casos.
  const colecao = tipo === 'cliente' ? db.clientes : db.prestadores;

  // Equivalente às restrições UNIQUE (email, cpf) do banco relacional:
  // aqui quem garante que não existam duplicados é o próprio código. O CPF é
  // comparado só pelos dígitos, para "529.982.247-25" e "52998224725" serem
  // reconhecidos como o mesmo.
  const jaExiste = () =>
    colecao.some((u) => u.email.toLowerCase() === emailNormalizado || somenteDigitos(u.cpf) === cpfDigitos);
  const respostaDuplicado = { erro: 'Já existe um cadastro com este email ou CPF.' };
  if (jaExiste()) {
    return res.status(409).json(respostaDuplicado);
  }

  // Nunca guardamos a senha em texto puro: bcrypt gera um hash (texto
  // embaralhado e irreversível) a partir da senha. No login, comparamos
  // a senha digitada com esse hash (ver bcrypt.compare mais abaixo),
  // sem nunca precisar "descriptografar" nada.
  const senhaHash = await bcrypt.hash(senha, 10);

  // O bcrypt acima é assíncrono: enquanto ele roda, outra requisição com o
  // mesmo email/CPF pode ter terminado o cadastro. Conferimos de novo aqui —
  // daqui até o "push" não há mais nenhum await, então nada se intromete.
  if (jaExiste()) {
    return res.status(409).json(respostaDuplicado);
  }

  const usuario = {
    id: crypto.randomUUID(), // identificador único (equivalente ao SERIAL/IDENTITY do SQL)
    nome: nome.trim(),
    email: emailNormalizado,
    senhaHash,
    telefone: typeof telefone === 'string' && telefone.trim() ? telefone.trim() : null,
    // Guardado sempre no formato 000.000.000-00, igual à máscara da tela.
    cpf: `${cpfDigitos.slice(0, 3)}.${cpfDigitos.slice(3, 6)}.${cpfDigitos.slice(6, 9)}-${cpfDigitos.slice(9)}`,
    dataCadastro: paraIso()
  };

  // Prestador tem campos extras que cliente não tem (ver tabela
  // "prestador" em sos_veiculos_mysql.sql): categoria, disponibilidade e
  // localização atual.
  if (tipo === 'prestador') {
    usuario.categoriaId = Number(categoriaId);
    usuario.aprovado = false;
    usuario.disponivel = false;
    usuario.latitude = null;
    usuario.longitude = null;
  }

  colecao.push(usuario); // "INSERT" na tabela em memória
  await salvar();

  if (tipo === 'prestador') {
    return res.status(201).json({
      mensagem: 'Cadastro enviado para aprovação do administrador. Você só conseguirá fazer login após a aprovação.'
    });
  }

  const token = criarSessao(tipo, usuario.id);
  // "paraPublico" remove a senhaHash antes de devolver o usuário — o
  // frontend nunca deve receber esse dado, nem por engano.
  res.status(201).json({ token, usuario: paraPublico(tipo, usuario) });
}));

// Login: recebe tipo + email + senha, confere a senha contra o hash
// salvo e, se bater, devolve um novo token de sessão.
app.post('/api/auth/login', limitarRequisicoes(60 * 1000, 10), assincrono(async (req, res) => {
  const { tipo, email, senha } = req.body;
  const emailNormalizado = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const colecao = tipo === 'cliente' ? db.clientes : tipo === 'prestador' ? db.prestadores : null;
  const usuario = colecao && colecao.find((u) => u.email.toLowerCase() === emailNormalizado);

  // bcrypt.compare faz o hash da senha digitada com o mesmo algoritmo e
  // compara com o hash salvo — sem nunca reverter o hash original.
  const senhaValida =
    usuario && typeof senha === 'string' && (await bcrypt.compare(senha, usuario.senhaHash));

  if (!senhaValida) {
    // Mensagem genérica de propósito: não dizemos se foi o email ou a
    // senha que errou, para não ajudar quem estiver tentando adivinhar
    // credenciais de outra pessoa.
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });
  }

  if (tipo === 'prestador' && usuario.aprovado !== true) {
    return res.status(403).json({ erro: 'Seu cadastro está pendente de aprovação do administrador.' });
  }

  const token = criarSessao(tipo, usuario.id);
  res.json({ token, usuario: paraPublico(tipo, usuario) });
}));

// Logout: invalida o token atual (ver auth-middleware.js). Prestador que sai
// também deixa de estar "disponível" — senão continuaria marcado assim no
// banco sem ninguém logado para atender.
app.post('/api/auth/logout', autenticar(), assincrono(async (req, res) => {
  if (req.sessao.tipo === 'prestador') {
    const prestador = buscarUsuario('prestador', req.sessao.id);
    if (prestador?.disponivel) {
      prestador.disponivel = false;
      await salvar();
    }
  }
  encerrarSessao(req.token);
  res.status(204).end(); // 204 = "sucesso, sem conteúdo para devolver"
}));

// Usada pelo frontend ao carregar a página: se já existir um token
// salvo no navegador (localStorage), essa rota confirma se ele ainda é
// válido e devolve os dados do usuário logado, evitando pedir login de
// novo a cada vez que a página é recarregada.
app.get('/api/auth/me', autenticar(), (req, res) => {
  const usuario = buscarUsuario(req.sessao.tipo, req.sessao.id);
  res.json({ tipo: req.sessao.tipo, usuario: paraPublico(req.sessao.tipo, usuario) });
});

// Atualiza dados do usuário logado (nome, telefone e/ou senha).
app.patch('/api/auth/atualizar', autenticar(['cliente', 'prestador']), assincrono(async (req, res) => {
  const usuario = buscarUsuario(req.sessao.tipo, req.sessao.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  // Valida tudo ANTES de alterar qualquer campo, para uma requisição
  // recusada não deixar o usuário meio atualizado em memória.
  const { nome, telefone, senha, categoriaId } = req.body;
  if (nome !== undefined && (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120)) {
    return res.status(400).json({ erro: 'Informe um nome válido (até 120 caracteres).' });
  }
  if (!telefoneValido(telefone)) {
    return res.status(400).json({ erro: 'Informe um telefone válido (até 20 caracteres).' });
  }
  const trocaSenha = senha !== undefined && senha !== '';
  if (trocaSenha) {
    const erroSenha = validarSenha(senha);
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
  }
  if (categoriaId !== undefined) {
    if (req.sessao.tipo !== 'prestador' || !categoriaValida(categoriaId)) {
      return res.status(400).json({ erro: 'Informe uma categoria de atendimento válida.' });
    }
  }

  if (typeof nome === 'string') usuario.nome = nome.trim();
  if (typeof telefone === 'string') usuario.telefone = telefone.trim() || null;
  if (categoriaId !== undefined) usuario.categoriaId = Number(categoriaId);
  if (trocaSenha) {
    usuario.senhaHash = await bcrypt.hash(senha, 10);
    // Quem estivesse logado em outro aparelho (ou com a senha antiga
    // vazada) perde o acesso; a sessão atual continua valendo.
    encerrarSessoesDoUsuario(req.sessao.tipo, req.sessao.id, req.token);
  }

  await salvar();
  res.json(paraPublico(req.sessao.tipo, usuario));
}));

// Pede a redefinição de senha: gera um token válido por 1 hora e envia
// por e-mail (ver server/email.js). Responde sempre com sucesso
// genérico, exista ou não o e-mail informado — evita que alguém use esta
// rota para descobrir quais e-mails estão cadastrados no sistema.
app.post('/api/auth/esqueci-senha', limitarRequisicoes(60 * 1000, 3), assincrono(async (req, res) => {
  const { tipo, email } = req.body;
  const emailNormalizado = typeof email === 'string' ? email.trim().toLowerCase() : '';

  const colecao =
    tipo === 'cliente'
      ? db.clientes
      : tipo === 'prestador'
        ? db.prestadores
        : [...db.clientes, ...db.prestadores];

  const usuario = colecao.find((u) => u.email.toLowerCase() === emailNormalizado);
  const tipoUsuario = usuario && db.clientes.some((u) => u.id === usuario.id) ? 'cliente' : 'prestador';

  if (usuario) {
    const token = process.env.RESET_TOKEN_OVERRIDE || crypto.randomUUID();
    const expiraEm = new Date(Date.now() + 60 * 60 * 1000);
    const agora = new Date();
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    // Aproveita para descartar tokens vencidos (senão só sairiam do banco
    // quando o servidor fosse reiniciado).
    db.redefinicoesSenha = db.redefinicoesSenha.filter(
      (r) => r.usuarioId !== usuario.id && new Date(r.expiraEm) > agora
    );
    db.redefinicoesSenha.push({ token, tipo: tipoUsuario, usuarioId: usuario.id, expiraEm: paraIso(expiraEm) });
    await salvar();

    // Sem "await" de propósito: o envio de e-mail leva vários segundos e só
    // acontece quando o e-mail existe — esperar por ele deixaria a resposta
    // mais lenta para e-mails cadastrados e permitiria descobri-los medindo
    // o tempo. (enviarEmailRedefinicao já trata os próprios erros.)
    const envio = await enviarEmailRedefinicao({
      paraEmail: usuario.email,
      nome: usuario.nome,
      tipo: tipoUsuario,
      token,
      appUrl
    }).catch((erro) => {
      console.warn('[e-mail] Falha inesperada ao enviar redefinição de senha:', erro.message);
      return { link: `${appUrl}/?tipo=${encodeURIComponent(tipoUsuario)}&token=${encodeURIComponent(token)}`, smtpConfigurado: false };
    });

    return res.json({
      mensagem: 'Se o email informado estiver cadastrado, enviaremos um link de redefinição.',
      link: envio?.link || null
    });
  }

  res.json({ mensagem: 'Se o email informado estiver cadastrado, enviaremos um link de redefinição.' });
}));

// Conclui a redefinição: valida o token (existe e não expirou) e troca a
// senha. O token é descartado logo em seguida, funcione ou não — um
// token só pode ser usado uma vez.
app.post('/api/auth/redefinir-senha', limitarRequisicoes(60 * 1000, 10), assincrono(async (req, res) => {
  const { token, novaSenha } = req.body;
  const redefinicao = typeof token === 'string' && db.redefinicoesSenha.find((r) => r.token === token);

  if (!redefinicao || new Date(redefinicao.expiraEm) < new Date()) {
    return res.status(400).json({ erro: 'Link de redefinição inválido ou expirado. Peça um novo.' });
  }
  const erroSenha = validarSenha(novaSenha);
  if (erroSenha) {
    return res.status(400).json({ erro: erroSenha });
  }

  const usuario = buscarUsuario(redefinicao.tipo, redefinicao.usuarioId);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  usuario.senhaHash = await bcrypt.hash(novaSenha, 10);
  db.redefinicoesSenha = db.redefinicoesSenha.filter((r) => r.token !== token);
  // Redefinir a senha costuma significar "perdi o controle da conta": todas
  // as sessões abertas com a senha antiga deixam de valer.
  encerrarSessoesDoUsuario(redefinicao.tipo, redefinicao.usuarioId);
  await salvar();

  res.json({ mensagem: 'Senha redefinida com sucesso.' });
}));

// Login exclusivo do administrador — não existe cadastro público para
// este tipo de usuário, só as credenciais fixas definidas por variável
// de ambiente (ver ADMIN_EMAIL/ADMIN_SENHA acima).
app.post('/api/auth/login-admin', limitarRequisicoes(60 * 1000, 10), assincrono(async (req, res) => {
  const { email, senha } = req.body;
  const senhaValida = typeof senha === 'string' && (await bcrypt.compare(senha, ADMIN_SENHA_HASH));
  const emailValido = typeof email === 'string' && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (!emailValido || !senhaValida) {
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });
  }
  const token = criarSessao('admin', 'admin');
  res.json({ token, usuario: { id: 'admin', nome: 'Administrador' } });
}));

// ---------------------------------------------------------------
// Prestador: disponibilidade e localização
// ---------------------------------------------------------------

// O prestador chama essa rota sempre que liga/desliga o interruptor de
// disponibilidade, e também em segundo plano quando o navegador consegue
// uma nova localização GPS. Só atualiza os campos que vierem preenchidos
// no corpo da requisição (permite atualizar só a localização, ou só a
// disponibilidade, sem precisar mandar tudo de novo).
app.patch('/api/prestador/disponibilidade', autenticar(['prestador']), assincrono(async (req, res) => {
  const prestador = buscarUsuario('prestador', req.sessao.id);
  const { disponivel, latitude, longitude } = req.body;

  // Valida tudo antes de alterar qualquer campo: uma requisição recusada com
  // 400 não pode deixar o prestador com a disponibilidade já trocada.
  const temLocalizacao = latitude !== undefined || longitude !== undefined;
  if (temLocalizacao && !coordenadasValidas(latitude, longitude)) {
    return res.status(400).json({ erro: 'Informe latitude e longitude válidas.' });
  }

  if (typeof disponivel === 'boolean') prestador.disponivel = disponivel;
  if (temLocalizacao) {
    prestador.latitude = latitude;
    prestador.longitude = longitude;
  }

  await salvar();
  res.json(paraPublico('prestador', prestador));
}));

// Cliente atualiza a própria posição durante um chamado ativo. O prestador
// vinculado recebe essas coordenadas pela rota /chamados/atual.
app.patch('/api/chamados/:id/localizacao', autenticar(['cliente']), assincrono(async (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.clienteId === req.sessao.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!STATUS_ATIVOS.includes(chamado.status)) {
    return res.status(409).json({ erro: 'Este chamado não está ativo.' });
  }

  const { latitude, longitude } = req.body;
  if (!coordenadasValidas(latitude, longitude)) {
    return res.status(400).json({ erro: 'Informe latitude e longitude válidas.' });
  }

  chamado.latitude = latitude;
  chamado.longitude = longitude;
  await salvar();
  res.json(montarChamado(chamado));
}));

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
app.post('/api/chamados', autenticar(['cliente']), assincrono(async (req, res) => {
  const { categoriaId, latitude, longitude, endereco, descricao } = req.body;

  if (!categoriaValida(categoriaId)) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }
  if (!coordenadasValidas(latitude, longitude)) {
    return res.status(400).json({ erro: 'Informe a localização (latitude/longitude).' });
  }
  // Tipo e tamanho são checados aqui porque um valor inválido que entrasse em
  // "db" faria TODAS as gravações seguintes falharem no MySQL (o salvar()
  // regrava o estado inteiro, inclusive este chamado).
  if (endereco != null && (typeof endereco !== 'string' || endereco.length > 255)) {
    return res.status(400).json({ erro: 'O endereço deve ter no máximo 255 caracteres.' });
  }
  if (descricao != null && (typeof descricao !== 'string' || descricao.length > 1000)) {
    return res.status(400).json({ erro: 'A descrição deve ter no máximo 1000 caracteres.' });
  }

  // Regra simples de bom uso: um cliente não pode abrir um segundo
  // chamado enquanto já tiver um em andamento (aberto, aceito ou a
  // caminho). Evita pedidos duplicados por engano.
  const jaTemChamadoAberto = db.chamados.some(
    (c) => c.clienteId === req.sessao.id && STATUS_ATIVOS.includes(c.status)
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
    endereco: endereco?.trim() || null,
    descricao: descricao?.trim() || null,
    status: 'aberto', // ciclo de vida: aberto -> aceito -> em_andamento -> concluido (ou cancelado)
    dataAbertura: paraIso(),
    dataAceite: null,
    dataConclusao: null
  };
  db.chamados.push(chamado);
  await salvar();

  res.status(201).json(montarChamado(chamado));
}));

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

  // O interruptor "Disponível" do painel vale de verdade: quem está
  // indisponível não recebe chamados na lista.
  if (!prestador.disponivel) return res.json([]);

  // IDs vindos do MySQL e de instalações antigas podem ter tipos diferentes;
  // a comparação numérica evita perder pedidos válidos após trocar a categoria.
  const disponiveis = db.chamados
    .filter(
      (c) =>
        c.status === 'aberto' &&
        Number(c.categoriaId) === Number(prestador.categoriaId)
    )
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
app.post('/api/chamados/:id/aceitar', autenticar(['prestador']), assincrono(async (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

  const prestador = buscarUsuario('prestador', req.sessao.id);
  if (Number(chamado.categoriaId) !== Number(prestador.categoriaId)) {
    return res.status(403).json({ erro: 'Este chamado não é da sua categoria de atendimento.' });
  }
  // Checagem que implementa a regra central: só aceita se NINGUÉM
  // ainda tiver aceitado (status ainda "aberto" e prestadorId nulo).
  if (chamado.status !== 'aberto' || chamado.prestadorId !== null) {
    return res.status(409).json({ erro: 'Este chamado já foi aceito por outro prestador.' });
  }
  if (!prestador.disponivel) {
    return res.status(403).json({ erro: 'Ative a opção "Disponível" para aceitar chamados.' });
  }
  // Um atendimento por vez: o painel do prestador só mostra UM chamado em
  // andamento (ver /chamados/atual), então um segundo aceite ficaria preso,
  // invisível para ele e sem resposta para o cliente.
  const jaAtendendo = db.chamados.some((c) => c.prestadorId === prestador.id && STATUS_ATIVOS.includes(c.status));
  if (jaAtendendo) {
    return res.status(409).json({ erro: 'Conclua ou cancele o atendimento atual antes de aceitar outro chamado.' });
  }

  chamado.prestadorId = prestador.id; // "trava" o chamado para este prestador
  chamado.status = 'aceito';
  chamado.dataAceite = paraIso();
  await salvar();

  res.json(montarChamado(chamado));
}));

// Devolve o chamado "ativo" do usuário logado (cliente ou prestador),
// ou seja, o que ainda não terminou (aberto, aceito ou a caminho). Usada
// pelo frontend para decidir se mostra o formulário de "pedir socorro" /
// lista de chamados disponíveis, ou a tela de acompanhamento.
app.get('/api/chamados/atual', autenticar(), (req, res) => {
  const emAndamento = STATUS_ATIVOS;

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
app.post('/api/chamados/:id/iniciar', autenticar(['prestador']), assincrono(async (req, res) => {
  const chamado = pegarChamadoDoPrestador(req);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (chamado.status !== 'aceito') {
    return res.status(409).json({ erro: 'Este chamado não está aguardando início de atendimento.' });
  }
  chamado.status = 'em_andamento';
  await salvar();
  res.json(montarChamado(chamado));
}));

// Prestador marca o atendimento como concluído (aceito ou em_andamento
// -> concluido). Permite concluir direto a partir de "aceito" também,
// caso o prestador esqueça de marcar "cheguei ao local" antes.
app.post('/api/chamados/:id/concluir', autenticar(['prestador']), assincrono(async (req, res) => {
  const chamado = pegarChamadoDoPrestador(req);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!['aceito', 'em_andamento'].includes(chamado.status)) {
    return res.status(409).json({ erro: 'Este chamado não pode ser concluído neste momento.' });
  }
  chamado.status = 'concluido';
  chamado.dataConclusao = paraIso();
  await salvar();
  res.json(montarChamado(chamado));
}));

// Cliente cancela o próprio chamado — permitido enquanto ninguém aceitou
// (status "aberto") ou até 1 minuto após o aceite pelo prestador.
app.post('/api/chamados/:id/cancelar', autenticar(['cliente']), assincrono(async (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.clienteId === req.sessao.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });

  // Se ainda não foi aceito, pode cancelar normalmente.
  if (chamado.status === 'aberto') {
    chamado.status = 'cancelado';
    await salvar();
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

    // Cancelamento dentro do prazo: o chamado é encerrado (não volta para a
    // fila — quem cancelou foi o próprio cliente) e o prestador vinculado
    // fica livre para aceitar outro.
    chamado.status = 'cancelado';
    chamado.prestadorId = null;
    chamado.dataAceite = null;
    await salvar();
    return res.json(montarChamado(chamado));
  }

  return res.status(409).json({ erro: 'Só é possível cancelar enquanto não aceito ou dentro de 1 minuto após o aceite.' });
}));

// Prestador cancela um chamado que havia aceitado (libera para a fila).
app.post('/api/chamados/:id/cancelar-prestador', autenticar(['prestador']), assincrono(async (req, res) => {
  const prestador = buscarUsuario('prestador', req.sessao.id);
  const chamado = db.chamados.find((c) => c.id === req.params.id && c.prestadorId === prestador.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado para este prestador.' });
  if (chamado.status !== 'aceito') {
    return res.status(409).json({ erro: 'Só é possível cancelar um chamado que esteja no estado "aceito".' });
  }

  chamado.prestadorId = null;
  chamado.status = 'aberto';
  chamado.dataAceite = null;
  await salvar();
  res.json(montarChamado(chamado));
}));

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
app.post('/api/chamados/:id/avaliacao', autenticar(['cliente']), assincrono(async (req, res) => {
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
  if (req.body.comentario !== undefined && (typeof req.body.comentario !== 'string' || req.body.comentario.length > 500)) {
    return res.status(400).json({ erro: 'O comentário deve ter no máximo 500 caracteres.' });
  }

  const avaliacao = {
    id: crypto.randomUUID(),
    chamadoId: chamado.id,
    nota: notaNum,
    comentario: req.body.comentario?.trim() || null,
    dataAvaliacao: paraIso()
  };
  db.avaliacoes.push(avaliacao);
  await salvar();

  res.status(201).json(avaliacao);
}));

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

app.post('/api/admin/prestadores/:id/aprovar', autenticar(['admin']), assincrono(async (req, res) => {
  const prestador = db.prestadores.find((p) => p.id === req.params.id);
  if (!prestador) return res.status(404).json({ erro: 'Prestador não encontrado.' });
  if (prestador.aprovado === true) {
    return res.status(409).json({ erro: 'Este prestador já está aprovado.' });
  }

  prestador.aprovado = true;
  await salvar();
  res.json(paraPublico('prestador', prestador));
}));

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
app.post('/api/admin/chamados/:id/cancelar', autenticar(['admin']), assincrono(async (req, res) => {
  const chamado = db.chamados.find((c) => c.id === req.params.id);
  if (!chamado) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!STATUS_ATIVOS.includes(chamado.status)) {
    return res.status(409).json({ erro: 'Este chamado já está finalizado.' });
  }
  chamado.status = 'cancelado';
  await salvar();
  res.json(montarChamado(chamado));
}));

// Categorias: o admin pode ver e renomear (id continua fixo, 1/2/3/4).
app.get('/api/admin/categorias', autenticar(['admin']), (req, res) => {
  res.json(db.categorias);
});
app.patch('/api/admin/categorias/:id', autenticar(['admin']), assincrono(async (req, res) => {
  const categoria = db.categorias.find((c) => c.id === Number(req.params.id));
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });
  if (typeof req.body.nome !== 'string' || !req.body.nome.trim() || req.body.nome.trim().length > 50) {
    return res.status(400).json({ erro: 'Informe um nome válido (até 50 caracteres).' });
  }
  categoria.nome = req.body.nome.trim();
  await salvar();
  res.json(categoria);
}));

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
    resto.aprovado = usuario.aprovado !== undefined ? Boolean(usuario.aprovado) : true;
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
    prestadorLatitude: prestador?.latitude ?? null,
    prestadorLongitude: prestador?.longitude ?? null,
    prestadorNotaMedia: notaPrestador?.media ?? null,
    prestadorTotalAvaliacoes: notaPrestador?.total ?? 0,
    avaliacao
  };
}

// Rotas /api/* que não existem respondem JSON (em vez da página HTML de erro
// padrão do Express), que é o que o frontend sabe ler.
app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Último middleware: recebe qualquer erro das rotas (inclusive os das rotas
// async, via "assincrono") e do próprio Express, como JSON malformado. O
// tratamento padrão do Express devolveria uma página HTML com o stack trace
// — informação interna que não deve chegar ao usuário.
app.use((erro, req, res, next) => {
  if (res.headersSent) return next(erro);
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição inválido.' });
  }
  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Requisição grande demais.' });
  }
  console.error(`Erro em ${req.method} ${req.path}:`, erro);
  res.status(500).json({ erro: 'Erro interno. Tente novamente em instantes.' });
});

// Rede de segurança: uma Promise rejeitada que ninguém tratou é registrada em
// vez de derrubar o servidor para todos os usuários.
process.on('unhandledRejection', (motivo) => {
  console.error('Promise rejeitada sem tratamento:', motivo);
});

const HOST = process.env.HOST || '0.0.0.0';
const TLS_CERT_FILE = process.env.TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.TLS_KEY_FILE;

async function criarServidor() {
  if (Boolean(TLS_CERT_FILE) !== Boolean(TLS_KEY_FILE)) {
    throw new Error('Configure TLS_CERT_FILE e TLS_KEY_FILE juntos para ativar HTTPS.');
  }
  if (TLS_CERT_FILE && TLS_KEY_FILE) {
    return https.createServer({
      cert: fs.readFileSync(TLS_CERT_FILE),
      key: fs.readFileSync(TLS_KEY_FILE)
    }, app);
  }

  const diretorioCertificados = path.resolve(__dirname, '..', '.certs');
  const arquivoCertificado = path.join(diretorioCertificados, 'localhost-cert.pem');
  const arquivoChave = path.join(diretorioCertificados, 'localhost-key.pem');
  if (!fs.existsSync(arquivoCertificado) || !fs.existsSync(arquivoChave)) {
    fs.mkdirSync(diretorioCertificados, { recursive: true });
    const ipLocal = obterIpLocal() || '127.0.0.1';
    const atributos = [{ name: 'commonName', value: 'localhost' }];
    const extensoes = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', keyEncipherment: true, digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip: ipLocal }
      ] }
    ];
    const certificado = await selfsigned.generate(atributos, {
      keySize: 2048,
      days: 365,
      extensions: extensoes
    });
    fs.writeFileSync(arquivoCertificado, certificado.cert);
    fs.writeFileSync(arquivoChave, certificado.private);
  }
  return https.createServer({
    cert: fs.readFileSync(arquivoCertificado),
    key: fs.readFileSync(arquivoChave)
  }, app);
}

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

// As sessões só existem em memória: ao (re)iniciar o servidor ninguém está
// logado. Prestadores que ficaram gravados como "disponíveis" (por terem
// fechado a aba ou pelo servidor ter caído, sem "Sair") estariam aparecendo
// como disponíveis sem poder atender. Cada um volta a ativar o interruptor
// quando entrar de novo.
async function zerarDisponibilidadeDosPrestadores() {
  const disponiveis = db.prestadores.filter((p) => p.disponivel);
  if (disponiveis.length === 0) return;
  disponiveis.forEach((p) => {
    p.disponivel = false;
  });
  await salvar();
  console.log(`${disponiveis.length} prestador(es) estavam marcados como disponíveis sem sessão ativa; agora constam como indisponíveis.`);
}

inicializarBanco()
  .catch((erro) => {
    console.warn('Inicialização do banco falhou; iniciando servidor em modo fallback.', erro.message);
  })
  .then(zerarDisponibilidadeDosPrestadores)
  .then(criarServidor)
  .then((servidor) => {
    servidor.on('error', (erro) => {
      console.error(
        erro.code === 'EADDRINUSE'
          ? `A porta ${PORTA} já está em uso. Feche o outro processo ou defina outra porta em PORT.`
          : `Erro no servidor: ${erro.message}`
      );
      process.exit(1);
    });
    servidor.listen(PORTA, HOST, () => {
      const ipLocal = obterIpLocal();
      const protocolo = 'https';
      if (ipLocal) {
        console.log(`SOS Car rodando em:
  - ${protocolo}://localhost:${PORTA}
  - ${protocolo}://${ipLocal}:${PORTA} (rede local)`);
      } else {
        console.log(`SOS Car rodando em ${protocolo}://localhost:${PORTA} (host ${HOST})`);
      }
    });
  })
  .catch((erro) => {
    // Ex.: só uma das variáveis TLS_* definida, ou arquivo de certificado ausente.
    console.error('Não foi possível iniciar o servidor:', erro.message);
    process.exit(1);
  });
