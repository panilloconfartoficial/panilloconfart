// firebase-messaging-sw.js
// Service Worker para notificações push da Panillo (FCM background handler)

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Recebe a config do Firebase via postMessage vindo do app principal
let messaging = null;

self.addEventListener("message", (event) => {
  if (event.data?.type === "FIREBASE_CONFIG" && event.data.config) {
    try {
      const app = firebase.initializeApp(event.data.config, "sw-app");
      messaging = firebase.messaging(app);

      // Handler de mensagens em background (app fechado ou em segundo plano)
      messaging.onBackgroundMessage((payload) => {
        const { title, body, icon } = payload.notification || {};
        const data = payload.data || {};

        self.registration.showNotification(title || "🍪 Novo pedido — Panillo", {
          body: body || "Um novo pedido chegou!",
          icon: icon || "/favicon.ico",
          badge: "/favicon.ico",
          tag: "panillo-order-" + (data.orderId || Date.now()),
          data: { url: data.url || "/admin" },
          actions: [
            { action: "open", title: "Ver pedido" },
            { action: "dismiss", title: "Dispensar" }
          ],
          vibrate: [200, 100, 200],
          requireInteraction: true
        });
      });
    } catch (e) {
      console.warn("[SW] Firebase init error:", e.message);
    }
  }
});

// Abre o admin ao clicar na notificação
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = event.notification.data?.url || "/admin";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Se já tem uma janela do site aberta, foca nela
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Caso contrário, abre nova aba no admin
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
