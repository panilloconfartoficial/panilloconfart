// ─── ADMIN SECTIONS ────────────────────────────────────
function showAdminSection(sec, el) {
  document.querySelectorAll('[id^="sec-"]').forEach(s => s.classList.add("hidden"));
  document.getElementById("sec-" + sec).classList.remove("hidden");
  document.querySelectorAll(".sb-item").forEach(i => i.classList.remove("active"));
  if (el) el.classList.add("active");
  syncBottomNav(sec);

  if (sec === "dash")        loadDashboard();
  if (sec === "pedidos")     renderOrders();
  if (sec === "clientes")    renderClients();
  if (sec === "cardapio")    renderAdminProducts();
  if (sec === "estoque")     renderStockAdmin();
  if (sec === "fiado")       renderFiadoAdmin();
  if (sec === "historico")   loadHistoricoAdmin();
  if (sec === "suprimentos") renderIngredients();
  if (sec === "ia")          renderIASection();
  if (sec === "indicadores") {
    // Preenche datas padrão se ainda não preenchidas
    const today = new Date().toISOString().split("T")[0];
    const d30   = new Date(); d30.setDate(d30.getDate()-30);
    const from30 = d30.toISOString().split("T")[0];
    const df = document.getElementById("ind-date-from");
    const dt = document.getElementById("ind-date-to");
    if (df && !df.value) df.value = from30;
    if (dt && !dt.value) dt.value = today;
    loadIndicadores("mes");
  }
  if (sec === "admin-depoimentos") renderDepoimentosAdmin();
  if (sec === "metas")       loadMetas();
  if (sec === "planejamento") loadPlanejamento();
  if (sec === "fluxo") {
    const today = new Date().toISOString().split("T")[0];
    const d30   = new Date(); d30.setDate(d30.getDate()-30);
    const from30 = d30.toISOString().split("T")[0];
    const df = document.getElementById("fluxo-date-from");
    const dt = document.getElementById("fluxo-date-to");
    if (df && !df.value) df.value = from30;
    if (dt && !dt.value) dt.value = today;
    loadFluxo();
  }
  if (sec === "producao")    loadProducao();
}

// ─── PRODUCTS ──────────────────────────────────────────
async function loadProducts() {
  try {
    const docs = await fbGet("products");
    allProducts = docs;
  } catch {
    allProducts = [];
  }
  renderStoreProducts("todos");
  renderPEProducts();
  renderAdminProducts();
}

// ─── ORDER MODE (PE / Encomenda) ───────────────────────
function switchOrderMode(mode) {
  orderMode = mode;
  document.getElementById("otab-pe").classList.toggle("active", mode === "pe");
  document.getElementById("otab-enc").classList.toggle("active", mode === "enc");
  document.getElementById("tab-pe-content").classList.toggle("active", mode === "pe");
  document.getElementById("tab-enc-content").classList.toggle("active", mode === "enc");
  if (mode === "pe") renderPEProducts();
}

