// ─── CONFIG ─────────────────────────────────────────────
// Todos os dados sensíveis vêm do servidor via /api/config
// Nenhuma API key, senha ou dado pessoal está neste arquivo.
let WPP_NUMBER = "";
let PIX_KEY    = "";

// ─── STATE ─────────────────────────────────────────────
let cart = {};
let currentStep = 1;
let selectedPay = "";
let selectedMktOpt = "Instagram";
let editingProdId = null;
let editingIngId  = null;
let ingRows = 0;
let allOrders = [];
let allIngredients = [];
let allProducts = [];
let allClients = [];
let orderFilterStatus = "todos";
let iaChatHistory = [];
let orderMode = "pe";          // "pe" | "enc"
let allStock = {};             // { prodId: { qty, ativo } }
let allFiadoAccounts = [];     // array of credit account docs
let foundFiadoClient = null;   // temp for fiado auth modal

// ─── FIREBASE HELPERS ──────────────────────────────────
let db, auth, FB;
window.addEventListener("firebase-ready", () => {
  db   = window._db;
  auth = window._auth;
  FB   = window._fbModules;

  // Preenche configurações vindas do servidor
  WPP_NUMBER = window._wppNumber || "";
  PIX_KEY    = window._pixKey    || "";

  // Observa estado de autenticação — redireciona automaticamente se já logada
  FB.onAuthStateChanged(auth, (user) => {
    const onAdminRoute = window.location.pathname === "/admin" || window.location.pathname === "/admin/";
    if (user) {
      const loginActive = document.getElementById("page-login").classList.contains("active");
      if (loginActive || onAdminRoute) {
        showPage("page-admin");
        showMobBottomNav(true);
      }
      // Inicia listeners de coleções privadas agora que auth está confirmado
      setupAdminListeners();
    } else {
      // Para os listeners privados ao deslogar
      ["orders","fiado","ingredients","clients"].forEach(k => _stopListen(k));
      if (onAdminRoute) {
        showPage("page-login");
      }
    }
  });

  // Inicia listeners em tempo real — substituem todos os loadXxx() individuais.
  setupRealtimeListeners();

  // Aplica WhatsApp no footer (após setup crítico, com try-catch de segurança)
  try { if (WPP_NUMBER) applyFooterWpp(WPP_NUMBER); } catch {}

  // Reconcilia estoque após os listeners terem carregado os dados iniciais
  setTimeout(() => {
    const needsReconcile = (allOrders||[]).some(o =>
      o.tipo === "pronta-entrega" && o.status === "entregue" && !o._stockDecremented
    );
    if (needsReconcile) reconcileStock();
  }, 2500);
});

// Converte preço/unidade do ingrediente para preço/grama (ou preço/ml, tratado como equivalente)
// kg e L são convertidos (÷1000) assumindo densidade ~1 para líquidos; g e ml não precisam conversão.
function precoPorGrama(ing) {
  const preco = Number(ing.preco) || 0;
  if (ing.unit === "kg" || ing.unit === "L") return preco / 1000;
  return preco; // g, ml, unidade
}

function escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// ─── REAL-TIME LISTENERS (onSnapshot) ─────────────────────────────────
// Mantém todas as coleções sincronizadas em tempo real entre dispositivos
// e abas — qualquer mudança no Firestore reflete instantaneamente na tela
// sem precisar recarregar a página.

let _listeners = {}; // mapa: nome → função unsubscribe

function _stopListen(name) {
  if (_listeners[name]) { try { _listeners[name](); } catch {} delete _listeners[name]; }
}

function isAdminVisible() {
  return document.getElementById("page-admin")?.classList.contains("active");
}

