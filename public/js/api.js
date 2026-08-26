// =================================================================
// Camada única de comunicação com a API (backend em server/server.js).
//
// Nenhuma outra parte do frontend usa "fetch" diretamente — todo mundo
// passa por aqui. Isso mantém num único lugar: o endereço base da API,
// como o token de sessão é anexado às requisições, e como os erros são
// tratados (transformados em uma mensagem de texto simples).
//
// "API" é um objeto só, criado por uma IIFE (Immediately Invoked
// Function Expression — uma função que é definida e já executada na
// hora, entre parênteses). Isso cria um "namespace" isolado: as
// variáveis internas (BASE, CHAVE_TOKEN, requisitar) não vazam para o
// resto do código, só o que é devolvido no "return" fica acessível.
// =================================================================
const API = (function () {
  const BASE = '/api';
  const CHAVE_TOKEN = 'sos-car-token'; // nome usado para guardar o token no localStorage

  // localStorage mantém os dados salvos mesmo depois de fechar a aba/
  // navegador — é assim que o usuário continua logado ao recarregar a
  // página (ver também app.js, função iniciar()).
  function obterToken() {
    return localStorage.getItem(CHAVE_TOKEN);
  }
  function definirToken(token) {
    if (token) localStorage.setItem(CHAVE_TOKEN, token);
    else localStorage.removeItem(CHAVE_TOKEN); // usado no logout
  }

  // Função central: monta e envia a requisição HTTP, sempre anexando o
  // token de sessão (se existir) no cabeçalho Authorization, e traduz
  // respostas de erro num "throw" simples, para quem chamou poder usar
  // try/catch normalmente.
  async function requisitar(caminho, opcoes = {}) {
    const token = obterToken();
    const cabecalhos = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
    if (token) cabecalhos.Authorization = `Bearer ${token}`;

    const resposta = await fetch(BASE + caminho, { ...opcoes, headers: cabecalhos });

    // Respostas 204 ("sem conteúdo", ex.: logout) não têm corpo JSON
    // para ler; nas demais, tentamos ler o JSON e, se falhar, seguimos
    // com null em vez de quebrar a aplicação.
    const corpo = resposta.status === 204 ? null : await resposta.json().catch(() => null);

    if (!resposta.ok) {
      // O backend sempre manda { erro: "mensagem" } quando dá algo
      // errado (ver server.js) — usamos essa mensagem pronta para
      // mostrar direto na tela.
      throw new Error((corpo && corpo.erro) || 'Ocorreu um erro inesperado.');
    }
    return corpo;
  }

  // Uma função "de conveniência" para cada rota da API, para o resto do
  // código nunca precisar montar URL/método/corpo na mão.
  return {
    obterToken,
    definirToken,

    categorias: () => requisitar('/categorias'),

    registrar: (dados) => requisitar('/auth/registrar', { method: 'POST', body: JSON.stringify(dados) }),
    login: (dados) => requisitar('/auth/login', { method: 'POST', body: JSON.stringify(dados) }),
    logout: () => requisitar('/auth/logout', { method: 'POST' }),
    quemSouEu: () => requisitar('/auth/me'),

    abrirChamado: (dados) => requisitar('/chamados', { method: 'POST', body: JSON.stringify(dados) }),
    chamadoAtual: () => requisitar('/chamados/atual'),
    cancelarChamado: (id) => requisitar(`/chamados/${id}/cancelar`, { method: 'POST' }),
    avaliarChamado: (id, dados) =>
      requisitar(`/chamados/${id}/avaliacao`, { method: 'POST', body: JSON.stringify(dados) }),
    historico: () => requisitar('/chamados/historico'),

    atualizarDisponibilidade: (dados) =>
      requisitar('/prestador/disponibilidade', { method: 'PATCH', body: JSON.stringify(dados) }),
    chamadosDisponiveis: () => requisitar('/chamados/disponiveis'),
    aceitarChamado: (id) => requisitar(`/chamados/${id}/aceitar`, { method: 'POST' }),
    iniciarAtendimento: (id) => requisitar(`/chamados/${id}/iniciar`, { method: 'POST' }),
    concluirAtendimento: (id) => requisitar(`/chamados/${id}/concluir`, { method: 'POST' })
    ,
    atualizarUsuario: (dados) => requisitar('/auth/atualizar', { method: 'PATCH', body: JSON.stringify(dados) })
  };
})();
