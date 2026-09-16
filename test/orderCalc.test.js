import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWpp,
  computeItemsAndSubtotal,
  validateCoupon,
  computeTotal,
} from "../api/_orderCalc.js";

test("normalizeWpp remove tudo que não é dígito", () => {
  assert.equal(normalizeWpp("(85) 99999-1234"), "85999991234");
  assert.equal(normalizeWpp(""), "");
  assert.equal(normalizeWpp(undefined), "");
});

test("computeItemsAndSubtotal soma preço × quantidade de cada item", () => {
  const items = [
    { prodId: "p1", qty: 2 },
    { prodId: "p2", qty: 3 },
  ];
  const products = [
    { id: "p1", nome: "Cookie", preco: 12, ativo: true },
    { id: "p2", nome: "Brownie", preco: 15, ativo: true },
  ];
  const result = computeItemsAndSubtotal(items, products);
  assert.equal(result.error, undefined);
  assert.equal(result.subtotal, 2 * 12 + 3 * 15);
  assert.equal(result.itensFinal.length, 2);
  assert.equal(result.itensFinal[0].prodId, "p1");
  assert.equal(result.itensFinal[0].nome, "Cookie");
});

test("computeItemsAndSubtotal usa sempre o ID do documento, não um campo 'id' interno do produto", () => {
  const items = [{ prodId: "p1", qty: 1 }];
  // produto malicioso/malformado com um campo "id" próprio diferente do doc ID
  const products = [{ id: "p1", nome: "Cookie", preco: 10, ativo: true }];
  const result = computeItemsAndSubtotal(items, products);
  assert.equal(result.itensFinal[0].prodId, "p1");
});

test("computeItemsAndSubtotal rejeita produto inexistente", () => {
  const items = [{ prodId: "nao-existe", qty: 1 }];
  const result = computeItemsAndSubtotal(items, [null]);
  assert.match(result.error, /Produto não encontrado/);
});

test("computeItemsAndSubtotal rejeita produto inativo", () => {
  const items = [{ prodId: "p1", qty: 1 }];
  const products = [{ id: "p1", nome: "Cookie", preco: 10, ativo: false }];
  const result = computeItemsAndSubtotal(items, products);
  assert.match(result.error, /Produto indisponível/);
});

test("computeItemsAndSubtotal preserva sabores e obs do item, e usa preço/nome do produto real (ignora o que vier do client)", () => {
  const items = [{ prodId: "p1", qty: 1, sabores: ["chocolate"], obs: "sem nozes", preco: 0.01, nome: "hackeado" }];
  const products = [{ id: "p1", nome: "Cookie", preco: 12, ativo: true }];
  const result = computeItemsAndSubtotal(items, products);
  assert.equal(result.itensFinal[0].preco, 12);
  assert.equal(result.itensFinal[0].nome, "Cookie");
  assert.deepEqual(result.itensFinal[0].sabores, ["chocolate"]);
  assert.equal(result.itensFinal[0].obs, "sem nozes");
});

test("validateCoupon aceita cupom válido e retorna índice/percentual", () => {
  const coupons = [{ code: "PROMO10", pct: 10, usos: 0 }];
  const result = validateCoupon(coupons, "promo10", "2026-01-01");
  assert.equal(result.error, undefined);
  assert.equal(result.index, 0);
  assert.equal(result.pct, 10);
  assert.equal(result.code, "PROMO10");
});

test("validateCoupon rejeita código inexistente", () => {
  const result = validateCoupon([{ code: "OUTRO" }], "PROMO10", "2026-01-01");
  assert.match(result.error, /Cupom inválido/);
});

test("validateCoupon rejeita cupom expirado", () => {
  const coupons = [{ code: "PROMO10", pct: 10, validade: "2025-01-01" }];
  const result = validateCoupon(coupons, "PROMO10", "2026-01-01");
  assert.match(result.error, /Cupom expirado/);
});

test("validateCoupon rejeita cupom com validade futura (ainda não expirado)", () => {
  const coupons = [{ code: "PROMO10", pct: 10, validade: "2099-01-01" }];
  const result = validateCoupon(coupons, "PROMO10", "2026-01-01");
  assert.equal(result.error, undefined);
});

test("validateCoupon rejeita cupom que atingiu o limite de usos", () => {
  const coupons = [{ code: "PROMO10", pct: 10, maxUsos: 5, usos: 5 }];
  const result = validateCoupon(coupons, "PROMO10", "2026-01-01");
  assert.match(result.error, /limite de usos/);
});

test("validateCoupon permite cupom logo abaixo do limite de usos", () => {
  const coupons = [{ code: "PROMO10", pct: 10, maxUsos: 5, usos: 4 }];
  const result = validateCoupon(coupons, "PROMO10", "2026-01-01");
  assert.equal(result.error, undefined);
});

test("computeTotal aplica o desconto percentual sobre o subtotal", () => {
  assert.equal(computeTotal(100, 10), 90);
  assert.equal(computeTotal(100, 0), 100);
  assert.equal(computeTotal(100, null), 100);
  assert.equal(computeTotal(50, 50), 25);
});