function renderPEProducts() {
  const grid = document.getElementById("products-grid-pe");
  if (!grid) return;
  const peProds = allProducts.filter(p => {
    if (p.ativo === false) return false;
    const s = allStock[p.id];
    return s && s.ativo && (s.qty || 0) > 0;
  });
  if (peProds.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--muted);font-size:14px;">
      <div style="font-size:40px;margin-bottom:12px;">📦</div>
      Nenhum produto disponível para pronta entrega no momento.<br>
      <span style="font-size:12px;">Veja nosso <a href="javascript:void(0)" onclick="switchOrderMode('enc')" style="color:var(--gold);">cardápio de encomendas</a>!</span>
    </div>`;
    return;
  }
  grid.innerHTML = peProds.map(p => {
    const s = allStock[p.id];
    const qty = s ? (s.qty || 0) : 0;
    const isLow = qty > 0 && qty <= 3;
    const badgeClass = qty === 0 ? "stock-zero" : isLow ? "stock-low" : "stock-ok";
    const badgeIcon  = qty === 0 ? "ti-x" : isLow ? "ti-alert-triangle" : "ti-circle-check";
    const badgeText  = qty === 0 ? "Esgotado" : `${qty} unid.`;
    const imgBg = p.categoria === "brownie"
      ? "background:linear-gradient(135deg,#F5E8DA,#E8D0B8);"
      : p.categoria === "combo"
        ? "background:linear-gradient(135deg,#FDF6E8,#F5E0B0);"
        : "background:linear-gradient(135deg,#FDF0DC,#F5E0B0);";
    // Usa fotoUrl se disponível — mesmo comportamento da aba Encomenda
    const imgContent = p.fotoUrl
      ? `<img src="${p.fotoUrl}" alt="${p.nome}" style="width:100%;height:100%;object-fit:cover;object-position:${p.fotoPos ? p.fotoPos.x+'% '+p.fotoPos.y+'%' : '50% 50%'};transform:scale(${p.fotoPos ? p.fotoPos.zoom/100 : 1});transform-origin:${p.fotoPos ? p.fotoPos.x+'% '+p.fotoPos.y+'%' : '50% 50%'};" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
        + `<span style="display:none;font-size:72px;align-items:center;justify-content:center;width:100%;height:100%;">${p.emoji || "🍪"}</span>`
      : `<span style="font-size:72px;">${p.emoji || "🍪"}</span>`;
    const cardOp = qty === 0 ? "opacity:0.55;" : "";
    return `<div class="product-card" style="${cardOp}" id="pe-card-${p.id}">
      <div class="prod-img ${p.categoria}" style="${imgBg}position:relative;overflow:hidden;">
        ${imgContent}
      </div>
      <div class="prod-body">
        <div class="prod-name">${p.nome}</div>
        <div class="prod-desc">${p.desc || ""}</div>
        <div class="stock-badge-pe ${badgeClass}"><i class="ti ${badgeIcon}" style="font-size:11px;"></i> ${badgeText}</div>
        <div class="prod-footer">
          <div class="prod-price">R$ ${Number(p.preco).toFixed(2).replace(".",",")}<small>/un.</small></div>
          ${qty > 0 ? `<div class="qty-ctrl">
            <button class="qty-btn" onclick="changePEQty('${p.id}',-1)">−</button>
            <span class="qty-num" id="pe-qty-${p.id}">0</span>
            <button class="qty-btn" onclick="changePEQty('${p.id}',1)">+</button>
          </div>` : `<button disabled style="background:rgba(0,0,0,0.06);color:#999;border:none;padding:8px 14px;border-radius:20px;font-size:12px;">Esgotado</button>`}
        </div>
      </div>
    </div>`;
  }).join("");
}

function changePEQty(prodId, delta) {
  const s = allStock[prodId];
  const maxQty = s ? (s.qty || 0) : 0;
  const qtyEl = document.getElementById("pe-qty-" + prodId);
  if (!qtyEl) return;
  const prod = allProducts.find(p => p.id === prodId);
  if (!prod) return;

  const current = parseInt(qtyEl.textContent) || 0;
  const newQty = Math.min(Math.max(0, current + delta), maxQty);
  qtyEl.textContent = newQty;

  const key = prodId + "_pe";
  if (newQty === 0) {
    delete cart[key];
  } else {
    cart[key] = { prod: { ...prod, _pe: true }, qty: newQty };
  }
  updateCartUI();
}

