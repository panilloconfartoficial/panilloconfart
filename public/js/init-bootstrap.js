// ─── INIT ──────────────────────────────────────────────
updateCartUI();
restoreClientSession();
document.addEventListener("DOMContentLoaded", () => {
  initAdminDark();
  // Sidebar mobile: fecha ao clicar em item
  document.querySelectorAll(".sb-item").forEach(item => {
    item.addEventListener("click", () => {
      if (window.innerWidth <= 900) toggleAdminSidebar();
    });
  });

  // Config e logo
  loadConfig();
  applyLogo(LOGO_BASE64);

  // Rota /admin — o CSS já esconde a loja e mostra o login imediatamente
  // (via data-route="admin" no <html>). Aqui apenas lidamos com o caso raro
  // onde Firebase já carregou antes do DOMContentLoaded.
  const path = window.location.pathname;
  if (path === "/admin" || path === "/admin/") {
    const currentUser = window._auth?.currentUser;
    if (currentUser) {
      // Firebase já carregou E usuário já autenticado → vai direto ao painel
      showPage("page-admin");
      loadDashboard();
      showMobBottomNav(true);
    } else if (window._fbModules?.onAuthStateChanged) {
      // Firebase carregou mas auth ainda resolvendo
      const unsub = window._fbModules.onAuthStateChanged(window._auth, (user) => {
        unsub && unsub();
        if (user) { showPage("page-admin"); loadDashboard(); showMobBottomNav(true); }
        // Se não logado: página de login já está visível pelo CSS
      });
    }
    // Se Firebase não carregou ainda: firebase-ready cuida do roteamento final
  }
});
