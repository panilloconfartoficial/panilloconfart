// public/firebase-messaging-sw.js
// Service Worker para receber notificações push mesmo com aba fechada.
// Este arquivo DEVE ficar na raiz do domínio (public/).

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// A configuração do Firebase é recebida via postMessage do index.html.
// Fallback hardcoded APENAS para o service worker funcionar offline.
const firebaseConfig = self.__FIREBASE_CONFIG__ || {};

if (Object.keys(firebaseConfig).length > 0) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Notificação em background (aba fechada ou em segundo plano)
  messaging.onBackgroundMessage((payload) => {
    const { title, body } = payload.notification || {};
    self.registration.showNotification(title || "Novo pedido Panillo!", {
      body: body || "Toque para ver detalhes",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      tag: "panillo-order",
      renotify: true,
      data: payload.data || {}
    });
  });
}

// Ao clicar na notificação, abre o painel admin
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/admin") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/admin");
      }
    })
  );
});
