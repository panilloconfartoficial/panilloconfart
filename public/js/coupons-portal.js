// ─── COUPONS ───────────────────────────────────────────
let activeCoupon = null;

// Renderiza a lista de cupons buscando sempre do Firestore (fonte de verdade).
// Atualiza também o localStorage local para manter sincronia.
async function renderCouponsList() {
  const el = document.getElementById("coupons-list");
  if (!el) return;
  el.innerHTML = `<div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Carregando cupons…</div>`;

  let coupons = [];
  try {
    if (db && FB) {
      const docs = await fbGet("appConfig");
      if (docs.length > 0) {
        coupons = docs[0].coupons || [];
        // Mantém localStorage em sincronia com o Firestore
        const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
        cfg.coupons = coupons;
        localStorage.setItem("panillo-config", JSON.stringify(cfg));
      } else {
        // Firestore sem documento ainda — usa localStorage como fallback
        coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
      }
    } else {
      coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
    }
  } catch(e) {
    coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
  }

  if (coupons.length === 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Nenhum cupom cadastrado</div>`;
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  el.innerHTML = coupons.map((c,i) => {
    const usos = c.usos || 0;
    const expirado = c.validade && c.validade < today;
    const esgotado = c.maxUsos && usos >= c.maxUsos;
    const inativo = expirado || esgotado;
    let detalhes = `${c.pct}% de desconto`;
    if (c.validade) detalhes += ` · válido até ${c.validade.split("-").reverse().join("/")}`;
    if (c.maxUsos)  detalhes += ` · ${usos}/${c.maxUsos} usos`;
    else if (usos)  detalhes += ` · ${usos} uso(s)`;
    if (inativo) detalhes += ` · <strong style="color:#993C1D;">${expirado ? "expirado" : "esgotado"}</strong>`;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--cream);border-radius:8px;margin-bottom:6px;${inativo?'opacity:.6;':''}">
      <div><strong style="font-size:13px;">${c.code}</strong><span style="color:var(--muted);font-size:12px;margin-left:8px;">${detalhes}</span></div>
      <button onclick="removeCoupon(${i})" style="background:none;border:none;color:#993C1D;cursor:pointer;font-size:16px;line-height:1;">×</button>
    </div>`;
  }).join("");
}

async function addCoupon() {
  const code = (document.getElementById("new-coupon-code")?.value || "").trim().toUpperCase();
  const pct  = parseInt(document.getElementById("new-coupon-pct")?.value || "0");
  const validade = document.getElementById("new-coupon-validade")?.value || null;
  const maxUsosRaw = document.getElementById("new-coupon-maxusos")?.value || "";
  const maxUsos = maxUsosRaw ? parseInt(maxUsosRaw) : null;
  if (!code || !pct || pct < 1 || pct > 100) { showToast("Preencha código e % válidos!"); return; }
  if (maxUsosRaw && (!maxUsos || maxUsos < 1)) { showToast("Limite de usos inválido!"); return; }

  // CRÍTICO: busca a lista ATUAL do Firestore antes de adicionar.
  // Sem isso, dispositivos diferentes sobrescrevem a lista um do outro
  // porque cada um só conhece o próprio localStorage.
  let coupons = [];
  let firestoreDocId = null;
  try {
    if (db && FB) {
      const docs = await fbGet("appConfig");
      if (docs.length > 0) {
        coupons = docs[0].coupons || [];
        firestoreDocId = docs[0].id;
      }
    } else {
      // Sem Firebase: usa localStorage como fallback
      coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
    }
  } catch(e) {
    coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
  }

  if (coupons.find(c => c.code === code)) { showToast("Cupom já existe!"); return; }
  coupons.push({ code, pct, validade: validade || null, maxUsos: maxUsos || null, usos: 0 });

  // Salva lista completa (de todos os dispositivos + o novo) no Firestore
  try {
    if (db && FB) {
      if (firestoreDocId) await fbUpdate("appConfig", firestoreDocId, { coupons });
      else await fbAdd("appConfig", { coupons });
    }
  } catch(e) { console.warn("Cupom: Firebase indisponível, salvando só local.", e); }

  // Atualiza localStorage local para manter sincronia
  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  cfg.coupons = coupons;
  localStorage.setItem("panillo-config", JSON.stringify(cfg));

  document.getElementById("new-coupon-code").value = "";
  document.getElementById("new-coupon-pct").value  = "";
  document.getElementById("new-coupon-validade").value = "";
  document.getElementById("new-coupon-maxusos").value  = "";
  renderCouponsList();
  showToast(`Cupom ${code} criado!`);
}

