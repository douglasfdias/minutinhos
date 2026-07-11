// ================================================================
// sw.js — Service Worker — Minutinhos: Ordem dos Guardiões
// v19 — adiciona push notifications em background (Firebase Cloud Messaging)
// ================================================================

// --- Firebase Cloud Messaging (push com o app fechado) ---------
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyABCdoTrqwRmj3wmiYGRJfTbcyoqyf5uME",
  authDomain: "minutinhos.firebaseapp.com",
  databaseURL: "https://minutinhos-default-rtdb.firebaseio.com",
  projectId: "minutinhos",
  storageBucket: "minutinhos.firebasestorage.app",
  messagingSenderId: "205117538078",
  appId: "1:205117538078:web:33a0c88a10c6b3d7f5930f"
});

const messaging = firebase.messaging();

// Mostra a notificação do sistema quando o push chega com o app fechado/em background.
messaging.onBackgroundMessage((payload) => {
  const titulo = payload.notification?.title || 'Minutinhos';
  const corpo = payload.notification?.body || '';
  self.registration.showNotification(titulo, {
    body: corpo,
    icon: 'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
    badge: 'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
    vibrate: [60, 30, 60, 30, 120],
    data: payload.data || {},
    tag: payload.data?.tipo || 'minutinhos'
  });
});

// Ao tocar na notificação, abre/foca o app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('/minutinhos/') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/minutinhos/');
    })
  );
});

const CACHE_NAME = 'minutinhos-v25';

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
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js',
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
