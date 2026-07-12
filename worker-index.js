// ================================================================
// minutinhos-push — Cloudflare Worker
// Relay seguro de notificações push (FCM HTTP v1) para o app
// "Minutinhos: A Ordem dos Guardiões".
//
// Por que esse Worker existe:
// Enviar push exige uma credencial secreta (Service Account do Firebase).
// Essa credencial NUNCA pode estar no index.html/Mestre.html (ficaria
// visível pra qualquer pessoa no "Ver código-fonte"). Este Worker guarda
// o segredo do lado de fora do navegador e só age depois de validar de
// verdade quem está pedindo o envio (token do Firebase Authentication).
//
// Endpoints:
//   POST /notify   -> dispara um push para um destinatário específico
//   (scheduled)    -> roda a cada 1 min, fecha vouchers expirados e avisa
// ================================================================

import { jwtVerify, createRemoteJWKSet, SignJWT, importPKCS8 } from 'jose';

const FIREBASE_AUTH_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedGoogleToken = null; // { token, expiresAt }

// URLs ABSOLUTAS dos apps. O FCM exige https:// em webpush.fcm_options.link —
// um caminho relativo faz o envio inteiro falhar com 400 INVALID_ARGUMENT.
const APP_CRIANCA_URL = 'https://douglasfdias.github.io/minutinhos/';
const APP_MESTRE_URL  = 'https://douglasfdias.github.io/minutinhos-mestre/';

// ----------------------------------------------------------------
// OAuth2 — obtém access_token da Service Account (cacheado em memória)
// ----------------------------------------------------------------
async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleToken.expiresAt - 60 > now) {
    return cachedGoogleToken.token;
  }

  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não está configurado (secret vazio ou ausente no Cloudflare).');
  }
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido (provavelmente foi salvo incompleto). Início do valor: "' + raw.slice(0, 60) + '"');
  }
  if (!sa.private_key || !sa.client_email) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não contém private_key/client_email — não é o arquivo certo da Service Account.');
  }
  const privateKey = await importPKCS8(sa.private_key, 'RS256');

  const scope = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/firebase.database',
    'https://www.googleapis.com/auth/firebase.messaging',
  ].join(' ');

  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(assertion),
  });

  if (!resp.ok) {
    throw new Error('Falha ao obter token Google: ' + (await resp.text()));
  }
  const data = await resp.json();
  cachedGoogleToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

// ----------------------------------------------------------------
// Verifica o ID token do Firebase Authentication enviado pelo app
// (mãe logada com email/senha, ou criança autenticada anonimamente)
// ----------------------------------------------------------------
const jwks = createRemoteJWKSet(new URL(FIREBASE_AUTH_JWKS_URL));

async function verifyFirebaseIdToken(idToken, projectId) {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  return payload; // contém .sub (uid), .email (se houver), .firebase.sign_in_provider
}

// ----------------------------------------------------------------
// Helpers de acesso administrativo ao Realtime Database (via OAuth)
// ----------------------------------------------------------------

// Lê o corpo como texto primeiro; corpo vazio = null (em vez de
// deixar JSON.parse('') derrubar a função com SyntaxError).
async function parseJsonSafe(resp, path) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Resposta inesperada do Firebase em ${path}: ${text.slice(0, 200)}`);
  }
}

async function dbGet(env, path) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${env.FIREBASE_DB_URL}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`dbGet ${path} falhou: ${resp.status} — ${await resp.text()}`);
  return parseJsonSafe(resp, path);
}

async function dbPatch(env, path, body) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${env.FIREBASE_DB_URL}/${path}.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`dbPatch ${path} falhou: ${resp.status} — ${await resp.text()}`);
  return parseJsonSafe(resp, path);
}

async function dbPost(env, path, body) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${env.FIREBASE_DB_URL}/${path}.json`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`dbPost ${path} falhou: ${resp.status} — ${await resp.text()}`);
  return parseJsonSafe(resp, path);
}

