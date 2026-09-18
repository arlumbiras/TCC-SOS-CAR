// =================================================================
// Mini-mapa de localização (card "Seu chamado" do cliente e
// "Atendimento em andamento" do prestador), usando Leaflet + tiles do
// OpenStreetMap — gratuito, sem chave de API (ver <link>/<script> do
// Leaflet carregados via CDN em index.html, antes deste arquivo).
//
// Guardamos uma instância de mapa por elemento (em vez de recriar a
// cada atualização do painel) porque o Leaflet não gosta de ser
// inicializado duas vezes sobre o mesmo <div> — é mais barato só mover
// o marcador existente quando a localização não muda.
// =================================================================
const Mapa = (function () {
  const instancias = {}; // elementoId -> { mapa, marcadores, rota, usuarioMoveu }

  function prepararBotaoTelaCheia(elementoId) {
    const elemento = document.getElementById(elementoId);
    if (!elemento || elemento.querySelector('.mapa-botao-fullscreen')) return;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'mapa-botao-fullscreen';
    botao.textContent = 'Tela inteira';
    botao.addEventListener('click', () => {
      const instancia = instancias[elementoId];
      if (!instancia) return;
      const ativo = elemento.classList.toggle('mapa-fullscreen');
      botao.textContent = ativo ? 'Sair da tela inteira' : 'Tela inteira';
      setTimeout(() => instancia.mapa.invalidateSize(), 0);
    });
    elemento.appendChild(botao);
  }

  function normalizarCategoria(chave) {
    if (!chave) return 'padrao';
    const texto = String(chave).trim().toLowerCase();
    if (texto.includes('mecan')) return 'mecanico';
    if (texto.includes('borrache')) return 'borracheiro';
    if (texto.includes('eletrica') || texto.includes('elétrica')) return 'auto-eletrica';
    if (texto.includes('guin')) return 'guincho';
    return 'padrao';
  }

  function getIconeCategoria(categoriaNome) {
    const categoria = normalizarCategoria(categoriaNome);
    const mapaIcones = {
      mecanico: { emoji: '🔧', classe: 'icon-mecanico' },
      borracheiro: { emoji: '🛞', classe: 'icon-borracheiro' },
      'auto-eletrica': { emoji: '⚡', classe: 'icon-auto-eletrica' },
      guincho: { emoji: '🚚', classe: 'icon-guincho' },
      padrao: { emoji: '📍', classe: 'icon-cliente' }
    };

    const icone = mapaIcones[categoria] || mapaIcones.padrao;
    return L.divIcon({
      className: '',
      html: `<div class="mapa-icone ${icone.classe}" aria-label="${icone.emoji}">${icone.emoji}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18]
    });
  }

  function calcularDistanciaKm(origem, destino) {
    const toRad = (valor) => (valor * Math.PI) / 180;
    const lat1 = toRad(origem[0]);
    const lat2 = toRad(destino[0]);
    const dLat = toRad(destino[0] - origem[0]);
    const dLng = toRad(destino[1] - origem[1]);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
  }

  function formatarTempoEstimado(minutos) {
    const totalMinutos = Math.max(1, Math.round(minutos));
    if (totalMinutos < 60) return `${totalMinutos} min`;
    const horas = Math.floor(totalMinutos / 60);
    const minutosRestantes = totalMinutos % 60;
    return minutosRestantes ? `${horas}h ${minutosRestantes}min` : `${horas}h`;
  }

  function atualizarViewportSeNecessario(elementoId) {
    const instancia = instancias[elementoId];
    if (!instancia || instancia.usuarioMoveu) return;

    const pontos = Object.values(instancia.marcadores)
      .filter(Boolean)
      .map((marcador) => marcador.getLatLng());

    if (pontos.length < 2) return;

    const bounds = L.latLngBounds(pontos);
    const visivel = instancia.mapa.getBounds();
    const saiuCampoVisao = pontos.some((ponto) => !visivel.contains(ponto));

    if (saiuCampoVisao) {
      instancia.mapa.fitBounds(bounds, {
        padding: [60, 60],
        maxZoom: 16,
        animate: true
      });
    }
  }

  function removerRota(elementoId) {
    const instancia = instancias[elementoId];
    if (!instancia?.rota) return;
    instancia.mapa.removeLayer(instancia.rota);
    instancia.rota = null;
  }

  function mostrarRota(elementoId, origem, destino) {
    const instancia = instancias[elementoId];
    if (!instancia || !origem || !destino) return;

    removerRota(elementoId);

    const origemLngLat = [origem[1], origem[0]];
    const destinoLngLat = [destino[1], destino[0]];
    const distanciaKm = calcularDistanciaKm(origem, destino);
    const tempoEstimado = Math.max(1, (distanciaKm / 32) * 60);

    const montarLinha = (pontos, popupHtml) => {
      const linha = L.polyline(pontos, {
        color: '#4f46e5',
        weight: 5,
        opacity: 0.8,
        dashArray: '8 10'
      }).addTo(instancia.mapa);
      linha.bindPopup(popupHtml, { autoClose: false, closeButton: true });
      linha.openPopup();
      instancia.rota = linha;
    };

    fetch(
      `https://router.project-osrm.org/route/v1/driving/${origemLngLat.join(',')};${destinoLngLat.join(',')}?overview=full&geometries=geojson`
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Rota indisponível'))))
      .then((dados) => {
        const coords = dados?.routes?.[0]?.geometry?.coordinates;
        const distanciaApi = dados?.routes?.[0]?.distance;
        const duracaoApi = dados?.routes?.[0]?.duration;
        const popupHtml =
          typeof distanciaApi === 'number'
            ? `Distância: ${(distanciaApi / 1000).toFixed(1)} km<br>Tempo estimado: ${formatarTempoEstimado(typeof duracaoApi === 'number' ? duracaoApi / 60 : tempoEstimado)}`
            : `Distância: ${distanciaKm.toFixed(1)} km<br>Tempo estimado: ${formatarTempoEstimado(tempoEstimado)}`;

        if (!coords || !coords.length) {
          montarLinha([origem, destino], popupHtml);
          return;
        }

        const pontos = coords.map(([lng, lat]) => [lat, lng]);
        montarLinha(pontos, popupHtml);
      })
      .catch(() => {
        const popupFallback = `Distância: ${distanciaKm.toFixed(1)} km<br>Tempo estimado: ${formatarTempoEstimado(tempoEstimado)}`;
        montarLinha([origem, destino], popupFallback);
      });
  }

  function obterInstancia(elementoId, latitude, longitude) {
    const elemento = document.getElementById(elementoId);
    if (!elemento || typeof L === 'undefined' || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }

    if (instancias[elementoId]) return instancias[elementoId];

    const mapa = L.map(elemento, { zoomControl: false }).setView([latitude, longitude], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(mapa);

    instancias[elementoId] = { mapa, marcadores: {}, rota: null, usuarioMoveu: false };
    mapa.on('dragstart', () => {
      instancias[elementoId].usuarioMoveu = true;
    });
    mapa.on('zoomstart', () => {
      instancias[elementoId].usuarioMoveu = true;
    });
    prepararBotaoTelaCheia(elementoId);
    setTimeout(() => mapa.invalidateSize(), 0);
    return instancias[elementoId];
  }

  function atualizarMarcador(elementoId, chave, latitude, longitude, titulo, categoriaNome = null) {
    const instancia = obterInstancia(elementoId, latitude, longitude);
    if (!instancia) return;

    const coordenadas = [latitude, longitude];
    const marcador = instancia.marcadores[chave];
    if (marcador) {
      marcador.setLatLng(coordenadas);
      marcador.setIcon(getIconeCategoria(categoriaNome));
      if (titulo) marcador.bindPopup(titulo);
      return;
    }

    const novoMarcador = L.marker(coordenadas, {
      icon: getIconeCategoria(categoriaNome)
    }).addTo(instancia.mapa);
    if (titulo) novoMarcador.bindPopup(titulo);
    instancia.marcadores[chave] = novoMarcador;
  }

  function criarOuAtualizar(elementoId, latitude, longitude, titulo, categoriaNome = null) {
    const instancia = obterInstancia(elementoId, latitude, longitude);
    if (!instancia) return;
    atualizarMarcador(elementoId, 'chamado', latitude, longitude, titulo, categoriaNome || 'padrao');
    atualizarViewportSeNecessario(elementoId);
    setTimeout(() => instancia.mapa.invalidateSize(), 0);
  }

  function criarOuAtualizarPrestador(elementoId, latitude, longitude, titulo, categoriaNome = null) {
    const instancia = obterInstancia(elementoId, latitude, longitude);
    if (!instancia) return;
    atualizarMarcador(elementoId, 'prestador', latitude, longitude, titulo, categoriaNome || 'mecanico');
    atualizarViewportSeNecessario(elementoId);
  }

  function removerPrestador(elementoId) {
    const instancia = instancias[elementoId];
    const marcador = instancia?.marcadores.prestador;
    if (!marcador) return;
    instancia.mapa.removeLayer(marcador);
    delete instancia.marcadores.prestador;
    atualizarViewportSeNecessario(elementoId);
  }

  function criarOuAtualizarRota(elementoId, origem, destino) {
    const instancia = instancias[elementoId];
    if (!instancia || !origem || !destino) return;
    mostrarRota(elementoId, origem, destino);
    atualizarViewportSeNecessario(elementoId);
  }

  return { criarOuAtualizar, criarOuAtualizarPrestador, removerPrestador, criarOuAtualizarRota };
})();
