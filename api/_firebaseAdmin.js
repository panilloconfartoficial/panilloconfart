// api/_firebaseAdmin.js — Inicialização compartilhada do Firebase Admin SDK
// Usa a mesma service account já configurada para FCM (FCM_SERVICE_ACCOUNT_JSON),
// que precisa ter os scopes necessários para Firestore (cloud-platform / datastore).
//
// IMPORTANTE: este módulo SÓ deve ser importado por funções server-side
// (api/*.js). Nunca expor a service account ao cliente.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let _db = null;

export function getAdminDb() {
  if (_db) return _db;

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

  if (!getApps().length) {
    initializeApp({
      credential: cert(sa),
      projectId: sa.project_id || process.env.FCM_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
    });
  }

  _db = getFirestore();
  return _db;
}
