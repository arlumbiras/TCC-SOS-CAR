// =================================================================
// Service worker mínimo: só o necessário para o navegador considerar o
// SOS Car "instalável" (PWA) e funcionar de forma razoável offline para
// quem já visitou antes. Estratégia "network-first": tenta a rede
// primeiro (dados sempre atualizados) e só cai no cache se estiver
// offline — nunca serve uma versão desatualizada por engano enquanto
// há conexão.
//
// Instalação como app exige HTTPS (ou "localhost") — em http:// puro
// (ex.: acessando pelo IP da rede local) o navegador registra o service
// worker, mas não oferece a opção de instalar.
// =================================================================
const CACHE = 'sos-car-v1';
const ARQUIVOS_ESSENCIAIS = [
  '/',
  '/css/style.css',
  '/js/theme.js',
  '/js/api.js',
  '/js/masks.js',
  '/js/mapa.js',
  '/js/app.js',
  '/img/logo.svg',
  '/manifest.json'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS_ESSENCIAIS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  // Chamadas à API nunca devem ser respondidas pelo cache — precisam
  // sempre ser dados atuais (ou falhar de verdade, para o app tratar).
  if (evento.request.url.includes('/api/')) return;

  evento.respondWith(
    fetch(evento.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(evento.request, copia));
        return resposta;
      })
      .catch(() => caches.match(evento.request))
  );
});
