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
import { checkRateLimit, getClientIp } from "./_rateLimit.js";
import { OrderError, normalizeWpp, computeItemsAndSubtotal, validateCoupon, computeTotal } from "./_orderCalc.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  // Rota pública (sem autenticação) — limita pedidos por IP pra impedir
  // que um script encha o Firestore de pedidos falsos.
  const ip = getClientIp(req);
  try {
    const rl = await checkRateLimit(`create-order:${ip}`, { limit: 8, windowMs: 10 * 60 * 1000 });
    if (rl.limited) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      return res.status(429).json({ error: "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente novamente." });
    }
  } catch (e) {
    console.error("create-order: falha no rate limit", e.message);
    // Não bloqueia o pedido por falha do próprio controle de limite.
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

  const wppNorm = normalizeWpp(cliente.wpp);
  if (wppNorm.length < 8) {
    return res.status(400).json({ error: "WhatsApp do cliente inválido" });
  }

  try {
    const db = getAdminDb();

    // ─── 1) Busca os produtos reais e recalcula itens/subtotal ──────
    const prodSnaps = await Promise.all(
      items.map(i => db.collection("products").doc(String(i.prodId)).get())
    );

    const resolvedProducts = prodSnaps.map(snap => snap.exists ? { ...snap.data(), id: snap.id } : null);
    const calc = computeItemsAndSubtotal(items, resolvedProducts);
    if (calc.error) {
      return res.status(400).json({ error: calc.error });
    }
    const { itensFinal, subtotal } = calc;

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
        const appConfigSnap = await appConfigCol.limit(1).get();
        if (appConfigSnap.empty) {
          throw new OrderError("Cupom inválido", true);
        }
        appConfigRef = appConfigSnap.docs[0].ref;
        const appConfigTx = await tx.get(appConfigRef);
        appConfigData = appConfigTx.data() || {};
        const today = new Date().toISOString().split("T")[0];
        const cv = validateCoupon(appConfigData.coupons || [], cupomCode, today);
        if (cv.error) throw new OrderError(cv.error, true);
        cupomIndex = cv.index;
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

      const total = computeTotal(subtotal, descontoAplicado);

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
