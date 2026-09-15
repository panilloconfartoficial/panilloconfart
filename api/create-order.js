// api/create-order.js — Cria um pedido com preços, desconto e total
// recalculados no servidor (Admin SDK), em vez de confiar no client.
//
// Resolve problemas do fluxo anterior (tudo calculado e gravado direto
// pelo browser em "orders"):
//   1. Preço/quantidade adulterados no devtools antes do envio — preços
//      são lidos de "products" no servidor, ignorando o que o client mandou.
//   2. Cupom de desconto aplicado sem validar expiração/limite de uso, e
//      sem atomicidade no incremento de "usos" — duas pessoas usando o
//      mesmo cupom ao mesmo tempo poderiam ambas passar pela validação.
//      Aqui o cupom é validado E incrementado dentro de uma transação.
//   3. Débito de fiado (quando pagamento === "fiado") é aplicado no mesmo
//      fluxo, em vez de depender de allFiadoAccounts já carregado no
//      client (que no checkout público está sempre vazio).
//
// Request body (POST):
// {
//   items: [{ prodId, qty, sabores?, obs? }],
//   cupomCode?: string,
//   cliente: { nome, wpp, email?, bday?, obs? },
//   enderecoIdx, tipo: "pronta-entrega"|"encomenda",
//   dataRetirada, periodo, pagamento
// }
//
// Response: 200 { ok: true, order: {...} }
//        ou 400 { error, couponInvalid?: true }  — front-end deve
//             remover o cupom do estado e recalcular se couponInvalid
//        ou 500 { error }

import { getAdminDb } from "./_firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

