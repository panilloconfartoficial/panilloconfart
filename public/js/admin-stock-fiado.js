// ─── ADMIN: STOCK PRONTA ENTREGA ───────────────────────
async function loadStock() {
  try {
    const docs = await fbGet("stock");
    allStock = {};
    docs.forEach(d => { allStock[d.prodId] = { id: d.id, qty: d.qty || 0, ativo: d.ativo || false }; });
  } catch { allStock = {}; }
  renderPEProducts();
}

// ── Reconcilia estoque com pedidos já entregues não contabilizados ──────────
// Roda uma vez ao iniciar o painel. Varre todos os pedidos pronta-entrega com
// status "entregue" que ainda não têm _stockDecremented:true e aplica os
// descontos que ficaram para trás (reload de página, troca de sessão, etc.).
async function reconcileStock() {
  if (!db || !FB) return;
  const pending = (allOrders || []).filter(o =>
    o.tipo === "pronta-entrega" &&
    o.status === "entregue" &&
    !o._stockDecremented
  );
  if (pending.length === 0) return;

  console.log(`[reconcile] ${pending.length} pedido(s) PE entregue(s) sem desconto de estoque. Corrigindo…`);

  // Calcula o delta total por produto de uma vez
  const deltas = {}; // { prodId: totalQtyToSubtract }
  for (const order of pending) {
    for (const item of (order.itens || [])) {
      if (!item.prodId) continue;
      deltas[item.prodId] = (deltas[item.prodId] || 0) + (item.qty || 0);
    }
  }

  // Só entra na transação quem tem entrada de estoque cadastrada.
  const stockRefs = []; // { prodId, stockId }
  for (const prodId of Object.keys(deltas)) {
    const s = allStock[prodId];
    if (s?.id) stockRefs.push({ prodId, stockId: s.id });
    else console.warn("[reconcile] Sem entrada de estoque para:", prodId);
  }

  const newQtys = {}; // preenchido dentro da transação, para log/UI depois

  try {
    // Tudo (leitura + escrita de estoque + flag dos pedidos) roda em UMA
    // transação atômica: ou tudo é confirmado no servidor, ou nada é.
    // Isso elimina o cenário em que o estoque era descontado mas a flag
    // _stockDecremented falhava em gravar (ex: queda de rede no meio do
    // processo) — o que fazia o mesmo pedido ser reprocessado e o estoque
    // ser descontado de novo na próxima vez que o painel carregasse.
    // Também elimina a corrida entre abas/dispositivos abertos ao mesmo
    // tempo: o Firestore serializa transações que tocam os mesmos
    // documentos, refazendo a leitura automaticamente se necessário.
    await FB.runTransaction(db, async (tx) => {
      // 1) TODAS as leituras primeiro — exigência do Firestore para transações.
      //    Lê o valor atual direto do servidor, não do cache local `allStock`,
      //    que pode estar desatualizado se outra aba já mexeu no estoque.
      const stockSnaps = {};
      for (const { prodId, stockId } of stockRefs) {
        stockSnaps[prodId] = await tx.get(FB.doc(db, "stock", stockId));
      }

      // 2) Calcula os novos valores a partir do dado lido AGORA, dentro da transação.
      for (const { prodId, stockId } of stockRefs) {
        const current = stockSnaps[prodId].data()?.qty || 0;
        newQtys[prodId] = Math.max(0, current - deltas[prodId]);
      }

      // 3) TODAS as escritas no mesmo commit atômico: estoque + flag dos pedidos.
      for (const { prodId, stockId } of stockRefs) {
        tx.update(FB.doc(db, "stock", stockId), { qty: newQtys[prodId] });
      }
      for (const order of pending) {
        tx.update(FB.doc(db, "orders", order.id), { _stockDecremented: true });
      }
    });
  } catch (e) {
    // Se a transação falhar (ex: rede caiu de vez), NADA foi aplicado —
    // nem estoque nem flag. O reconcile tenta de novo no próximo load,
    // sem risco de desconto duplicado.
    console.error("[reconcile] Falha ao reconciliar estoque — nada foi alterado:", e);
    return;
  }

  // Só atualiza o estado local depois que o servidor confirmou a transação.
  for (const { prodId, stockId } of stockRefs) {
    const s = allStock[prodId];
    allStock[prodId] = { ...s, qty: newQtys[prodId] };
    const nome = allProducts.find(p => p.id === prodId)?.nome || prodId;
    console.log(`[reconcile] ${nome}: -${deltas[prodId]} → ${newQtys[prodId]} unid.`);
  }
  allOrders = allOrders.map(o =>
    pending.some(p => p.id === o.id) ? { ...o, _stockDecremented: true } : o
  );

  console.log("[reconcile] Estoque corrigido com sucesso.");
  renderStockAdmin();
  renderPEProducts();
}

