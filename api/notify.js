// api/notify.js
// Rota Vercel: recebe dados do pedido e dispara notificação FCM para o admin
// Variáveis de ambiente necessárias no Vercel:
//   FCM_SERVER_KEY  — chave do servidor FCM (Firebase Console > Project Settings > Cloud Messaging > Server key)
//   ADMIN_FCM_TOKEN — token FCM do celular da admin (salvo quando ela ativa as notificações)
//                     OU use a coleção "fcmTokens" no Firestore para tokens dinâmicos

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { order } = req.body || {};
  if (!order) return res.status(400).json({ error: "No order data" });

  const serverKey  = process.env.FCM_SERVER_KEY;
  const adminToken = process.env.ADMIN_FCM_TOKEN;

  const results = { fcm: null, wpp: null };

  // ── 1. PUSH NOTIFICATION via FCM Legacy HTTP API ────────────────────────────
  if (serverKey && adminToken) {
    try {
      const clientNome  = order.cliente?.nome || "Cliente";
      const numPedido   = order.numero || order.id || "—";
      const itensText   = (order.itens || []).map(i => `${i.qty}× ${i.nome}`).join(", ");
      const totalText   = `R$ ${Number(order.total || 0).toFixed(2).replace(".", ",")}`;

      const fcmPayload = {
        to: adminToken,
        priority: "high",
        notification: {
          title: `🍪 Novo pedido — ${clientNome}`,
          body: `${itensText} · ${totalText}`,
          sound: "default",
          click_action: "FLUTTER_NOTIFICATION_CLICK"
        },
        data: {
          orderId: numPedido,
          url: "/admin",
          tipo: "novo_pedido"
        }
      };

      const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `key=${serverKey}`
        },
        body: JSON.stringify(fcmPayload)
      });

      const fcmData = await fcmRes.json();
      results.fcm = fcmData.success === 1 ? "ok" : fcmData;
    } catch (e) {
      results.fcm = { error: e.message };
    }
  } else {
    results.fcm = "skipped: FCM_SERVER_KEY ou ADMIN_FCM_TOKEN não configurados";
  }

  // ── 2. WHATSAPP via CallMeBot (gratuito, sem backend extra) ────────────────
  // Pré-requisito: ativar CallMeBot UMA VEZ enviando mensagem para +34 644 71 07 98:
  //   "I allow callmebot to send me messages"
  // Depois adicionar CALLMEBOT_APIKEY e ADMIN_WPP_NUMBER nas env vars do Vercel
  const callMeBotKey = process.env.CALLMEBOT_APIKEY;
  const adminPhone   = process.env.ADMIN_WPP_NUMBER; // formato: 5585999999999

  if (callMeBotKey && adminPhone) {
    try {
      const clientNome = order.cliente?.nome || "Cliente";
      const numPedido  = order.numero || "—";
      const itensText  = (order.itens || []).map(i => `${i.qty}x ${i.nome}`).join(", ");
      const totalText  = `R$ ${Number(order.total || 0).toFixed(2).replace(".", ",")}`;
      const dataRet    = order.dataRetirada
        ? new Date(order.dataRetirada + "T12:00").toLocaleDateString("pt-BR")
        : "Pronta entrega";

      const wppMsg = encodeURIComponent(
        `🍪 *NOVO PEDIDO — Panillo*\n\n` +
        `👤 Cliente: ${clientNome}\n` +
        `📋 Pedido: #${numPedido}\n` +
        `🛒 Itens: ${itensText}\n` +
        `💰 Total: ${totalText}\n` +
        `📅 Retirada: ${dataRet}\n` +
        `💳 Pagamento: ${order.pagamento || "—"}\n\n` +
        `Acesse o admin para confirmar.`
      );

      const wppUrl = `https://api.callmebot.com/whatsapp.php?phone=${adminPhone}&text=${wppMsg}&apikey=${callMeBotKey}`;
      const wppRes = await fetch(wppUrl);
      results.wpp = wppRes.ok ? "ok" : `status ${wppRes.status}`;
    } catch (e) {
      results.wpp = { error: e.message };
    }
  } else {
    results.wpp = "skipped: CALLMEBOT_APIKEY ou ADMIN_WPP_NUMBER não configurados";
  }

  return res.status(200).json({ ok: true, results });
}