class OrderError extends Error {
  constructor(message, couponInvalid = false) {
    super(message);
    this.couponInvalid = couponInvalid;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const body = req.body || {};
  const { items, cupomCode, cliente, enderecoIdx, tipo, dataRetirada, periodo, pagamento } = body;

  // ─── Validações básicas de entrada ──────────────────────────────
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Carrinho vazio ou inválido" });
  }
  for (const i of items) {
    if (!i.prodId || !Number.isFinite(Number(i.qty)) || Number(i.qty) <= 0) {
      return res.status(400).json({ error: "Item do carrinho inválido" });
    }
  }
  if (!cliente || !cliente.nome || !cliente.wpp) {
    return res.status(400).json({ error: "Dados do cliente incompletos" });
  }
  if (!["pronta-entrega", "encomenda"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo de pedido inválido" });
  }
  const PAGAMENTOS_VALIDOS = ["pix", "credito", "debito", "dinheiro", "fiado"];
  if (!PAGAMENTOS_VALIDOS.includes(pagamento)) {
    return res.status(400).json({ error: "Forma de pagamento inválida" });
  }

  const wppNorm = String(cliente.wpp).replace(/\D/g, "");
  if (wppNorm.length < 8) {
    return res.status(400).json({ error: "WhatsApp do cliente inválido" });
  }

  try {
    const db = getAdminDb();

    // ─── 1) Busca os produtos reais e recalcula itens/subtotal ──────
    const prodSnaps = await Promise.all(
      items.map(i => db.collection("products").doc(String(i.prodId)).get())
    );

    const itensFinal = [];
    let subtotal = 0;
    for (let idx = 0; idx < items.length; idx++) {
      const reqItem = items[idx];
      const snap = prodSnaps[idx];
      if (!snap.exists) {
        return res.status(400).json({ error: `Produto não encontrado: ${reqItem.prodId}` });
      }
      const prod = snap.data();
      if (prod.ativo === false) {
        return res.status(400).json({ error: `Produto indisponível: ${prod.nome || reqItem.prodId}` });
      }
      const qty = Number(reqItem.qty);
      const preco = Number(prod.preco || 0);
      subtotal += preco * qty;
      itensFinal.push({
        prodId: snap.id,
        nome: prod.nome || "",
        qty,
        preco,
        sabores: reqItem.sabores || null,
        obs: reqItem.obs || null,
      });
    }

    // ─── 2) Busca conta fiado do cliente (se pagamento === "fiado") ─
    // clientWpp pode estar salvo formatado ou normalizado em registros
    // antigos; tenta ambos, sempre limitado a 1 resultado.
    let fiadoAccountRef = null;
    if (pagamento === "fiado") {
      let q = await db.collection("fiadoAccounts").where("clientWpp", "==", wppNorm).limit(1).get();
      if (q.empty) {
        q = await db.collection("fiadoAccounts").where("clientWpp", "==", cliente.wpp).limit(1).get();
      }
      if (q.empty || q.docs[0].data().autorizado !== true) {
        return res.status(400).json({ error: "Cliente não possui fiado autorizado" });
      }
      fiadoAccountRef = q.docs[0].ref;
    }

    const orderNum = "PAN" + Date.now().toString().slice(-6);
    const orderRef = db.collection("orders").doc();
    const clientRef = db.collection("clients").doc(wppNorm);
    const appConfigCol = db.collection("appConfig");

    // ─── 3) Transação: valida + aplica cupom, grava pedido, atualiza cliente/fiado ──
    // Tudo dentro de uma única transação para evitar condições de corrida
    // (ex: dois pedidos simultâneos usando o último uso disponível de um
    // cupom com maxUsos).
    const result = await db.runTransaction(async (tx) => {
      // ── FASE 1: TODAS AS LEITURAS PRIMEIRO ──────────────────────────
      // Firestore exige que, dentro de uma transação, todas as operações
      // get() ocorram antes de qualquer set()/update()/delete(). Por isso
      // lemos appConfig e fiadoAccounts aqui, e só escrevemos depois.
      let appConfigRef = null;
      let appConfigData = null;
      let cupomIndex = -1;

      if (cupomCode) {
        const code = String(cupomCode).trim().toUpperCase();
        const appConfigSnap = await appConfigCol.limit(1).get();
        if (appConfigSnap.empty) {
          throw new OrderError("Cupom inválido", true);
        }
        appConfigRef = appConfigSnap.docs[0].ref;
        const appConfigTx = await tx.get(appConfigRef);
        appConfigData = appConfigTx.data() || {};
        const coupons = appConfigData.coupons || [];
        cupomIndex = coupons.findIndex(c => c.code === code);
        if (cupomIndex < 0) throw new OrderError("Cupom inválido", true);

        const c = coupons[cupomIndex];
        const today = new Date().toISOString().split("T")[0];
        if (c.validade && c.validade < today) throw new OrderError("Cupom expirado", true);
        if (c.maxUsos && (c.usos || 0) >= c.maxUsos) throw new OrderError("Cupom atingiu o limite de usos", true);
      }

      let fiadoData = null;
      if (fiadoAccountRef) {
        const fiadoTx = await tx.get(fiadoAccountRef);
        fiadoData = fiadoTx.data() || {};
      }

      // ── FASE 2: CÁLCULOS ─────────────────────────────────────────────
      let descontoAplicado = null;
      let cupomUsado = null;
      if (cupomIndex >= 0) {
        const c = appConfigData.coupons[cupomIndex];
        descontoAplicado = Number(c.pct) || 0;
        cupomUsado = String(cupomCode).trim().toUpperCase();
      }

      const total = subtotal * (1 - (descontoAplicado || 0) / 100);

      const order = {
        numero: orderNum,
        orderNum,
        cliente: {
          nome: String(cliente.nome).trim(),
          wpp: wppNorm,
          email: cliente.email || "",
          bday: cliente.bday || "",
          obs: cliente.obs || "",
        },
        itens: itensFinal,
        total,
        subtotal,
        descontoAplicado,
        cupomUsado,
        enderecoIdx: enderecoIdx || "1",
        tipo,
        dataRetirada: tipo === "pronta-entrega"
          ? new Date().toISOString().split("T")[0]
          : (dataRetirada || ""),
        periodo: periodo || "",
        pagamento,
        status: "pendente",
        createdAt: FieldValue.serverTimestamp(),
      };

      // ── FASE 3: TODAS AS ESCRITAS ───────────────────────────────────
      tx.set(orderRef, order);

      tx.set(clientRef, {
        nome: order.cliente.nome,
        wpp: wppNorm,
        ...(order.cliente.email ? { email: order.cliente.email } : {}),
        ...(order.cliente.bday  ? { bday:  order.cliente.bday  } : {}),
        ...(order.cliente.obs   ? { obs:   order.cliente.obs   } : {}),
        favorito: itensFinal[0]?.nome || "",
        pedidos: FieldValue.increment(1),
        totalGasto: FieldValue.increment(total),
        lastOrderAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (appConfigRef && cupomIndex >= 0) {
        const coupons = [...(appConfigData.coupons || [])];
        coupons[cupomIndex] = { ...coupons[cupomIndex], usos: (coupons[cupomIndex].usos || 0) + 1 };
        tx.update(appConfigRef, { coupons });
      }

      if (fiadoAccountRef) {
        const newSaldo = Number(fiadoData.saldo || 0) + total;
        const newHist = [...(fiadoData.historico || []), {
          tipo: "pedido",
          descricao: `Pedido #${orderNum} — ${itensFinal.map(i => `${i.qty}× ${i.nome}`).join(", ")}`,
          valor: total,
          data: new Date().toLocaleDateString("pt-BR"),
        }];
        tx.update(fiadoAccountRef, { saldo: newSaldo, historico: newHist });
      }

      return { ...order, id: orderRef.id, createdAt: undefined };
    });

    return res.status(200).json({ ok: true, order: result });
  } catch (error) {
    if (error instanceof OrderError) {
      return res.status(400).json({ error: error.message, couponInvalid: error.couponInvalid });
    }
    console.error("create-order error:", error);
    return res.status(500).json({ error: "Erro interno ao criar pedido" });
  }
}