function renderStoreProducts(filter) {
  const grid = document.getElementById("products-grid");
  const ativos = allProducts.filter(p => p.ativo !== false);
  const list = filter === "todos" ? ativos : ativos.filter(p => p.categoria === filter);
  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--muted);font-size:14px;">Nenhum produto disponível no momento.</div>`;
    return;
  }
  grid.innerHTML = list.map(p => {
    const isCombo = p.categoria === "combo";
    const imgBg   = p.categoria === "brownie"
      ? "background:linear-gradient(135deg,#F5E8DA,#E8D0B8);"
      : p.categoria === "combo"
      ? "background:linear-gradient(135deg,#FDF6E8,#F5E0B0);"
      : "background:linear-gradient(135deg,#FDF0DC,#F5E4C0);";
    const imgContent = p.fotoUrl
      ? `<img src="${p.fotoUrl}" alt="${p.nome}" style="width:100%;height:100%;object-fit:cover;object-position:${p.fotoPos?p.fotoPos.x+'% '+p.fotoPos.y+'%':'50% 50%'};transform:scale(${p.fotoPos?p.fotoPos.zoom/100:1});transform-origin:${p.fotoPos?p.fotoPos.x+'% '+p.fotoPos.y+'%':'50% 50%'};" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
        + `<span style="display:none;font-size:64px;align-items:center;justify-content:center;width:100%;height:100%;">${p.emoji||"🍪"}</span>`
      : `<span style="font-size:64px;">${p.emoji || (isCombo?"🎁":"🍪")}</span>`;
    const comboInfo = isCombo
      ? `<div style="font-size:11px;color:var(--teal-light);font-weight:500;margin-bottom:4px;">${p.comboCookies||0} cookie(s) + ${p.comboBrownies||0} brownie(s)</div>`
      : "";
    const action = isCombo
      ? `<button style="background:var(--gold);color:#fff;border:none;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;" onclick="openComboModal('${p.id}')">Montar 🎁</button>`
      : `<div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty('${p.id}',-1)">−</button>
          <span class="qty-num" id="qty-${p.id}">${cart[p.id]?.qty || 0}</span>
          <button class="qty-btn" onclick="changeQty('${p.id}',1)">+</button>
        </div>`;
    return `
    <div class="product-card fade-in">
      <div class="prod-img ${p.categoria}" style="${imgBg}position:relative;overflow:hidden;">
        ${p.badge ? `<div class="prod-badge">${p.badge}</div>` : ""}
        ${imgContent}
      </div>
      <div class="prod-body">
        ${comboInfo}
        <div class="prod-name">${p.nome}</div>
        <div class="prod-desc">${p.desc}</div>
        <div class="prod-footer">
          <div class="prod-price">R$ ${Number(p.preco).toFixed(2).replace(".",",")} <small>/un</small></div>
          ${action}
        </div>
      </div>
    </div>`;
  }).join("");
}

function filterProducts(f, btn) {
  document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderStoreProducts(f);
}

// ─── CART ──────────────────────────────────────────────
function changeQty(id, delta) {
  const prod = allProducts.find(p => p.id === id);
  if (!prod) return;
  if (!cart[id]) cart[id] = { prod, qty: 0 };
  cart[id].qty = Math.max(0, cart[id].qty + delta);
  if (cart[id].qty === 0) delete cart[id];
  updateCartUI();
  const el = document.getElementById("qty-" + id);
  if (el) el.textContent = cart[id]?.qty || 0;
}

function updateCartUI() {
  const items = Object.values(cart);
  const subtotal = items.reduce((s, i) => s + i.prod.preco * i.qty, 0);
  const count    = items.reduce((s, i) => s + i.qty, 0);
  document.getElementById("cart-count").textContent = count;
  const listEl   = document.getElementById("cart-items-list");
  const footerEl = document.getElementById("cart-footer-panel");
  const isPE     = items.some(i => i.prod._pe);

  // Coupon discount (pct pode ser null quando cupom está pendente de validação)
  const discPct  = activeCoupon?.pct || 0;
  const discVal  = subtotal * discPct / 100;
  const total    = subtotal - discVal;

  const checkoutBtn = document.getElementById("checkout-main-btn");
  if (checkoutBtn) checkoutBtn.textContent = isPE ? "Finalizar pedido →" : "Finalizar encomenda →";

  if (items.length === 0) {
    listEl.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛒</div><div>Seu carrinho está vazio</div></div>`;
    footerEl.style.display = "none";
    activeCoupon = null;
    const wrap = document.getElementById("coupon-badge-wrap");
    if (wrap) wrap.innerHTML = "";
  } else {
    listEl.innerHTML = (isPE ? `<div style="background:rgba(26,107,107,0.08);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--teal-dark);display:flex;align-items:center;gap:6px;"><i class='ti ti-package' style='font-size:14px;'></i> <strong>Pronta Entrega</strong> — disponível agora</div>` : "") +
    items.map(i => `
      <div class="cart-item-row">
        <div class="cart-item-thumb ${i.prod.categoria}">${i.prod.emoji}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${i.prod.nome}</div>
          <div class="cart-item-unit">R$ ${i.prod.preco.toFixed(2).replace(".",",")} / un</div>
        </div>
        <div class="cart-item-right">
          <div class="cart-item-total">R$ ${(i.prod.preco*i.qty).toFixed(2).replace(".",",")}</div>
          <div class="mini-qty-ctrl">
            <button class="mini-btn" onclick="${i.prod._pe ? `changePEQty('${i.prod.id}',-1)` : `changeQty('${i.prod.id}',-1)`}">−</button>
            <span class="mini-qty">${i.qty}</span>
            <button class="mini-btn" onclick="${i.prod._pe ? `changePEQty('${i.prod.id}',1)` : `changeQty('${i.prod.id}',1)`}">+</button>
          </div>
        </div>
      </div>`).join("");
    footerEl.style.display = "block";
    document.getElementById("cart-subtotal").textContent = `R$ ${subtotal.toFixed(2).replace(".",",")}`;
    document.getElementById("cart-total").textContent    = `R$ ${total.toFixed(2).replace(".",",")}`;
    // Discount row
    const discRow   = document.getElementById("discount-row");
    const discLabel = document.getElementById("discount-pct-label");
    const discValEl = document.getElementById("discount-val");
    if (discRow) {
      discRow.style.display = discPct > 0 ? "" : "none";
      if (discLabel) discLabel.textContent = `(${discPct}%)`;
      if (discValEl) discValEl.textContent = `-R$ ${discVal.toFixed(2).replace(".",",")}`;
    }
    // WhatsApp
    const tipoPed = isPE ? "🛒 Pronta Entrega" : "📅 Encomenda";
    const msg = encodeURIComponent(`Olá Panillo! Quero fazer um pedido (${tipoPed}):\n` + items.map(i=>`• ${i.qty}x ${i.prod.nome} = R$ ${(i.prod.preco*i.qty).toFixed(2)}`).join("\n") + `\n*Total: R$ ${total.toFixed(2)}*`);
    document.getElementById("wpp-btn").onclick = () => window.open(`https://wa.me/${WPP_NUMBER}?text=${msg}`,"_blank");
  }
  // Store discount info for checkout
  window._cartTotal    = total;
  window._cartDiscount = discPct;
}

