import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRateLimitDecision } from "../api/_rateLimit.js";

const OPTS = { limit: 3, windowMs: 10_000 };

test("primeira requisição (sem estado salvo) nunca é limitada", () => {
  const decision = computeRateLimitDecision(null, 1000, OPTS);
  assert.equal(decision.limited, false);
  assert.deepEqual(decision.nextState, { windowStart: 1000, count: 1 });
});

test("permite requisições dentro do limite, incrementando o contador", () => {
  const data = { windowStart: 1000, count: 1 };
  const decision = computeRateLimitDecision(data, 1500, OPTS);
  assert.equal(decision.limited, false);
  assert.deepEqual(decision.nextState, { windowStart: 1000, count: 2 });
});

test("bloqueia ao atingir o limite dentro da mesma janela", () => {
  const data = { windowStart: 1000, count: 3 }; // já no limite (3)
  const decision = computeRateLimitDecision(data, 1500, OPTS);
  assert.equal(decision.limited, true);
  assert.equal(decision.retryAfterSec, Math.ceil((OPTS.windowMs - 500) / 1000));
});

test("reinicia a janela depois que ela expira, mesmo estando no limite", () => {
  const data = { windowStart: 1000, count: 3 };
  const now = 1000 + OPTS.windowMs + 1; // passou da janela
  const decision = computeRateLimitDecision(data, now, OPTS);
  assert.equal(decision.limited, false);
  assert.deepEqual(decision.nextState, { windowStart: now, count: 1 });
});

test("não bloqueia exatamente um a menos que o limite", () => {
  const data = { windowStart: 1000, count: 2 }; // limite é 3
  const decision = computeRateLimitDecision(data, 1200, OPTS);
  assert.equal(decision.limited, false);
  assert.equal(decision.nextState.count, 3);
});