async function removeCoupon(idx) {
  // Busca lista atual do Firestore para não perder cupons criados em outros dispositivos
  let coupons = [];
  let firestoreDocId = null;
  try {
    if (db && FB) {
      const docs = await fbGet("appConfig");
      if (docs.length > 0) { coupons = docs[0].coupons || []; firestoreDocId = docs[0].id; }
    }
  } catch(e) {}
  if (!coupons.length) {
    coupons = JSON.parse(localStorage.getItem("panillo-config") || "{}").coupons || [];
  }

  coupons = coupons.filter((_,i) => i !== idx);

  try {
    if (db && FB && firestoreDocId) await fbUpdate("appConfig", firestoreDocId, { coupons });
  } catch(e) { console.warn("Cupom remove: Firebase indisponível.", e); }

  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  cfg.coupons = coupons;
  localStorage.setItem("panillo-config", JSON.stringify(cfg));
  renderCouponsList();
  showToast("Cupom removido!");
}

async function applyCoupon() {
  const code = (document.getElementById("coupon-input")?.value || "").trim().toUpperCase();
  if (!code) return;
  const wrap    = document.getElementById("coupon-badge-wrap");
  const discRow = document.getElementById("discount-row");
  if (wrap) wrap.innerHTML = `<span style="font-size:12px;color:var(--muted);">Verificando cupom...</span>`;

  // ── Validação local (usa cupons do appConfig em cache) ────────────────
  // O listener de config já mantém os cupons atualizados em localStorage.
  const cfg     = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const coupons = cfg.coupons || [];
  const coupon  = coupons.find(c => (c.code || "").toUpperCase() === code);

  if (!coupon) {
    activeCoupon = null;
    if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:#993C1D;margin-bottom:6px;">Cupom inválido ou não encontrado</div>`;
    if (discRow) discRow.style.display = "none";
    updateCartUI();
    return;
  }

  // Verificar validade
  if (coupon.validade) {
    // Suporta YYYY-MM-DD (date input) e DD/MM/YYYY (legado)
    let exp;
    if (coupon.validade.includes("-")) {
      exp = new Date(coupon.validade + "T23:59:59");
    } else {
      const [dd, mm, yy] = coupon.validade.split("/");
      exp = new Date(`${yy}-${mm}-${dd}T23:59:59`);
    }
    if (exp < new Date()) {
      activeCoupon = null;
      if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:#993C1D;margin-bottom:6px;">Cupom expirado</div>`;
      if (discRow) discRow.style.display = "none";
      updateCartUI();
      return;
    }
  }

  // Verificar limite de usos
  const maxUsos = parseInt(coupon.maxUsos) || 0;
  const usos    = parseInt(coupon.usos)    || 0;
  if (maxUsos > 0 && usos >= maxUsos) {
    activeCoupon = null;
    if (wrap) wrap.innerHTML = `<div style="font-size:12px;color:#993C1D;margin-bottom:6px;">Cupom atingiu o limite de usos</div>`;
    if (discRow) discRow.style.display = "none";
    updateCartUI();
    return;
  }

  // ✅ Cupom válido
  const pct = parseFloat(coupon.pct) || 0;
  activeCoupon = { code, pct };
  if (wrap) wrap.innerHTML = `<div class="coupon-badge">✓ ${code} — ${pct}% de desconto</div>`;
  updateCartUI();
  showToast(`Cupom aplicado: ${pct}% de desconto!`);
}

// ─── CUSTOMER PORTAL ───────────────────────────────────
let _portalWpp = null;
let _portalOrders = [];

function openPortal(tab) {
  document.getElementById("portal-modal").classList.add("open");
  switchPortalTab(tab || "pedidos", document.querySelector(".portal-tab"));
  // Pre-fill wpp if client is logged in
  const saved = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  if (saved.wpp) {
    const inp = document.getElementById("portal-wpp");
    if (inp && !inp.value) { inp.value = saved.wpp; portalLoadOrders(); }
  }
}

