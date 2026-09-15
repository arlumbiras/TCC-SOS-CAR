// =================================================================
// Lógica das telas do SOS Car.
//
// É uma SPA (Single Page Application) bem simples: existe um único
// index.html com as três telas já escritas nele (auth, cliente,
// prestador), e este arquivo apenas mostra/esconde cada uma via CSS
// (classe "oculta") e preenche o conteúdo delas com dados vindos da
// API (api.js). Não há nenhum framework nem "roteador" de página —
// tudo é feito manipulando o DOM diretamente.
// =================================================================
(function () {
  // setInterval usado para atualizar a tela periodicamente (novos
  // chamados disponíveis, mudança de status etc.), sem precisar de
  // WebSockets — o navegador simplesmente pergunta de novo à API a
  // cada alguns segundos ("polling"). Guardamos aqui o id do interval
  // atual para poder cancelá-lo ao trocar de tela ou deslogar.
  let intervaloAtualizacao = null;

  // Guarda o chamado que está sendo mostrado no momento (do cliente ou
  // do prestador, dependendo de quem está logado), para os botões de
  // ação (cancelar, aceitar, concluir...) saberem qual id usar.
  let chamadoEmFoco = null;

  const telas = {
    carregamento: document.getElementById('tela-carregamento'),
    auth: document.getElementById('tela-auth'),
    esqueciSenha: document.getElementById('tela-esqueci-senha'),
    redefinirSenha: document.getElementById('tela-redefinir-senha'),
    cliente: document.getElementById('tela-cliente'),
    prestador: document.getElementById('tela-prestador'),
    config: document.getElementById('tela-config'),
    admin: document.getElementById('tela-admin'),
    sobre: document.getElementById('tela-sobre'),
    ajuda: document.getElementById('tela-ajuda'),
    termos: document.getElementById('tela-termos'),
    privacidade: document.getElementById('tela-privacidade')
  };
  const btnSair = document.getElementById('btn-sair');
  const btnConfig = document.getElementById('btn-config');
  const linkAdmin = document.getElementById('link-admin');
  const formConfig = document.getElementById('form-configuracoes');
  const btnConfigCancel = document.getElementById('btn-config-cancel');
  let usuarioTipoAtual = null;
  let ultimoUsuario = null;

  // Mostra só a tela pedida, escondendo as demais (classe "oculta" vem
  // do CSS com "display: none !important"). Sair/Configurações/link de
  // admin dependem de quem está logado (usuarioTipoAtual), não do nome
  // da tela — assim continuam corretos mesmo em telas "de passagem"
  // como Sobre/Ajuda, que podem ser abertas tanto logado quanto não.
  function mostrarTela(nome) {
    Object.entries(telas).forEach(([chave, el]) => el.classList.toggle('oculta', chave !== nome));
    const logado = !!usuarioTipoAtual;
    btnSair.classList.toggle('oculto', !logado);
    if (btnConfig) btnConfig.classList.toggle('oculto', usuarioTipoAtual !== 'cliente' && usuarioTipoAtual !== 'prestador');
    if (linkAdmin) linkAdmin.classList.toggle('oculto', logado);
  }

  // Volta para o painel de quem estiver logado (cliente/prestador/admin)
  // ou para a tela de login, se ninguém estiver — usado pelo clique no
  // logo e por todos os botões "Voltar" das telas institucionais/admin.
  function voltarTelaPrincipal() {
    if (usuarioTipoAtual === 'cliente') mostrarTela('cliente');
    else if (usuarioTipoAtual === 'prestador') mostrarTela('prestador');
    else if (usuarioTipoAtual === 'admin') mostrarTela('admin');
    else mostrarTela('auth');
  }

  function pararAtualizacaoAutomatica() {
    if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);
    intervaloAtualizacao = null;
  }

  // Traduz o status técnico (igual ao salvo no banco) para um texto
  // amigável de mostrar na tela.
  function rotuloStatus(status) {
    return (
      {
        aberto: 'Aberto',
        aceito: 'Aceito',
        em_andamento: 'A caminho',
        concluido: 'Concluído',
        cancelado: 'Cancelado'
      }[status] || status
    );
  }

  function formatarData(iso) {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  // Escapa caracteres especiais de HTML antes de inserir texto vindo da
  // API (nome, endereço, descrição etc.) dentro de innerHTML. Sem isso,
  // alguém poderia cadastrar um nome como "<img src=x onerror=...>" e
  // esse código rodaria no navegador de qualquer outro usuário que visse
  // esse nome na tela (XSS armazenado).
  function escaparHtml(texto) {
    return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  // ---------------- Notificações (toast) e confirmação ----------------
  // Substituem alert()/confirm() nativos do navegador por componentes
  // próprios (ver #toast-container e #modal-confirmar no index.html e
  // os estilos em style.css), para manter a aparência consistente com
  // o resto do produto.
  const toastContainer = document.getElementById('toast-container');
  const modalConfirmar = document.getElementById('modal-confirmar');
  const modalConfirmarTexto = document.getElementById('modal-confirmar-texto');
  const modalConfirmarOk = document.getElementById('modal-confirmar-ok');
  const modalConfirmarCancelar = document.getElementById('modal-confirmar-cancelar');

  function toast(mensagem, tipo = 'erro') {
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = mensagem; // textContent nunca interpreta HTML, sem risco de XSS
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // Mostra o modal de confirmação e devolve uma Promise que resolve
  // "true" (confirmou) ou "false" (cancelou), no lugar do confirm()
  // nativo do navegador.
  function confirmar(mensagem) {
    modalConfirmarTexto.textContent = mensagem;
    modalConfirmar.classList.remove('oculto');
    return new Promise((resolve) => {
      function limpar(resultado) {
        modalConfirmar.classList.add('oculto');
        modalConfirmarOk.removeEventListener('click', aoConfirmar);
        modalConfirmarCancelar.removeEventListener('click', aoCancelar);
        resolve(resultado);
      }
      function aoConfirmar() {
        limpar(true);
      }
      function aoCancelar() {
        limpar(false);
      }
      modalConfirmarOk.addEventListener('click', aoConfirmar);
      modalConfirmarCancelar.addEventListener('click', aoCancelar);
    });
  }

  // Desabilita um botão e troca seu texto durante uma operação
  // assíncrona (ex.: enviar um formulário), restaurando tudo ao final.
  // Evita duplo clique e dá feedback visual de que algo está
  // acontecendo, em vez de a tela simplesmente "não reagir" por um instante.
  async function comCarregamento(botao, textoCarregando, fn) {
    const textoOriginal = botao.textContent;
    botao.disabled = true;
    botao.textContent = textoCarregando;
    try {
      await fn();
    } finally {
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  }

  // Registra o service worker (public/sw.js), que permite o app ser
  // instalado (PWA) e funcionar de forma básica offline para quem já o
  // visitou antes. Puramente incremental: se o navegador não suportar
  // ou o registro falhar, o app continua funcionando normalmente.
  function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  // ---------------- Boot ----------------
  // Roda uma única vez, assim que a página carrega (chamada lá no final
  // do arquivo). Decide qual tela mostrar primeiro.
  async function iniciar() {
    registrarServiceWorker();
    try {
      await carregarCategorias();
    } catch (err) {
      mostrarTela('auth');
      toast(`Não foi possível carregar a aplicação: ${err.message}`);
      return;
    }

    // Link de redefinição de senha (ex.: "?tipo=cliente&token=..."),
    // recebido por e-mail — tem prioridade sobre qualquer sessão salva:
    // quem abriu esse link quer trocar a senha, não continuar logado.
    const parametros = new URLSearchParams(window.location.search);
    const token = parametros.get('token');
    const tipoRedefinicao = parametros.get('tipo');
    if (token && tipoRedefinicao) {
      tokenRedefinicaoAtual = token;
      mostrarTela('redefinirSenha');
      return;
    }

    // Se já existir um token salvo de uma visita anterior, tenta
    // validar com a API (/auth/me) e pular direto para o painel certo,
    // sem pedir login de novo.
    if (API.obterToken()) {
      try {
        const { tipo, usuario } = await API.quemSouEu();
        entrarComoUsuario(tipo, usuario);
        return;
      } catch {
        // Token inválido/expirado (ex.: servidor foi reiniciado) — descarta
        // e segue para a tela de login normalmente.
        API.definirToken(null);
      }
    }
    mostrarTela('auth');
  }

  // Busca as categorias de serviço na API e preenche os dois <select>
  // que dependem delas: o de cadastro de prestador e o de abertura de
  // chamado (que só existe depois do login como cliente, mas já
  // deixamos pronto).
  async function carregarCategorias() {
    const categorias = await API.categorias();
    const opcoesHtml = categorias.map((c) => `<option value="${c.id}">${c.nome}</option>`).join('');
    const seletores = [
      document.querySelector('#form-cadastro select[name="categoriaId"]'),
      document.getElementById('chamado-categoria')
    ];
    seletores.forEach((select) => {
      if (select) select.innerHTML = opcoesHtml;
    });
  }

  // Depois de login/cadastro bem-sucedido, decide qual painel abrir, de
  // acordo com o tipo de usuário.
  function entrarComoUsuario(tipo, usuario) {
    usuarioTipoAtual = tipo;
    ultimoUsuario = usuario;
    if (tipo === 'cliente') iniciarPainelCliente(usuario);
    else if (tipo === 'prestador') iniciarPainelPrestador(usuario);
    else if (tipo === 'admin') iniciarPainelAdmin();
  }

  // =================================================================
  // Tela de autenticação (login / cadastro, cliente / prestador)
  // =================================================================
  const segPerfil = document.getElementById('seg-perfil'); // abas "Sou cliente" / "Sou prestador"
  const segModo = document.getElementById('seg-modo'); // abas "Entrar" / "Criar conta"
  const campoCategoria = document.getElementById('campo-categoria'); // só aparece para prestador
  const formLogin = document.getElementById('form-login');
  const formCadastro = document.getElementById('form-cadastro');
  const authErro = document.getElementById('auth-erro');

  let perfilSelecionado = 'cliente'; // guarda a aba ativa (cliente/prestador) fora do DOM

  // Clique nas abas "Sou cliente" / "Sou prestador": marca visualmente a
  // aba escolhida e mostra/esconde o campo de categoria, que só faz
  // sentido para prestador.
  segPerfil.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-perfil]');
    if (!botao) return;
    perfilSelecionado = botao.dataset.perfil;
    [...segPerfil.children].forEach((b) => b.classList.toggle('ativo', b === botao));
    const ehPrestador = perfilSelecionado === 'prestador';
    campoCategoria.classList.toggle('oculto', !ehPrestador);
    campoCategoria.querySelector('select').required = ehPrestador;
  });

  // Clique nas abas "Entrar" / "Criar conta": alterna qual dos dois
  // formulários fica visível.
  segModo.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-modo]');
    if (!botao) return;
    const modo = botao.dataset.modo;
    [...segModo.children].forEach((b) => b.classList.toggle('ativo', b === botao));
    formLogin.classList.toggle('oculto', modo !== 'login');
    formCadastro.classList.toggle('oculto', modo !== 'cadastro');
    esconderErro();
  });

  function mostrarErro(mensagem) {
    authErro.textContent = mensagem;
    authErro.classList.remove('oculto');
  }
  function esconderErro() {
    authErro.classList.add('oculto');
  }

  // Envio do formulário de login. "FormData" + "Object.fromEntries" lê
  // todos os campos do formulário de uma vez (pelo atributo "name" de
  // cada <input>), sem precisar pegar um por um.
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault(); // impede o navegador de recarregar a página (comportamento padrão de <form>)
    esconderErro();
    const dados = Object.fromEntries(new FormData(formLogin));
    await comCarregamento(formLogin.querySelector('button[type="submit"]'), 'Entrando...', async () => {
      try {
        const { token, usuario } = await API.login({ tipo: perfilSelecionado, ...dados });
        API.definirToken(token);
        formLogin.reset();
        entrarComoUsuario(perfilSelecionado, usuario);
      } catch (err) {
        mostrarErro(err.message);
      }
    });
  });

  // Envio do formulário de cadastro — mesma lógica do login, chamando
  // API.registrar em vez de API.login.
  formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    esconderErro();
    const dados = Object.fromEntries(new FormData(formCadastro));
    await comCarregamento(formCadastro.querySelector('button[type="submit"]'), 'Criando conta...', async () => {
      try {
        const { token, usuario } = await API.registrar({ tipo: perfilSelecionado, ...dados });
        API.definirToken(token);
        formCadastro.reset();
        entrarComoUsuario(perfilSelecionado, usuario);
      } catch (err) {
        mostrarErro(err.message);
      }
    });
  });

  // Botão "Sair": avisa a API (para invalidar o token no servidor),
  // apaga o token local e volta para a tela de login. Funciona para
  // cliente, prestador OU admin — o backend só olha o token, não o tipo.
  btnSair.addEventListener('click', async () => {
    pararAtualizacaoAutomatica();
    try {
      await API.logout();
    } catch {
      // Mesmo que o logout no servidor falhe (ex.: sessão já expirada),
      // seguimos limpando o token local e voltando para o login.
    }
    API.definirToken(null);
    usuarioTipoAtual = null;
    ultimoUsuario = null;
    mostrarTela('auth');
  });

  // Botão de Configurações: abre a tela de config preenchida com os dados do usuário
  if (btnConfig) {
    btnConfig.addEventListener('click', async () => {
      try {
        const { usuario } = await API.quemSouEu();
        // preenche o formulário
        formConfig.elements.nome.value = usuario.nome || '';
        formConfig.elements.telefone.value = usuario.telefone || '';
        formConfig.elements.senha.value = '';
        mostrarTela('config');
      } catch (err) {
        toast('Não foi possível carregar seus dados: ' + err.message, 'erro');
      }
    });
  }

  // Envio do formulário de configurações: atualiza usuário via API
  if (formConfig) {
    formConfig.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(formConfig));
      if (!dados.senha) delete dados.senha; // se vazio, não envia senha
      await comCarregamento(formConfig.querySelector('button[type="submit"]'), 'Salvando...', async () => {
        try {
          await API.atualizarUsuario(dados);
          // lê os dados atualizados e reentra no painel apropriado
          const me = await API.quemSouEu();
          entrarComoUsuario(me.tipo, me.usuario);
          toast('Dados atualizados com sucesso.', 'sucesso');
        } catch (err) {
          toast(err.message, 'erro');
        }
      });
    });
  }

  if (btnConfigCancel) {
    btnConfigCancel.addEventListener('click', () => {
      if (usuarioTipoAtual && ultimoUsuario) entrarComoUsuario(usuarioTipoAtual, ultimoUsuario);
      else mostrarTela('auth');
    });
  }

  // Clique no logo/marca: vai para a tela principal (painel do usuário
  // se estiver logado, ou tela de autenticação se não estiver).
  const marcaEl = document.querySelector('.marca');
  if (marcaEl) {
    marcaEl.addEventListener('click', voltarTelaPrincipal);
  }

  // Todo botão "Voltar" (telas institucionais, login de admin,
  // "esqueci minha senha") tem a mesma classe e o mesmo destino: volta
  // para o painel de quem estiver logado, ou para o login.
  document.querySelectorAll('.btn-voltar').forEach((botao) => {
    botao.addEventListener('click', voltarTelaPrincipal);
  });

  // Links do rodapé (Sobre/Ajuda/Termos/Privacidade/Acesso
  // administrativo) — delegação num único listener no <nav>, todos
  // usando o atributo "data-tela" com o nome da tela a abrir.
  const rodapeLinks = document.querySelector('.rodape-links');
  if (rodapeLinks) {
    rodapeLinks.addEventListener('click', (e) => {
      const link = e.target.closest('[data-tela]');
      if (!link) return;
      e.preventDefault();
      mostrarTela(link.dataset.tela);
    });
  }

  // =================================================================
  // Esqueci minha senha / redefinir senha
  // =================================================================
  const btnEsqueciSenha = document.getElementById('btn-esqueci-senha');
  const formEsqueciSenha = document.getElementById('form-esqueci-senha');
  const esqueciSenhaSucesso = document.getElementById('esqueci-senha-sucesso');
  const formRedefinirSenha = document.getElementById('form-redefinir-senha');
  const redefinirSenhaErro = document.getElementById('redefinir-senha-erro');
  let tokenRedefinicaoAtual = null; // preenchido em iniciar() a partir da URL do link de e-mail

  if (btnEsqueciSenha) {
    btnEsqueciSenha.addEventListener('click', () => {
      formEsqueciSenha.reset();
      formEsqueciSenha.elements.tipo.value = perfilSelecionado; // acompanha a aba ativa (cliente/prestador)
      formEsqueciSenha.classList.remove('oculto');
      esqueciSenhaSucesso.classList.add('oculto');
      mostrarTela('esqueciSenha');
    });
  }

  if (formEsqueciSenha) {
    formEsqueciSenha.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(formEsqueciSenha));
      await comCarregamento(formEsqueciSenha.querySelector('button[type="submit"]'), 'Enviando...', async () => {
        try {
          const resposta = await API.esqueciSenha(dados);
          esqueciSenhaSucesso.textContent = resposta.mensagem;
          esqueciSenhaSucesso.classList.remove('oculto');
          formEsqueciSenha.classList.add('oculto');
        } catch (err) {
          toast(err.message, 'erro');
        }
      });
    });
  }

  if (formRedefinirSenha) {
    formRedefinirSenha.addEventListener('submit', async (e) => {
      e.preventDefault();
      redefinirSenhaErro.classList.add('oculto');
      const dados = Object.fromEntries(new FormData(formRedefinirSenha));
      await comCarregamento(formRedefinirSenha.querySelector('button[type="submit"]'), 'Redefinindo...', async () => {
        try {
          await API.redefinirSenha({ token: tokenRedefinicaoAtual, novaSenha: dados.novaSenha });
          // Limpa "?tipo=...&token=..." da URL para um F5 não reabrir esta tela.
          window.history.replaceState({}, '', window.location.pathname);
          formRedefinirSenha.reset();
          mostrarTela('auth');
          toast('Senha redefinida com sucesso. Faça login com a nova senha.', 'sucesso');
        } catch (err) {
          redefinirSenhaErro.textContent = err.message;
          redefinirSenhaErro.classList.remove('oculto');
        }
      });
    });
  }

  // =================================================================
  // Painel do cliente
  // =================================================================
  const clienteNomeEl = document.getElementById('cliente-nome');
  const semChamadoEl = document.getElementById('cliente-sem-chamado'); // formulário de "pedir socorro"
  const comChamadoEl = document.getElementById('cliente-com-chamado'); // acompanhamento do chamado atual
  const formChamado = document.getElementById('form-chamado');
  const btnUsarLocalizacao = document.getElementById('btn-usar-localizacao');
  const btnLocalizarEndereco = document.getElementById('btn-localizar-endereco');
  const localizacaoStatus = document.getElementById('localizacao-status');
  const progressoEl = document.getElementById('progresso-chamado'); // "trilha" com as 4 etapas do chamado
  const detalhesEl = document.getElementById('chamado-detalhes');
  const btnCancelarChamado = document.getElementById('btn-cancelar-chamado');
  const blocoAvaliacao = document.getElementById('bloco-avaliacao');
  const formAvaliacao = document.getElementById('form-avaliacao');
  const estrelasEl = document.getElementById('estrelas');
  const clienteHistoricoEl = document.getElementById('cliente-historico');

  // Centro de São Paulo, usado como localização de reserva apenas se o
  // cliente não conceder permissão de geolocalização — o pedido de
  // socorro não pode travar só porque o navegador negou o GPS.
  const LOCALIZACAO_RESERVA = { latitude: -23.55052, longitude: -46.633308 };

  let localizacaoCliente = null; // coordenadas obtidas pelo botão "Usar minha localização"
  let notaSelecionada = 0; // nota (1-5) escolhida no componente de estrelas

  // Chamada uma vez, logo após o login/cadastro como cliente.
  function iniciarPainelCliente(usuario) {
    clienteNomeEl.textContent = usuario.nome;
    mostrarTela('cliente');
    montarEstrelas();
    atualizarPainelCliente();
    pararAtualizacaoAutomatica();
    // A cada 6 segundos, busca de novo o chamado atual e o histórico —
    // é assim que a tela do cliente "percebe" quando um prestador aceita
    // o chamado, sem precisar de WebSockets.
    intervaloAtualizacao = setInterval(atualizarPainelCliente, 6000);
  }

  // Botão "Usar minha localização": pede ao navegador as coordenadas
  // GPS atuais (API nativa navigator.geolocation, que exibe o popup de
  // permissão do navegador).
  btnUsarLocalizacao.addEventListener('click', () => {
    if (!navigator.geolocation) {
      localizacaoStatus.textContent = 'Geolocalização não é suportada neste navegador.';
      return;
    }
    localizacaoStatus.textContent = 'Obtendo localização...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        localizacaoCliente = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        localizacaoStatus.textContent = `Localização obtida (${localizacaoCliente.latitude.toFixed(4)}, ${localizacaoCliente.longitude.toFixed(4)}).`;
      },
      () => {
        localizacaoStatus.textContent = 'Não foi possível obter sua localização. O endereço informado será usado.';
      }
    );
  });

  btnLocalizarEndereco.addEventListener('click', async () => {
    const endereco = new FormData(formChamado).get('endereco');
    if (typeof endereco !== 'string' || endereco.trim().length < 5) {
      localizacaoStatus.textContent = 'Informe o endereço antes de localizá-lo.';
      return;
    }

    localizacaoStatus.textContent = 'Localizando endereço...';
    try {
      const localizacao = await API.geocodificar(endereco);
      localizacaoCliente = localizacao;
      localizacaoStatus.textContent =
        `Endereço localizado (${localizacao.latitude.toFixed(5)}, ${localizacao.longitude.toFixed(5)}).`;
    } catch (err) {
      localizacaoStatus.textContent = err.message;
    }
  });

  // Envio do formulário "Precisa de socorro agora?": abre um novo
  // chamado. Usa a localização obtida por GPS se houver; senão, cai no
  // fallback fixo (LOCALIZACAO_RESERVA), já que o backend exige
  // latitude/longitude numéricas.
  formChamado.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(formChamado));
    await comCarregamento(formChamado.querySelector('button[type="submit"]'), 'Enviando...', async () => {
      try {
        let localizacao = localizacaoCliente;
        if (!localizacao && dados.endereco) {
          try {
            localizacao = await API.geocodificar(dados.endereco);
            localizacaoStatus.textContent =
              `Endereço localizado (${localizacao.latitude.toFixed(5)}, ${localizacao.longitude.toFixed(5)}).`;
          } catch {
            localizacao = LOCALIZACAO_RESERVA;
            localizacaoStatus.textContent = 'Endereço não localizado; usando posição de demonstração.';
          }
        }
        localizacao = localizacao || LOCALIZACAO_RESERVA;
        await API.abrirChamado({
          categoriaId: Number(dados.categoriaId),
          endereco: dados.endereco,
          descricao: dados.descricao,
          latitude: localizacao.latitude,
          longitude: localizacao.longitude
        });
        formChamado.reset();
        localizacaoCliente = null;
        localizacaoStatus.textContent = '';
        await atualizarPainelCliente(); // já troca a tela para "acompanhamento do chamado"
      } catch (err) {
        toast(err.message, 'erro');
      }
    });
  });

  btnCancelarChamado.addEventListener('click', async () => {
    if (!chamadoEmFoco || !(await confirmar('Cancelar este chamado?'))) return;
    try {
      await API.cancelarChamado(chamadoEmFoco.id);
      await atualizarPainelCliente();
    } catch (err) {
      toast(err.message, 'erro');
    }
  });

  // Cria as 5 estrelas clicáveis da avaliação. Cada uma guarda seu
  // próprio valor (1 a 5) em data-valor; ao clicar, marcamos como
  // "ativa" todas as estrelas até a clicada (efeito visual comum de
  // avaliação por estrelas).
  function montarEstrelas() {
    estrelasEl.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const span = document.createElement('span');
      span.className = 'estrela';
      span.textContent = '★';
      span.dataset.valor = i;
      span.addEventListener('click', () => {
        notaSelecionada = i;
        [...estrelasEl.children].forEach((el) => el.classList.toggle('ativa', Number(el.dataset.valor) <= i));
      });
      estrelasEl.appendChild(span);
    }
  }

  formAvaliacao.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!notaSelecionada) {
      toast('Escolha uma nota de 1 a 5 estrelas.', 'erro');
      return;
    }
    const dados = Object.fromEntries(new FormData(formAvaliacao));
    await comCarregamento(formAvaliacao.querySelector('button[type="submit"]'), 'Enviando...', async () => {
      try {
        await API.avaliarChamado(chamadoEmFoco.id, { nota: notaSelecionada, comentario: dados.comentario });
        notaSelecionada = 0;
        formAvaliacao.reset();
        await atualizarPainelCliente();
      } catch (err) {
        toast(err.message, 'erro');
      }
    });
  });

  // Busca o chamado atual (se houver) e o histórico, e redesenha a tela
  // do cliente de acordo. Chamada tanto na entrada do painel quanto a
  // cada "tick" do polling (setInterval acima).
  async function atualizarPainelCliente() {
    const [atual, historico] = await Promise.all([API.chamadoAtual(), API.historico()]);
    chamadoEmFoco = atual;

    // Mostra OU o formulário de pedir socorro, OU o acompanhamento do
    // chamado — nunca os dois ao mesmo tempo.
    semChamadoEl.classList.toggle('oculta', !!atual);
    comChamadoEl.classList.toggle('oculta', !atual);
    if (atual) renderizarChamadoCliente(atual);

    renderizarHistorico(clienteHistoricoEl, historico, (c) => c.categoriaNome);
  }

  // Desenha a "trilha" de progresso (Aberto -> Aceito -> A caminho ->
  // Concluído), os detalhes do chamado e decide se mostra o botão de
  // cancelar e/ou o formulário de avaliação.
  function renderizarChamadoCliente(chamado) {
    const passos = ['aberto', 'aceito', 'em_andamento', 'concluido'];
    const indiceAtual = passos.indexOf(chamado.status);

    [...progressoEl.children].forEach((li, i) => {
      li.classList.remove('concluido', 'atual', 'cancelado');
      if (chamado.status === 'cancelado') {
        li.classList.add('cancelado'); // troca a trilha inteira por um "x" (ver CSS)
        return;
      }
      if (i < indiceAtual) li.classList.add('concluido'); // etapas já passadas
      if (i === indiceAtual) li.classList.add('atual'); // etapa em que o chamado está agora
    });

    const notaPrestadorHtml =
      chamado.prestadorTotalAvaliacoes > 0
        ? ` · ★ ${chamado.prestadorNotaMedia.toFixed(1)} (${chamado.prestadorTotalAvaliacoes})`
        : '';
    detalhesEl.innerHTML = `
      <dt>Categoria</dt><dd>${escaparHtml(chamado.categoriaNome)}</dd>
      <dt>Endereço</dt><dd>${escaparHtml(chamado.endereco) || '—'}</dd>
      ${chamado.prestadorNome ? `<dt>Prestador</dt><dd>${escaparHtml(chamado.prestadorNome)} · ${escaparHtml(chamado.prestadorTelefone) || 'sem telefone'}${notaPrestadorHtml}</dd>` : ''}
      <dt>Status</dt><dd>${rotuloStatus(chamado.status)}</dd>
    `;
    Mapa.criarOuAtualizar('mapa-cliente', chamado.latitude, chamado.longitude, 'Local do chamado');

    // Cliente pode cancelar enquanto ninguém aceitou, ou dentro de 1
    // minuto após o aceite. Depois disso, o botão some.
    let podeCancelarCliente = false;
    if (chamado.status === 'aberto') {
      podeCancelarCliente = true;
    } else if (chamado.status === 'aceito' && chamado.dataAceite) {
      const diff = Date.now() - new Date(chamado.dataAceite).getTime();
      if (!Number.isNaN(diff) && diff <= 60 * 1000) podeCancelarCliente = true;
    }
    btnCancelarChamado.classList.toggle('oculto', !podeCancelarCliente);
    blocoAvaliacao.classList.toggle('oculto', !(chamado.status === 'concluido' && !chamado.avaliacao));
  }

  // =================================================================
  // Painel do prestador
  // =================================================================
  const prestadorNomeEl = document.getElementById('prestador-nome');
  const prestadorCategoriaEl = document.getElementById('prestador-categoria');
  const chkDisponivel = document.getElementById('chk-disponivel'); // interruptor de disponibilidade
  const disponivelTexto = document.getElementById('disponivel-texto');
  const prestadorLocalizacaoStatus = document.getElementById('prestador-localizacao-status');
  const prestadorSemChamadoEl = document.getElementById('prestador-sem-chamado'); // lista de chamados disponíveis
  const prestadorComChamadoEl = document.getElementById('prestador-com-chamado'); // atendimento em andamento
  const listaDisponiveisEl = document.getElementById('lista-disponiveis');
  const semChamadosMsg = document.getElementById('sem-chamados-msg');
  const prestadorChamadoDetalhesEl = document.getElementById('prestador-chamado-detalhes');
  const btnIniciar = document.getElementById('btn-iniciar');
  const btnConcluir = document.getElementById('btn-concluir');
  const btnCancelarPrestador = document.getElementById('btn-cancelar-prestador');
  const prestadorHistoricoEl = document.getElementById('prestador-historico');
  const prestadorAvaliacaoResumoEl = document.getElementById('prestador-avaliacao-resumo');
  const prestadorListaAvaliacoesEl = document.getElementById('prestador-lista-avaliacoes');

  let localizacaoPrestador = null;

  // Chamada uma vez, logo após o login/cadastro como prestador.
  function iniciarPainelPrestador(usuario) {
    prestadorNomeEl.textContent = usuario.nome;
    prestadorCategoriaEl.textContent = `Categoria: ${usuario.categoriaNome}`;
    chkDisponivel.checked = !!usuario.disponivel;
    disponivelTexto.textContent = usuario.disponivel ? 'Disponível' : 'Indisponível';

    mostrarTela('prestador');
    obterLocalizacaoPrestador();
    atualizarPainelPrestador();
    pararAtualizacaoAutomatica();
    // Mesma ideia do painel do cliente: sem WebSockets, a lista de
    // chamados disponíveis (ou o andamento do chamado aceito) é
    // atualizada perguntando de novo à API a cada 6 segundos.
    intervaloAtualizacao = setInterval(atualizarPainelPrestador, 6000);
  }

  // Pede a localização GPS do prestador assim que o painel abre, e já
  // manda para a API — é essa localização que alimenta o cálculo de
  // distância usado para filtrar/ordenar os chamados disponíveis.
  function obterLocalizacaoPrestador() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        localizacaoPrestador = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        prestadorLocalizacaoStatus.textContent = 'Localização atualizada.';
        try {
          await API.atualizarDisponibilidade({ ...localizacaoPrestador });
        } catch {
          // Falha silenciosa: a disponibilidade ainda pode ser alternada
          // manualmente pelo interruptor, só a busca por distância fica sem esse dado.
        }
      },
      () => {
        prestadorLocalizacaoStatus.textContent =
          'Não foi possível obter sua localização; a busca por chamados próximos ficará sem filtro de distância.';
      }
    );
  }

  // Interruptor "Disponível" / "Indisponível": avisa a API a cada
  // mudança (junto com a última localização conhecida, se houver).
  chkDisponivel.addEventListener('change', async () => {
    disponivelTexto.textContent = chkDisponivel.checked ? 'Disponível' : 'Indisponível';
    try {
      await API.atualizarDisponibilidade({ disponivel: chkDisponivel.checked, ...(localizacaoPrestador || {}) });
      await atualizarPainelPrestador();
    } catch (err) {
      toast(err.message, 'erro');
    }
  });

  // Delegação de evento: em vez de um listener por botão "Aceitar" (que
  // teria que ser recriado toda vez que a lista é redesenhada), ouvimos
  // o clique no <ul> inteiro e conferimos se o alvo tem o atributo
  // "data-aceitar" (ver renderizarDisponiveis, mais abaixo).
  listaDisponiveisEl.addEventListener('click', async (e) => {
    const botao = e.target.closest('[data-aceitar]');
    if (!botao) return;
    botao.disabled = true; // evita duplo clique enquanto o pedido está em voo
    try {
      await API.aceitarChamado(botao.dataset.aceitar);
    } catch (err) {
      // Erro mais comum aqui: outro prestador aceitou primeiro (409) —
      // a mensagem já vem pronta da API.
      toast(err.message, 'erro');
    }
    await atualizarPainelPrestador(); // atualiza a lista de qualquer forma (com ou sem sucesso)
  });

  btnIniciar.addEventListener('click', async () => {
    try {
      await API.iniciarAtendimento(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      toast(err.message, 'erro');
    }
  });

  btnCancelarPrestador.addEventListener('click', async () => {
    if (!chamadoEmFoco || !(await confirmar('Cancelar este atendimento e liberar o chamado para outros prestadores?'))) return;
    try {
      await API.cancelarPorPrestador(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      toast(err.message, 'erro');
    }
  });

  btnConcluir.addEventListener('click', async () => {
    try {
      await API.concluirAtendimento(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      toast(err.message, 'erro');
    }
  });

  // Busca o chamado ativo do prestador (se houver) e redesenha a tela:
  // OU a lista de chamados disponíveis, OU o card de atendimento em
  // andamento — mais o histórico, que aparece sempre.
  async function atualizarPainelPrestador() {
    const atual = await API.chamadoAtual();
    chamadoEmFoco = atual;

    prestadorSemChamadoEl.classList.toggle('oculta', !!atual);
    prestadorComChamadoEl.classList.toggle('oculta', !atual);

    if (atual) {
      renderizarChamadoPrestador(atual);
    } else {
      renderizarDisponiveis(await API.chamadosDisponiveis());
    }

    renderizarHistorico(prestadorHistoricoEl, await API.historico(), (c) => c.clienteNome);
    await atualizarAvaliacoesPrestador();
  }

  // Preenche o card "Minhas avaliações": nota média + total no topo, e
  // a lista de comentários recebidos logo abaixo (mais recente primeiro).
  async function atualizarAvaliacoesPrestador() {
    const { media, total, avaliacoes } = await API.minhasAvaliacoes();

    prestadorAvaliacaoResumoEl.innerHTML =
      total > 0
        ? `<strong>★ ${media.toFixed(1)}</strong><span class="texto-auxiliar">de 5 · ${total} avaliaç${total === 1 ? 'ão' : 'ões'}</span>`
        : '<span class="texto-auxiliar">Você ainda não recebeu nenhuma avaliação.</span>';

    prestadorListaAvaliacoesEl.innerHTML = avaliacoes
      .map(
        (a) => `
      <li class="item-historico">
        <div>
          <strong>${'★'.repeat(a.nota)}${'☆'.repeat(5 - a.nota)}</strong>
          <div class="texto-auxiliar">${escaparHtml(a.comentario) || 'Sem comentário'} · ${escaparHtml(a.clienteNome)} · ${formatarData(a.data)}</div>
        </div>
      </li>`
      )
      .join('');
  }

  // Desenha a lista de chamados disponíveis para aceitar. Cada item
  // carrega o id do chamado no atributo "data-aceitar" do botão, lido
  // pelo listener de delegação configurado acima.
  function renderizarDisponiveis(lista) {
    semChamadosMsg.classList.toggle('oculto', lista.length > 0);
    listaDisponiveisEl.innerHTML = lista
      .map(
        (c) => `
      <li class="item-chamado">
        <div class="item-chamado-info">
          <strong>${escaparHtml(c.endereco) || 'Endereço não informado'}</strong>
          <div class="texto-auxiliar">${escaparHtml(c.descricao) || 'Sem descrição'}${c.distanciaKm != null ? ` · ${c.distanciaKm.toFixed(1)} km` : ''}</div>
        </div>
        <button class="botao-primario" data-aceitar="${c.id}">Aceitar</button>
      </li>`
      )
      .join('');
  }

  // Desenha o card do chamado que o prestador já aceitou, com os dados
  // de contato do cliente (só aparecem aqui, depois do aceite — ver
  // comentário sobre privacidade em server.js) e os botões de ação
  // certos para a etapa atual.
  function renderizarChamadoPrestador(chamado) {
    prestadorChamadoDetalhesEl.innerHTML = `
      <dt>Cliente</dt><dd>${escaparHtml(chamado.clienteNome)} · ${escaparHtml(chamado.clienteTelefone) || 'sem telefone'}</dd>
      <dt>Endereço</dt><dd>${escaparHtml(chamado.endereco) || '—'}</dd>
      <dt>Descrição</dt><dd>${escaparHtml(chamado.descricao) || '—'}</dd>
      <dt>Status</dt><dd>${rotuloStatus(chamado.status)}</dd>
    `;
    Mapa.criarOuAtualizar('mapa-prestador', chamado.latitude, chamado.longitude, escaparHtml(chamado.clienteNome));
    btnIniciar.classList.toggle('oculto', chamado.status !== 'aceito');
    btnConcluir.classList.toggle('oculto', chamado.status === 'aberto');
    btnCancelarPrestador.classList.toggle('oculto', chamado.status !== 'aceito');
  }

  // ---------------- Histórico (compartilhado entre os dois painéis) ----------------
  // "obterTitulo" é uma função passada por quem chama: no painel do
  // cliente mostra a categoria do chamado, no painel do prestador mostra
  // o nome do cliente atendido — o resto do card é igual nos dois casos.
  function renderizarHistorico(elemento, lista, obterTitulo) {
    elemento.innerHTML = lista.length
      ? lista
          .map(
            (c) => `
        <li class="item-historico">
          <div>
            <strong>${escaparHtml(obterTitulo(c))}</strong>
            <div class="texto-auxiliar">${escaparHtml(c.endereco)} · ${formatarData(c.dataAbertura)}</div>
          </div>
          <span class="selo ${c.status === 'cancelado' ? 'selo-cancelado' : 'selo-concluido'}">${rotuloStatus(c.status)}</span>
        </li>`
          )
          .join('')
      : `<li class="estado-vazio">
          <svg class="estado-vazio-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v6l-3 3H7l-3-3V4z"/><path d="M4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9"/></svg>
          Nada por aqui ainda.
        </li>`;
  }

  // =================================================================
  // Painel administrativo
  // Sem cadastro público — só a conta fixa definida no servidor (ver
  // ADMIN_EMAIL/ADMIN_SENHA em server/server.js). O acesso é feito pelo
  // link discreto "Acesso administrativo" no rodapé (ver seção de links
  // do rodapé, mais acima).
  // =================================================================
  const formAdminLogin = document.getElementById('form-admin-login');
  const adminLoginErro = document.getElementById('admin-login-erro');
  const adminLoginEl = document.getElementById('admin-login');
  const adminPainelEl = document.getElementById('admin-painel');
  const statClientes = document.getElementById('stat-clientes');
  const statPrestadores = document.getElementById('stat-prestadores');
  const statChamados = document.getElementById('stat-chamados');
  const statChamadosAbertos = document.getElementById('stat-chamados-abertos');
  const adminListaCategorias = document.getElementById('admin-lista-categorias');
  const adminFiltroStatus = document.getElementById('admin-filtro-status');
  const adminTabelaChamados = document.querySelector('#admin-tabela-chamados tbody');
  const adminTabelaUsuarios = document.querySelector('#admin-tabela-usuarios tbody');

  if (formAdminLogin) {
    formAdminLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      adminLoginErro.classList.add('oculto');
      const dados = Object.fromEntries(new FormData(formAdminLogin));
      await comCarregamento(formAdminLogin.querySelector('button[type="submit"]'), 'Entrando...', async () => {
        try {
          const { token, usuario } = await API.loginAdmin(dados);
          API.definirToken(token);
          formAdminLogin.reset();
          usuarioTipoAtual = 'admin';
          ultimoUsuario = usuario;
          iniciarPainelAdmin();
        } catch (err) {
          adminLoginErro.textContent = err.message;
          adminLoginErro.classList.remove('oculto');
        }
      });
    });
  }

  // Chamada uma vez, logo após o login como admin.
  function iniciarPainelAdmin() {
    adminLoginEl.classList.add('oculta');
    adminPainelEl.classList.remove('oculta');
    mostrarTela('admin');
    atualizarPainelAdmin();
    pararAtualizacaoAutomatica();
    intervaloAtualizacao = setInterval(atualizarPainelAdmin, 8000);
  }

  async function atualizarPainelAdmin() {
    const [estatisticas, categorias, usuarios] = await Promise.all([
      API.adminEstatisticas(),
      API.adminCategorias(),
      API.adminUsuarios()
    ]);

    statClientes.textContent = estatisticas.totalClientes;
    statPrestadores.textContent = estatisticas.totalPrestadores;
    statChamados.textContent = estatisticas.totalChamados;
    statChamadosAbertos.textContent = ['aberto', 'aceito', 'em_andamento'].reduce(
      (soma, status) => soma + (estatisticas.chamadosPorStatus[status] || 0),
      0
    );

    renderizarCategoriasAdmin(categorias);
    renderizarUsuariosAdmin(usuarios);
    await renderizarChamadosAdmin();
  }

  function renderizarCategoriasAdmin(categorias) {
    adminListaCategorias.innerHTML = categorias
      .map(
        (c) => `
      <li class="item-categoria" data-categoria="${c.id}">
        <span class="categoria-nome">${escaparHtml(c.nome)}</span>
        <button type="button" class="botao-secundario botao-pequeno" data-editar-categoria="${c.id}">Renomear</button>
      </li>`
      )
      .join('');
  }

  // Um único listener de delegação cobre os três estados do "renomear
  // categoria" (clicar em Renomear -> vira input; Salvar; Cancelar) —
  // um miniformulário inline no lugar de usar prompt() nativo, para
  // manter a mesma linha visual do resto do produto.
  if (adminListaCategorias) {
    adminListaCategorias.addEventListener('click', async (e) => {
      const btnEditar = e.target.closest('[data-editar-categoria]');
      if (btnEditar) {
        const item = btnEditar.closest('.item-categoria');
        const nomeAtual = item.querySelector('.categoria-nome').textContent;
        item.innerHTML = `
          <input type="text" class="categoria-input" value="${escaparHtml(nomeAtual)}" />
          <div class="acoes">
            <button type="button" class="botao-primario botao-pequeno" data-salvar-categoria="${btnEditar.dataset.editarCategoria}">Salvar</button>
            <button type="button" class="botao-secundario botao-pequeno" data-cancelar-categoria>Cancelar</button>
          </div>`;
        item.querySelector('.categoria-input').focus();
        return;
      }

      if (e.target.closest('[data-cancelar-categoria]')) {
        renderizarCategoriasAdmin(await API.adminCategorias());
        return;
      }

      const btnSalvar = e.target.closest('[data-salvar-categoria]');
      if (btnSalvar) {
        const item = btnSalvar.closest('.item-categoria');
        const novoNome = item.querySelector('.categoria-input').value.trim();
        if (novoNome) {
          try {
            await API.adminRenomearCategoria(btnSalvar.dataset.salvarCategoria, novoNome);
            await carregarCategorias(); // atualiza também os <select> de cadastro/chamado
            toast('Categoria renomeada.', 'sucesso');
          } catch (err) {
            toast(err.message, 'erro');
          }
        }
        renderizarCategoriasAdmin(await API.adminCategorias());
      }
    });
  }

  function renderizarUsuariosAdmin({ clientes, prestadores }) {
    const linhas = [
      ...clientes.map((c) => ({ ...c, tipo: 'Cliente' })),
      ...prestadores.map((p) => ({ ...p, tipo: 'Prestador' }))
    ];
    adminTabelaUsuarios.innerHTML = linhas.length
      ? linhas
          .map(
            (u) => `
        <tr>
          <td>${escaparHtml(u.nome)}</td>
          <td>${escaparHtml(u.email)}</td>
          <td>${u.tipo}</td>
          <td>${escaparHtml(u.categoriaNome) || '—'}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="texto-auxiliar">Nenhum usuário cadastrado.</td></tr>';
  }

  async function renderizarChamadosAdmin() {
    const lista = await API.adminChamados(adminFiltroStatus.value);
    adminTabelaChamados.innerHTML = lista.length
      ? lista
          .map((c) => {
            const podeCancelar = ['aberto', 'aceito', 'em_andamento'].includes(c.status);
            return `
        <tr>
          <td>${escaparHtml(c.clienteNome)}</td>
          <td>${escaparHtml(c.prestadorNome) || '—'}</td>
          <td>${escaparHtml(c.categoriaNome)}</td>
          <td><span class="selo ${c.status === 'cancelado' ? 'selo-cancelado' : c.status === 'concluido' ? 'selo-concluido' : ''}">${rotuloStatus(c.status)}</span></td>
          <td>${formatarData(c.dataAbertura)}</td>
          <td>${podeCancelar ? `<button type="button" class="botao-perigo botao-pequeno" data-admin-cancelar="${c.id}">Cancelar</button>` : ''}</td>
        </tr>`;
          })
          .join('')
      : '<tr><td colspan="6" class="texto-auxiliar">Nenhum chamado encontrado.</td></tr>';
  }

  if (adminFiltroStatus) {
    adminFiltroStatus.addEventListener('change', renderizarChamadosAdmin);
  }

  if (adminTabelaChamados) {
    adminTabelaChamados.addEventListener('click', async (e) => {
      const botao = e.target.closest('[data-admin-cancelar]');
      if (!botao) return;
      if (!(await confirmar('Cancelar este chamado por moderação?'))) return;
      try {
        await API.adminCancelarChamado(botao.dataset.adminCancelar);
        toast('Chamado cancelado.', 'sucesso');
        await atualizarPainelAdmin();
      } catch (err) {
        toast(err.message, 'erro');
      }
    });
  }

  iniciar(); // ponto de entrada: roda assim que este script é carregado
})();