function setupRealtimeListeners() {
  if (!db || !FB?.onSnapshot) return;

  // ── Coleções PÚBLICAS (sem autenticação) ─────────────────────────────

  // Produtos (loja + admin)
  _stopListen("products");
  _listeners.products = FB.onSnapshot(FB.collection(db, "products"), snap => {
    allProducts = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    renderStoreProducts("todos");
    renderPEProducts();
    if (isAdminVisible()) renderAdminProducts();
  }, e => console.warn("RT products:", e.message));

  // Estoque PE (loja + admin)
  _stopListen("stock");
  _listeners.stock = FB.onSnapshot(FB.collection(db, "stock"), snap => {
    allStock = {};
    snap.docs.forEach(d => {
      const dat = d.data();
      allStock[dat.prodId] = { id: d.id, qty: dat.qty || 0, ativo: dat.ativo || false };
    });
    renderPEProducts();
    if (isAdminVisible() && document.getElementById("sec-estoque")?.classList.contains("hidden") === false) {
      renderStockAdmin();
    }
  }, e => console.warn("RT stock:", e.message));

  // Depoimentos (público + admin)
  _stopListen("depoimentos");
  _listeners.depoimentos = FB.onSnapshot(FB.collection(db, "depoimentos"), snap => {
    _allDepoimentos = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    const badge = document.getElementById("badge-depoimentos");
    if (badge) { badge.textContent = _allDepoimentos.length; badge.style.display = _allDepoimentos.length ? "" : "none"; }
    const grid = document.getElementById("depoimentos-grid");
    if (grid) {
      const visiveis = _allDepoimentos.filter(d => !d.oculto);
      if (!visiveis.length) {
        grid.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;grid-column:1/-1;">Seja o primeiro a avaliar! 🍪</div>';
      } else {
        grid.innerHTML = visiveis.map(d => {
          const estrelas = "★".repeat(d.estrelas||5) + "☆".repeat(5-(d.estrelas||5));
          const resposta = d.resposta ? `<div class="dep-reply"><div class="dep-reply-lbl">Resposta da Panillo</div><div class="dep-reply-txt">${escHtml(d.resposta)}</div></div>` : "";
          return `<div class="dep-card"><div class="dep-stars">${estrelas}</div><div class="dep-text">"${escHtml(d.texto)}"</div><div class="dep-name">${escHtml(d.clienteNome || "Cliente")}</div>${resposta}</div>`;
        }).join("");
      }
    }
    if (isAdminVisible()) renderDepoimentosAdmin();
  }, e => console.warn("RT depoimentos:", e.message));

  // AppConfig (endereço, pix, cupons)
  _stopListen("config");
  _listeners.config = FB.onSnapshot(FB.collection(db, "appConfig"), snap => {
    if (!snap.docs.length) return;
    const remote = snap.docs[0].data();
    const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
    const merged = { ...cfg, ...remote };
    localStorage.setItem("panillo-config", JSON.stringify(merged));
    if (remote.pixKey)    { PIX_KEY    = remote.pixKey;    window._pixKey    = remote.pixKey;    }
    if (remote.wppNumber) { WPP_NUMBER = remote.wppNumber; window._wppNumber = remote.wppNumber; try { applyFooterWpp(remote.wppNumber); } catch {} }
    if (remote.logo) applyLogo(remote.logo);
    if (isAdminVisible()) renderCouponsList();
  }, e => console.warn("RT config:", e.message));
}

