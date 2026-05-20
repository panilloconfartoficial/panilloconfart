// api/config.js — Entrega as configurações do app a partir das variáveis de ambiente.
// Nenhum dado sensível fica no código-fonte.

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  // Verifica se todas as variáveis obrigatórias estão presentes
  const required = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
    "WPP_NUMBER",
    "PIX_KEY",
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error("Variáveis de ambiente faltando:", missing);
    return res.status(500).json({ error: "Configuração incompleta no servidor." });
  }

  // Retorna apenas o necessário para o frontend funcionar
  return res.status(200).json({
    firebase: {
      apiKey:            process.env.FIREBASE_API_KEY,
      authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
      projectId:         process.env.FIREBASE_PROJECT_ID,
      storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId:             process.env.FIREBASE_APP_ID,
    },
    wppNumber: process.env.WPP_NUMBER,
    pixKey:    process.env.PIX_KEY,
  });
}