// ─── CADASTRO DO CLIENTE ────────────────────────────────
function openClientRegister() {
  // Se já tem dados salvos localmente, abre em modo "editar perfil"
  const saved = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  const isEdit = !!saved.nome;

  // Reset states
  document.getElementById("crb-form-state").style.display   = "";
  document.getElementById("crb-success-state").style.display = "none";
  document.getElementById("crb-error").style.display = "none";

  // Preenche campos se já cadastrado
  document.getElementById("crb-nome").value  = saved.nome  || "";
  document.getElementById("crb-wpp").value   = saved.wpp   || "";
  document.getElementById("crb-email").value = saved.email || "";
  document.getElementById("crb-bday").value  = saved.bday  || "";
  document.getElementById("crb-obs").value   = saved.obs   || "";

  // Ajusta textos para modo editar
  const submitBtn = document.getElementById("crb-submit-btn");
  if (isEdit) {
    submitBtn.textContent = "Atualizar cadastro";
  } else {
    submitBtn.textContent = "Salvar cadastro";
  }

  document.getElementById("client-reg-modal").classList.add("open");
}

function closeClientRegister() {
  document.getElementById("client-reg-modal").classList.remove("open");
}

async function submitClientRegister() {
  const nome  = document.getElementById("crb-nome").value.trim();
  const wpp   = document.getElementById("crb-wpp").value.trim();
  const email = document.getElementById("crb-email").value.trim();
  const bday  = document.getElementById("crb-bday").value;
  const obs   = document.getElementById("crb-obs").value.trim();
  const errEl = document.getElementById("crb-error");
  const btn   = document.getElementById("crb-submit-btn");

  errEl.style.display = "none";
  if (!nome || !wpp) {
    errEl.textContent = "Nome e WhatsApp são obrigatórios.";
    errEl.style.display = "block";
    return;
  }

  btn.textContent = "Salvando...";
  btn.disabled = true;

  const clientData = { nome, wpp, email, bday, obs };

  // Salva localmente
  localStorage.setItem("panillo-cliente", JSON.stringify(clientData));

  // Salva / atualiza no Firebase
  // ─── ESQUEMA: ID do documento = WhatsApp normalizado ────────────────
  // Mesma lógica de saveClientToFirebase: as regras do Firestore não
  // permitem "read" público em "clients", então não há como verificar se
  // o cliente já existe antes de escrever. Usamos setDoc(merge:true) com
  // o WhatsApp normalizado como ID — isso cria ou atualiza sem leitura
  // prévia. Campos de contador (pedidos/totalGasto/favorito) são
  // deliberadamente OMITIDOS aqui para não zerar o histórico de um
  // cliente que já tenha pedidos — eles só são definidos/incrementados em
  // saveClientToFirebase (no momento de um pedido real).
  const wppNorm = String(wpp).replace(/\D/g,""); // normaliza para só dígitos
  let firebaseSaved = false;
  try {
    if (!db || !FB) throw new Error("Firebase não inicializado");
    if (!wppNorm) throw new Error("WhatsApp inválido");

    await fbSetMerge("clients", wppNorm, {
      nome,
      wpp: wppNorm,
      ...(email ? { email } : {}),
      ...(bday  ? { bday  } : {}),
      ...(obs   ? { obs   } : {}),
      lastCadastroAt: FB.serverTimestamp()
    });
    firebaseSaved = true;
    console.log("Cliente salvo/atualizado via Cadastre-se (setDoc merge):", nome);
  } catch(e) {
    console.error("Erro ao salvar cadastro:", e);
  }
  if (!firebaseSaved) {
    // Mesmo sem Firebase, o cadastro local funciona para o fluxo de compra
    console.warn("Cadastro salvo apenas localmente para:", nome);
  }

  btn.textContent = "Salvar cadastro";
  btn.disabled = false;

  // Mostra sucesso
  document.getElementById("crb-form-state").style.display    = "none";
  document.getElementById("crb-success-state").style.display = "";
  document.getElementById("crb-success-name").textContent =
    `Olá, ${nome.split(" ")[0]}! 🎉`;

  // Atualiza botão da nav
  updateNavClientButton(nome);

  // Verifica se tem fiado ativo e mostra opção
  checkFiadoForClient(wpp);
}

