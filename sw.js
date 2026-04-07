// ================================================================
// sw.js — Service Worker — Minutinhos: Ordem dos Guardiões
// v3 — start_url corrigido para /minutinhos/
// ================================================================

const CACHE_NAME = 'minutinhos-v14';

const ASSETS_TO_CACHE = [
  '/minutinhos/',
  '/minutinhos/index.html',
  '/minutinhos/Index.html',
  '/minutinhos/Mestre.html',
  '/minutinhos/manifest.json',
  '/minutinhos/sw.js',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;700;900&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js',
  'https://i.ibb.co/d4ntxNFN/background-user-UI-Minutinhos-3.webp',
  'https://i.ibb.co/yFhfs0n4/duolingo-oraculo-full-body.png',
  'https://i.ibb.co/N2QFSxDx/icone-energia-2.png',
  'https://i.ibb.co/Zzkm8F01/icone-cristal.png',
  'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
  'https://i.ibb.co/V077M1SY/avatar-girl-full-body-mod1-nobg-2.png',
  'https://i.ibb.co/rR2qn4yf/avatar-dad-full-body-mod1-nobg-2.png'
];

self.addEventListener('install', event => {
  // Não ativa automaticamente — espera o app chamar skipWaiting via mensagem
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('firebaseio.com') ||
      event.request.url.includes('firebase.googleapis.com')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('/minutinhos/');
        }
      });
    })
  );
});

// Recebe mensagem do app para ativar nova versão
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
