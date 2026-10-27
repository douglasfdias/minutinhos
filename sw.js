// ================================================================
// sw.js - Service Worker - Minutinhos: Ordem dos Guardiões
// v45 - Central de Mensagens: notificação única, com o texto da mensagem
// ================================================================

const TITULO_PADRAO = 'Minutinhos';

// --- Notificações push (com o app fechado) ----------------------------------
// O Worker manda só "dados" (sem bloco notification). Assim só ESTE código
// mostra a notificação, uma vez só. Antes o Firebase mostrava uma e este
// arquivo mostrava outra: era a notificação duplicada.
const ICONE_PADRAO = 'https://i.ibb.co/1YgwbMTG/duolingo-oraculo-head.png';
const SELO = new URL('badge-notif.png', self.registration.scope).href;

function lerPush(event) {
  if (!event.data) return {};
  try { return event.data.json() || {}; } catch (e) { return { data: { titulo: TITULO_PADRAO, corpo: event.data.text() } }; }
}

async function clientesVisiveis() {
  const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return lista.filter((c) => c.url.startsWith(self.registration.scope) && c.visibilityState === 'visible');
}

async function mostrarPush(payload) {
  const d = Object.assign({}, payload.data || {});
  const n = payload.notification || {};               // compatibilidade com o Worker antigo
  const titulo = d.titulo || n.title || TITULO_PADRAO;
  const corpo = d.corpo || d.mensagem || n.body || '';
  const tipo = d.tipo || 'geral';
  const url = d.url || self.registration.scope;

  // App aberto na tela: ele mesmo avisa (aviso no topo, sino do Oráculo).
  const visiveis = await clientesVisiveis();
  if (visiveis.length) {
    visiveis.forEach((c) => c.postMessage({ cx: 'push', tipo, dados: d }));
    return;
  }

  if (tipo === 'chat' && d.cid) {
    // Uma notificação por conversa, juntando as mensagens (como no WhatsApp)
    const tag = 'chat-' + d.cid;
    const antigas = await self.registration.getNotifications({ tag });
    const ant = (antigas[0] && antigas[0].data) || {};
    const mids = Array.isArray(ant.mids) ? ant.mids : [];
    const linhas = Array.isArray(ant.linhas) ? ant.linhas : [];
    const repetida = d.mid && mids.includes(d.mid);   // a mesma mensagem chegou de novo
    if (!repetida) { linhas.push(corpo); if (d.mid) mids.push(d.mid); }
    const ultimas = linhas.slice(-6);
    const qtd = linhas.length;
    return self.registration.showNotification(qtd > 1 ? titulo + ' (' + qtd + ' mensagens)' : titulo, {
      body: ultimas.join('\n'),
      icon: d.icone || ICONE_PADRAO,
      badge: SELO,
      tag,
      renotify: !repetida,
      vibrate: repetida ? undefined : [80, 50, 80, 50, 160],
      timestamp: Number(d.ts) || Date.now(),
      data: { url, cid: d.cid, tipo, mids: mids.slice(-30), linhas: linhas.slice(-30) }
    });
  }

  // Avisos da Ordem (aprovações, vouchers...). A tag usa o id do envio:
  // se o mesmo aviso chegar duas vezes, a segunda substitui a primeira em silêncio.
  const tag = d.nid ? 'aviso-' + d.nid : 'aviso-' + tipo + '-' + Date.now();
  const ja = d.nid ? await self.registration.getNotifications({ tag }) : [];
  const opcoes = { body: corpo, icon: d.icone || ICONE_PADRAO, badge: SELO, tag, data: { url, tipo } };
  if (ja.length) opcoes.silent = true; else opcoes.vibrate = [80, 50, 80, 50, 160];
  return self.registration.showNotification(titulo, opcoes);
}

self.addEventListener('push', (event) => {
  event.waitUntil(mostrarPush(lerPush(event)).catch(() =>
    self.registration.showNotification(TITULO_PADRAO, { body: 'Você tem uma novidade.', icon: ICONE_PADRAO, badge: SELO })));
});

// Tocar na notificação abre o app (e a conversa certa, se for mensagem)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const destino = d.url || self.registration.scope;
  event.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const meu = lista.find((c) => c.url.startsWith(self.registration.scope));
    if (meu) {
      try { await meu.focus(); } catch (e) {}
      if (d.cid) meu.postMessage({ cx: 'abrir', cid: d.cid });
      return;
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});

const CACHE_NAME = 'minutinhos-v45';

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
  'https://i.ibb.co/YF6L3bP8/imagem-livro-180x140.png',
  'https://i.ibb.co/cScPzrpW/imagem-forja-188x188.png',
  'https://i.ibb.co/jvkzKpNL/duolingo-oraculo-head-50x50.png',
  'https://i.ibb.co/1YgwbMTG/duolingo-oraculo-head.png',
  'https://i.ibb.co/N2QFSxDx/icone-energia-2.png',
  'https://i.ibb.co/Zzkm8F01/icone-cristal.png',
  'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
  'https://i.ibb.co/V077M1SY/avatar-girl-full-body-mod1-nobg-2.png',
  'https://i.ibb.co/rR2qn4yf/avatar-dad-full-body-mod1-nobg-2.png'
];

self.addEventListener('install', event => {
  // Não ativa automaticamente - espera o app chamar skipWaiting via mensagem
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
  // Telas do app abrem do cache mesmo com ?chat=... ou ?cer=... no endereço
  const opcoesCache = event.request.mode === 'navigate' ? { ignoreSearch: true } : undefined;
  event.respondWith(
    caches.match(event.request, opcoesCache).then(cached => {
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