function updateNavClientButton(nome) {
  const initials = nome.substring(0, 2).toUpperCase();
  const label    = nome.split(" ")[0];
  const navBtn   = document.getElementById("nav-client-label");
  const mobLabel = document.getElementById("mob-client-label");
  if (navBtn) navBtn.textContent = label;
  if (mobLabel) mobLabel.textContent = label;
}

async function checkFiadoForClient(wpp) {
  // allFiadoAccounts é mantido pelo listener em tempo real — não precisa
  // de fetch manual a cada cadastro. Se ainda vazio (Firebase não iniciou),
  // faz fetch único como fallback.
  if (!allFiadoAccounts.length && db && FB) {
    try { allFiadoAccounts = await fbGet("fiadoAccounts"); } catch {}
  }
}

// Ao carregar a página, restaura o nome no botão se já cadastrado
function restoreClientSession() {
  const saved = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  if (saved.nome) updateNavClientButton(saved.nome);
}

function toggleCart() {
  document.getElementById("cart-overlay").classList.toggle("open");
  document.getElementById("cart-drawer").classList.toggle("open");
  updateCartUI();
}

// ─── CHECKOUT ──────────────────────────────────────────
function renderStepBar(active) {
  // active: 0=Identificação, 1=Dados, 2=Retirada, 3=Confirmação
  const steps = ["Identificação","Dados","Retirada","Confirmação"];
  document.getElementById("checkout-stepbar").innerHTML = steps.map((s,i) => {
    const cls = i < active ? "done" : i === active ? "active" : "next";
    const lbl = i < active ? "✓" : i + 1;
    return `<div class="step-it"><div class="step-c ${cls}">${lbl}</div><span class="step-n ${i===active?'active':''}">${s}</span></div>${i<steps.length-1?'<div class="step-ln"></div>':''}`;
  }).join("");
}

function renderOrderSummary(elId) {
  const items    = Object.values(cart);
  const subtotal = items.reduce((s,i) => s + i.prod.preco * i.qty, 0);
  const discPct  = activeCoupon?.pct || 0;
  const discVal  = discPct > 0 ? subtotal * discPct / 100 : 0;
  const total    = subtotal - discVal;

  const discHtml = discPct > 0 ? `
    <div class="os-item" style="color:#2E7D32;font-size:13px;">
      <span class="name">✓ Cupom ${activeCoupon.code} (${discPct}%)</span>
      <span class="val" style="color:#2E7D32;">−R$ ${discVal.toFixed(2).replace(".",",")}</span>
    </div>` : "";

  document.getElementById(elId).innerHTML = `
    <div class="os-title">Resumo do pedido</div>
    ${items.map(i=>`<div class="os-item"><span class="name">${i.prod.nome} × ${i.qty}</span><span class="val">R$ ${(i.prod.preco*i.qty).toFixed(2).replace(".",",")}</span></div>`).join("")}
    ${discHtml}
    <div class="os-divider"></div>
    <div class="os-total"><span class="lbl">Total</span><span class="val">R$ ${total.toFixed(2).replace(".",",")}</span></div>`;
}

function openCheckout() {
  if (Object.keys(cart).length === 0) { showToast("Adicione produtos ao carrinho!"); return; }
  document.getElementById("cart-overlay").classList.remove("open");
  document.getElementById("cart-drawer").classList.remove("open");
  currentStep = 0;
  renderStepBar(0);
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("step-0").classList.add("active");

  // Reseta o step-0
  toggleClienteOpt(null);
  document.getElementById("busca-resultado").innerHTML = "";
  document.getElementById("f-wpp-busca").value = "";

  const isPE = Object.values(cart).some(i => i.prod._pe);
  const titleEl = document.getElementById("checkout-modal-title");
  if (titleEl) titleEl.textContent = isPE ? "🛒 Pronta Entrega" : "📅 Finalizar Encomenda";

  // Se já tem dados salvos, pré-seleciona "já sou cliente" automaticamente
  const saved = localStorage.getItem("panillo-cliente");
  if (saved) {
    const c = JSON.parse(saved);
    toggleClienteOpt(true);
    document.getElementById("f-wpp-busca").value = c.wpp || "";
  }

  document.getElementById("checkout-modal").classList.add("open");
}

function closeCheckout() {
  document.getElementById("checkout-modal").classList.remove("open");
}

// ─── STEP 0: IDENTIFICAÇÃO ─────────────────────────────
let _clienteOptSelecionado = null; // true=retornando, false=novo, null=não escolheu

