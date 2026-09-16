// api/_orderCalc.js — Lógica pura de cálculo de pedido, extraída de
// create-order.js pra poder ser testada isoladamente (sem precisar de
// Firestore). Nenhuma função aqui faz I/O.

export class OrderError extends Error {
  constructor(message, couponInvalid = false) {
    super(message);
    this.couponInvalid = couponInvalid;
  }
}

export function normalizeWpp(wpp) {
  return String(wpp || "").replace(/\D/g, "");
}

// items: [{ prodId, qty, sabores?, obs? }] — como veio do request.
// resolvedProducts: array alinhado por índice com items, cada posição é
// `{ id, nome, preco, ativo }` (produto encontrado) ou `null` (não existe).
// Retorna { itensFinal, subtotal } ou { error }.
export function computeItemsAndSubtotal(items, resolvedProducts) {
  const itensFinal = [];
  let subtotal = 0;
  for (let idx = 0; idx < items.length; idx++) {
    const reqItem = items[idx];
    const prod = resolvedProducts[idx];
    if (!prod) {
      return { error: `Produto não encontrado: ${reqItem.prodId}` };
    }
    if (prod.ativo === false) {
      return { error: `Produto indisponível: ${prod.nome || reqItem.prodId}` };
    }
    const qty = Number(reqItem.qty);
    const preco = Number(prod.preco || 0);
    subtotal += preco * qty;
    itensFinal.push({
      prodId: prod.id,
      nome: prod.nome || "",
      qty,
      preco,
      sabores: reqItem.sabores || null,
      obs: reqItem.obs || null,
    });
  }
  return { itensFinal, subtotal };
}

// coupons: array de cupons salvos em appConfig.coupons.
// today: string "YYYY-MM-DD" (mesmo formato salvo em c.validade).
// Retorna { index, pct, code } ou { error }.
export function validateCoupon(coupons, code, today) {
  const upperCode = String(code).trim().toUpperCase();
  const index = (coupons || []).findIndex(c => c.code === upperCode);
  if (index < 0) return { error: "Cupom inválido" };

  const c = coupons[index];
  if (c.validade && c.validade < today) return { error: "Cupom expirado" };
  if (c.maxUsos && (c.usos || 0) >= c.maxUsos) return { error: "Cupom atingiu o limite de usos" };

  return { index, pct: Number(c.pct) || 0, code: upperCode };
}

export function computeTotal(subtotal, descontoPct) {
  return subtotal * (1 - (descontoPct || 0) / 100);
}
