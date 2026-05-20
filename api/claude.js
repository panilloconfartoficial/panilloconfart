// api/claude.js — Rota serverless do Vercel
// A chave fica segura como variável de ambiente, nunca exposta no browser.

export default async function handler(req, res) {
  // Apenas POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key não configurada no Vercel" });
  }

  try {
    const { prompt, maxTokens = 300 } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt inválido" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01"
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: Math.min(maxTokens, 1000), // limite de segurança
        messages:   [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return res.status(response.status).json({ error: "Erro na API Anthropic" });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    return res.status(200).json({ text });

  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
}