function toggleClienteOpt(isReturning) {
  _clienteOptSelecionado = isReturning;
  const retOpt   = document.getElementById("returning-opt");
  const newOpt   = document.getElementById("new-opt");
  const retBody  = document.getElementById("ret-opt-body");
  if (!retOpt || !newOpt) return;

  if (isReturning === true) {
    retOpt.style.borderColor  = "var(--teal-dark)";
    newOpt.style.borderColor  = "var(--border)";
    if (retBody) retBody.style.display = "block";
  } else if (isReturning === false) {
    retOpt.style.borderColor  = "var(--border)";
    newOpt.style.borderColor  = "var(--teal-dark)";
    if (retBody) retBody.style.display = "none";
  } else {
    retOpt.style.borderColor  = "var(--border)";
    newOpt.style.borderColor  = "var(--border)";
    if (retBody) retBody.style.display = "none";
  }
}

async function buscarClienteExistente() {
  const raw    = document.getElementById("f-wpp-busca").value.replace(/\D/g,"");
  const result = document.getElementById("busca-resultado");
  if (raw.length < 8) { result.innerHTML = `<span style="color:#993C1D;">Digite um número válido.</span>`; return; }

  const btn = document.getElementById("btn-buscar-cliente");
  btn.disabled = true; btn.textContent = "Buscando...";
  result.innerHTML = `<span style="color:var(--muted);">Buscando...</span>`;

  // Tenta o número com e sem DDI 55 — maior compatibilidade entre formatos salvos
  const variants = [raw, raw.startsWith("55") ? raw.slice(2) : "55" + raw];

  let found = null;
  let foundWpp = raw;

  // Busca diretamente no Firestore por ID do documento (= número do WhatsApp normalizado).
  // O endpoint /api/find-client nunca foi criado, então vamos direto à fonte.
  if (db && FB) {
    for (const v of variants) {
      try {
        const snap = await FB.getDoc(FB.doc(db, "clients", v));
        if (snap.exists()) {
          const d = snap.data();
          found = { nome: d.nome, pedidos: d.pedidos, totalGasto: d.totalGasto, email: d.email||"", bday: d.bday||"", obs: d.obs||"" };
          foundWpp = v;
          break;
        }
      } catch {} // permission-denied ou não encontrado — tenta variante
    }
  }

  if (found) {
    result.innerHTML = `
      <div style="background:#E8F5F0;border:1px solid #A8DCC8;border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--teal-dark);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">
          ${(found.nome||"?").substring(0,2).toUpperCase()}
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--teal-dark);">✅ ${escHtml(found.nome)}</div>
          <div style="font-size:11px;color:var(--muted);">${found.pedidos||0} pedido(s) · R$ ${Number(found.totalGasto||0).toFixed(2).replace(".",",")}</div>
        </div>
      </div>`;
    localStorage.setItem("panillo-cliente", JSON.stringify({
      nome: found.nome, wpp: foundWpp,
      email: found.email||"", bday: found.bday||"", obs: found.obs||""
    }));
  } else {
    result.innerHTML = `
      <div style="background:#FDF6E8;border:1px solid #E8C96A;border-radius:10px;padding:10px 14px;font-size:12px;color:#7A5A00;">
        ⚠️ Número não encontrado. Verifique ou selecione "primeiro pedido" abaixo.
      </div>`;
  }

  btn.disabled = false; btn.textContent = "Buscar";
}

