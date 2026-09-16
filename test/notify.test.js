import { test } from "node:test";
import assert from "node:assert/strict";
import { escHtml } from "../api/notify.js";

test("escHtml escapa os 5 caracteres perigosos de HTML", () => {
  assert.equal(escHtml(`<img src=x onerror="alert('xss')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;");
});

test("escHtml trata null/undefined como string vazia", () => {
  assert.equal(escHtml(null), "");
  assert.equal(escHtml(undefined), "");
});

test("escHtml não altera texto sem caracteres especiais", () => {
  assert.equal(escHtml("Cookie de chocolate"), "Cookie de chocolate");
});

test("escHtml converte números para string antes de escapar", () => {
  assert.equal(escHtml(42), "42");
});
