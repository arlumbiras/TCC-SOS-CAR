// =================================================================
// Lógica das telas do SOS Barbie.
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
    auth: document.getElementById('tela-auth'),
    cliente: document.getElementById('tela-cliente'),
    prestador: document.getElementById('tela-prestador'),
    config: document.getElementById('tela-config')
  };
  const btnSair = document.getElementById('btn-sair');
  const btnConfig = document.getElementById('btn-config');
  const formConfig = document.getElementById('form-configuracoes');
  const btnConfigCancel = document.getElementById('btn-config-cancel');
  let usuarioTipoAtual = null;
  let ultimoUsuario = null;

  // Mostra só a tela pedida, escondendo as outras duas (classe "oculta"
  // vem do CSS com "display: none !important"). O botão "Sair" só
  // aparece quando o usuário está logado (qualquer tela != auth).
  function mostrarTela(nome) {
    Object.entries(telas).forEach(([chave, el]) => el.classList.toggle('oculta', chave !== nome));
    btnSair.classList.toggle('oculto', nome === 'auth');
    if (btnConfig) btnConfig.classList.toggle('oculto', nome === 'auth');
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

  // ---------------- Boot ----------------
  // Roda uma única vez, assim que a página carrega (chamada lá no final
  // do arquivo). Decide qual tela mostrar primeiro.
  async function iniciar() {
    await carregarCategorias();

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

  // Depois de login/cadastro bem-sucedido, decide qual dos dois painéis
  // abrir, de acordo com o tipo de usuário.
  function entrarComoUsuario(tipo, usuario) {
    usuarioTipoAtual = tipo;
    ultimoUsuario = usuario;
    if (btnConfig) btnConfig.classList.remove('oculto');
    if (tipo === 'cliente') iniciarPainelCliente(usuario);
    else iniciarPainelPrestador(usuario);
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
    try {
      const { token, usuario } = await API.login({ tipo: perfilSelecionado, ...dados });
      API.definirToken(token);
      formLogin.reset();
      entrarComoUsuario(perfilSelecionado, usuario);
    } catch (err) {
      mostrarErro(err.message);
    }
  });

  // Envio do formulário de cadastro — mesma lógica do login, chamando
  // API.registrar em vez de API.login.
  formCadastro.addEventListener('submit', async (e) => {
    e.preventDefault();
    esconderErro();
    const dados = Object.fromEntries(new FormData(formCadastro));
    try {
      const { token, usuario } = await API.registrar({ tipo: perfilSelecionado, ...dados });
      API.definirToken(token);
      formCadastro.reset();
      entrarComoUsuario(perfilSelecionado, usuario);
    } catch (err) {
      mostrarErro(err.message);
    }
  });

  // Botão "Sair": avisa a API (para invalidar o token no servidor),
  // apaga o token local e volta para a tela de login.
  btnSair.addEventListener('click', async () => {
    pararAtualizacaoAutomatica();
    try {
      await API.logout();
    } catch {
      // Mesmo que o logout no servidor falhe (ex.: sessão já expirada),
      // seguimos limpando o token local e voltando para o login.
    }
    API.definirToken(null);
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
        alert('Não foi possível carregar seus dados: ' + err.message);
      }
    });
  }

  // Envio do formulário de configurações: atualiza usuário via API
  if (formConfig) {
    formConfig.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dados = Object.fromEntries(new FormData(formConfig));
      if (!dados.senha) delete dados.senha; // se vazio, não envia senha
      try {
        await API.atualizarUsuario(dados);
        // lê os dados atualizados e reentra no painel apropriado
        const me = await API.quemSouEu();
        entrarComoUsuario(me.tipo, me.usuario);
        alert('Dados atualizados com sucesso.');
      } catch (err) {
        alert(err.message);
      }
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
    marcaEl.addEventListener('click', () => {
      if (usuarioTipoAtual) {
        mostrarTela(usuarioTipoAtual === 'cliente' ? 'cliente' : 'prestador');
      } else {
        mostrarTela('auth');
      }
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

  // Envio do formulário "Precisa de socorro agora?": abre um novo
  // chamado. Usa a localização obtida por GPS se houver; senão, cai no
  // fallback fixo (LOCALIZACAO_RESERVA), já que o backend exige
  // latitude/longitude numéricas.
  formChamado.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(formChamado));
    const localizacao = localizacaoCliente || LOCALIZACAO_RESERVA;

    try {
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
      alert(err.message);
    }
  });

  btnCancelarChamado.addEventListener('click', async () => {
    if (!chamadoEmFoco || !confirm('Cancelar este chamado?')) return;
    try {
      await API.cancelarChamado(chamadoEmFoco.id);
      await atualizarPainelCliente();
    } catch (err) {
      alert(err.message);
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
      alert('Escolha uma nota de 1 a 5 estrelas.');
      return;
    }
    const dados = Object.fromEntries(new FormData(formAvaliacao));
    try {
      await API.avaliarChamado(chamadoEmFoco.id, { nota: notaSelecionada, comentario: dados.comentario });
      notaSelecionada = 0;
      formAvaliacao.reset();
      await atualizarPainelCliente();
    } catch (err) {
      alert(err.message);
    }
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

    detalhesEl.innerHTML = `
      <dt>Categoria</dt><dd>${chamado.categoriaNome}</dd>
      <dt>Endereço</dt><dd>${chamado.endereco || '—'}</dd>
      ${chamado.prestadorNome ? `<dt>Prestador</dt><dd>${chamado.prestadorNome} · ${chamado.prestadorTelefone || 'sem telefone'}</dd>` : ''}
      <dt>Status</dt><dd>${rotuloStatus(chamado.status)}</dd>
    `;

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
      alert(err.message);
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
      alert(err.message);
    }
    await atualizarPainelPrestador(); // atualiza a lista de qualquer forma (com ou sem sucesso)
  });

  btnIniciar.addEventListener('click', async () => {
    try {
      await API.iniciarAtendimento(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      alert(err.message);
    }
  });

  btnCancelarPrestador.addEventListener('click', async () => {
    if (!chamadoEmFoco || !confirm('Cancelar este atendimento e liberar o chamado para outros prestadores?')) return;
    try {
      await API.cancelarPorPrestador(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      alert(err.message);
    }
  });

  btnConcluir.addEventListener('click', async () => {
    try {
      await API.concluirAtendimento(chamadoEmFoco.id);
      await atualizarPainelPrestador();
    } catch (err) {
      alert(err.message);
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
          <strong>${c.endereco || 'Endereço não informado'}</strong>
          <div class="texto-auxiliar">${c.descricao || 'Sem descrição'}${c.distanciaKm != null ? ` · ${c.distanciaKm.toFixed(1)} km` : ''}</div>
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
      <dt>Cliente</dt><dd>${chamado.clienteNome} · ${chamado.clienteTelefone || 'sem telefone'}</dd>
      <dt>Endereço</dt><dd>${chamado.endereco || '—'}</dd>
      <dt>Descrição</dt><dd>${chamado.descricao || '—'}</dd>
      <dt>Status</dt><dd>${rotuloStatus(chamado.status)}</dd>
    `;
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
            <strong>${obterTitulo(c)}</strong>
            <div class="texto-auxiliar">${c.endereco || ''} · ${formatarData(c.dataAbertura)}</div>
          </div>
          <span class="selo ${c.status === 'cancelado' ? 'selo-cancelado' : 'selo-concluido'}">${rotuloStatus(c.status)}</span>
        </li>`
          )
          .join('')
      : '<li class="texto-auxiliar">Nada por aqui ainda.</li>';
  }

  iniciar(); // ponto de entrada: roda assim que este script é carregado
})();