// Listeners de coleções privadas — só chamado após autenticação confirmada.
// Evita "permission-denied" inicial que mata o listener permanentemente.
function setupAdminListeners() {
  if (!db || !FB?.onSnapshot) return;

  // Pedidos
  _stopListen("orders");
  _listeners.orders = FB.onSnapshot(FB.collection(db, "orders"), snap => {
    allOrders = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    const badge = allOrders.filter(o => o.status === "pendente").length;
    const badgeEl = document.getElementById("badge-pedidos");
    if (badgeEl) { badgeEl.textContent = badge; updateMbnBadge(badge); }
    loadDashboard();
    if (isAdminVisible()) renderOrders();
  }, e => console.warn("RT orders:", e.message));

  // Contas fiado
  _stopListen("fiado");
  _listeners.fiado = FB.onSnapshot(FB.collection(db, "fiadoAccounts"), snap => {
    allFiadoAccounts = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    const activeCount = allFiadoAccounts.filter(a => a.autorizado).length;
    const badgeEl = document.getElementById("badge-fiado");
    if (badgeEl) badgeEl.textContent = activeCount;
    if (isAdminVisible()) renderFiadoAdmin();
  }, e => console.warn("RT fiado:", e.message));

  // Ingredientes
  _stopListen("ingredients");
  _listeners.ingredients = FB.onSnapshot(FB.collection(db, "ingredients"), snap => {
    allIngredients = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    if (isAdminVisible()) renderIngredients();
  }, e => console.warn("RT ingredients:", e.message));

  // Clientes (background)
  _stopListen("clients");
  _listeners.clients = FB.onSnapshot(FB.collection(db, "clients"), snap => {
    allClients = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    renderBdayAlerts(allClients);
    if (isAdminVisible()) renderClients();
  }, e => console.warn("RT clients:", e.message));
}

// ─── FIREBASE HELPERS ──────────────────────────────────────────────────
async function fbAdd(col, data) {
  return FB.addDoc(FB.collection(db, col), { ...data, createdAt: FB.serverTimestamp() });
}
async function fbUpdate(col, id, data) {
  return FB.updateDoc(FB.doc(db, col, id), data);
}
async function fbGet(col) {
  const snap = await FB.getDocs(FB.collection(db, col));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}
// Escreve/atualiza um documento por ID conhecido com merge — não requer
// leitura prévia do documento (cria se não existir, mescla se existir).
// Usado para coleções onde o cliente público só tem permissão de
// create/update, não de read (ex: "clients").
async function fbSetMerge(col, id, data) {
  return FB.setDoc(FB.doc(db, col, id), data, { merge: true });
}

// ─── TOAST ─────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ─── PAGE ROUTING ──────────────────────────────────────
function showPage(id) {
  document.querySelectorAll(".page, .admin-page").forEach(p => {
    p.classList.remove("active");
  });
  document.getElementById(id).classList.add("active");
  // Remove o override de CSS do /admin quando navega para outra página
  if (id !== "page-login") {
    document.documentElement.removeAttribute("data-route");
  }
}

function goToStore() {
  showPage("page-store");
}

async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass  = document.getElementById("login-pass").value;
  const errEl = document.getElementById("login-err");
  const btn   = document.querySelector(".login-btn");
  errEl.classList.add("hidden");
  btn.textContent = "Entrando...";
  btn.disabled = true;
  try {
    await FB.signInWithEmailAndPassword(auth, email, pass);
    showPage("page-admin");
    loadOrders(); // carrega pedidos e atualiza dashboard
    showMobBottomNav(true);
    // Ativa notificações push para o admin
    setupAdminPushNotifications();
  } catch (err) {
    errEl.textContent = "E-mail ou senha incorretos.";
    errEl.classList.remove("hidden");
  } finally {
    btn.textContent = "Entrar";
    btn.disabled = false;
  }
}

async function setupAdminPushNotifications() {
  try {
    if (!window._setupFCMPush) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      showToast("⚠️ Permita notificações para receber alertas de pedidos");
      return;
    }
    await window._setupFCMPush();
    showToast("🔔 Notificações push ativadas!");
  } catch(e) {
    console.warn("Push setup:", e);
  }
}

// ─── NOTIFICAÇÕES (CallMeBot + Resend + FCM) ────────────
async function sendOrderNotifications(order) {
  try {
    await fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order })
    });
  } catch(e) {
    console.warn("Notification API error:", e);
  }
}

async function doLogout() {
  try { await FB.signOut(auth); } catch {}
  showPage("page-store");
  showMobBottomNav(false);
}

