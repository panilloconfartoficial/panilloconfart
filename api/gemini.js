// api/gemini.js — Proxy seguro para Google Gemini
// A chave fica como variável de ambiente GEMINI_API_KEY no Vercel.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callGemini(apiKey, contents, maxTokens, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: Math.min(maxTokens, 1000),
            temperature: 0.8,
          }
        })
      }
    );

    // Sucesso
    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // 429: limite de requisições — espera e tenta de novo
    if (response.status === 429 && attempt < retries) {
      // Respeita o header Retry-After se existir, senão espera 2^attempt segundos
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : (2 ** attempt) * 1000;
      console.warn(`Gemini 429 — aguardando ${waitMs}ms antes da tentativa ${attempt + 1}/${retries}`);
      await sleep(waitMs);
      continue;
    }

    // Outro erro — lança imediatamente
    const err = await response.text();
    console.error("Gemini error:", response.status, err);
    throw new Error(`Gemini ${response.status}`);
  }
  throw new Error("Gemini: limite de tentativas atingido");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY não configurada no Vercel" });
  }

  try {
    const { prompt, maxTokens = 300, systemPrompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt inválido" });
    }

    const userText = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const contents = [{ role: "user", parts: [{ text: userText }] }];

    const text = await callGemini(apiKey, contents, maxTokens);
    return res.status(200).json({ text });

  } catch (error) {
    console.error("Handler error:", error.message);

    // Se ainda é 429 após todas as tentativas, informa o frontend claramente
    if (error.message.includes("429") || error.message.includes("tentativas")) {
      return res.status(429).json({ error: "Muitas requisições simultâneas. Aguarde alguns segundos e tente novamente." });
    }

    return res.status(500).json({ error: "Erro interno" });
  }
}