function renderStockAdmin() {
  const grid = document.getElementById("stock-admin-grid");
  if (!grid) return;
  const prods = allProducts.filter(p => p.ativo !== false && p.categoria !== "combo");
  if (prods.length === 0) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px;">Cadastre produtos no Cardápio primeiro.</div>';
    return;
  }
  grid.innerHTML = prods.map(p => {
    const s = allStock[p.id] || { qty: 0, ativo: false };
    const isOn = s.ativo;
    const cat = p.categoria || "cookie";
    return `<div class="stock-admin-card">
      <div class="sac-img ${cat}">
        <span>${p.emoji || "🍪"}</span>
        <span class="sac-pe-badge ${isOn?'on':'off'}">${isOn?"PE ativo":"PE inativo"}</span>
      </div>
      <div class="sac-body">
        <div class="sac-name">${p.nome}</div>
        <div class="sac-price">R$ ${Number(p.preco).toFixed(2).replace(".",",")}</div>
        <div class="sac-qty-row">
          <span class="sac-qty-label">Qtd. em estoque:</span>
          <input class="sac-qty-input" type="number" min="0" value="${s.qty}" id="stock-qty-${p.id}" placeholder="0">
        </div>
        <div class="sac-btn-row">
          <button class="sac-toggle-btn ${isOn?'disable':'enable'}" onclick="toggleStockProduct('${p.id}',${isOn})">
            ${isOn?"⏸ Desativar PE":"▶ Ativar PE"}
          </button>
          <button class="sac-save-btn" onclick="saveStockQty('${p.id}')">💾 Salvar</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

async function saveStockQty(prodId) {
  const input    = document.getElementById("stock-qty-" + prodId);
  const qty      = parseInt(input?.value) || 0;
  const existing = allStock[prodId];

  try {
    if (existing?.id) {
      // Documento já existe — atualiza diretamente pelo ID (sem query)
      await FB.updateDoc(FB.doc(db, "stock", existing.id), { qty });
      allStock[prodId] = { ...existing, qty };
    } else {
      // Primeiro cadastro deste produto no estoque
      const ref = await fbAdd("stock", { prodId, qty, ativo: false });
      allStock[prodId] = { id: ref.id, qty, ativo: false };
    }
    showToast("Estoque salvo!");
    addAuditLog(prodId, `Estoque: ${allProducts.find(p=>p.id===prodId)?.nome||prodId} → ${qty} unid.`, "estoque");
    renderPEProducts();
  } catch(e) {
    showToast("Erro ao salvar estoque");
    console.error("saveStockQty:", prodId, e);
  }
}

async function toggleStockProduct(prodId, currentState) {
  const newState = !currentState;
  const inputVal = parseInt(document.getElementById("stock-qty-" + prodId)?.value) || 0;
  // Garante qty mínimo de 1 ao ativar — produto com qty=0 não aparece na loja
  const qty      = newState ? Math.max(inputVal, 1) : inputVal;
  const existing = allStock[prodId];

  try {
    if (existing?.id) {
      // Atualiza documento existente diretamente pelo ID
      await FB.updateDoc(FB.doc(db, "stock", existing.id), { ativo: newState, qty });
      allStock[prodId] = { ...existing, ativo: newState, qty };
    } else {
      // Cria documento novo (produto ainda não tinha entrada no estoque)
      const ref = await fbAdd("stock", { prodId, qty, ativo: newState });
      allStock[prodId] = { id: ref.id, qty, ativo: newState };
    }
    const nome = allProducts.find(p => p.id === prodId)?.nome || prodId;
    showToast(newState
      ? `✅ ${nome} ativado para Pronta Entrega (${qty} un.)`
      : `⏸ ${nome} removido da Pronta Entrega`);
    renderStockAdmin();
    renderPEProducts();
  } catch(e) {
    showToast("Erro ao alterar status");
    console.error("toggleStockProduct:", prodId, e);
  }
}

// ─── ADMIN: CONTAS FIADO ───────────────────────────────
async function loadFiadoAccounts() {
  try { allFiadoAccounts = await fbGet("fiadoAccounts"); } catch { allFiadoAccounts = []; }
  const activeCount = allFiadoAccounts.filter(a => a.autorizado).length;
  const badgeEl = document.getElementById("badge-fiado");
  if (badgeEl) badgeEl.textContent = activeCount;
}

async function renderFiadoAdmin() {
  // allFiadoAccounts é mantido atualizado pelo listener em tempo real.
  // Só faz fetch manual se por algum motivo ainda estiver vazio (fallback).
  if (!allFiadoAccounts.length) {
    try { allFiadoAccounts = await fbGet("fiadoAccounts"); } catch {}
  }
  const list = document.getElementById("fiado-client-list");
  if (!list) return;

  const active = allFiadoAccounts.filter(a => a.autorizado);

  // totalAberto calculado a partir dos pedidos NÃO pagos (fonte de verdade)
  const totalAberto = (allOrders || [])
    .filter(o => o.pagamento === "fiado" && !o.pagamentoConfirmado && o.status !== "cancelado")
    .reduce((s, o) => s + (o.total || 0), 0);

  // Calcular recebido este mês
  const now = new Date();
  let recebidoMes = 0;
  active.forEach(a => {
    (a.historico || []).forEach(h => {
      if (h.tipo === "pagamento") {
        const hDate = new Date(h.data);
        if (hDate.getMonth() === now.getMonth() && hDate.getFullYear() === now.getFullYear()) {
          recebidoMes += h.valor || 0;
        }
      }
    });
  });

  // KPI metrics
  const fmCount = document.getElementById("fm-count");
  const fmTotal = document.getElementById("fm-total");
  const fmRecebido = document.getElementById("fm-recebido");
  if (fmCount) fmCount.textContent = active.length;
  if (fmTotal) fmTotal.textContent = "R$ " + totalAberto.toFixed(2).replace(".",",");
  if (fmRecebido) fmRecebido.textContent = "R$ " + recebidoMes.toFixed(2).replace(".",",");

  // Total badge in topbar
  const totalBadge = document.getElementById("fiado-total-badge");
  if (totalBadge) totalBadge.textContent = `${active.length} conta${active.length !== 1 ? "s" : ""}`;

  // Search
  const q = (document.getElementById("fiado-search")?.value || "").toLowerCase();
  let filtered = q
    ? active.filter(a => (a.clientNome||"").toLowerCase().includes(q) || (a.clientWpp||"").includes(q))
    : [...active];

  // Status filter
  const statusFilter = document.getElementById("fiado-filter")?.value || "todos";
  if (statusFilter === "aberto")   filtered = filtered.filter(a => (a.saldo||0) > 0);
  if (statusFilter === "quitado")  filtered = filtered.filter(a => (a.saldo||0) <= 0);

  // Sort
  const sort = document.getElementById("fiado-sort")?.value || "nome-az";
  filtered.sort((a, b) => {
    switch (sort) {
      case "nome-az":      return (a.clientNome||"").localeCompare(b.clientNome||"", "pt-BR");
      case "nome-za":      return (b.clientNome||"").localeCompare(a.clientNome||"", "pt-BR");
      case "saldo-maior":  return Number(b.saldo||0) - Number(a.saldo||0);
      case "saldo-menor":  return Number(a.saldo||0) - Number(b.saldo||0);
      case "saldo-zero":   return Number(a.saldo||0) - Number(b.saldo||0); // quitados (0) primeiro
      case "saldo-aberto": return Number(b.saldo||0) - Number(a.saldo||0); // em aberto primeiro
      default: return 0;
    }
  });

  // Count
  const countEl = document.getElementById("fiado-count");
  if (countEl) countEl.textContent = q || statusFilter !== "todos"
    ? `${filtered.length} de ${active.length} conta(s)`
    : `${filtered.length} conta(s)`;

  if (filtered.length === 0) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">🔍</div>
      Nenhuma conta encontrada com os filtros selecionados.
    </div>`;
    return;
  }

  list.innerHTML = filtered.map((a, index) => {
    const initials = (a.clientNome || "?").substring(0,2).toUpperCase();

    // ── Busca pedidos reais do allOrders para este cliente (por wpp) ─────
    const clientWppClean = (a.clientWpp || "").replace(/\D/g, "");
    const pedidosFiado = (allOrders || []).filter(o =>
      o.pagamento === "fiado" &&
      (o.cliente?.wpp || "").replace(/\D/g, "") === clientWppClean &&
      o.status !== "cancelado"
    ).sort((x,y) => (y.createdAt?.seconds||0) - (x.createdAt?.seconds||0));

    // ── Saldo real = soma dos pedidos NÃO pagos (fonte de verdade) ────────
    // a.saldo no Firestore pode estar desatualizado; recalculamos aqui.
    const saldoReal = pedidosFiado
      .filter(o => !o.pagamentoConfirmado)
      .reduce((s, o) => s + (o.total || 0), 0);

    // Se saldo armazenado diverge do real, corrige em background
    if (Math.abs(saldoReal - (a.saldo || 0)) > 0.001 && a.id) {
      fbUpdate("fiadoAccounts", a.id, { saldo: saldoReal }).catch(() => {});
      a.saldo = saldoReal; // atualiza em memória imediatamente
    }

    const saldo     = saldoReal;
    const badgeClass = saldo > 0 ? "fiado-danger" : "fiado-zero";
    const badgeText  = saldo > 0 ? `R$ ${saldo.toFixed(2).replace(".",",")} em aberto` : "R$ 0,00 — quitado";
    const hist = (a.historico || []).slice().reverse().slice(0,5);
    const pedCount = pedidosFiado.length;

    // Monta HTML dos pedidos fiado com desconto individual
    const pedidosHTML = pedidosFiado.length === 0
      ? `<div style="font-size:12px;color:var(--muted);padding:8px 0 4px;">Nenhum pedido fiado encontrado.</div>`
      : pedidosFiado.map(o => {
          const oTotal = o.total || 0;
          const oDate  = o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : (o.createdAt ? new Date(o.createdAt.seconds*1000).toLocaleDateString("pt-BR") : "—");
          const oItens = (o.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ");
          const oPago  = o.pagamentoConfirmado ? `<span style="color:var(--teal);font-size:10px;font-weight:600;">✓ pago</span>` : `<span style="color:#e74c3c;font-size:10px;font-weight:600;">em aberto</span>`;
          return `
          <div style="background:#f8fafb;border:1px solid var(--border-light);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:var(--teal-dark);margin-bottom:2px;">
                  Pedido #${o.orderNum || o.id.substring(0,6)} &nbsp;${oPago}
                </div>
                <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${oItens}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">${oDate}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:14px;font-weight:700;color:#e74c3c;">R$ ${oTotal.toFixed(2).replace(".",",")}</div>
                <button onclick="toggleFiadoOrderForm('${a.id}','${o.id}')" style="margin-top:4px;font-size:10px;padding:3px 8px;border:1px solid var(--teal);border-radius:6px;background:transparent;color:var(--teal);cursor:pointer;font-weight:600;">
                  💳 Pagar / Desc.
                </button>
              </div>
            </div>
            <div id="forder-form-${a.id}-${o.id}" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-light);">
              <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;">REGISTRAR PAGAMENTO DESTE PEDIDO</div>
              <label style="font-size:12px;">Valor recebido (R$) *</label>
              <input class="fi" type="number" id="fopval-${a.id}-${o.id}" placeholder="${oTotal.toFixed(2)}" step="0.01" min="0.01" value="${oTotal.toFixed(2)}" style="margin-bottom:8px;">
              <label style="font-size:12px;">Desconto (opcional)</label>
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                <input class="fi" type="number" id="fopdesc-${a.id}-${o.id}" placeholder="0" step="0.01" min="0" style="flex:1;margin-bottom:0;">
                <select id="fopdesc-tipo-${a.id}-${o.id}" style="padding:8px 10px;border:1px solid var(--border-mid);border-radius:8px;font-size:13px;background:#fff;min-width:60px;">
                  <option value="reais">R$</option>
                  <option value="pct">%</option>
                </select>
              </div>
              <label style="font-size:12px;">Forma de pagamento</label>
              <select class="fi" id="fopmet-${a.id}-${o.id}" style="margin-bottom:8px;">
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="credito">Cartão Crédito</option>
                <option value="debito">Cartão Débito</option>
                <option value="transferencia">Transferência</option>
              </select>
              <button class="btn-sm-primary" style="width:100%;padding:10px;" onclick="registerFiadoOrderPayment('${a.id}','${o.id}',${oTotal},${saldo})">
                Confirmar pagamento deste pedido
              </button>
            </div>
          </div>`;
        }).join("");

    return `<div class="fiado-client-card">
      <div class="fcc-header" onclick="toggleFiadoDetail('${a.id}')">
        <div style="font-size:11px;font-weight:700;color:var(--muted);min-width:24px;text-align:center;">${index + 1}</div>
        <div class="fcc-av">${initials}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <span class="fcc-name">${a.clientNome || "—"}</span>
            <span class="fiado-tag">fiado ativo</span>
          </div>
          <div class="fcc-phone">${a.clientWpp || "—"}</div>
        </div>
        <span class="fiado-badge ${badgeClass}">${badgeText}</span>
        <i class="ti ti-chevron-down" id="fchev-${a.id}" style="font-size:16px;color:var(--muted);transition:transform .2s;flex-shrink:0;margin-left:8px;"></i>
      </div>
      <div class="fcc-detail" id="fdetail-${a.id}">
        <div class="fcc-detail-grid">
          <div class="fd-card">
            <div class="fd-label">Saldo devedor</div>
            <div class="fd-val ${saldo>0?'red':''}" id="fsaldo-${a.id}">R$ ${saldo.toFixed(2).replace(".",",")}</div>
          </div>
          <div class="fd-card">
            <div class="fd-label">Pedidos no fiado</div>
            <div class="fd-val">${pedCount} pedido${pedCount!==1?"s":""}</div>
          </div>
        </div>
        ${a.limite ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Limite: R$ ${Number(a.limite).toFixed(2).replace(".",",")} &nbsp;|&nbsp; Disponível: R$ ${Math.max(0, a.limite - saldo).toFixed(2).replace(".",",")}</div>` : ""}

        <div class="fcc-hist-title" style="margin-bottom:8px;">
          <i class="ti ti-shopping-bag" style="font-size:13px;margin-right:4px;"></i>Pedidos em aberto
        </div>
        ${pedidosHTML}

        <div class="fcc-hist-title" style="margin-top:14px;">Histórico recente</div>
        ${hist.length === 0 ? '<div style="font-size:12px;color:var(--muted);padding:8px 0;">Nenhum lançamento ainda.</div>' :
          hist.map(h => {
            const isDeb = h.tipo === "pedido";
            const isDesc = h.tipo === "desconto";
            const dotClass = isDeb ? "hist-dot-pedido" : isDesc ? "hist-dot-desconto" : "hist-dot-pagto";
            const icon     = isDeb ? "ti-shopping-bag" : isDesc ? "ti-tag" : "ti-cash";
            const valClass = isDeb ? "debit" : "credit";
            const prefix   = isDeb ? "+" : "-";
            const label    = h.descricao || (isDeb ? "Pedido" : isDesc ? "Desconto" : "Pagamento");
            return `<div class="fcc-hist-item">
              <div class="fcc-hist-dot ${dotClass}">
                <i class="ti ${icon}"></i>
              </div>
              <div class="fcc-hist-info">
                <div class="fcc-hist-desc">${label}</div>
                <div class="fcc-hist-date">${h.data || "—"}</div>
              </div>
              <div class="fcc-hist-val ${valClass}">${prefix}R$ ${Number(h.valor||0).toFixed(2).replace(".",",")}</div>
            </div>`;
          }).join("")}
        <div class="fcc-action-row">
          <button class="fcc-pagto-btn" onclick="toggleFiadoForm('${a.id}')">
            <i class="ti ti-cash" style="font-size:14px;"></i> Pagamento total
          </button>
          <button class="fcc-revoke-btn" onclick="revokeCredit('${a.id}','${(a.clientNome||'').replace(/'/g,"\\'")}')">
            <i class="ti ti-ban" style="font-size:14px;"></i> Revogar crédito
          </button>
        </div>
        <div class="fcc-pagto-form" id="fpagto-${a.id}">
          <label>Valor recebido (R$) *</label>
          <input class="fi" type="number" id="fpval-${a.id}" placeholder="Ex: 50.00" step="0.01" min="0.01">
          <label>Desconto (opcional)</label>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
            <input class="fi" type="number" id="fpdesc-${a.id}" placeholder="Ex: 10" step="0.01" min="0" style="flex:1;margin-bottom:0;">
            <select id="fpdesc-tipo-${a.id}" style="padding:8px 10px;border:1px solid var(--border-mid);border-radius:8px;font-size:13px;background:#fff;min-width:60px;">
              <option value="reais">R$</option>
              <option value="pct">%</option>
            </select>
          </div>
          <label>Forma de pagamento</label>
          <select class="fi" id="fpmet-${a.id}" style="margin-bottom:10px;">
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="credito">Cartão Crédito</option>
            <option value="debito">Cartão Débito</option>
            <option value="transferencia">Transferência</option>
          </select>
          <label>Observação (opcional)</label>
          <input class="fi" type="text" id="fpobs-${a.id}" placeholder="Ex: referente a maio">
          <div style="margin-top:12px;">
            <button class="btn-sm-primary" style="width:100%;padding:11px;" onclick="registerFiadoPayment('${a.id}',${saldo})">
              Confirmar pagamento total
            </button>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");
}

function toggleFiadoDetail(id) {
  const detail = document.getElementById("fdetail-" + id);
  const chev   = document.getElementById("fchev-" + id);
  if (!detail) return;
  const isOpen = detail.classList.contains("open");
  // Close all
  document.querySelectorAll(".fcc-detail").forEach(d => d.classList.remove("open"));
  document.querySelectorAll("[id^='fchev-']").forEach(c => c.style.transform = "");
  if (!isOpen) {
    detail.classList.add("open");
    if (chev) chev.style.transform = "rotate(180deg)";
  }
}

function toggleFiadoForm(id) {
  const form = document.getElementById("fpagto-" + id);
  if (form) form.classList.toggle("open");
}

function toggleFiadoOrderForm(accountId, orderId) {
  const form = document.getElementById(`forder-form-${accountId}-${orderId}`);
  if (!form) return;
  const isOpen = form.style.display !== "none";
  // Fecha todos os forms de pedido deste cliente
  document.querySelectorAll(`[id^="forder-form-${accountId}-"]`).forEach(f => f.style.display = "none");
  if (!isOpen) form.style.display = "block";
}

async function registerFiadoOrderPayment(accountId, orderId, orderTotal, currentSaldo) {
  const valInput  = document.getElementById(`fopval-${accountId}-${orderId}`);
  const descInput = document.getElementById(`fopdesc-${accountId}-${orderId}`);
  const descTipo  = document.getElementById(`fopdesc-tipo-${accountId}-${orderId}`);
  const metInput  = document.getElementById(`fopmet-${accountId}-${orderId}`);

  const val = parseFloat(valInput?.value);
  if (!val || val <= 0) { showToast("Informe um valor válido!"); return; }

  // Calcula desconto sobre o valor do pedido
  let descReais = 0;
  const descVal = parseFloat(descInput?.value) || 0;
  if (descVal > 0) {
    const tipo = descTipo?.value || "reais";
    descReais = tipo === "pct" ? orderTotal * descVal / 100 : descVal;
    descReais = Math.min(descReais, orderTotal);
  }

  const totalAbatido = val + descReais;
  const newSaldo = Math.max(0, currentSaldo - totalAbatido);
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR");

  try {
    const account = allFiadoAccounts.find(a => a.id === accountId);
    if (!account) return;

    // Busca número do pedido para a descrição
    const order = (allOrders || []).find(o => o.id === orderId);
    const orderRef = order ? `Pedido #${order.orderNum || orderId.substring(0,6)}` : "Pedido";

    const entries = [];
    entries.push({
      tipo: "pagamento",
      descricao: `Pagamento de ${orderRef}` + (metInput?.value ? " — " + payLabel(metInput.value) : ""),
      valor: val,
      data: dateStr
    });
    if (descReais > 0) {
      entries.push({
        tipo: "desconto",
        descricao: `Desconto em ${orderRef}`,
        valor: descReais,
        data: dateStr
      });
    }

    const newHist = [...(account.historico || []), ...entries];
    await fbUpdate("fiadoAccounts", accountId, { saldo: newSaldo, historico: newHist });
    allFiadoAccounts = allFiadoAccounts.map(a => a.id === accountId ? { ...a, saldo: newSaldo, historico: newHist } : a);

    // Marca o pedido como pago
    if (order) {
      await fbUpdate("orders", orderId, { pagamentoConfirmado: true });
      allOrders = allOrders.map(o => o.id === orderId ? { ...o, pagamentoConfirmado: true } : o);
    }

    let msg = `Pagamento de R$ ${val.toFixed(2).replace(".",",")} registrado!`;
    if (descReais > 0) msg += ` + desconto R$ ${descReais.toFixed(2).replace(".",",")}`;
    showToast(msg);
    addAuditLog(accountId, `Fiado — pagamento de R$ ${val.toFixed(2)} (${payLabel(metInput?.value)}) ref. ${orderRef} — cliente: ${account.clientNome}`, "fiado");
    renderFiadoAdmin();
  } catch(e) { showToast("Erro ao registrar pagamento"); console.error(e); }
}

async function registerFiadoPayment(accountId, currentSaldo) {
  const valInput   = document.getElementById("fpval-"       + accountId);
  const metInput   = document.getElementById("fpmet-"       + accountId);
  const obsInput   = document.getElementById("fpobs-"       + accountId);
  const descInput  = document.getElementById("fpdesc-"      + accountId);
  const descTipo   = document.getElementById("fpdesc-tipo-" + accountId);

  const val = parseFloat(valInput?.value);
  if (!val || val <= 0) { showToast("Informe um valor válido!"); return; }

  // Calcula desconto
  let descReais = 0;
  const descVal = parseFloat(descInput?.value) || 0;
  if (descVal > 0) {
    const tipo = descTipo?.value || "reais";
    descReais = tipo === "pct" ? currentSaldo * descVal / 100 : descVal;
    descReais = Math.min(descReais, currentSaldo);
  }

  const totalAbatido = val + descReais;
  const newSaldo = Math.max(0, currentSaldo - totalAbatido);
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR");

  try {
    const account = allFiadoAccounts.find(a => a.id === accountId);
    if (!account) return;

    const entries = [];
    entries.push({
      tipo: "pagamento",
      descricao: "Pagamento recebido" + (metInput?.value ? " — " + payLabel(metInput.value) : "") + (obsInput?.value ? " (" + obsInput.value + ")" : ""),
      valor: val,
      data: dateStr
    });
    if (descReais > 0) {
      entries.push({
        tipo: "desconto",
        descricao: "Desconto aplicado pelo admin" + (obsInput?.value ? " (" + obsInput.value + ")" : ""),
        valor: descReais,
        data: dateStr
      });
    }

    const newHist = [...(account.historico || []), ...entries];
    await fbUpdate("fiadoAccounts", accountId, { saldo: newSaldo, historico: newHist });
    allFiadoAccounts = allFiadoAccounts.map(a => a.id === accountId ? { ...a, saldo: newSaldo, historico: newHist } : a);

    let msg = "Pagamento de R$ " + val.toFixed(2).replace(".",",") + " registrado!";
    if (descReais > 0) msg += " + desconto de R$ " + descReais.toFixed(2).replace(".",",");
    showToast(msg);
    addAuditLog(accountId, `Fiado — pagamento total R$ ${val.toFixed(2)} (${payLabel(metInput?.value)}) — cliente: ${account.clientNome}`, "fiado");
    renderFiadoAdmin();
  } catch(e) { showToast("Erro ao registrar pagamento"); console.error(e); }
}

async function revokeCredit(accountId, clientName) {
  if (!confirm(`Revogar o crédito fiado de ${clientName}? O saldo em aberto não será cancelado.`)) return;
  try {
    await fbUpdate("fiadoAccounts", accountId, { autorizado: false });
    allFiadoAccounts = allFiadoAccounts.map(a => a.id === accountId ? { ...a, autorizado: false } : a);
    showToast("Crédito revogado.");
    addAuditLog(accountId, `Crédito fiado revogado — cliente: ${clientName}`, "fiado");
    renderFiadoAdmin();
  } catch(e) { showToast("Erro ao revogar crédito"); }
}

async function addFiadoDebt(client, order) {
  try {
    const wppNorm = (client.wpp || "").replace(/\D/g, "");
    const account = allFiadoAccounts.find(a => (a.clientWpp||"").replace(/\D/g,"") === wppNorm && a.autorizado);
    if (!account) return;
    const numRef = order.orderNum || order.numero || order.id?.substring(0,6);
    const now = new Date();
    const newHist = [...(account.historico || []), {
      tipo: "pedido",
      descricao: `Pedido #${numRef} — ${(order.itens||[]).map(i=>`${i.qty}× ${i.nome}`).join(", ")}`,
      valor: order.total,
      data: now.toLocaleDateString("pt-BR")
    }];
    const newSaldo = (account.saldo || 0) + order.total;
    await fbUpdate("fiadoAccounts", account.id, { saldo: newSaldo, historico: newHist });
    allFiadoAccounts = allFiadoAccounts.map(a => a.id === account.id ? { ...a, saldo: newSaldo, historico: newHist } : a);
    addAuditLog(account.id, `Débito fiado — R$ ${order.total.toFixed(2)} — pedido #${numRef} — ${account.clientNome}`, "fiado");
    const badge = document.getElementById("badge-fiado");
    if (badge) badge.textContent = allFiadoAccounts.filter(a=>a.autorizado).length;
  } catch(e) { console.warn("Fiado debt error", e); }
}

// ─── FIADO AUTH MODAL ──────────────────────────────────
async function openFiadoAuthModal() {
  foundFiadoClient = null;
  const inp = document.getElementById("fiado-search-nome");
  if (inp) inp.value = "";
  document.getElementById("fiado-client-found").style.display = "none";
  document.getElementById("fiado-no-client").style.display   = "none";
  document.getElementById("fiado-confirm-btn").style.display = "none";
  document.getElementById("fiado-limite").value = "";
  document.getElementById("fiado-obs").value    = "";
  document.getElementById("fiado-auth-modal").classList.add("open");
  // Preenche datalist com todos os clientes cadastrados
  try {
    const clients = await fbGet("clients");
    const dl = document.getElementById("fiado-clients-list");
    if (dl) {
      dl.innerHTML = clients.map(c =>
        `<option value="${escHtml(c.nome||"")}" data-wpp="${escHtml(c.wpp||"")}">${escHtml(c.nome||"")} · ${escHtml(c.wpp||"")}</option>`
      ).join("");
      // Guarda array global para lookup rápido
      window._allClientsList = clients;
    }
  } catch(e) { console.warn("Erro ao carregar clientes para fiado:", e); }
}

function onFiadoNameInput() {
  // Ao digitar, limpa resultado anterior para forçar nova busca
  foundFiadoClient = null;
  document.getElementById("fiado-client-found").style.display = "none";
  document.getElementById("fiado-no-client").style.display   = "none";
  document.getElementById("fiado-confirm-btn").style.display = "none";
}

function closeFiadoAuthModal() {
  document.getElementById("fiado-auth-modal").classList.remove("open");
}

async function searchClientForFiado() {
  const nome = (document.getElementById("fiado-search-nome").value || "").trim();
  if (!nome) { showToast("Informe o nome do cliente!"); return; }
  try {
    // Tenta usar a lista já carregada no datalist para lookup instantâneo
    const cached = window._allClientsList || [];
    const normalizar = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let found = cached.find(c => normalizar(c.nome||"") === normalizar(nome));
    // Se não achou exato, tenta parcial
    if (!found) found = cached.find(c => normalizar(c.nome||"").includes(normalizar(nome)));
    // Se ainda não achou, busca no Firestore
    if (!found) {
      const snap = await FB.getDocs(FB.collection(db,"clients"));
      snap.forEach(d => {
        const c = { id: d.id, ...d.data() };
        if (!found && normalizar(c.nome||"").includes(normalizar(nome))) found = c;
      });
    }
    if (!found) {
      document.getElementById("fiado-client-found").style.display = "none";
      document.getElementById("fiado-no-client").style.display   = "block";
      document.getElementById("fiado-confirm-btn").style.display = "none";
      foundFiadoClient = null;
      return;
    }
    foundFiadoClient = found;
    document.getElementById("fiado-found-name").textContent = foundFiadoClient.nome || "—";
    document.getElementById("fiado-found-wpp").textContent  = foundFiadoClient.wpp  || "—";
    document.getElementById("fiado-client-found").style.display = "block";
    document.getElementById("fiado-no-client").style.display   = "none";
    document.getElementById("fiado-confirm-btn").style.display = "";
  } catch(e) { showToast("Erro ao buscar cliente"); console.error(e); }
}

async function confirmFiadoAuth() {
  if (!foundFiadoClient) { showToast("Busque um cliente primeiro!"); return; }
  const limite = parseFloat(document.getElementById("fiado-limite").value) || null;
  const obs    = document.getElementById("fiado-obs").value.trim();
  // Normaliza wpp para só dígitos — evita inconsistências de formato
  const wppNorm = (foundFiadoClient.wpp || "").replace(/\D/g, "");

  // Check if already has an account (compara normalizado)
  const existing = allFiadoAccounts.find(a => (a.clientWpp||"").replace(/\D/g,"") === wppNorm);
  try {
    if (existing) {
      await fbUpdate("fiadoAccounts", existing.id, { autorizado: true, ...(limite?{limite}:{}), ...(obs?{obs}:{}) });
      allFiadoAccounts = allFiadoAccounts.map(a => a.id === existing.id ? { ...a, autorizado: true } : a);
    } else {
      const data = {
        clientId:   foundFiadoClient.id,
        clientNome: foundFiadoClient.nome,
        clientWpp:  wppNorm,
        saldo:      0,
        autorizado: true,
        historico:  [],
        ...(limite ? { limite } : {}),
        ...(obs    ? { obs    } : {})
      };
      const ref = await fbAdd("fiadoAccounts", data);
      allFiadoAccounts.push({ id: ref.id, ...data });
    }
    showToast(`Fiado autorizado para ${foundFiadoClient.nome}!`);
    addAuditLog(wppNorm, `Fiado autorizado para ${foundFiadoClient.nome}${limite ? ` — limite R$ ${limite.toFixed(2)}` : ""}`, "fiado");
    closeFiadoAuthModal();
    renderFiadoAdmin();
    const badge = document.getElementById("badge-fiado");
    if (badge) badge.textContent = allFiadoAccounts.filter(a=>a.autorizado).length;
  } catch(e) { showToast("Erro ao autorizar fiado"); console.error(e); }
}

function openProdModal(id) {
  editingProdId = id || null;
  ingRows = 0;
  _currentPhotoBase64 = null;
  _currentFotoPos = { x: 50, y: 50, zoom: 100 };
  document.getElementById("pm-ings").innerHTML = "";
  document.getElementById("pm-custo-est").textContent = "—";
  document.getElementById("pm-margem-est").textContent = "—";

  // Reset photo UI
  const photoPreview = document.getElementById("photo-preview");
  const photoIcon    = document.getElementById("photo-icon");
  const photoSpan    = document.getElementById("photo-span");
  photoPreview.src = "";
  photoPreview.style.display = "none";
  photoPreview.style.transform = "";
  photoPreview.style.objectPosition = "50% 50%";
  photoIcon.style.display = "";
  photoSpan.style.display = "";
  document.getElementById("photo-input").value = "";
  document.getElementById("crop-zoom").value = 100;
  document.getElementById("crop-x").value    = 50;
  document.getElementById("crop-y").value    = 50;
  document.getElementById("crop-zoom-val").textContent = "100%";
  document.getElementById("crop-x-val").textContent    = "50%";
  document.getElementById("crop-y-val").textContent    = "50%";
  showCropPanel(false);

  if (id) {
    const p = allProducts.find(x => x.id === id);
    if (p) {
      document.getElementById("pm-nome").value  = p.nome;
      document.getElementById("pm-cat").value   = p.categoria;
      document.getElementById("pm-desc").value  = p.desc;
      document.getElementById("pm-preco").value = p.preco;
      document.getElementById("pm-preco-revenda").value = p.precoRevenda || "";
      document.getElementById("pm-rend").value  = p.rendimento || "";
      document.getElementById("pm-tempo-preparo").value   = p.tempoPreparoMin  || "";
      document.getElementById("pm-tempo-embalagem").value = p.tempoEmbalagemMin || "";
      document.getElementById("pm-title").textContent = "Editar produto";
      if (p.ingredientes) p.ingredientes.forEach(i => addIngRow(i));
      // Restaura foto e enquadramento existentes
      if (p.fotoUrl) {
        _currentPhotoBase64 = p.fotoUrl;
        const pos = p.fotoPos || { x: 50, y: 50, zoom: 100 };
        _currentFotoPos = pos;
        document.getElementById("crop-zoom").value = pos.zoom;
        document.getElementById("crop-x").value    = pos.x;
        document.getElementById("crop-y").value    = pos.y;
        photoPreview.src = p.fotoUrl;
        photoPreview.style.display = "block";
        photoIcon.style.display = "none";
        photoSpan.style.display = "none";
        applyCropPreview();
        showCropPanel(true);
      }
    }
  } else {
    document.getElementById("pm-nome").value  = "";
    document.getElementById("pm-desc").value  = "";
    document.getElementById("pm-preco").value = "";
    document.getElementById("pm-preco-revenda").value = "";
    document.getElementById("pm-rend").value  = "";
    document.getElementById("pm-tempo-preparo").value   = "";
    document.getElementById("pm-tempo-embalagem").value = "";
    document.getElementById("pm-title").textContent = "Novo produto";
    addIngRow();
  }
  document.getElementById("prod-modal").classList.add("open");
}

function closeProdModal() {
  document.getElementById("prod-modal").classList.remove("open");
}

let ingRowCount = 0;
function addIngRow(data) {
  ingRowCount++;
  const id = "ing-row-" + ingRowCount;
  const ingNames = allIngredients.map(i => `<option value="${i.id}" data-preco="${i.preco}" data-unit="${i.unit}">${i.nome}</option>`).join("");
  const row = document.createElement("div");
  row.id = id;
  row.style.cssText = "display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center;";
  row.innerHTML = `
    <select class="fi" style="padding:8px 10px;font-size:12px;" onchange="recalcCost()">
      <option value="">Selecione ingrediente</option>
      ${ingNames}
    </select>
    <input class="fi" type="number" placeholder="Gramas" style="padding:8px;font-size:12px;" oninput="recalcCost()">
    <input class="fi" type="text" placeholder="Custo" readonly style="padding:8px;font-size:12px;background:var(--cream);">
    <button onclick="document.getElementById('${id}').remove();recalcCost();" style="background:transparent;border:none;color:var(--muted);font-size:18px;cursor:pointer;">×</button>`;
  if (data) {
    row.querySelector("select").value            = data.ingId || "";
    row.querySelector("input[type=number]").value = data.grams || "";
  }
  document.getElementById("pm-ings").appendChild(row);
  recalcCost();
}

function recalcCost() {
  let total = 0;
  document.querySelectorAll("#pm-ings > div").forEach(row => {
    const sel   = row.querySelector("select");
    const grams = parseFloat(row.querySelector("input[type=number]").value) || 0;
    const costEl = row.querySelector("input[readonly]");
    const ing = allIngredients.find(i => i.id === sel.value);
    if (ing && grams) {
      const pricePerG = precoPorGrama(ing);
      const cost = pricePerG * grams;
      costEl.value = `R$ ${cost.toFixed(3)}`;
      total += cost;
    } else { costEl.value = ""; }
  });
  const _c = _planCfg();
  const _vh = _c.horas > 0 ? _c.proLabore/_c.horas : 0;
  const rend = parseInt(document.getElementById("pm-rend").value) || 1;
  const preco = parseFloat(document.getElementById("pm-preco").value) || 0;
  const tempoPreparoModal   = parseInt(document.getElementById("pm-tempo-preparo").value)   || 0;
  const tempoEmbalagemModal = parseInt(document.getElementById("pm-tempo-embalagem").value) || 0;
  const tempoAtivo = (tempoPreparoModal + tempoEmbalagemModal) > 0
    ? (tempoPreparoModal + tempoEmbalagemModal)
    : _c.tempo;
  const ingUn = (total/rend) * (1 + _c.perda);
  const laborUn = (tempoAtivo/rend) * _vh/60;
  const costPerUnit = ingUn + laborUn;
  const cmUn = preco*(1 - _c.cartao) - ingUn - laborUn;
  const cmPct = preco > 0 ? (cmUn/preco*100) : 0;
  document.getElementById("pm-custo-est").textContent = costPerUnit > 0 ? `R$ ${costPerUnit.toFixed(2)}` : "—";
  document.getElementById("pm-margem-est").textContent = preco > 0 ? `${cmPct.toFixed(0)}%` : "—";
}

async function saveProduct() {
  const nome  = document.getElementById("pm-nome").value.trim();
  const desc  = document.getElementById("pm-desc").value.trim();
  const preco = parseFloat(document.getElementById("pm-preco").value);
  const precoRevendaRaw = document.getElementById("pm-preco-revenda").value;
  const precoRevenda = precoRevendaRaw ? parseFloat(precoRevendaRaw) : null;
  if (!nome || !desc || !preco) { showToast("Preencha nome, descrição e preço!"); return; }

  const ingredientes = [];
  document.querySelectorAll("#pm-ings > div").forEach(row => {
    const ingId = row.querySelector("select").value;
    const grams = parseFloat(row.querySelector("input[type=number]").value);
    if (ingId && grams) ingredientes.push({ ingId, grams });
  });

  const cat = document.getElementById("pm-cat").value;
  const isCombo = cat === "combo";

  // Extras do combo
  const comboExtras = [];
  document.querySelectorAll("#pm-extras > div input[type=text]").forEach(inp => {
    if (inp.value.trim()) comboExtras.push(inp.value.trim());
  });

  const data = {
    nome, desc, preco,
    precoRevenda: precoRevenda,
    categoria:     cat,
    rendimento:    parseInt(document.getElementById("pm-rend").value) || 1,
    tempoPreparoMin:   parseInt(document.getElementById("pm-tempo-preparo").value)   || 0,
    tempoEmbalagemMin: parseInt(document.getElementById("pm-tempo-embalagem").value) || 0,
    emoji:         isCombo ? "🎁" : cat === "brownie" ? "🍫" : "🍪",
    ingredientes,
    badge: "",
    fotoUrl:       _currentPhotoBase64 || null,
    fotoPos:       _currentPhotoBase64 ? _currentFotoPos : null,
    ...(isCombo ? {
      comboCookies:  parseInt(document.getElementById("pm-combo-cookies").value)  || 0,
      comboBrownies: parseInt(document.getElementById("pm-combo-brownies").value) || 0,
      comboExtras,
    } : {})
  };

  if (editingProdId) {
    // ─ EDITAR produto existente
    try {
      await fbUpdate("products", editingProdId, data);
    } catch(e) { console.warn("Firebase update error:", e); }
    allProducts = allProducts.map(p => p.id === editingProdId ? { ...p, ...data } : p);
    showToast("Produto atualizado!");
  } else {
    // ─ NOVO produto
    try {
      const ref = await fbAdd("products", data);
      allProducts.push({ id: ref.id, ...data });
    } catch(e) {
      console.warn("Firebase add error:", e);
      allProducts.push({ id: "p" + Date.now(), ...data });
    }
    showToast("Produto criado!");
  }

  closeProdModal();
  renderStoreProducts("todos");
  renderAdminProducts();
}

