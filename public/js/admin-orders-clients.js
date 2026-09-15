// ─── ADMIN: ORDERS ─────────────────────────────────────
async function loadOrders() {
  try { allOrders = await fbGet("orders"); } catch { allOrders = []; }
  const badge = allOrders.filter(o => o.status === "pendente").length;
  document.getElementById("badge-pedidos").textContent = badge;
  updateMbnBadge(badge);
  // Atualiza dashboard após carregar pedidos (garante dados corretos)
  loadDashboard();
}

let ordersPage = 1;
const ORDERS_PER_PAGE = 20;

function renderOrders() {
  const q = (document.getElementById("orders-search")?.value || "").toLowerCase();
  const filterPag  = document.getElementById("orders-filter-pag")?.value  || "todos";
  const filterConf = document.getElementById("orders-filter-conf")?.value || "todos";
  const sort       = document.getElementById("orders-sort")?.value         || "data-desc";

  let list = orderFilterStatus === "todos" ? allOrders : allOrders.filter(o => o.status === orderFilterStatus);

  if (q) {
    list = list.filter(o =>
      (o.cliente?.nome||"").toLowerCase().includes(q) ||
      (o.cliente?.wpp||"").includes(q) ||
      (o.itens||[]).some(i => i.nome.toLowerCase().includes(q)) ||
      (o.orderNum||o.numero||"").toString().includes(q)
    );
  }

  // Filtro forma de pagamento
  if (filterPag !== "todos") list = list.filter(o => o.pagamento === filterPag);

  // Filtro confirmação de pagamento
  if (filterConf === "pago")    list = list.filter(o => o.pagamentoConfirmado);
  if (filterConf === "pendente") list = list.filter(o => !o.pagamentoConfirmado);

  // Ordenação
  list = [...list].sort((a, b) => {
    switch (sort) {
      case "data-desc":      return (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0);
      case "data-asc":       return (a.createdAt?.seconds||0) - (b.createdAt?.seconds||0);
      case "nome-az":        return (a.cliente?.nome||"").localeCompare(b.cliente?.nome||"", "pt-BR");
      case "nome-za":        return (b.cliente?.nome||"").localeCompare(a.cliente?.nome||"", "pt-BR");
      case "valor-maior":    return Number(b.totalComDesconto??b.total??0) - Number(a.totalComDesconto??a.total??0);
      case "valor-menor":    return Number(a.totalComDesconto??a.total??0) - Number(b.totalComDesconto??b.total??0);
      case "retirada-asc": {
        const da = a.dataRetirada ? new Date(a.dataRetirada).getTime() : Infinity;
        const db2 = b.dataRetirada ? new Date(b.dataRetirada).getTime() : Infinity;
        return da - db2;
      }
      default: return (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0);
    }
  });

  // Contador
  const countEl = document.getElementById("orders-count");
  if (countEl) {
    const total = allOrders.length;
    countEl.textContent = list.length < total ? `${list.length} de ${total} pedido(s)` : `${total} pedido(s)`;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / ORDERS_PER_PAGE));
  if (ordersPage > totalPages) ordersPage = totalPages;
  const start = (ordersPage - 1) * ORDERS_PER_PAGE;
  const pageList = list.slice(start, start + ORDERS_PER_PAGE);

  const tbody = document.getElementById("orders-tbody");
  tbody.innerHTML = pageList.length === 0
    ? `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Nenhum pedido encontrado</td></tr>`
    : pageList.map(o => {
        const payPaid = o.pagamentoConfirmado
          ? `<button class="pay-confirm-btn confirmed" onclick="togglePayConfirm('${o.id}',false)">✓ Pago</button>`
          : `<button class="pay-confirm-btn" onclick="togglePayConfirm('${o.id}',true)">Confirmar pag.</button>`;
        const curPay = o.pagamento || "pix";
        const paySelect = `<select class="status-select" style="min-width:100px;" onchange="updateOrderPayMethod('${o.id}',this.value)">
          <option value="pix"     ${curPay==='pix'    ?'selected':''}>Pix</option>
          <option value="credito" ${curPay==='credito' ?'selected':''}>Crédito</option>
          <option value="debito"  ${curPay==='debito'  ?'selected':''}>Débito</option>
          <option value="dinheiro"${curPay==='dinheiro'?'selected':''}>Dinheiro</option>
          <option value="fiado"   ${curPay==='fiado'   ?'selected':''}>Fiado</option>
        </select>`;
        return `
        <tr style="${o.status==='cancelado'?'opacity:.6;':''}">
          <td><strong>${escHtml(o.cliente?.nome || "—")}</strong><br><span style="font-size:11px;color:var(--muted);">${escHtml(o.cliente?.wpp || "")}</span></td>
          <td style="font-size:12px;">${(o.itens||[]).map(i=>`${i.qty}× ${escHtml(i.nome)}`).join(", ")}</td>
          <td>${o.dataRetirada ? new Date(o.dataRetirada+"T12:00").toLocaleDateString("pt-BR") : "—"}<br><span style="font-size:11px;color:var(--muted);">${o.periodo||""}${o.tipoVenda==="revenda" ? ' <span style="background:#FFF3E0;color:#b35c00;border-radius:5px;padding:1px 5px;font-size:10px;font-weight:700;">REVENDA</span>' : ""}</span></td>
          <td>${paySelect}</td>
          <td>${payPaid}</td>
          <td>
            <strong>R$ ${Number(o.totalComDesconto ?? o.total ?? 0).toFixed(2).replace(".",",")}</strong>
            ${o.descontoAplicado ? `<br><span style="font-size:10px;color:#8B4513;">-${o.descontoAplicado}%</span>` : ""}
            ${o.descontoAdmin ? `<br><span style="font-size:10px;color:#8B4513;">-R$ ${Number(o.descontoAdmin).toFixed(2).replace(".",",")} (admin)</span>` : ""}
            <div id="desc-form-${o.id}" style="display:none;margin-top:6px;">
              <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                <input type="number" id="desc-val-${o.id}" placeholder="Valor" min="0" step="0.01"
                  style="width:72px;padding:4px 6px;border:1px solid var(--border-mid);border-radius:6px;font-size:12px;"
                  onkeydown="if(event.key==='Enter')applyOrderDiscount('${o.id}')">
                <select id="desc-tipo-${o.id}" style="padding:4px 5px;border:1px solid var(--border-mid);border-radius:6px;font-size:12px;">
                  <option value="reais">R$</option>
                  <option value="pct">%</option>
                </select>
                <button onclick="applyOrderDiscount('${o.id}')" style="background:var(--teal);color:#fff;border:none;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">&#10003;</button>
                <button onclick="toggleDescForm('${o.id}')" style="background:none;border:1px solid var(--border-mid);padding:4px 6px;border-radius:6px;font-size:11px;cursor:pointer;color:var(--muted);">&#10005;</button>
              </div>
            </div>
            <button onclick="toggleDescForm('${o.id}')"
              style="margin-top:5px;background:none;border:1px dashed var(--teal-light);color:var(--teal);padding:3px 8px;border-radius:6px;font-size:10px;cursor:pointer;">
              &#127991; Desconto
            </button>
          </td>
          <td><span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span></td>
          <td>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <select class="status-select" onchange="updateOrderStatus('${o.id}',this.value)" ${o.status==='cancelado'?'disabled':''}>
                <option value="pendente"   ${o.status==='pendente'  ?'selected':''}>Pendente</option>
                <option value="confirmado" ${o.status==='confirmado'?'selected':''}>Confirmado</option>
                <option value="pronto"     ${o.status==='pronto'    ?'selected':''}>Pronto</option>
                <option value="entregue"   ${o.status==='entregue'  ?'selected':''}>Entregue</option>
                <option value="cancelado"  ${o.status==='cancelado' ?'selected':''}>Cancelado</option>
              </select>
              ${o.cliente?.wpp && o.status !== 'cancelado' ? `<button onclick="notifyClient('${o.id}')" style="background:#25D366;color:#fff;border:none;padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px;justify-content:center;"><i class='ti ti-brand-whatsapp'></i> Avisar cliente</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join("");

  // Pagination
  const pgEl = document.getElementById("orders-pagination");
  if (pgEl) {
    let html = `<span style="font-size:12px;color:var(--muted);margin-right:4px;">${list.length} pedido(s)</span>`;
    html += `<button class="pg-btn ${ordersPage===1?'disabled':''}" onclick="goOrdersPage(${ordersPage-1})">‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
      if (totalPages <= 7 || Math.abs(p - ordersPage) <= 2 || p === 1 || p === totalPages) {
        html += `<button class="pg-btn ${p===ordersPage?'active':''}" onclick="goOrdersPage(${p})">${p}</button>`;
      } else if (Math.abs(p - ordersPage) === 3) {
        html += `<span style="color:var(--muted);padding:0 4px;">…</span>`;
      }
    }
    html += `<button class="pg-btn ${ordersPage===totalPages?'disabled':''}" onclick="goOrdersPage(${ordersPage+1})">›</button>`;
    pgEl.innerHTML = html;
  }
}

function goOrdersPage(p) {
  const q = (document.getElementById("orders-search")?.value || "").toLowerCase();
  let list = orderFilterStatus === "todos" ? allOrders : allOrders.filter(o => o.status === orderFilterStatus);
  if (q) list = list.filter(o => (o.cliente?.nome||"").toLowerCase().includes(q) || (o.cliente?.wpp||"").includes(q));
  const totalPages = Math.max(1, Math.ceil(list.length / ORDERS_PER_PAGE));
  ordersPage = Math.min(Math.max(1, p), totalPages);
  renderOrders();
}

function toggleDescForm(orderId) {
  const el = document.getElementById("desc-form-" + orderId);
  if (el) el.style.display = el.style.display === "none" ? "block" : "none";
}

async function applyOrderDiscount(orderId) {
  const valEl  = document.getElementById("desc-val-"  + orderId);
  const tipoEl = document.getElementById("desc-tipo-" + orderId);
  const val    = parseFloat(valEl?.value);
  const tipo   = tipoEl?.value || "reais";
  if (!val || val <= 0) { showToast("Informe um valor de desconto válido!"); return; }

  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const totalOriginal = order.totalOriginal ?? order.total ?? 0;
  let descReais;
  if (tipo === "pct") {
    if (val > 100) { showToast("Percentual não pode ser maior que 100%!"); return; }
    descReais = totalOriginal * val / 100;
  } else {
    descReais = val;
  }
  descReais = Math.min(descReais, totalOriginal);
  const novoTotal = Math.max(0, totalOriginal - descReais);

  try {
    await fbUpdate("orders", orderId, {
      descontoAdmin: descReais,
      descontoAdminTipo: tipo,
      totalOriginal: totalOriginal,
      totalComDesconto: novoTotal
    });
    allOrders = allOrders.map(o => o.id === orderId
      ? { ...o, descontoAdmin: descReais, descontoAdminTipo: tipo, totalOriginal, totalComDesconto: novoTotal }
      : o);
    showToast("Desconto de R$ " + descReais.toFixed(2).replace(".",",") + " aplicado!");
    renderOrders();
    addAuditLog(orderId, "Desconto admin: -R$ " + descReais.toFixed(2) + " (" + (tipo === "pct" ? val + "%" : "fixo") + ")", "desconto");
  } catch(e) { showToast("Erro ao salvar desconto"); console.error(e); }
}

function payLabel(p) { return { pix:"Pix", credito:"Crédito", debito:"Débito", dinheiro:"Dinheiro", fiado:"Fiado" }[p] || p || "—"; }
function statusLabel(s) { return { pendente:"pendente", confirmado:"confirmado", pronto:"pronto", entregue:"entregue", cancelado:"cancelado" }[s] || s || "pendente"; }
function statusClass(s) { return { pendente:"s-pending", confirmado:"s-confirmed", pronto:"s-ready", entregue:"s-done", cancelado:"s-cancelled" }[s] || "s-pending"; }

async function togglePayConfirm(id, confirmed) {
  try { await fbUpdate("orders", id, { pagamentoConfirmado: confirmed }); } catch(e) { console.warn(e); }
  allOrders = allOrders.map(o => o.id === id ? { ...o, pagamentoConfirmado: confirmed } : o);
  renderOrders();
  addAuditLog(id, confirmed ? "Pagamento confirmado" : "Confirmação de pagamento removida", "pagamento");
}

async function updateOrderPayMethod(id, newPay) {
  const order = allOrders.find(o => o.id === id);
  if (!order) return;
  const oldPay = order.pagamento;
  try { await fbUpdate("orders", id, { pagamento: newPay }); } catch(e) { console.warn(e); return; }
  allOrders = allOrders.map(o => o.id === id ? { ...o, pagamento: newPay } : o);
  addAuditLog(id, `Forma de pagamento alterada: ${payLabel(oldPay)} → ${payLabel(newPay)}`, "pagamento");
  // If changing to fiado: auto-link to client's fiado account
  if (newPay === "fiado" && order.cliente?.wpp) {
    const wpp = order.cliente.wpp.replace(/\D/g,"");
    let accounts = [];
    try { accounts = await fbGet("fiadoAccounts"); } catch {}
    let acc = accounts.find(a => a.clientWpp?.replace(/\D/g,"") === wpp);
    if (!acc) {
      // Create fiado account for this client
      const novoAcc = {
        clientNome: order.cliente.nome || "Cliente",
        clientWpp: order.cliente.wpp,
        saldo: Number(order.total||0),
        autorizado: true,
        createdAt: new Date().toISOString()
      };
      try { await fbAdd("fiadoAccounts", novoAcc); } catch {}
      showToast(`Conta fiado criada para ${order.cliente.nome || "cliente"}`, "success");
    } else {
      // Add to existing balance
      const novoSaldo = Number(acc.saldo||0) + Number(order.total||0);
      try { await fbUpdate("fiadoAccounts", acc.id, { saldo: novoSaldo }); } catch {}
      showToast(`Valor adicionado à conta fiado de ${order.cliente.nome || "cliente"}`, "success");
    }
  }
  renderOrders();
}

function exportOrdersCSV() {
  const headers = ["#", "Cliente", "WhatsApp", "Produtos", "Data Retirada", "Período", "Pagamento", "Pago", "Total", "Status", "Desconto%"];
  const rows = allOrders.map(o => [
    o.orderNum || o.id,
    o.cliente?.nome || "",
    o.cliente?.wpp || "",
    (o.itens||[]).map(i=>`${i.qty}x ${i.nome}`).join("; "),
    o.dataRetirada || "",
    o.periodo || "",
    payLabel(o.pagamento),
    o.pagamentoConfirmado ? "Sim" : "Não",
    Number(o.total||0).toFixed(2),
    o.status || "",
    o.descontoAplicado || ""
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `pedidos_panillo_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── HISTÓRICO DO SISTEMA (persistente no Firestore) ──────────────────────
const auditLog = []; // mantido em memória para compatibilidade com código existente

// Registra evento no Firestore e no array local
async function addAuditLog(refId, msg, tipo) {
  const now = new Date();
  const entry = {
    refId:  refId  || "",
    msg:    msg    || "",
    tipo:   tipo   || _inferTipo(msg),
    data:   now.toLocaleDateString("pt-BR"),
    hora:   now.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" }),
    ts:     now.toISOString()
  };
  auditLog.unshift(entry);
  if (auditLog.length > 500) auditLog.pop();
  // Persiste no Firestore em background — desiste silenciosamente se não tiver permissão
  if (window._historicoPermDenied) return;
  try {
    if (db && FB) {
      FB.addDoc(FB.collection(db, "historico"), { ...entry, createdAt: FB.serverTimestamp() })
        .catch(e => {
          if (e?.code === "permission-denied") {
            window._historicoPermDenied = true;
            // Regra não configurada no Firestore — falha silenciosa, não afeta funcionamento
          }
        });
    }
  } catch(e) {}
}

function _inferTipo(msg) {
  if (!msg) return "sistema";
  const m = msg.toLowerCase();
  if (m.includes("pagamento")) return "pagamento";
  if (m.includes("desconto"))  return "desconto";
  if (m.includes("fiado"))     return "fiado";
  if (m.includes("estoque"))   return "estoque";
  if (m.includes("cliente"))   return "cliente";
  if (m.includes("status") || m.includes("→") || m.includes("pendente") || m.includes("entregue") || m.includes("cancelado")) return "status";
  if (m.includes("pedido"))    return "pedido";
  return "sistema";
}

let _histPage = 1;
const HIST_PER_PAGE = 30;
let _histDocs = [];

async function loadHistoricoAdmin() {
  try {
    const snap = await FB.getDocs(
      FB.query(FB.collection(db, "historico"), FB.orderBy("createdAt", "desc"))
    );
    _histDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Funde com auditLog em memória (eventos desta sessão ainda não persistidos)
    auditLog.forEach(e => {
      if (!_histDocs.some(d => d.ts === e.ts && d.msg === e.msg)) {
        _histDocs.unshift(e);
      }
    });
  } catch {
    // Firestore indisponível — usa apenas memória
    _histDocs = [...auditLog];
  }
  renderHistoricoAdmin();
}

const HIST_TIPO_LABEL = {
  pedido:"🛒 Pedido", pagamento:"💰 Pagamento", status:"🔄 Status",
  fiado:"🤝 Fiado", estoque:"📦 Estoque", desconto:"🏷️ Desconto",
  cliente:"👤 Cliente", sistema:"⚙️ Sistema"
};
const HIST_TIPO_COLOR = {
  pedido:"#3D1500", pagamento:"#27ae60", status:"#8e44ad",
  fiado:"#2980b9", estoque:"#e67e22", desconto:"#16a085",
  cliente:"#c0392b", sistema:"#7f8c8d"
};

function renderHistoricoAdmin() {
  const list = document.getElementById("hist-list");
  const pgEl  = document.getElementById("hist-pagination");
  if (!list) return;

  const filtroTipo = document.getElementById("hist-filter-tipo")?.value || "todos";
  let docs = filtroTipo === "todos" ? _histDocs : _histDocs.filter(d => d.tipo === filtroTipo);

  // KPIs
  const hoje = new Date().toLocaleDateString("pt-BR");
  const semanaAgo = new Date(Date.now() - 7*24*60*60*1000);
  const countEl = document.getElementById("hist-total-count");
  const todayEl = document.getElementById("hist-today-count");
  const weekEl  = document.getElementById("hist-week-count");
  if (countEl) countEl.textContent = _histDocs.length;
  if (todayEl) todayEl.textContent = _histDocs.filter(d => d.data === hoje).length;
  if (weekEl)  weekEl.textContent  = _histDocs.filter(d => new Date(d.ts||0) >= semanaAgo).length;

  if (docs.length === 0) {
    list.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:24px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">📋</div>Nenhum evento registrado ainda.</div>`;
    if (pgEl) pgEl.innerHTML = "";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(docs.length / HIST_PER_PAGE));
  if (_histPage > totalPages) _histPage = totalPages;
  const page = docs.slice((_histPage-1)*HIST_PER_PAGE, _histPage*HIST_PER_PAGE);

  list.innerHTML = page.map(d => {
    const tipo    = d.tipo || "sistema";
    const cor     = HIST_TIPO_COLOR[tipo] || "#7f8c8d";
    const tipoLabel = HIST_TIPO_LABEL[tipo] || tipo;
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 14px;background:#fff;border:1px solid var(--border-light);border-radius:10px;border-left:3px solid ${cor};">
      <div style="flex-shrink:0;margin-top:2px;">
        <span style="font-size:10px;font-weight:700;background:${cor}20;color:${cor};padding:2px 7px;border-radius:20px;white-space:nowrap;">${tipoLabel}</span>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;color:var(--text);">${escHtml(d.msg || "—")}</div>
        ${d.refId ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">Ref: ${escHtml(d.refId)}</div>` : ""}
      </div>
      <div style="flex-shrink:0;text-align:right;">
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;">${d.data || ""}</div>
        <div style="font-size:11px;color:var(--muted);">${d.hora || ""}</div>
      </div>
    </div>`;
  }).join("");

  // Pagination
  if (pgEl) {
    let html = `<span style="font-size:12px;color:var(--muted);margin-right:4px;">${docs.length} evento(s)</span>`;
    html += `<button class="pg-btn ${_histPage===1?'disabled':''}" onclick="_histPage--;renderHistoricoAdmin()">‹</button>`;
    for (let p=1;p<=totalPages;p++) {
      if (totalPages<=7||Math.abs(p-_histPage)<=2||p===1||p===totalPages) {
        html += `<button class="pg-btn ${p===_histPage?'active':''}" onclick="_histPage=${p};renderHistoricoAdmin()">${p}</button>`;
      } else if (Math.abs(p-_histPage)===3) {
        html += `<span style="color:var(--muted);padding:0 4px;">…</span>`;
      }
    }
    html += `<button class="pg-btn ${_histPage===totalPages?'disabled':''}" onclick="_histPage++;renderHistoricoAdmin()">›</button>`;
    pgEl.innerHTML = html;
  }
}

function exportHistoricoCSV() {
  const headers = ["Data","Hora","Tipo","Mensagem","Referência"];
  const rows = _histDocs.map(d => [d.data||"", d.hora||"", d.tipo||"", d.msg||"", d.refId||""]);
  const csv = [headers,...rows].map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href=url; a.download=`historico_panillo_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

async function updateOrderStatus(id, newStatus) {
  const order = allOrders.find(o => o.id === id);
  const prevStatus = order ? order.status : null;
  if (prevStatus === newStatus) return;

  // Confirm cancellation
  if (newStatus === "cancelado") {
    if (!confirm(`Cancelar o pedido de ${order?.cliente?.nome || "cliente"}? Esta ação não pode ser desfeita.`)) return;
  }

  try { await fbUpdate("orders", id, { status: newStatus, [`statusLog_${Date.now()}`]: newStatus }); } catch(e) { console.warn("updateOrderStatus:", e); }
  allOrders = allOrders.map(o => o.id === id ? {...o, status: newStatus} : o);
  const badge = allOrders.filter(o => o.status === "pendente").length;
  document.getElementById("badge-pedidos").textContent = badge;
  updateMbnBadge(badge);
  addAuditLog(id, `Status: ${statusLabel(prevStatus)} → ${statusLabel(newStatus)} (${order?.cliente?.nome||"cliente"})`, "status");

  // ── Baixa estoque PE ao confirmar (ou primeiro status ativo) ──────────
  // Desconta assim que o pedido é aceito — reflete estoque real imediatamente.
  const statusAtivos = ["confirmado","pronto","entregue"];
  if (statusAtivos.includes(newStatus) && !statusAtivos.includes(prevStatus) &&
      order && order.tipo === "pronta-entrega" && !order._stockDecremented) {
    let stockChanged = false;
    for (const item of (order.itens || [])) {
      if (!item.prodId) continue;
      const s = allStock[item.prodId];
      if (!s?.id) { console.warn("Sem entrada de estoque para:", item.prodId); continue; }
      const newQty = Math.max(0, (s.qty || 0) - (item.qty || 0));
      try {
        await FB.updateDoc(FB.doc(db, "stock", s.id), { qty: newQty });
        allStock[item.prodId] = { ...s, qty: newQty };
        stockChanged = true;
      } catch(e) { console.error("Erro ao baixar estoque:", item.prodId, e); }
    }
    try { await fbUpdate("orders", id, { _stockDecremented: true }); } catch(e) {}
    allOrders = allOrders.map(o => o.id === id ? { ...o, _stockDecremented: true } : o);
    if (stockChanged) { renderStockAdmin(); renderPEProducts(); }
  }

  // ── Devolve estoque PE se cancelado ──────────────────────────
  // Restaura se: (a) flag _stockDecremented está true, OU
  //              (b) status anterior era "entregue" (estoque já foi baixado)
  if (newStatus === "cancelado" && order?.tipo === "pronta-entrega") {
    const shouldRestore = order._stockDecremented === true || ["confirmado","pronto","entregue"].includes(prevStatus);
    if (shouldRestore) {
      let stockChanged = false;
      for (const item of (order.itens || [])) {
        if (!item.prodId) continue;
        const s = allStock[item.prodId];
        if (!s?.id) continue;
        const restored = (s.qty || 0) + (item.qty || 0);
        try {
          await FB.updateDoc(FB.doc(db, "stock", s.id), { qty: restored });
          allStock[item.prodId] = { ...s, qty: restored };
          stockChanged = true;
        } catch(e) { console.error("Erro ao restaurar estoque:", item.prodId, e); }
      }
      try { await fbUpdate("orders", id, { _stockDecremented: false }); } catch(e) {}
      allOrders = allOrders.map(o => o.id === id ? { ...o, _stockDecremented: false } : o);
      if (stockChanged) { renderStockAdmin(); renderPEProducts(); }
    }
  }

  renderOrders();
  showToast("Status atualizado!");
}

function filterOrders(status, btn) {
  orderFilterStatus = status;
  ordersPage = 1;
  document.querySelectorAll(".sf-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderOrders();
}

// ─── ADMIN: CLIENTS ────────────────────────────────────
async function renderClients() {
  let clients = [];
  try { clients = await fbGet("clients"); allClients = clients; } catch {}
  if (!allFiadoAccounts || allFiadoAccounts.length === 0) {
    try { allFiadoAccounts = await fbGet("fiadoAccounts"); } catch { allFiadoAccounts = []; }
  }

  // Total badge (always total, regardless of filters)
  const totalBadge = document.getElementById("clients-total-badge");
  if (totalBadge) totalBadge.textContent = `${clients.length} cliente${clients.length !== 1 ? "s" : ""}`;

  // Birthday alerts
  renderBdayAlerts(clients);

  // Search filter
  const q = (document.getElementById("clients-search")?.value || "").toLowerCase();
  let filtered = q
    ? clients.filter(c => (c.nome||"").toLowerCase().includes(q) || (c.wpp||"").includes(q))
    : [...clients];

  // Sort
  const sort = document.getElementById("clients-sort")?.value || "nome-az";
  const today = new Date();
  filtered.sort((a, b) => {
    switch (sort) {
      case "nome-az":       return (a.nome||"").localeCompare(b.nome||"", "pt-BR");
      case "nome-za":       return (b.nome||"").localeCompare(a.nome||"", "pt-BR");
      case "gasto-maior":   return Number(b.totalGasto||0) - Number(a.totalGasto||0);
      case "gasto-menor":   return Number(a.totalGasto||0) - Number(b.totalGasto||0);
      case "pedidos-maior": return Number(b.pedidos||0) - Number(a.pedidos||0);
      case "pedidos-menor": return Number(a.pedidos||0) - Number(b.pedidos||0);
      case "aniversario": {
        const diff = (c) => {
          if (!c.bday) return 999;
          const bd = new Date(c.bday+"T12:00");
          const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
          const d = Math.ceil((bdThis - today)/(1000*60*60*24));
          return d < 0 ? d + 365 : d;
        };
        return diff(a) - diff(b);
      }
      default: return 0;
    }
  });

  const countEl = document.getElementById("clients-count");
  if (countEl) countEl.textContent = q ? `${filtered.length} de ${clients.length} cliente(s)` : `${filtered.length} cliente(s)`;

  const tbody = document.getElementById("clients-tbody");
  tbody.innerHTML = filtered.length === 0
    ? `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted);">Nenhum cliente encontrado</td></tr>`
    : filtered.map((c, index) => {
        // Birthday badge
        let bdayHtml = "—";
        if (c.bday) {
          const bd = new Date(c.bday + "T12:00");
          const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
          const diff = Math.ceil((bdThis - today)/(1000*60*60*24));
          const diffAdj = diff < 0 ? diff + 365 : diff;
          const label = diffAdj === 0 ? "🎉 Hoje!" : diffAdj === 1 ? "Amanhã" : diffAdj <= 5 ? `em ${diffAdj} dias` : "";
          const cls = diffAdj <= 5 ? "bday-soon" : diffAdj <= 14 ? "bday-ok" : "";
          bdayHtml = `<span class="bday-badge ${cls}" style="font-size:12px;">${bd.toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}${label ? ` · <b>${label}</b>` : ""}</span>`;
        }
        // Fiado badge
        const fiadoAcc = allFiadoAccounts.find(a => (a.clientWpp||"").replace(/\D/g,"") === (c.wpp||"").replace(/\D/g,""));
        let fiadoHtml;
        if (fiadoAcc && fiadoAcc.autorizado) {
          const saldo = Number(fiadoAcc.saldo||0).toFixed(2).replace(".",",");
          fiadoHtml = `<span style="display:inline-flex;align-items:center;gap:4px;background:#FDF0E0;color:#6B2C0A;border-radius:8px;padding:3px 9px;font-size:11px;font-weight:500;">✅ R$${saldo}</span>`;
        } else if (fiadoAcc && !fiadoAcc.autorizado) {
          fiadoHtml = `<span style="background:#FAECE7;color:#993C1D;border-radius:8px;padding:3px 9px;font-size:11px;font-weight:500;">⛔</span>`;
        } else {
          fiadoHtml = `<span style="color:var(--muted);font-size:11px;">—</span>`;
        }
        const idSafe = (c.id||"").replace(/'/g,"\\'");
        return `<tr>
          <td style="text-align:center;font-size:11px;color:var(--muted);font-weight:600;">${index + 1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="client-av" style="flex-shrink:0;">${(c.nome||"?").substring(0,2).toUpperCase()}</div>
              <div>
                <div class="client-name">${escHtml(c.nome||"—")}</div>
                ${c.obs ? `<div style="font-size:10px;color:var(--muted);">${escHtml(c.obs.substring(0,35))}…</div>` : ""}
              </div>
            </div>
          </td>
          <td><a href="https://wa.me/55${(c.wpp||"").replace(/\D/g,"")}" target="_blank" style="color:var(--teal);text-decoration:none;">${c.wpp||"—"}</a></td>
          <td>${bdayHtml}</td>
          <td style="text-align:center;font-weight:600;color:var(--teal-dark);">${c.pedidos||0}</td>
          <td style="font-weight:600;">R$ ${Number(c.totalGasto||0).toFixed(2).replace(".",",")}</td>
          <td style="font-size:12px;">${c.favorito||"—"}</td>
          <td>${fiadoHtml}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="pay-confirm-btn" onclick="openClientDetail('${idSafe}')">📋 Ver</button>
              <button class="pay-confirm-btn" style="background:#FDF0E0;color:#8B4513;" onclick="openClientDetail('${idSafe}',true)">✏️ Editar</button>
              <button class="pay-confirm-btn" style="background:#FAECE7;color:#993C1D;" onclick="confirmDeleteClient('${idSafe}','${escHtml(c.nome||'')}')">🗑️</button>
            </div>
          </td>
        </tr>`;
      }).join("");
}

// ─── EXCLUIR CLIENTE ───────────────────────────────────
function confirmDeleteClient(clientId, clientNome) {
  // Mini modal de confirmação inline
  let modal = document.getElementById("modal-delete-client");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-delete-client";
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.45);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;padding:16px;
    `;
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.18);">
      <div style="font-size:40px;margin-bottom:12px;">🗑️</div>
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;">Excluir cadastro?</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.5;">
        Você está prestes a excluir o cadastro de<br>
        <strong style="color:var(--text);">${clientNome}</strong>.<br>
        O histórico de pedidos não será afetado.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button onclick="document.getElementById('modal-delete-client').style.display='none'"
          style="flex:1;padding:11px;border:1.5px solid var(--border);border-radius:10px;background:#fff;color:var(--muted);font-size:13px;cursor:pointer;">
          Cancelar
        </button>
        <button onclick="deleteClient('${clientId}')"
          style="flex:1;padding:11px;border:none;border-radius:10px;background:#993C1D;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
          Sim, excluir
        </button>
      </div>
    </div>`;
  modal.style.display = "flex";
}

async function deleteClient(clientId) {
  const modal = document.getElementById("modal-delete-client");
  if (modal) modal.style.display = "none";
  try {
    await FB.deleteDoc(FB.doc(db, "clients", clientId));
    allClients = allClients.filter(c => c.id !== clientId);
    showToast("Cadastro excluído!");
    renderClients();
  } catch(e) {
    console.error("Erro ao excluir cliente:", e);
    showToast("Erro ao excluir cadastro.");
  }
}

// ─── ADMIN: PRODUCTS ───────────────────────────────────
function renderAdminProducts() {
  const grid = document.getElementById("admin-products-grid");
  if (!grid) return;
  if (allProducts.length === 0) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px;">Nenhum produto cadastrado. Clique em "+ Novo produto".</div>';
    return;
  }
  grid.innerHTML = allProducts.map(p => {
    const inativo = p.ativo === false;
    const badegeInativo = inativo ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;"><span style="background:#993C1D;color:#fff;font-size:10px;font-weight:700;padding:4px 10px;border-radius:8px;">INATIVO</span></div>' : '';
    const toggleStyle = inativo ? 'background:#FDF0E0;color:#8B4513;border-color:#8B451344;' : 'background:#FDF6E8;color:#C8902A;border-color:#C8902A44;';
    const toggleLabel = inativo ? 'Ativar' : 'Desativar';
    const nomeSafe = p.nome.replace(/'/g, "\\'");
    return `<div class="prod-admin-card" style="opacity:${inativo?'0.55':'1'}">
      <div class="pac-img ${p.categoria}" style="position:relative;${p.fotoUrl?'padding:0;overflow:hidden;font-size:0;':''}">
        ${p.fotoUrl
          ? `<img src="${p.fotoUrl}" alt="${p.nome}" style="width:100%;height:100%;object-fit:cover;object-position:${p.fotoPos?p.fotoPos.x+'% '+p.fotoPos.y+'%':'50% 50%'};display:block;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none;width:100%;height:100%;align-items:center;justify-content:center;font-size:48px;">${p.emoji||'🍪'}</span>`
          : (p.emoji||'🍪')}
        ${badegeInativo}
      </div>
      <div class="pac-body">
        <div class="pac-name">${p.nome}</div>
        <div class="pac-price">R$ ${Number(p.preco).toFixed(2).replace(".",",")}</div>
        <div class="pac-actions" style="flex-wrap:wrap;gap:6px;">
          <button class="pac-btn" style="flex:1;" onclick="openProdModal('${p.id}')">✏️ Editar</button>
          <button class="pac-btn" style="flex:1;${toggleStyle}" onclick="toggleProdActive('${p.id}',${inativo})">${toggleLabel}</button>
          <button class="pac-btn" style="flex:1;background:#FAECE7;color:#993C1D;border-color:#99333344;" onclick="deleteProd('${p.id}','${nomeSafe}')">🗑 Deletar</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