function confirmarIdentificacao() {
  if (_clienteOptSelecionado === null) {
    showToast("Escolha uma opção acima para continuar!");
    return;
  }
  // Avança para step-1 preenchendo os dados
  const isPE = Object.values(cart).some(i => i.prod._pe);
  const saved = localStorage.getItem("panillo-cliente");

  if (saved) {
    const c = JSON.parse(saved);
    document.getElementById("f-nome").value  = c.nome  || "";
    document.getElementById("f-wpp").value   = c.wpp   || "";
    document.getElementById("f-email").value = c.email || "";
    document.getElementById("f-bday").value  = c.bday  || "";
    document.getElementById("f-obs").value   = c.obs   || "";
    document.getElementById("ret-banner-wrap").innerHTML = `
      <div class="ret-banner">
        <div class="ret-avatar">${(c.nome||"?").substring(0,2).toUpperCase()}</div>
        <div class="ret-info">
          <div class="ret-name">Olá, ${c.nome.split(" ")[0]}! 👋</div>
          <div class="ret-sub">Confira seus dados abaixo e corrija se precisar.</div>
        </div>
      </div>`;
  } else {
    document.getElementById("f-nome").value  = "";
    document.getElementById("f-wpp").value   = "";
    document.getElementById("f-email").value = "";
    document.getElementById("f-bday").value  = "";
    document.getElementById("f-obs").value   = "";
    document.getElementById("ret-banner-wrap").innerHTML = "";
  }

  // Configura data mínima
  const dateInput = document.getElementById("f-data");
  const dateBlock = dateInput?.closest(".fg");
  if (isPE) {
    if (dateBlock) dateBlock.style.display = "none";
    dateInput.value = new Date().toISOString().split("T")[0];
  } else {
    if (dateBlock) dateBlock.style.display = "";
    const minDate = new Date(); minDate.setDate(minDate.getDate()+2);
    dateInput.min = minDate.toISOString().split("T")[0];
  }

  // Fiado
  const savedClient = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  const fiadoCard = document.getElementById("pay-fiado-card");
  if (fiadoCard && savedClient.wpp) {
    const hasCredit = allFiadoAccounts.some(a => (a.clientWpp||"").replace(/\D/g,"") === (savedClient.wpp||"").replace(/\D/g,"") && a.autorizado);
    fiadoCard.style.display = hasCredit ? "" : "none";
  }

  renderOrderSummary("order-summary-1");
  currentStep = 1;
  renderStepBar(1);
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("step-1").classList.add("active");
}

async function goStep(n) {
  // Step 1→2: valida dados do cliente
  if (n === 2) {
    const nome = document.getElementById("f-nome").value.trim();
    const wpp  = document.getElementById("f-wpp").value.trim();
    if (!nome || !wpp) { showToast("Preencha nome e WhatsApp!"); return; }
    const client = {
      nome, wpp,
      email: document.getElementById("f-email").value.trim(),
      bday:  document.getElementById("f-bday").value,
      obs:   document.getElementById("f-obs").value.trim()
    };
    localStorage.setItem("panillo-cliente", JSON.stringify(client));
    const fiadoCard = document.getElementById("pay-fiado-card");
    if (fiadoCard) {
      const hasCredit = allFiadoAccounts.some(a => (a.clientWpp||"").replace(/\D/g,"") === (wpp||"").replace(/\D/g,"") && a.autorizado);
      fiadoCard.style.display = hasCredit ? "" : "none";
    }
    renderOrderSummary("order-summary-2");
  }
  // Step 2→3: valida retirada e pagamento, depois submete
  if (n === 3) {
    const isPE = Object.values(cart).some(i => i.prod._pe);
    if (!isPE) {
      const data = document.getElementById("f-data").value;
      if (!data) { showToast("Escolha a data de retirada!"); return; }
    }
    if (!selectedPay) { showToast("Escolha a forma de pagamento!"); return; }
    await submitOrder();
    return;
  }
  currentStep = n;
  renderStepBar(n);
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("step-" + n).classList.add("active");
}

