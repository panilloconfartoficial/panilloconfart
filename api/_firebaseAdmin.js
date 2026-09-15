// api/_firebaseAdmin.js — Inicialização compartilhada do Firebase Admin SDK
// Usa a mesma service account já configurada para FCM (FCM_SERVICE_ACCOUNT_JSON),
// que precisa ter os scopes necessários para Firestore (cloud-platform / datastore).
//
// IMPORTANTE: este módulo SÓ deve ser importado por funções server-side
// (api/*.js). Nunca expor a service account ao cliente.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let _db = null;

function ensureAdminApp() {
  if (getApps().length) return;

  const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON não configurada no Vercel — necessária para o Admin SDK.");
  }

  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch (e) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON inválida (não é JSON válido): " + e.message);
  }

  // private_key costuma vir com \n escapado quando armazenada como variável
  // de ambiente — normaliza para quebras de linha reais.
  if (sa.private_key && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  initializeApp({
    credential: cert(sa),
    projectId: sa.project_id || process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  });
}

export function getAdminDb() {
  if (_db) return _db;
  ensureAdminApp();
  _db = getFirestore();
  return _db;
}

// Verifica o ID token do Firebase Auth enviado no header
// "Authorization: Bearer <token>". Usado para proteger rotas que só o
// admin autenticado deve poder chamar (mesmo modelo de confiança das
// firestore.rules: qualquer usuário autenticado é admin — não há claims
// separadas hoje). Lança em caso de token ausente/inválido/expirado.
export async function requireAdmin(req) {
  const authHeader = req.headers?.authorization || "";
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) {
    const err = new Error("Não autenticado");
    err.statusCode = 401;
    throw err;
  }
  ensureAdminApp();
  try {
    return await getAuth().verifyIdToken(match[1]);
  } catch (e) {
    const err = new Error("Token inválido ou expirado");
    err.statusCode = 401;
    throw err;
  }
}
