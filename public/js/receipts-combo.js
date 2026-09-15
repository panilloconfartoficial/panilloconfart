// ─── PIX COPY ──────────────────────────────────────────
function copyPix() {
  // window._pixPayload é preenchido por buildReceipt() com o payload EMV
  // que já inclui o valor exato do pedido. Fallback para a chave estática.
  const payload = window._pixPayload || PIX_KEY || "panilloconfart@gmail.com";
  navigator.clipboard.writeText(payload)
    .then(() => showToast("Pix Cópia e Cola copiado! Cole no app do seu banco."))
    .catch(() => { prompt("Copie o código Pix Cópia e Cola:", payload); });
}

// ─── NOTIFY CLIENT (WhatsApp) ──────────────────────────
function notifyClient(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !order.cliente?.wpp) return;
  const cfg   = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const addr  = cfg.addr1 || "nosso endereço";
  const nome  = order.cliente.nome?.split(" ")[0] || "cliente";
  const itens = (order.itens||[]).map(i => `• ${i.qty}× ${i.nome}`).join("\n");
  const msg   = encodeURIComponent(
    `Olá ${nome}! 🍪\n\nSeu pedido da *Panillo* está pronto para retirada!\n\n${itens}\n\n📍 Retire em: ${addr}\n\nQualquer dúvida é só falar. Obrigada! 💛`
  );
  window.open(`https://wa.me/55${order.cliente.wpp.replace(/\D/g,"")}?text=${msg}`, "_blank");
}

