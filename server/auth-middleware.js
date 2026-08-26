// =================================================================
// Autenticação por token, guardado em memória (sem JWT, sem cookies).
//
// Como funciona:
// 1. No login/cadastro, o servidor gera um token aleatório (uma string
//    única, tipo "bf0b4cf4-...") e guarda numa tabela em memória
//    (o Map "sessoes"), associando o token ao tipo de usuário e ao id.
// 2. Esse token é devolvido para o navegador, que passa a enviá-lo em
//    todo pedido, dentro do cabeçalho HTTP:
//        Authorization: Bearer <token>
// 3. O middleware "autenticar" lê esse cabeçalho em cada rota protegida,
//    procura o token no Map e, se achar, sabe quem está fazendo a
//    requisição (req.sessao).
//
// Simplificação proposital para o MVP: como "sessoes" é só uma variável
// em memória (não é gravada em arquivo/banco), todo mundo precisa fazer
// login de novo sempre que o servidor for reiniciado. Um sistema em
// produção normalmente usaria JWT assinado ou sessão persistida no
// banco, mas isso adicionaria complexidade sem valor para o objetivo do
// TCC (demonstrar a regra de negócio central do sistema de socorro).
// =================================================================
const crypto = require('crypto');

// Map funciona como um "dicionário": chave = token, valor = { tipo, id }.
const sessoes = new Map();

// Gera um novo token para o usuário (tipo = 'cliente' ou 'prestador',
// id = identificador único dele) e guarda a sessão em memória.
function criarSessao(tipo, id) {
  const token = crypto.randomUUID(); // string aleatória única, ex.: "a1b2c3d4-..."
  sessoes.set(token, { tipo, id });
  return token;
}

// Remove a sessão (usado no logout). Depois disso, o token antigo deixa
// de funcionar em qualquer rota protegida.
function encerrarSessao(token) {
  sessoes.delete(token);
}

// Middleware de autenticação: uma função que "embrulha" uma rota do
// Express e roda ANTES dela. Recebe uma lista opcional de tipos
// permitidos (ex.: ['prestador']) e devolve a função de middleware em si.
//
// - autenticar()               -> aceita qualquer usuário logado
// - autenticar(['cliente'])    -> só deixa passar se for cliente
// - autenticar(['prestador'])  -> só deixa passar se for prestador
function autenticar(tiposPermitidos) {
  return (req, res, next) => {
    // O cabeçalho chega no formato "Bearer <token>"; aqui extraímos só o token.
    const cabecalho = req.headers.authorization || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
    const sessao = token && sessoes.get(token);

    if (!sessao) {
      return res.status(401).json({ erro: 'Não autenticado. Faça login novamente.' });
    }
    if (tiposPermitidos && !tiposPermitidos.includes(sessao.tipo)) {
      return res.status(403).json({ erro: 'Acesso não permitido para este tipo de usuário.' });
    }

    // Deixa a sessão (e o próprio token, útil no logout) disponível
    // para a rota que vem depois deste middleware.
    req.sessao = sessao;
    req.token = token;
    next(); // segue para a próxima função (a rota de verdade)
  };
}

module.exports = { criarSessao, encerrarSessao, autenticar };