async function dbSet(env, path, value) {
  const token = await getGoogleAccessToken(env);
  const resp = await fetch(`${env.FIREBASE_DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!resp.ok) throw new Error(`dbSet ${path} falhou: ${resp.status} — ${await resp.text()}`);
  return parseJsonSafe(resp, path);
}

// ----------------------------------------------------------------
// Envia push via FCM HTTP v1 para todos os tokens de um destinatário
// destinoKey: chave do guardião (emailSanitizado) OU "_mestre"
// ----------------------------------------------------------------
async function enviarPushPara(env, destinoKey, titulo, mensagem, tipo, dados) {
  const tokensObj = await dbGet(env, `fcm_tokens/${destinoKey}`);
  if (!tokensObj) return { enviados: 0 };

  // Formato: { pushId1: { token, criadoEm, ua }, pushId2: {...} }
  const entradas = Object.entries(tokensObj).filter(([, v]) => v && v.token);
  const accessToken = await getGoogleAccessToken(env);
  const pushIdsParaRemover = [];
  let enviados = 0;

  // BUG CORRIGIDO: webpush.fcm_options.link EXIGE uma URL ABSOLUTA https://.
  // Antes era '/minutinhos/' (relativo) => o FCM recusava TODA mensagem com
  // 400 INVALID_ARGUMENT, e a limpeza abaixo apagava o token bom. Por isso o
  // nó /fcm_tokens vivia vazio e nenhum push jamais saía.
  const link = destinoKey === '_mestre' ? APP_MESTRE_URL : APP_CRIANCA_URL;

  const erros = [];

  for (const [pushId, info] of entradas) {
    const message = {
      message: {
        token: info.token,
        notification: { title: titulo, body: mensagem },
        webpush: {
          notification: {
            icon: 'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
            badge: 'https://i.ibb.co/7xwvFvSK/avatar-boy-full-body-mod1-nobg.png',
          },
          fcm_options: { link },
        },
        data: { tipo: tipo || 'geral', ...Object.fromEntries(
          Object.entries(dados || {}).map(([k, v]) => [k, String(v)])
        ) },
      },
    };

    const resp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }
    );

    if (resp.ok) {
      enviados++;
    } else {
      const errBody = await resp.text();
      // BUG CORRIGIDO: antes um 400 genérico (= payload inválido) fazia o token
      // BOM ser apagado. 400/INVALID_ARGUMENT é problema NOSSO, não do token.
      // Só removemos quando o FCM diz claramente que o token não existe mais.
      const morto = resp.status === 404 ||
                    errBody.includes('UNREGISTERED') ||
                    errBody.includes('NOT_FOUND') ||
                    errBody.includes('registration-token-not-registered');
      if (morto) pushIdsParaRemover.push(pushId);
      // CORREÇÃO 3: expor o erro do FCM (antes era lido e jogado fora — foi o
      // que manteve a causa invisível todo esse tempo).
      erros.push({ status: resp.status, removido: morto, fcm: errBody.slice(0, 300) });
    }
  }

  // Limpeza de tokens mortos
  for (const pushId of pushIdsParaRemover) {
    await fetch(`${env.FIREBASE_DB_URL}/fcm_tokens/${destinoKey}/${pushId}.json`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  }

  return { enviados, removidos: pushIdsParaRemover.length, erros };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ----------------------------------------------------------------
// POST /aceitar-convite
// Body esperado: { codigo }
// Header: Authorization: Bearer <Firebase ID Token> (já logado/criado)
//
// Permite que uma segunda pessoa (ex: o pai) se torne Mestre sem
// precisar editar nada no Firebase Console. A Mestre gera um código
// de uso único no painel; quem apresentar esse código aqui — com um
// token de login válido — vira admin. Evitamos comparar e-mails nas
// regras do Realtime Database porque a função de string .replace()
// das regras só troca a PRIMEIRA ocorrência de um caractere, o que
// quebraria silenciosamente para e-mails com mais de um ponto.
// ----------------------------------------------------------------
async function handleAceitarConvite(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return jsonResponse({ erro: 'Token de autenticação ausente.' }, 401);

  let payload;
  try {
    payload = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return jsonResponse({ erro: 'Token inválido: ' + e.message }, 401);
  }
  const uid = payload.sub;

  let body;
  try { body = await request.json(); } catch { return jsonResponse({ erro: 'Corpo inválido.' }, 400); }

  const codigo = (body.codigo || '').trim().toUpperCase();
  if (!codigo) return jsonResponse({ erro: 'Informe o código de convite.' }, 400);

  const convite = await dbGet(env, `convites/${codigo}`);
  if (!convite) return jsonResponse({ erro: 'Código inválido ou inexistente.' }, 404);
  if (convite.usado) return jsonResponse({ erro: 'Este código já foi usado.' }, 400);

  await dbSet(env, `admins/${uid}`, true);
  await dbPatch(env, `convites/${codigo}`, {
    usado: true, usadoPorUid: uid, usadoPorEmail: payload.email || null,
    usadoEm: new Date().toISOString(),
  });

  return jsonResponse({ ok: true });
}

// ----------------------------------------------------------------
// POST /notify
// Body esperado:
//   { remetenteKey, destinoKey, titulo, mensagem, tipo, dados }
// Header: Authorization: Bearer <Firebase ID Token>
//
// Regra de autorização:
//   - Se quem chama é a Mestre (uid está em /admins) -> pode notificar qualquer destinoKey.
//   - Se quem chama é uma criança -> só pode notificar "_mestre", e o uid
//     dela TEM que bater com /usuarios/{remetenteKey}/device_uid (vínculo
//     feito no primeiro uso daquele celular).
// ----------------------------------------------------------------
async function handleNotify(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) return jsonResponse({ erro: 'Token de autenticação ausente.' }, 401);

  let payload;
  try {
    payload = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return jsonResponse({ erro: 'Token inválido: ' + e.message }, 401);
  }

  const uid = payload.sub;
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ erro: 'Corpo da requisição inválido.' }, 400);
  }

  const { remetenteKey, destinoKey, titulo, mensagem, tipo, dados } = body;
  if (!destinoKey || !titulo || !mensagem) {
    return jsonResponse({ erro: 'Campos obrigatórios: destinoKey, titulo, mensagem.' }, 400);
  }

  const ehMestre = await dbGet(env, `admins/${uid}`);

  if (!ehMestre) {
    // Tem que ser uma criança vinculada, e só pode falar com a Mestre
    if (destinoKey !== '_mestre') {
      return jsonResponse({ erro: 'Sem permissão para notificar este destino.' }, 403);
    }
    if (!remetenteKey) {
      return jsonResponse({ erro: 'remetenteKey é obrigatório.' }, 400);
    }
    const deviceUid = await dbGet(env, `usuarios/${remetenteKey}/device_uid`);
    if (deviceUid !== uid) {
      return jsonResponse({ erro: 'Este dispositivo não está vinculado a esse Guardião.' }, 403);
    }
  }

  try {
    const resultado = await enviarPushPara(env, destinoKey, titulo, mensagem, tipo, dados);
    return jsonResponse({ ok: true, ...resultado });
  } catch (e) {
    return jsonResponse({ erro: e.message }, 500);
  }
}

// ----------------------------------------------------------------
// CRON — roda a cada 1 minuto. Fecha vouchers cujo timer_fim já passou
// e avisa filho + mãe, mesmo que ninguém esteja com o app aberto.
// Isso resolve o caso em que o app está fechado quando o tempo zera.
// ----------------------------------------------------------------
async function handleScheduled(env) {
  const vouchers = await dbGet(env, 'vouchers');
  if (!vouchers) return;

  const agora = Date.now();

  for (const [emailKey, lista] of Object.entries(vouchers)) {
    for (const [pushKey, v] of Object.entries(lista)) {
      if (v.status !== 'Ativo') continue;
      const fim = new Date(v.timer_fim).getTime();
      if (isNaN(fim) || fim > agora) continue;

      await dbPatch(env, `vouchers/${emailKey}/${pushKey}`, { status: 'Expirado' });

      await dbPost(env, `notificacoes/${emailKey}`, {
        tipo: 'voucher_encerrado',
        titulo: '⏱ Voucher Encerrado',
        mensagem: 'Seu tempo de tela acabou, Guardião!',
        quantidade: 0,
        timestamp: new Date().toISOString(),
      });

      await enviarPushPara(
        env, emailKey,
        '⏱ Voucher Encerrado',
        'Seu tempo de tela acabou, Guardião!',
        'voucher_encerrado', { pushKey }
      ).catch(() => {});

      await enviarPushPara(
        env, '_mestre',
        '⏱ Voucher encerrado',
        `O tempo de tela de ${emailKey} terminou automaticamente.`,
        'voucher_encerrado_mestre', { emailKey }
      ).catch(() => {});
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/notify') {
      return handleNotify(request, env);
    }
    if (url.pathname === '/aceitar-convite') {
      return handleAceitarConvite(request, env);
    }
    return jsonResponse({ status: 'minutinhos-push ativo' });
  },

  async scheduled(_event, env) {
    await handleScheduled(env);
  },
};
