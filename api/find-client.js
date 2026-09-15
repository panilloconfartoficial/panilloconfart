// api/find-client.js — Busca um cliente pelo WhatsApp, sem expor a coleção inteira.
//
// Usado pelo checkout público (tela "já sou cliente?") para reconhecer
// clientes recorrentes. Roda com privilégios de Admin SDK no servidor,
// então as regras do Firestore (que bloqueiam leitura pública de
// "clients") não se aplicam aqui — mas devolvemos só os campos
// necessários para a UI, nunca o documento completo ou outros clientes.
//
// Request:  GET /api/find-client?wpp=85999999999
// Response: 200 { found: true,  nome, email, bday, obs, pedidos, totalGasto }
//        ou 200 { found: false }
//        ou 400/500 { error }

import { getAdminDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const wppRaw = req.query.wpp;
  if (!wppRaw || typeof wppRaw !== "string") {
    return res.status(400).json({ error: "Parâmetro 'wpp' é obrigatório" });
  }

  // Normaliza para apenas dígitos — mesmo formato usado como ID do
  // documento em "clients" (ver index.html: saveClientToFirebase /
  // submitClientRegister, esquema ID = wpp normalizado).
  const wppNorm = wppRaw.replace(/\D/g, "");
  if (wppNorm.length < 8) {
    return res.status(400).json({ error: "Número de WhatsApp inválido" });
  }

  try {
    const db = getAdminDb();

    // 1) Tenta pelo ID = wpp normalizado (esquema novo)
    let snap = await db.collection("clients").doc(wppNorm).get();

    // 2) Fallback: clientes migrados antes do esquema novo podem ter ID
    //    auto-gerado com o campo "wpp" salvo em formato variado. Faz uma
    //    query limitada por esse campo (ainda restrita a um único
    //    resultado — não retorna a coleção).
    if (!snap.exists) {
      const q = await db.collection("clients").where("wpp", "==", wppNorm).limit(1).get();
      if (!q.empty) snap = q.docs[0];
    }

    if (!snap.exists) {
      return res.status(200).json({ found: false });
    }

    const data = snap.data();

    // Retorna apenas os campos que o checkout precisa — nunca o doc inteiro
    // (evita expor metadados internos, histórico de fiado, etc, mesmo que
    // estivessem no mesmo documento).
    return res.status(200).json({
      found: true,
      nome:       data.nome || "",
      email:      data.email || "",
      bday:       data.bday || "",
      obs:        data.obs || "",
      pedidos:    Number(data.pedidos || 0),
      totalGasto: Number(data.totalGasto || 0),
    });
  } catch (error) {
    console.error("find-client error:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
}