// ─── GERADOR PIX CÓPIA E COLA (BR Code EMV) ───────────────────────────
// Gera o payload padrão Pix (BACEN) com valor embutido.
// Não depende de API externa — tudo calculado localmente.
function gerarPixEMV(chave, valor, nomeBeneficiario, cidade, txid) {
  // Helper: campo EMV = ID(2) + tamanho(2) + valor
  const f = (id, v) => { const s = String(v); return id + String(s.length).padStart(2,"0") + s; };

  // Remove acentos e caracteres inválidos do nome e cidade
  const norm = str => String(str||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();

  const nome = norm(nomeBeneficiario||"PANILLO").substring(0,25);
  const cid  = norm(cidade||"FORTALEZA").substring(0,15);
  const txSafe = String(txid||"***").replace(/[^a-zA-Z0-9]/g,"").substring(0,25) || "***";
  const val  = parseFloat(valor||0).toFixed(2);

  // Campo 26: Merchant Account Information (Pix)
  const mai = f("00","br.gov.bcb.pix") + f("01", chave);
  // Campo 62: Additional Data (referência do pedido)
  const addt = f("05", txSafe);

  // Monta payload sem o CRC (terminando em "6304")
  let p = f("00","01")       // Payload Format Indicator
        + f("26", mai)        // Merchant Account Info
        + f("52","0000")      // MCC (não aplicável = 0000)
        + f("53","986")       // Moeda BRL
        + (parseFloat(valor||0) > 0 ? f("54", val) : "")  // Valor
        + f("58","BR")        // País
        + f("59", nome)       // Nome do beneficiário
        + f("60", cid)        // Cidade
        + f("62", addt)       // Dados adicionais
        + "6304";             // CRC placeholder

  // CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF)
  let crc = 0xFFFF;
  for (let i = 0; i < p.length; i++) {
    crc ^= p.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return p + crc.toString(16).toUpperCase().padStart(4,"0");
}

// ─── RECIBO COMPLETO (step 3) ──────────────────────────
function buildReceipt(order, orderNum) {
  const numEl = document.getElementById("success-order-num");
  if (numEl) numEl.textContent = `Pedido #${orderNum}`;

  const receiptEl = document.getElementById("success-receipt");
  if (!receiptEl) return;

  const itens = (order.itens||[]);
  const total = order.total || 0;
  const cfg   = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const addr  = order.enderecoIdx === "2" ? (cfg.addr2 || cfg.addr1 || "—") : (cfg.addr1 || "—");

  receiptEl.innerHTML = `
    <div style="font-size:13px;font-weight:500;color:var(--teal-dark);margin-bottom:10px;padding-bottom:8px;border-bottom:0.5px solid var(--border);">
      Resumo do pedido
    </div>
    ${itens.map(i => `
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
        <span style="color:var(--text-mid);">${i.qty}× ${i.nome}${i.sabores ? ` <span style="font-size:11px;color:var(--muted);">(${i.sabores.join(", ")})</span>` : ""}</span>
        <span style="font-weight:500;">R$ ${(i.qty * i.preco).toFixed(2).replace(".",",")}</span>
      </div>`).join("")}
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:500;color:var(--teal-dark);padding-top:10px;border-top:1px solid var(--border);margin-top:6px;">
      <span>Total</span><span>R$ ${total.toFixed(2).replace(".",",")}</span>
    </div>
    <div style="margin-top:12px;padding-top:10px;border-top:0.5px solid var(--border);font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
      <div>📅 Retirada: <strong>${new Date(order.dataRetirada+"T12:00").toLocaleDateString("pt-BR")}</strong> ${order.periodo ? "· "+order.periodo : ""}</div>
      <div>📍 Local: <strong>${addr}</strong></div>
      <div>💳 Pagamento: <strong>${{pix:"Pix",credito:"Cartão de crédito",debito:"Cartão de débito",dinheiro:"Dinheiro",fiado:"Fiado"}[order.pagamento] || order.pagamento}</strong></div>
    </div>`;

  // Pix box — gera Pix Cópia e Cola com o valor exato do pedido
  const pixBox = document.getElementById("success-pix-box");
  if (pixBox) {
    if (order.pagamento === "pix") {
      pixBox.classList.remove("hidden");
      const chave = PIX_KEY || "panilloconfart@gmail.com";
      // Gera o payload EMV com valor, nome e número do pedido como txid
      const emv = gerarPixEMV(chave, total, "Panillo", "Fortaleza", "Ped" + orderNum);
      window._pixPayload = emv; // armazena para copyPix()

      const labelEl = document.getElementById("success-pix-label");
      if (labelEl) labelEl.textContent = "Pix Cópia e Cola (valor já incluído):";

      const pixKeyEl = document.getElementById("success-pix-key");
      if (pixKeyEl) {
        // Exibe os primeiros 40 chars + "..." para não transbordar o layout
        pixKeyEl.textContent = emv.length > 44 ? emv.substring(0,44) + "…" : emv;
        pixKeyEl.title = emv; // full value on hover
        pixKeyEl.style.cssText = "font-size:11px;font-family:monospace;word-break:break-all;color:var(--teal-dark);margin-bottom:8px;cursor:default;";
      }
      const copyBtn = document.getElementById("pix-copy-btn");
      if (copyBtn) copyBtn.textContent = "📋 Copiar Pix Cópia e Cola";
    } else {
      pixBox.classList.add("hidden");
    }
  }
}

// ─── COMBO LOGIC ───────────────────────────────────────
let currentCombo = null;

function openComboModal(prodId) {
  const prod = allProducts.find(p => p.id === prodId);
  if (!prod) return;
  currentCombo = { prod, slots: [] };

  document.getElementById("combo-modal-title").textContent = "🎁 " + prod.nome;
  const nCookies  = parseInt(prod.comboCookies  || 0);
  const nBrownies = parseInt(prod.comboBrownies || 0);
  const extras    = prod.comboExtras || [];

  document.getElementById("combo-desc-label").textContent =
    `${nCookies > 0 ? nCookies + " cookie(s)" : ""}${nCookies > 0 && nBrownies > 0 ? " + " : ""}${nBrownies > 0 ? nBrownies + " brownie(s)" : ""}`;
  document.getElementById("combo-extras-label").textContent =
    extras.length ? "Inclui: " + extras.join(", ") : "";

  // Cookie slots
  const cookieProds = allProducts.filter(p => p.categoria === "cookie" && p.ativo !== false);
  const cookieSection = document.getElementById("combo-cookies-section");
  const cookieSlots   = document.getElementById("combo-cookie-slots");
  cookieSection.style.display = nCookies > 0 ? "block" : "none";
  cookieSlots.innerHTML = "";
  for (let i = 0; i < nCookies; i++) {
    cookieSlots.innerHTML += `
      <div class="fg" style="margin-bottom:8px;">
        <label class="fl">Cookie ${i+1}</label>
        <select class="fi" id="combo-cookie-${i}" style="padding:9px 12px;">
          ${cookieProds.map(p => `<option value="${p.nome}">${p.nome}</option>`).join("")}
        </select>
      </div>`;
  }

  // Brownie slots
  const brownieProds = allProducts.filter(p => p.categoria === "brownie" && p.ativo !== false);
  const brownieSection = document.getElementById("combo-brownies-section");
  const brownieSlots   = document.getElementById("combo-brownie-slots");
  brownieSection.style.display = nBrownies > 0 ? "block" : "none";
  brownieSlots.innerHTML = "";
  for (let i = 0; i < nBrownies; i++) {
    brownieSlots.innerHTML += `
      <div class="fg" style="margin-bottom:8px;">
        <label class="fl">Brownie ${i+1}</label>
        <select class="fi" id="combo-brownie-${i}" style="padding:9px 12px;">
          ${brownieProds.map(p => `<option value="${p.nome}">${p.nome}</option>`).join("")}
        </select>
      </div>`;
  }

  document.getElementById("combo-obs").value = "";
  document.getElementById("combo-modal").classList.add("open");
}

function closeComboModal() {
  document.getElementById("combo-modal").classList.remove("open");
  currentCombo = null;
}

function addComboToCart() {
  if (!currentCombo) return;
  const prod = currentCombo.prod;
  const nCookies  = parseInt(prod.comboCookies  || 0);
  const nBrownies = parseInt(prod.comboBrownies || 0);

  const sabores = [];
  for (let i = 0; i < nCookies; i++) {
    const sel = document.getElementById(`combo-cookie-${i}`);
    if (sel) sabores.push(sel.value);
  }
  for (let i = 0; i < nBrownies; i++) {
    const sel = document.getElementById(`combo-brownie-${i}`);
    if (sel) sabores.push(sel.value);
  }
  const obs = document.getElementById("combo-obs").value.trim();

  // Cada combo entra no carrinho como 1 unidade com sabores salvos
  const key = prod.id + "_combo_" + Date.now();
  cart[key] = { prod: { ...prod, nome: prod.nome, sabores, obs }, qty: 1 };
  closeComboModal();
  updateCartUI();
  showToast("Combo adicionado ao carrinho!");
}

// ─── PRODUTO MODAL: COMBO FIELDS TOGGLE ────────────────
function toggleComboFields(cat) {
  const comboFields = document.getElementById("combo-fields");
  const ingsSection = document.getElementById("pm-ings")?.closest("div");
  if (!comboFields) return;
  if (cat === "combo") {
    comboFields.classList.remove("hidden");
  } else {
    comboFields.classList.add("hidden");
  }
}

function addExtraRow(data) {
  const container = document.getElementById("pm-extras");
  if (!container) return;
  const id = "extra-" + Date.now();
  const row = document.createElement("div");
  row.id = id;
  row.style.cssText = "display:flex;gap:8px;margin-bottom:6px;align-items:center;";
  row.innerHTML = `
    <input class="fi" type="text" placeholder="Ex: Embalagem kraft" style="flex:2;padding:8px 10px;font-size:12px;" value="${data||""}">
    <button onclick="document.getElementById('${id}').remove();" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;flex-shrink:0;">×</button>`;
  container.appendChild(row);
}

// ─── MOBILE MENUS ──────────────────────────────────────
function toggleStoreMobileMenu() {
  const menu    = document.getElementById("store-mob-menu");
  const overlay = document.getElementById("store-mob-overlay");
  const burger  = document.getElementById("store-hamburger");
  const isOpen  = menu.style.right === "0px";
  menu.style.right    = isOpen ? "-260px" : "0px";
  overlay.classList.toggle("open", !isOpen);
  burger.classList.toggle("open", !isOpen);
}

// ─── MOBILE BOTTOM NAV ─────────────────────────────────
function mbnGo(sec, el) {
  // Map section to sidebar item for active state
  const sidebarMap = {
    'dash':     document.querySelector('.sb-item:nth-child(1)'),
    'pedidos':  document.querySelector('[onclick*="pedidos"]'),
    'clientes': document.querySelector('[onclick*="clientes"]'),
    'estoque':  document.querySelector('[onclick*="estoque"]')
  };
  showAdminSection(sec, sidebarMap[sec]);
  // Update bottom nav active state
  document.querySelectorAll('.mbn-item').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function syncBottomNav(sec) {
  const map = { dash:'mbn-dash', pedidos:'mbn-pedidos', clientes:'mbn-clientes', estoque:'mbn-estoque' };
  if (map[sec]) {
    document.querySelectorAll('.mbn-item').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(map[sec]);
    if (el) el.classList.add('active');
  }
}

function showMobBottomNav(show) {
  const nav = document.getElementById('mob-bottom-nav');
  if (!nav) return;
  // Só exibe em mobile (≤900px)
  if (show && window.innerWidth <= 900) {
    nav.style.display = 'flex';
  } else {
    nav.style.display = 'none';
  }
}

function updateMbnBadge(count) {
  const b = document.getElementById('mbn-badge');
  if (b) { b.textContent = count; b.style.display = count > 0 ? 'flex' : 'none'; }
}

function toggleAdminSidebar() {
  const sidebar = document.querySelector(".admin-sidebar");
  const overlay = document.getElementById("admin-mob-overlay");
  if (window.innerWidth > 900) {
    // Desktop: colapsa/expande sidebar
    sidebar.classList.toggle("collapsed");
  } else {
    // Mobile: slide in/out com overlay
    const isOpen = sidebar.classList.contains("open");
    sidebar.classList.toggle("open");
    overlay.classList.toggle("open", !isOpen);
  }
}

// Fecha sidebar ao clicar em um item (mobile)