function closePortal() {
  document.getElementById("portal-modal").classList.remove("open");
}

function switchPortalTab(tab, el) {
  ["pedidos","historico","suporte"].forEach(t => {
    const el2 = document.getElementById("portal-tab-" + t);
    if (el2) el2.style.display = t === tab ? "" : "none";
  });
  document.querySelectorAll(".portal-tab").forEach((b,i) => {
    b.classList.toggle("active", ["pedidos","historico","suporte"][i] === tab);
  });
  document.getElementById("portal-title").textContent =
    tab === "pedidos" ? "🛍️ Meus Pedidos" :
    tab === "historico" ? "📋 Histórico de Pedidos" : "💬 Suporte";
}

async function portalLoadOrders() {
  const raw = (document.getElementById("portal-wpp")?.value || "").replace(/\D/g,"");
  if (raw.length < 8) { showToast("Digite um número válido!"); return; }
  const btn = document.getElementById("portal-search-btn");
  btn.textContent = "…"; btn.disabled = true;
  _portalWpp = raw;

  // Tenta variantes com e sem DDI 55 para máxima compatibilidade
  const variants = [raw, raw.startsWith("55") ? raw.slice(2) : "55" + raw];
  let orders = [];

  try {
    // Estratégia 1: endpoint server-side /api/client-orders (usa Admin SDK,
    // contorna bloqueio público do Firestore nas regras de segurança)
    let apiOk = false;
    for (const v of variants) {
      try {
        const resp = await fetch(`/api/client-orders?wpp=${encodeURIComponent(v)}`);
        if (resp.status === 404) break; // endpoint não existe, vai para fallback
        if (resp.ok) {
          const data = await resp.json();
          if (data.orders?.length) orders = [...orders, ...data.orders];
          apiOk = true;
        }
      } catch {}
    }

    // Estratégia 2 (fallback): query direta no Firestore — pode funcionar
    // se as regras de segurança permitirem leitura condicional por wpp.
    if (!apiOk && db && FB) {
      for (const v of variants) {
        try {
          const snap = await FB.getDocs(
            FB.query(FB.collection(db,"orders"), FB.where("cliente.wpp","==",v))
          );
          snap.forEach(d => orders.push({ id:d.id, ...d.data() }));
        } catch {}
      }
    }

    // Deduplicar por id (mesma ordem pode aparecer via variantes diferentes)
    const seen = new Set();
    orders = orders.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });

    _portalOrders = orders.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
    renderPortalOrders();
    renderPortalHistory();
  } catch(e) {
    document.getElementById("portal-orders-result").innerHTML =
      `<div style="color:#993C1D;font-size:13px;">Erro ao buscar pedidos. Tente novamente.</div>`;
  }
  btn.textContent = "Buscar"; btn.disabled = false;
}

function _statusSteps(status) {
  const steps = ["pendente","confirmado","pronto","entregue"];
  const labels = ["Recebido","Confirmado","Pronto","Entregue"];
  const icons  = ["📥","✅","📦","🎉"];
  const idx    = steps.indexOf(status);
  return steps.map((s,i) => ({
    label: labels[i], icon: icons[i],
    state: i < idx ? "done" : i === idx ? "active" : ""
  }));
}

function renderPortalOrders() {
  const el = document.getElementById("portal-orders-result");
  // Show only active (non-delivered, non-cancelled)
  const active = _portalOrders.filter(o => !["entregue","cancelado"].includes(o.status));
  if (active.length === 0 && _portalOrders.length === 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px 0;">Nenhum pedido encontrado para este número.</div>`;
    return;
  }
  if (active.length === 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px 0;">Nenhum pedido ativo. Veja o histórico completo na aba "Histórico".</div>`;
    return;
  }
  el.innerHTML = active.map(o => {
    const steps = _statusSteps(o.status);
    const trackHtml = `<div class="portal-status-track">
      ${steps.map(s => `<div class="pst-step">
        <div class="pst-dot ${s.state}">${s.state === "done" ? "✓" : s.icon}</div>
        <div class="pst-label">${s.label}</div>
      </div>`).join("")}
    </div>`;
    const dateStr = o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : "—";
    return `<div class="portal-order-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--teal-dark);">#${o.numero||o.id.slice(-6)}</div>
          <div style="font-size:12px;color:var(--muted);">Retirada: ${dateStr} · ${o.periodo||""}</div>
        </div>
        <span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
      </div>
      <div style="font-size:12px;color:var(--text-mid);margin-bottom:4px;">${(o.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ")}</div>
      <div style="font-size:13px;font-weight:500;color:var(--teal-dark);">R$ ${Number(o.total||0).toFixed(2).replace(".",",")}</div>
      ${o.status !== "cancelado" ? trackHtml : ""}
      ${o.status === "cancelado" ? `<div style="color:#993C1D;font-size:12px;margin-top:6px;">❌ Pedido cancelado</div>` : ""}
    </div>`;
  }).join("");
}

