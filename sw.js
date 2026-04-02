// ================================================================
// sw.js — Service Worker — Minutinhos: Ordem dos Guardiões
// Estratégia: Cache-first para assets estáticos
// ================================================================

const CACHE_NAME = 'minutinhos-v1';

const ASSETS_TO_CACHE = [
  './Index.html',
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

// Instala e faz cache de todos os assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

// Ativa e limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Intercepta requisições
self.addEventListener('fetch', event => {
  // Firebase Realtime Database — NUNCA cachear (sempre online)
  if (event.request.url.includes('firebaseio.com') ||
      event.request.url.includes('firebase.googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cacheia respostas válidas de GET
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline e não tem cache — retorna o Index.html
        if (event.request.destination === 'document') {
          return caches.match('./Index.html');
        }
      });
    })
  );
});
