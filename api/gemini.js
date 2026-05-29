// api/gemini.js — Proxy seguro para Google Gemini
// A chave fica como variável de ambiente GEMINI_API_KEY no Vercel.

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

    // Monta o array de contents
    const contents = [];

    // Se há system prompt, inclui como parte do user turn (Gemini não tem role "system" no v1)
    const userText = systemPrompt
      ? `${systemPrompt}\n\n${prompt}`
      : prompt;

    contents.push({ role: "user", parts: [{ text: userText }] });

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

    if (!response.ok) {
      const err = await response.text();
      console.error("Gemini error:", err);
      return res.status(response.status).json({ error: "Erro na API Gemini" });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.status(200).json({ text });

  } catch (error) {
    console.error("Handler error:", error);
    return res.status(500).json({ error: "Erro interno" });
  }
}
