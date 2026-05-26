// api/notify.js — Envia notificações quando um pedido chega
// Suporta: CallMeBot (WhatsApp), Resend (e-mail) e Firebase FCM (push)
// Todas as chaves ficam em variáveis de ambiente — nunca no código-fonte.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { order } = req.body;
  if (!order) {
    return res.status(400).json({ error: "Dados do pedido ausentes" });
  }

  const results = { callmebot: null, resend: null, fcm: null };
  const errors  = [];

  // ─── Formata mensagem do pedido ───────────────────────────
  const itens = (order.itens || [])
    .map(i => `• ${i.qty}× ${i.nome} — R$ ${Number(i.qty * i.preco).toFixed(2).replace(".", ",")}`)
    .join("\n");
  const tipo = order.tipo === "pronta-entrega" ? "🛒 Pronta Entrega" : "📅 Encomenda";
  const pagamento = { pix: "Pix", credito: "Crédito", debito: "Débito", fiado: "Fiado" }[order.pagamento] || order.pagamento;
  const dataStr = order.dataRetirada
    ? new Date(order.dataRetirada + "T12:00").toLocaleDateString("pt-BR")
    : "—";

  const msgText = `🔔 *Novo pedido Panillo!*\n\n*#${order.numero}* — ${tipo}\n\n${itens}\n\n💰 Total: R$ ${Number(order.total).toFixed(2).replace(".", ",")}\n💳 Pagamento: ${pagamento}\n📅 Retirada: ${dataStr}\n👤 Cliente: ${order.cliente?.nome || "—"} | ${order.cliente?.wpp || "—"}`;

  // ─── 1. CALLMEBOT (WhatsApp) ──────────────────────────────
  const callmebotPhone = process.env.CALLMEBOT_PHONE;
  const callmebotKey   = process.env.CALLMEBOT_APIKEY;

  if (callmebotPhone && callmebotKey) {
    try {
      const encoded = encodeURIComponent(msgText);
      const cbUrl = `https://api.callmebot.com/whatsapp.php?phone=${callmebotPhone}&text=${encoded}&apikey=${callmebotKey}`;
      const cbResp = await fetch(cbUrl, { signal: AbortSignal.timeout(8000) });
      results.callmebot = cbResp.ok ? "ok" : `status ${cbResp.status}`;
    } catch (e) {
      errors.push("callmebot: " + e.message);
      results.callmebot = "error";
    }
  } else {
    results.callmebot = "not_configured";
  }

  // ─── 2. RESEND (e-mail) ──────────────────────────────────
  const resendKey   = process.env.RESEND_API_KEY;
  const resendEmail = process.env.RESEND_TO_EMAIL;
  const resendFrom  = process.env.RESEND_FROM_EMAIL || "notificacoes@panillo.com.br";

  if (resendKey && resendEmail) {
    try {
      const htmlBody = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #eee;">
          <div style="background:#0F4A4A;padding:20px 24px;">
            <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;color:#E8B84B;">Panillo</div>
            <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Novo pedido recebido!</div>
          </div>
          <div style="padding:24px;">
            <div style="background:#F8F5F0;border-radius:8px;padding:14px;margin-bottom:18px;">
              <div style="font-size:12px;color:#888;margin-bottom:6px;">Pedido</div>
              <div style="font-size:20px;font-weight:600;color:#0F4A4A;">#${order.numero}</div>
              <div style="font-size:13px;color:#666;margin-top:4px;">${tipo}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
              ${(order.itens || []).map(i => `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#333;">${i.qty}× ${i.nome}</td>
                <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#0F4A4A;text-align:right;font-weight:500;">
                  R$ ${Number(i.qty * i.preco).toFixed(2).replace(".", ",")}
                </td>
              </tr>`).join("")}
            </table>
            <div style="display:flex;justify-content:space-between;padding-top:12px;font-size:15px;font-weight:600;color:#0F4A4A;">
              <span>Total</span>
              <span>R$ ${Number(order.total).toFixed(2).replace(".", ",")}</span>
            </div>
            <div style="margin-top:18px;background:#FDF6E8;border-radius:8px;padding:12px 14px;font-size:12px;color:#666;">
              <div><strong>Cliente:</strong> ${order.cliente?.nome || "—"}</div>
              <div><strong>WhatsApp:</strong> ${order.cliente?.wpp || "—"}</div>
              <div><strong>Pagamento:</strong> ${pagamento}</div>
              <div><strong>Retirada:</strong> ${dataStr}</div>
            </div>
          </div>
        </div>`;

      const emailResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: `Panillo Pedidos <${resendFrom}>`,
          to: [resendEmail],
          subject: `🍪 Novo pedido #${order.numero} — ${tipo}`,
          html: htmlBody
        }),
        signal: AbortSignal.timeout(10000)
      });
      results.resend = emailResp.ok ? "ok" : `status ${emailResp.status}`;
    } catch (e) {
      errors.push("resend: " + e.message);
      results.resend = "error";
    }
  } else {
    results.resend = "not_configured";
  }

  // ─── 3. FIREBASE FCM (push) ──────────────────────────────
  // FCM v1 API usa Service Account para gerar token OAuth
  const fcmServiceAccount = process.env.FCM_SERVICE_ACCOUNT_JSON;
  const fcmTopic          = process.env.FCM_TOPIC || "panillo-admin";
  const fcmProjectId      = process.env.FCM_PROJECT_ID;

  if (fcmServiceAccount && fcmProjectId) {
    try {
      const sa = JSON.parse(fcmServiceAccount);
      // Gera JWT para OAuth 2.0
      const token = await getFCMAccessToken(sa);
      const fcmResp = await fetch(
        `https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: {
              topic: fcmTopic,
              notification: {
                title: `🍪 Novo pedido #${order.numero}`,
                body: `${tipo} — R$ ${Number(order.total).toFixed(2).replace(".", ",")} — ${order.cliente?.nome || "—"}`
              },
              data: { orderNum: String(order.numero), tipo: order.tipo || "encomenda" }
            }
          }),
          signal: AbortSignal.timeout(10000)
        }
      );
      results.fcm = fcmResp.ok ? "ok" : `status ${fcmResp.status}`;
    } catch (e) {
      errors.push("fcm: " + e.message);
      results.fcm = "error";
    }
  } else {
    results.fcm = "not_configured";
  }

  const allFailed = Object.values(results).every(v => v === "error");
  return res.status(allFailed ? 500 : 200).json({ results, errors });
}

// ─── FCM: gera access token via Service Account (RS256 JWT) ─────
async function getFCMAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header  = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");

  const unsigned = `${header}.${payload}`;

  // Importa chave privada RSA
  const pemKey = sa.private_key.replace(/\\n/g, "\n");
  const keyData = pemKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");

  const jwt = `${unsigned}.${sigB64}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenResp.json();
  if (!tokenData.access_token) throw new Error("FCM token falhou: " + JSON.stringify(tokenData));
  return tokenData.access_token;
}
