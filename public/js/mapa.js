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
  const instancias = {}; // elementoId -> { mapa, marcador }

  function criarOuAtualizar(elementoId, latitude, longitude, titulo) {
    const elemento = document.getElementById(elementoId);
    if (!elemento || typeof L === 'undefined' || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return;
    }

    const existente = instancias[elementoId];
    if (existente) {
      existente.mapa.setView([latitude, longitude]);
      existente.marcador.setLatLng([latitude, longitude]);
      if (titulo) existente.marcador.bindPopup(titulo);
      // O card pode ter ficado "display:none" entre uma atualização e
      // outra (troca de tela); invalidateSize recalcula o tamanho do
      // mapa assim que ele volta a ficar visível, senão os tiles ficam
      // cortados/cinzas.
      setTimeout(() => existente.mapa.invalidateSize(), 0);
      return;
    }

    const mapa = L.map(elemento, { zoomControl: false }).setView([latitude, longitude], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(mapa);
    const marcador = L.marker([latitude, longitude]).addTo(mapa);
    if (titulo) marcador.bindPopup(titulo).openPopup();

    instancias[elementoId] = { mapa, marcador };
    setTimeout(() => mapa.invalidateSize(), 0);
  }

  return { criarOuAtualizar };
})();
