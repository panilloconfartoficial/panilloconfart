// api/_rateLimit.js — Limite de requisições por IP para rotas públicas
// (sem autenticação), usando o próprio Firestore como armazenamento —
// evita depender de infraestrutura extra (Redis/KV) só pra isso.
//
// Cada chamada gasta uma leitura + escrita no Firestore (dentro de uma
// transação, pra não ter corrida entre requisições simultâneas do mesmo
// IP). O custo é irrelevante perto do que uma rota sem limite algum
// custaria se abusada.

import { getAdminDb } from "./_firebaseAdmin.js";

export function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// Retorna { limited: true/false, retryAfterSec? }.
// `key` deve identificar a rota + IP (ex: "create-order:1.2.3.4") pra não
// misturar o limite de rotas diferentes.
export async function checkRateLimit(key, { limit, windowMs }) {
  const db = getAdminDb();
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;

    // Sem registro ainda, ou janela de tempo anterior já expirou: reinicia.
    if (!data || now - data.windowStart > windowMs) {
      tx.set(ref, { windowStart: now, count: 1 });
      return { limited: false };
    }

    if (data.count >= limit) {
      const retryAfterSec = Math.ceil((windowMs - (now - data.windowStart)) / 1000);
      return { limited: true, retryAfterSec };
    }

    tx.update(ref, { count: data.count + 1 });
    return { limited: false };
  });
}