function renderPortalHistory() {
  const el = document.getElementById("portal-hist-result");
  if (!el) return;
  if (_portalOrders.length === 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;">Nenhum pedido encontrado.</div>`; return;
  }
  const total = _portalOrders.reduce((s,o)=>s+(o.total||0),0);
  el.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">
      <div style="background:var(--cream);border-radius:12px;padding:12px 16px;flex:1;min-width:100px;">
        <div style="font-size:11px;color:var(--muted);">Total de pedidos</div>
        <div style="font-size:20px;font-weight:600;color:var(--teal-dark);">${_portalOrders.length}</div>
      </div>
      <div style="background:var(--cream);border-radius:12px;padding:12px 16px;flex:1;min-width:100px;">
        <div style="font-size:11px;color:var(--muted);">Total gasto</div>
        <div style="font-size:20px;font-weight:600;color:var(--teal-dark);">R$ ${total.toFixed(2).replace(".",",")}</div>
      </div>
    </div>
  ` + _portalOrders.map(o => {
    const dateStr = o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : "—";
    return `<div class="portal-order-card" style="opacity:${o.status==='cancelado'?.6:1}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-size:12px;color:var(--muted);">#${o.numero||o.id.slice(-6)} · ${dateStr}</div>
        <span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
      </div>
      <div style="font-size:12px;color:var(--text-mid);margin-bottom:4px;">${(o.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ")}</div>
      <div style="font-size:13px;font-weight:500;color:var(--teal-dark);">R$ ${Number(o.total||0).toFixed(2).replace(".",",")}
        ${o.descontoAplicado ? `<span style="color:#8B4513;font-size:11px;"> (-${o.descontoAplicado}% desconto)</span>` : ""}
      </div>
    </div>`;
  }).join("");
}

// ─── SUPPORT CHAT ───────────────────────────────────────
const _supportHistory = [];

function supportQuick(q) {
  document.getElementById("support-input").value = q;
  sendSupport();
}

async function sendSupport() {
  const input = document.getElementById("support-input");
  const q = input.value.trim();
  if (!q) return;
  input.value = "";
  const histEl = document.getElementById("support-chat-history");
  histEl.innerHTML += `<div class="support-bubble user"><strong>Você:</strong> ${q}</div>`;
  histEl.scrollTop = histEl.scrollHeight;
  _supportHistory.push({ role:"user", content: q });
  if (_supportHistory.length > 12) _supportHistory.splice(0, 2); // max 6 trocas

  const cfg = JSON.parse(localStorage.getItem("panillo-config")||"{}");
  const addr = cfg.addr1 || "configure no painel admin";
  const pix  = cfg.pix   || "configure no painel admin";
  const periods = (cfg.periods || ["Manhã (9h–12h)","Tarde (13h–18h)"]).join(", ");
  const systemPrompt = `Você é a assistente virtual da Panillo, confeitaria artesanal de cookies e brownies em Fortaleza, CE.
Informações da loja:
- Endereço de retirada: ${addr}
- Horários de retirada: ${periods}
- Pagamento: Pix (${pix}), Crédito e Débito na retirada
- Não fazemos entregas, apenas retirada na loja
- Prazo para encomendas: mínimo 2 dias de antecedência
- Produtos: cookies e brownies artesanais feitos sob encomenda
Responda de forma simpática, breve e em português. Seja direta. Máximo 3 frases.`;

  const typingId = "support-typing-" + Date.now();
  histEl.innerHTML += `<div class="support-bubble bot" id="${typingId}">Digitando...</div>`;
  histEl.scrollTop = histEl.scrollHeight;

  try {
    const answer = await callClaudeAPI(
      _supportHistory.map(m=>`${m.role==='user'?'Cliente':'Assistente'}: ${m.content}`).join("\n") + `\n\nSistema: ${systemPrompt}`, 120
    );
    document.getElementById(typingId)?.remove();
    _supportHistory.push({ role:"assistant", content: answer });
    histEl.innerHTML += `<div class="support-bubble bot"><strong>Panillo 🍪</strong><br>${answer}</div>`;
  } catch {
    document.getElementById(typingId)?.remove();
    histEl.innerHTML += `<div class="support-bubble bot"><strong>Panillo 🍪</strong><br>Desculpe, não consegui responder agora. Fale com a gente pelo WhatsApp! 💛</div>`;
  }
  histEl.scrollTop = histEl.scrollHeight;
}

// ─── CLIENT HISTORY MODAL (admin) ──────────────────────
async function showClientHist(wpp, nome) {
  document.getElementById("client-hist-name").textContent = nome;
  document.getElementById("client-hist-sub").textContent  = "WhatsApp: " + wpp;
  document.getElementById("client-hist-modal").classList.add("open");
  const body = document.getElementById("client-hist-body");
  body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);">Carregando...</div>`;

  try {
    const wppNorm = wpp.replace(/\D/g,"");
    const variants = [wppNorm, wppNorm.startsWith("55")?wppNorm.slice(2):"55"+wppNorm];
    let orders = [];
    for (const v of variants) {
      const snap = await FB.getDocs(
        FB.query(FB.collection(db,"orders"), FB.where("cliente.wpp","==",v))
      );
      snap.forEach(d => orders.push({ id:d.id, ...d.data() }));
    }
    orders.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const total = orders.reduce((s,o)=>s+(o.total||0),0);
    body.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="background:var(--cream);border-radius:10px;padding:10px 14px;flex:1;">
          <div style="font-size:11px;color:var(--muted);">Pedidos</div>
          <div style="font-size:22px;font-weight:600;color:var(--teal-dark);">${orders.length}</div>
        </div>
        <div style="background:var(--cream);border-radius:10px;padding:10px 14px;flex:1;">
          <div style="font-size:11px;color:var(--muted);">Total gasto</div>
          <div style="font-size:22px;font-weight:600;color:var(--teal-dark);">R$ ${total.toFixed(2).replace(".",",")}</div>
        </div>
      </div>` +
      (orders.length === 0
        ? `<div style="color:var(--muted);font-size:13px;">Nenhum pedido encontrado</div>`
        : orders.map(o => {
            const dateStr = o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : "—";
            return `<div class="client-hist-order">
              <div class="client-hist-order-top">
                <div style="font-size:12px;color:var(--muted);">#${o.numero||o.id.slice(-6)} · ${dateStr}</div>
                <span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
              </div>
              <div style="font-size:12px;color:var(--text-mid);margin-bottom:4px;">${(o.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ")}</div>
              <div style="font-size:13px;font-weight:500;color:var(--teal-dark);">R$ ${Number(o.total||0).toFixed(2).replace(".",",")} · ${payLabel(o.pagamento)}${o.pagamentoConfirmado?' ✓':''}</div>
            </div>`;
          }).join(""));
  } catch(e) {
    body.innerHTML = `<div style="color:#993C1D;font-size:13px;padding:16px;">Erro ao carregar histórico.</div>`;
  }
}

function closeClientHist() {
  document.getElementById("client-hist-modal").classList.remove("open");
}

// ═══════════════════════════════════════════════════════
//  BIRTHDAY ALERTS — alertas progressivos de aniversário
// ═══════════════════════════════════════════════════════
let _dismissedBdays = JSON.parse(sessionStorage.getItem("dismissedBdays") || "[]");

function renderBdayAlerts(clients) {
  const wrap = document.getElementById("bday-alerts-wrap");
  if (!wrap) return;
  const today = new Date();
  const alerts = [];
  (clients || allClients).forEach(c => {
    if (!c.bday) return;
    const bd = new Date(c.bday + "T12:00");
    const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
    const diff = Math.ceil((bdThis - today) / (1000*60*60*24));
    const diffAdj = diff < 0 ? diff + 365 : diff;
    if (diffAdj <= 5) alerts.push({ c, diff: diffAdj });
  });
  alerts.sort((a,b) => a.diff - b.diff);

  const visible = alerts.filter(a => !_dismissedBdays.includes(a.c.id + "_" + today.toDateString()));
  if (!visible.length) { wrap.innerHTML = ""; return; }

  wrap.innerHTML = visible.map(({ c, diff }) => {
    const isToday = diff === 0;
    const key = c.id + "_" + today.toDateString();
    let msg, emoji;
    const nomeSafe = escHtml(c.nome||"");
    if (isToday) { emoji = "🎉"; msg = `Hoje é aniversário de <strong>${nomeSafe}</strong>! Que tal enviar uma mensagem especial?`; }
    else if (diff === 1) { emoji = "🎂"; msg = `Amanhã é aniversário de <strong>${nomeSafe}</strong>. Prepare uma surpresa!`; }
    else { emoji = "🍰"; msg = `Aniversário de <strong>${nomeSafe}</strong> em <strong>${diff} dias</strong> (${new Date(c.bday+"T12:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"long"})}).`; }
    return `<div class="bday-alert-bar${isToday?' bday-alert-today':''}" id="bday-alert-${c.id}">
      <span style="font-size:22px;">${emoji}</span>
      <span class="bday-alert-msg">${msg}</span>
      ${c.wpp ? `<button onclick="notifyBday('${escHtml(c.wpp)}','${nomeSafe}',this)" style="background:rgba(255,255,255,.15);border:none;color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">🎁 Parabenizar</button>` : ""}
      <button class="bday-alert-close" onclick="dismissBdayAlert('${c.id}')">✕</button>
    </div>`;
  }).join("");
}

function dismissBdayAlert(clientId) {
  const today = new Date().toDateString();
  const key = clientId + "_" + today;
  if (!_dismissedBdays.includes(key)) _dismissedBdays.push(key);
  sessionStorage.setItem("dismissedBdays", JSON.stringify(_dismissedBdays));
  const el = document.getElementById("bday-alert-" + clientId);
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════
//  CLIENT DETAIL + EDIT MODAL
// ═══════════════════════════════════════════════════════
let _cdClientId = null;
let _cdEditMode = false;

async function openClientDetail(clientId, editMode = false) {
  _cdClientId = clientId;
  _cdEditMode = editMode;
  const modal = document.getElementById("client-detail-modal");
  modal.classList.add("open");

  // Load client from cache or Firebase
  let c = allClients.find(x => x.id === clientId);
  if (!c) {
    try { const docs = await fbGet("clients"); allClients = docs; c = docs.find(x => x.id === clientId); } catch {}
  }
  if (!c) { showToast("Cliente não encontrado", "error"); modal.classList.remove("open"); return; }

  // Load orders for this client
  const wppNorm = (c.wpp||"").replace(/\D/g,"");
  let orders = allOrders.filter(o => (o.cliente?.wpp||"").replace(/\D/g,"") === wppNorm);
  if (!orders.length && wppNorm) {
    try {
      const snap = await FB.getDocs(FB.query(FB.collection(db,"orders"), FB.where("cliente.wpp","==",wppNorm)));
      snap.forEach(d => orders.push({ id:d.id, ...d.data() }));
    } catch {}
  }
  orders.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  // Header
  document.getElementById("cd-avatar").textContent = (c.nome||"?").substring(0,2).toUpperCase();
  document.getElementById("cd-title").textContent = c.nome || "—";
  document.getElementById("cd-subtitle").textContent = `WhatsApp: ${c.wpp||"—"} · ${orders.length} pedido(s)`;
  document.getElementById("cd-edit-btn").textContent = editMode ? "💾 Salvar" : "✏️ Editar";
  document.getElementById("cd-edit-btn").onclick = editMode ? () => cdSave(c) : () => { _cdEditMode = true; openClientDetail(clientId, true); };

  // Load fiado
  let fiadoSaldo = null;
  if (!allFiadoAccounts.length) { try { allFiadoAccounts = await fbGet("fiadoAccounts"); } catch {} }
  const fiadoAcc = allFiadoAccounts.find(a => (a.clientWpp||"").replace(/\D/g,"") === wppNorm);
  if (fiadoAcc) fiadoSaldo = Number(fiadoAcc.saldo||0);

  // Favorite product
  const prodCount = {};
  orders.forEach(o => (o.itens||[]).forEach(i => { prodCount[i.nome] = (prodCount[i.nome]||0) + i.qty; }));
  const favorito = Object.entries(prodCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || c.favorito || "—";
  const totalGasto = orders.filter(o=>!["cancelado"].includes(o.status)).reduce((s,o)=>s+Number(o.total||0),0);

  const ro = editMode ? "" : "readonly";
  const rd = editMode ? "" : "disabled";

  document.getElementById("cd-body").innerHTML = `
    <!-- KPI row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:20px;">
      <div style="background:var(--cream);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">Pedidos</div>
        <div style="font-size:22px;font-weight:700;color:var(--teal-dark);">${orders.length}</div>
      </div>
      <div style="background:var(--cream);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">Total gasto</div>
        <div style="font-size:20px;font-weight:700;color:var(--teal-dark);">R$ ${totalGasto.toFixed(2).replace(".",",")}</div>
      </div>
      <div style="background:var(--cream);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;">Favorito</div>
        <div style="font-size:12px;font-weight:600;color:var(--teal-dark);margin-top:4px;">${escHtml(favorito)}</div>
      </div>
      ${fiadoSaldo !== null ? `<div style="background:#FDF0E0;border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:#8B4513;font-weight:600;text-transform:uppercase;">Fiado</div>
        <div style="font-size:20px;font-weight:700;color:#8B4513;">R$ ${fiadoSaldo.toFixed(2).replace(".",",")}</div>
      </div>` : ""}
    </div>

    <!-- Edit fields -->
    <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;">Dados do Cliente ${editMode ? '<span style="background:#FDF0E0;color:#8B4513;padding:2px 8px;border-radius:6px;font-size:10px;">Modo edição</span>' : ''}</div>
    <div class="client-field-grid">
      <div class="client-field">
        <label>Nome completo</label>
        <input id="cd-nome" type="text" value="${escHtml(c.nome||"")}" ${ro}>
      </div>
      <div class="client-field">
        <label>WhatsApp</label>
        <input id="cd-wpp" type="text" value="${escHtml(c.wpp||"")}" ${ro}>
      </div>
      <div class="client-field">
        <label>Aniversário</label>
        <input id="cd-bday" type="date" value="${escHtml(c.bday||"")}" ${rd}>
      </div>
      <div class="client-field">
        <label>E-mail (opcional)</label>
        <input id="cd-email" type="email" value="${escHtml(c.email||"")}" ${ro}>
      </div>
      <div class="client-field">
        <label>Endereço / Bairro</label>
        <input id="cd-endereco" type="text" value="${escHtml(c.endereco||"")}" ${ro}>
      </div>
      <div class="client-field">
        <label>Produto favorito</label>
        <input id="cd-favorito" type="text" value="${escHtml(c.favorito||"")}" placeholder="${escHtml(favorito)}" ${ro}>
      </div>
    </div>
    <div class="client-field" style="margin-bottom:20px;">
      <label>Observações / Alergias / Preferências</label>
      <textarea id="cd-obs" rows="3" ${ro}>${escHtml(c.obs||"")}</textarea>
    </div>

    ${editMode ? `<div style="display:flex;gap:10px;margin-bottom:20px;">
      <button onclick="cdSave()" style="flex:1;background:var(--teal);color:#fff;border:none;padding:12px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">💾 Salvar alterações</button>
      <button onclick="openClientDetail('${clientId}',false)" style="padding:12px 18px;border:1.5px solid var(--border);background:#fff;border-radius:10px;font-size:13px;cursor:pointer;color:var(--muted);">Cancelar</button>
    </div>` : `<div style="display:flex;gap:10px;margin-bottom:20px;">
      <button onclick="openClientDetail('${clientId}',true)" style="background:var(--teal);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;">✏️ Editar dados</button>
      ${c.wpp ? `<a href="https://wa.me/55${(c.wpp).replace(/\D/g,'')}" target="_blank" style="background:#25D366;color:#fff;border:none;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:6px;"><i class="ti ti-brand-whatsapp"></i> WhatsApp</a>` : ""}
    </div>`}

    <!-- Order history -->
    <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px;border-top:1px solid var(--border);padding-top:16px;">Histórico de Pedidos</div>
    ${orders.length === 0
      ? `<div style="color:var(--muted);font-size:13px;padding:12px 0;">Nenhum pedido encontrado</div>`
      : orders.slice(0,8).map(o => {
          const dateStr = o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : "—";
          return `<div class="client-hist-order">
            <div class="client-hist-order-top">
              <div style="font-size:12px;color:var(--muted);">${dateStr} · ${payLabel(o.pagamento)}</div>
              <span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
            </div>
            <div style="font-size:12px;color:var(--text);margin-bottom:4px;">${(o.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ")}</div>
            <div style="font-size:13px;font-weight:600;color:var(--teal-dark);">R$ ${Number(o.total||0).toFixed(2).replace(".",",")}${o.pagamentoConfirmado?' <span style="color:#8B4513;font-size:11px;">✓ Pago</span>':''}</div>
          </div>`;
        }).join("")}
    ${orders.length > 8 ? `<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px;">+ ${orders.length-8} pedido(s) mais antigos</div>` : ""}
  `;
}

async function cdSave() {
  const c = allClients.find(x => x.id === _cdClientId);
  if (!c) return;
  const updates = {
    nome:      document.getElementById("cd-nome")?.value.trim() || c.nome,
    wpp:       document.getElementById("cd-wpp")?.value.trim() || c.wpp,
    bday:      document.getElementById("cd-bday")?.value || c.bday || "",
    email:     document.getElementById("cd-email")?.value.trim() || "",
    endereco:  document.getElementById("cd-endereco")?.value.trim() || "",
    favorito:  document.getElementById("cd-favorito")?.value.trim() || c.favorito || "",
    obs:       document.getElementById("cd-obs")?.value.trim() || "",
  };
  try {
    await fbUpdate("clients", _cdClientId, updates);
    allClients = allClients.map(x => x.id === _cdClientId ? { ...x, ...updates } : x);
    showToast("Dados do cliente salvos!", "success");
    openClientDetail(_cdClientId, false); // switch back to view mode
    renderClients();
  } catch(e) {
    console.error(e);
    showToast("Erro ao salvar. Tente novamente.", "error");
  }
}

function closeClientDetail() {
  document.getElementById("client-detail-modal").classList.remove("open");
  _cdClientId = null;
}

// ─── Novo Cliente (cadastro manual pelo admin) ──────────────────────────
function openNewClientModal() {
  ["nc-nome", "nc-wpp", "nc-bday", "nc-email", "nc-obs"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const errEl = document.getElementById("nc-error");
  if (errEl) errEl.style.display = "none";
  document.getElementById("new-client-modal").classList.add("open");
}

function closeNewClientModal() {
  document.getElementById("new-client-modal").classList.remove("open");
}

async function submitNewClient() {
  const nome  = document.getElementById("nc-nome").value.trim();
  const wpp   = document.getElementById("nc-wpp").value.trim();
  const bday  = document.getElementById("nc-bday").value;
  const email = document.getElementById("nc-email").value.trim();
  const obs   = document.getElementById("nc-obs").value.trim();
  const errEl = document.getElementById("nc-error");
  errEl.style.display = "none";

  const wppNorm = wpp.replace(/\D/g, "");
  if (!nome) {
    errEl.textContent = "Informe o nome do cliente.";
    errEl.style.display = "block";
    return;
  }
  if (wppNorm.length < 8) {
    errEl.textContent = "WhatsApp inválido.";
    errEl.style.display = "block";
    return;
  }
  // Evita duplicar: já existe cliente com esse WhatsApp?
  if ((allClients||[]).some(c => (c.wpp||"").replace(/\D/g,"") === wppNorm)) {
    errEl.textContent = "Já existe um cliente cadastrado com esse WhatsApp.";
    errEl.style.display = "block";
    return;
  }

  try {
    await fbSetMerge("clients", wppNorm, {
      nome,
      wpp: wppNorm,
      ...(email ? { email } : {}),
      ...(bday  ? { bday  } : {}),
      ...(obs   ? { obs   } : {}),
      lastCadastroAt: FB.serverTimestamp(),
    });
    showToast("Cliente cadastrado!", "success");
    closeNewClientModal();
    renderClients();
  } catch(e) {
    console.error(e);
    errEl.textContent = "Erro ao cadastrar. Tente novamente.";
    errEl.style.display = "block";
  }
}