async function submitOrder() {
  const items = Object.values(cart);
  const client = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  const enderecoIdx = document.querySelector('input[name="endereco"]:checked')?.value || "1";
  const isPE = Object.values(cart).some(i => i.prod._pe);

  const btn = document.querySelector('#step-2 .btn-next-step');
  if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }

  const payload = {
    items: items.map(i => ({
      prodId: i.prod.id, qty: i.qty,
      sabores: i.prod.sabores || null, obs: i.prod.obs || null
    })),
    cupomCode: activeCoupon?.code || null,
    cliente: client,
    enderecoIdx,
    tipo: isPE ? "pronta-entrega" : "encomenda",
    dataRetirada: isPE ? new Date().toISOString().split("T")[0] : document.getElementById("f-data").value,
    periodo: document.getElementById("f-periodo").value,
    pagamento: selectedPay
  };

  let order, orderNum;

  // ── Pedido sempre criado via endpoint server-side /api/create-order ──
  // Preço, desconto e total são recalculados no servidor a partir dos
  // dados reais em "products"/"appConfig" — nunca confiamos em valores
  // vindos do navegador. Não há fallback de escrita direta no Firestore:
  // se a API falhar, o pedido não é enviado (evita preços adulterados).
  try {
    const resp = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      if (data?.couponInvalid) {
        activeCoupon = null;
        const wrap = document.getElementById("coupon-badge-wrap");
        const discRow = document.getElementById("discount-row");
        if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:#993C1D;margin-bottom:6px;">${data.error} — desconto removido. Confirme o pedido novamente.</div>`;
        if (discRow) discRow.style.display = "none";
        updateCartUI();
        renderOrderSummary("order-summary-2");
        showToast("Cupom não é mais válido — revise e confirme novamente.");
        if (btn) { btn.disabled = false; btn.textContent = "Confirmar pedido →"; }
        return;
      }
      throw new Error(data?.error || "Erro ao criar pedido");
    }

    order = data.order;
    orderNum = order.orderNum;
    // Garante que itens da API também têm prodId (para desconto de estoque)
    if (order.itens) {
      order.itens = order.itens.map((item, idx) => ({
        ...item,
        prodId: item.prodId || payload.items[idx]?.prodId || null
      }));
    }
  } catch(apiErr) {
    console.error("Falha ao criar pedido via API:", apiErr);
    showToast("Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.");
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar pedido →"; }
    return;
  }

  const total = order.total;

  // ── Notificações e auditoria ─────────────────────────────────────────
  // Obs: o uso do cupom já é incrementado no servidor, dentro da mesma
  // transação que cria o pedido (ver api/create-order.js) — não repetir
  // aqui no client evita contar o mesmo pedido duas vezes.
  sendOrderNotifications(order).catch(e => console.warn("Notify error:", e));
  addAuditLog(orderNum, `Novo pedido #${orderNum} — ${client.nome||"cliente"} — R$ ${total.toFixed(2)} — ${payLabel(selectedPay)}`, "pedido");

  // Update UI
  currentStep = 3;
  renderStepBar(3);
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("step-3").classList.add("active");

  buildReceipt(order, orderNum);

  logClientOrderAudit(client, order);

  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const addr = enderecoIdx === "2" ? (cfg.addr2 || cfg.addr1 || "nosso endereço") : (cfg.addr1 || "nosso endereço");
  const saboresStr = items.map(i => {
    let s = `• ${i.qty}× ${i.prod.nome}`;
    if (i.prod.sabores?.length) s += ` (${i.prod.sabores.join(", ")})`;
    return s;
  }).join("\n");
  const tipoPed = isPE ? "🛒 Pronta Entrega" : "📅 Encomenda";
  const dataExibir = isPE ? "Hoje" : new Date(order.dataRetirada+"T12:00:00").toLocaleDateString("pt-BR");
  const wppMsg = encodeURIComponent(
    `Olá Panillo! Acabei de fazer um pedido:\n\n${saboresStr}\n\nTotal: R$ ${total.toFixed(2)}\nTipo: ${tipoPed}\nPagamento: ${selectedPay}\nRetirada: ${dataExibir}\nLocal: ${addr}\nPedido: #${orderNum}`
  );
  document.getElementById("success-wpp-btn").onclick = () => window.open(`https://wa.me/${WPP_NUMBER}?text=${wppMsg}`,"_blank");
  cart = {};
  updateCartUI();
  document.querySelectorAll("[id^='qty-']").forEach(el => el.textContent = 0);
  document.querySelectorAll("[id^='pe-qty-']").forEach(el => el.textContent = 0);
  // Nota: loadOrders() foi removido daqui — é uma função do painel admin
  // (atualiza badge/dashboard que não existem na loja pública) e já
  // falhava silenciosamente neste contexto antes desta alteração.
}

function logClientOrderAudit(client, order) {
  // NOTA: a atualização do documento em "clients" (nome/favorito/pedidos/
  // totalGasto/lastOrderAt) já acontece no servidor, dentro da mesma
  // transação que cria o pedido (ver api/create-order.js). Escrever de
  // novo aqui, direto do navegador, duplicava a contagem de pedidos e o
  // total gasto de cada cliente a cada compra — e como a escrita pública
  // em "clients" não valida tipos/valores nas regras do Firestore, também
  // permitia que qualquer pessoa forjasse esses campos via devtools sem
  // nem passar por um pedido real. Por isso este passo ficou só com o
  // log de auditoria (local, não altera o documento do cliente).
  if (!client || !client.nome || !client.wpp) return;
  const wppNorm = String(client.wpp).replace(/\D/g,"");
  if (!wppNorm) return;
  try {
    addAuditLog(wppNorm, `Pedido registrado para ${client.nome} — total R$ ${Number(order.total).toFixed(2)}`, "cliente");
  } catch(e) {
    console.warn("logClientOrderAudit error:", e);
  }
}

function selectPay(type, el) {
  selectedPay = type;
  document.querySelectorAll(".pay-card").forEach(c => c.classList.remove("selected"));
  el.classList.add("selected");
  document.getElementById("pix-details").classList.add("hidden");
  document.getElementById("card-details").classList.add("hidden");
  if (type === "pix") {
    // Atualiza chave Pix dinamicamente
    const pixEl = document.getElementById("checkout-pix-key-display");
    if (pixEl) pixEl.textContent = PIX_KEY || "—";
    document.getElementById("pix-details").classList.remove("hidden");
  } else {
    document.getElementById("card-details").classList.remove("hidden");
  }
}

