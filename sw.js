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
    icon: (payload.data && payload.data.icone) || '/minutinhos/icon-192.png',
    badge: '/minutinhos/icon-192.png',
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

const CACHE_NAME = 'minutinhos-v31';

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
  // Não ativa sozinho — o app mostra o banner e o usuário decide.
  // Mas baixa SEMPRE da rede: sem { cache: 'reload' } o GitHub Pages
  // devolve o HTML antigo do cache HTTP e a versão nova nunca chega.
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
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

/* Rede primeiro para o que muda (HTML/JS/CSS do próprio app),
   cache primeiro só para bibliotecas externas e imagens.
   Antes era cache-primeiro para TUDO — por isso o app das crianças
   continuava servindo o index.html velho mesmo com o SW novo ativo. */
const ROOT = '/minutinhos/';

function ehConteudoDoApp(request, url) {
  if (request.mode === 'navigate') return true;
  if (url.origin !== self.location.origin) return false;
  return /\.(html|js|css|json)$/i.test(url.pathname) || url.pathname === ROOT;
}

async function redePrimeiro(request) {
  try {
    const res = await fetch(new Request(request.url, { cache: 'no-store' }));
    if (res && res.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await caches.match(ROOT + 'index.html')) || (await caches.match(ROOT));
    }
    throw e;
  }
}

async function cachePrimeiro(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (request.method === 'GET' && res && res.status === 200) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseinstallations')) return;

  event.respondWith(ehConteudoDoApp(req, url) ? redePrimeiro(req) : cachePrimeiro(req));
});

// Recebe mensagem do app para ativar nova versão
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'LIMPAR_CACHE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
  }
});
