// =================================================================
// Cálculo de distância entre duas coordenadas GPS (fórmula de Haversine).
//
// É o "cálculo simples de distância" citado no escopo do TCC: em vez de
// usar um serviço de roteirização (que calcularia a distância real por
// ruas, fora do escopo do MVP), calculamos a distância em linha reta
// entre o prestador e o chamado, em quilômetros, e usamos isso para
// filtrar/ordenar os chamados "próximos" de cada prestador.
// =================================================================
function distanciaKm(lat1, lon1, lat2, lon2) {
  // Se alguma coordenada não existir (ex.: prestador ainda não permitiu
  // geolocalização), não dá para calcular distância — devolve null e
  // quem chamou essa função decide o que fazer (ver server.js, onde um
  // chamado sem distância calculável é tratado como "dentro do raio").
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) {
    return null;
  }

  const R = 6371; // raio médio da Terra, em quilômetros
  const paraRad = (graus) => (graus * Math.PI) / 180; // graus -> radianos

  const dLat = paraRad(lat2 - lat1);
  const dLon = paraRad(lon2 - lon1);

  // Fórmula de Haversine: calcula a distância "em linha reta" entre dois
  // pontos na superfície de uma esfera, a partir da latitude/longitude.
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(paraRad(lat1)) * Math.cos(paraRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distância final, em km
}

module.exports = { distanciaKm };
