const https = require('https');

const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const cache = new Map();
let proximaConsulta = 0;

function aguardarLimite() {
  const espera = Math.max(0, proximaConsulta - Date.now());
  proximaConsulta = Date.now() + espera + 1100;
  return new Promise((resolve) => setTimeout(resolve, espera));
}

function consultarNominatim(endereco) {
  return new Promise((resolve, reject) => {
    const url = new URL(URL_NOMINATIM);
    url.searchParams.set('q', endereco);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'br');

    const requisicao = https.get(
      url,
      {
        headers: {
          'User-Agent': process.env.OSM_USER_AGENT || 'SOS-Car-TCC/1.0 (contato: admin@soscar.com)',
          Accept: 'application/json'
        }
      },
      (resposta) => {
        let corpo = '';
        resposta.setEncoding('utf8');
        resposta.on('data', (parte) => {
          corpo += parte;
        });
        resposta.on('end', () => {
          if (resposta.statusCode !== 200) {
            reject(new Error(`Nominatim respondeu com HTTP ${resposta.statusCode}.`));
            return;
          }
          try {
            resolve(JSON.parse(corpo));
          } catch {
            reject(new Error('A resposta do serviço de geocodificação não é válida.'));
          }
        });
      }
    );
    requisicao.setTimeout(10000, () => requisicao.destroy(new Error('Tempo limite ao consultar Nominatim.')));
    requisicao.on('error', reject);
  });
}

async function geocodificar(endereco) {
  const chave = endereco.trim().toLocaleLowerCase('pt-BR');
  if (!chave) throw new Error('Informe um endereço para localizar.');
  if (cache.has(chave)) return cache.get(chave);

  await aguardarLimite();
  const resultados = await consultarNominatim(endereco.trim());
  const primeiro = resultados[0];
  if (!primeiro) return null;

  const localizacao = {
    latitude: Number(primeiro.lat),
    longitude: Number(primeiro.lon),
    enderecoFormatado: primeiro.display_name
  };
  cache.set(chave, localizacao);
  return localizacao;
}

module.exports = { geocodificar };