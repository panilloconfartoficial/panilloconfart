// ─── DASHBOARD ─────────────────────────────────────────
// ─── PERIOD TOGGLE ─────────────────────────────────────
let periodMode = "mes";
function togglePeriod() {
  periodMode = periodMode === "mes" ? "semana" : periodMode === "semana" ? "ano" : "mes";
  const labels = { mes:"Este mês", semana:"Esta semana", ano:"Este ano" };
  document.getElementById("period-btn").textContent = labels[periodMode];
  loadDashboard();
}

function _periodOrders() {
  const now = new Date();
  return allOrders.filter(o => {
    // Faturamento só conta pedidos pagos/entregues
    if (!["confirmado","pronto","entregue"].includes(o.status)) return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000)
             : o.dataRetirada       ? new Date(o.dataRetirada + "T12:00")
             : null;
    if (!ts) return false;
    if (periodMode === "semana") {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return ts >= d;
    } else if (periodMode === "mes") {
      return ts.getFullYear() === now.getFullYear() && ts.getMonth() === now.getMonth();
    } else { // ano
      return ts.getFullYear() === now.getFullYear();
    }
  });
}

function _prevPeriodOrders() {
  const now = new Date();
  return allOrders.filter(o => {
    if (!["confirmado","pronto","entregue"].includes(o.status)) return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000)
             : o.dataRetirada       ? new Date(o.dataRetirada + "T12:00")
             : null;
    if (!ts) return false;
    if (periodMode === "semana") {
      const d1 = new Date(now); d1.setDate(d1.getDate() - 14);
      const d2 = new Date(now); d2.setDate(d2.getDate() - 7);
      return ts >= d1 && ts < d2;
    } else if (periodMode === "mes") {
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      return ts.getFullYear() === prevYear && ts.getMonth() === prevMonth;
    } else {
      return ts.getFullYear() === now.getFullYear() - 1;
    }
  });
}

function _calcLucro(orders) {
  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overhead = parseFloat(cfg.overhead || 20) / 100; // default 20%
  let custoIngredientes = 0;
  orders.forEach(o => {
    (o.itens||[]).forEach(i => {
      const prod = allProducts.find(p => p.id === i.prodId || p.nome === i.nome);
      if (prod?.custoPorUnidade) custoIngredientes += prod.custoPorUnidade * (i.qty||1);
    });
  });
  const fat = orders.reduce((s,o) => s + (o.total||0), 0);
  const custoOp = fat * overhead;
  return Math.max(0, fat - custoIngredientes - custoOp);
}

function _deltaHtml(curr, prev, prefix = "R$ ") {
  if (prev === 0) return `<span class="kpi-delta flat">— sem período anterior</span>`;
  const pct = ((curr - prev) / prev * 100).toFixed(1);
  const up = curr >= prev;
  return `<span class="kpi-delta ${up ? 'up' : 'down'}">${up ? '↑' : '↓'} ${Math.abs(pct)}% vs período anterior</span>`;
}

async function loadDashboard() {
  const orders  = _periodOrders();
  const prev    = _prevPeriodOrders();
  const fat     = orders.reduce((s,o) => s + (o.total||0), 0);
  const fatPrev = prev.reduce((s,o)   => s + (o.total||0), 0);
  const lucro   = _calcLucro(orders);
  const lucroPrev = _calcLucro(prev);
  const ticket  = orders.length ? fat / orders.length : 0;
  const ticketPrev = prev.length ? fatPrev / prev.length : 0;
  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overhead = parseFloat(cfg.overhead || 20);

  document.getElementById("kpi-fat").textContent    = `R$ ${fat.toFixed(2).replace(".",",")}`;
  document.getElementById("kpi-lucro").textContent  = `R$ ${lucro.toFixed(2).replace(".",",")}`;
  document.getElementById("kpi-ped").textContent    = orders.length;
  document.getElementById("kpi-ticket").textContent = `R$ ${ticket.toFixed(2).replace(".",",")}`;

  document.getElementById("kpi-fat-d").innerHTML    = _deltaHtml(fat, fatPrev);
  document.getElementById("kpi-lucro-d").innerHTML  = `<span class="kpi-delta flat">Custo op.: ${overhead}% | Ingredientes calculados</span>`;
  document.getElementById("kpi-ped-d").innerHTML    = _deltaHtml(orders.length, prev.length, "");
  document.getElementById("kpi-ticket-d").innerHTML = _deltaHtml(ticket, ticketPrev);

  // Recent orders
  const recentEl = document.getElementById("recent-orders-list");
  if (recentEl) {
    const recent = [...allOrders].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,6);
    recentEl.innerHTML = recent.length === 0
      ? `<div style="color:var(--muted);font-size:13px;padding:12px 0;">Nenhum pedido ainda</div>`
      : recent.map(o => `
        <div class="order-row">
          <div class="order-av">🍪</div>
          <div class="order-inf">
            <div class="order-name">${escHtml(o.cliente?.nome||"—")}</div>
            <div class="order-detail">${(o.itens||[]).map(i=>`${i.qty}× ${escHtml(i.nome)}`).join(", ")}</div>
          </div>
          <div style="text-align:right;">
            <div class="order-amt">R$ ${Number(o.total||0).toFixed(2).replace(".",",")}</div>
            <span class="status-badge ${statusClass(o.status)}">${statusLabel(o.status)}</span>
          </div>
        </div>`).join("");
  }

  // Top products chart
  const prodCount = {};
  orders.forEach(o => (o.itens||[]).forEach(i => { prodCount[i.nome] = (prodCount[i.nome]||0)+i.qty; }));
  const sorted = Object.entries(prodCount).sort((a,b)=>b[1]-a[1]);
  const maxQty = sorted[0]?.[1] || 1;
  const chartEl = document.getElementById("top-products-chart");
  if (chartEl) {
    chartEl.innerHTML = sorted.length === 0
      ? `<div style="color:var(--muted);font-size:13px;">Sem vendas no período</div>`
      : sorted.slice(0,6).map(([nome,qty]) => {
          const pct = Math.round(qty/maxQty*100);
          return `<div class="bar-item"><div class="bar-top"><span class="bar-name">${nome}</span><span class="bar-pct">${qty} un.</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--teal-dark);"></div></div></div>`;
        }).join("");
  }

  // Temporal chart (SVG line)
  renderTemporalChart(orders);

  // Alerts: low stock + birthdays
  renderDashAlerts();

  // AI insights with real data
  generateAutoInsights(orders, fat, lucro);
}

function renderTemporalChart(orders) {
  const svg = document.getElementById("temporal-chart");
  if (!svg) return;
  // Build daily/weekly buckets for last 30 days
  const now = new Date();
  const buckets = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    buckets[key] = 0;
  }
  orders.forEach(o => {
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000)
             : o.dataRetirada       ? new Date(o.dataRetirada+"T12:00")
             : null;
    if (!ts) return;
    const key = ts.toISOString().slice(0,10);
    if (key in buckets) buckets[key] += (o.total||0);
  });

  const vals = Object.values(buckets);
  const keys = Object.keys(buckets);
  const maxV  = Math.max(...vals, 1);
  const W = 560, H = 110, px = 32, py = 14;
  const iw = W - px*2, ih = H - py*2;
  const n = vals.length;
  const pts = vals.map((v,i) => [px + i/(n-1)*iw, py + ih - (v/maxV)*ih]);

  const path = "M " + pts.map(p => p.join(",")).join(" L ");
  const area = "M " + pts[0].join(",") + " L " + pts.map(p=>p.join(",")).join(" L ") + ` L ${pts[pts.length-1][0]},${py+ih} L ${pts[0][0]},${py+ih} Z`;

  // X-axis labels (every 7 days)
  let labels = "";
  [0,7,14,21,29].forEach(i => {
    if (i < n) {
      const d = new Date(keys[i]+"T12:00");
      const lbl = d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
      labels += `<text x="${pts[i][0]}" y="${H-2}" text-anchor="middle" font-size="9" fill="#aaa">${lbl}</text>`;
    }
  });

  // Max value label
  const maxLabel = `R$ ${maxV.toFixed(0)}`;
  svg.innerHTML = `
    <defs>
      <linearGradient id="tcGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--teal)" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="var(--teal)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#tcGrad)"/>
    <path d="${path}" fill="none" stroke="var(--teal-dark)" stroke-width="2" stroke-linejoin="round"/>
    ${pts.map((p,i) => vals[i] > 0 ? `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--teal-dark)"/>` : "").join("")}
    <text x="${px}" y="${py+8}" font-size="9" fill="#aaa">${maxLabel}</text>
    ${labels}`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
}

function renderDashAlerts() {
  const el = document.getElementById("dash-alerts-list");
  if (!el) return;
  let html = "";
  // Low stock
  const lowIng = allIngredients.filter(i => Number(i.estoque||0) < Number(i.min||0));
  if (lowIng.length > 0) {
    html += `<div style="font-size:12px;font-weight:600;color:#993C1D;margin-bottom:6px;">⚠️ Ingredientes abaixo do mínimo</div>`;
    html += lowIng.map(i => `<div class="order-row" style="padding:8px 0;border-bottom:0.5px solid var(--border);">
      <div class="order-av" style="background:#FAECE7;color:#993C1D;font-size:12px;">⚠</div>
      <div class="order-inf"><div class="order-name" style="font-size:13px;">${i.nome}</div>
      <div class="order-detail">Estoque: ${i.estoque} ${i.unit||""} · Mínimo: ${i.min} ${i.unit||""}</div></div>
    </div>`).join("");
  }
  // Birthdays next 14 days
  const today = new Date();
  const bdays = [];
  try {
    fbGet("clients").then(clients => {
      clients.forEach(c => {
        if (!c.bday) return;
        const bd = new Date(c.bday+"T12:00");
        const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
        const diff = Math.ceil((bdThis-today)/(1000*60*60*24));
        if (diff >= 0 && diff <= 14) bdays.push({ nome:c.nome, diff, wpp:c.wpp });
      });
      if (bdays.length > 0) {
        el.innerHTML += `<div style="font-size:12px;font-weight:600;color:var(--teal-dark);margin:10px 0 6px;">🎂 Aniversariantes em 14 dias</div>`;
        el.innerHTML += bdays.map(b => `<div class="order-row" style="padding:8px 0;">
          <div class="order-av" style="background:#FDF6E8;font-size:14px;">🎂</div>
          <div class="order-inf"><div class="order-name" style="font-size:13px;">${b.nome}</div>
          <div class="order-detail">${b.diff === 0 ? "🎉 Hoje!" : `em ${b.diff} dia(s)`}</div></div>
        </div>`).join("");
      }
    }).catch(()=>{});
  } catch(e){}
  el.innerHTML = html || `<div style="color:var(--muted);font-size:13px;padding:12px 0;">✅ Nenhum alerta no momento</div>`;
}

function generateAutoInsights(orders, fat, lucro) {
  const prodCount = {};
  orders.forEach(o => (o.itens||[]).forEach(i => { prodCount[i.nome] = (prodCount[i.nome]||0)+i.qty; }));
  const top = Object.entries(prodCount).sort((a,b)=>b[1]-a[1])[0];
  const lowStock = allIngredients.filter(i => Number(i.estoque||0) < Number(i.min||0));
  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overhead = cfg.overhead || 20;
  const margem = fat > 0 ? (lucro/fat*100).toFixed(1) : 0;
  const cancelados = allOrders.filter(o=>o.status==="cancelado").length;
  const semPagar = allOrders.filter(o=>["confirmado","pronto"].includes(o.status) && !o.pagamentoConfirmado).length;

  const insights = [];
  if (fat > 0) insights.push({ type:"pos", label:"Faturamento real", text:`R$ ${fat.toFixed(2).replace(".",",")} faturado no período com ${orders.length} pedido(s). Margem estimada: ${margem}% (overhead: ${overhead}%).` });
  if (top) insights.push({ type:"pos", label:"Produto destaque", text:`"${top[0]}" lidera com ${top[1]} unidades vendidas. Considere criar variações ou combos.` });
  if (lowStock.length > 0) insights.push({ type:"neg", label:"Estoque crítico", text:`${lowStock.map(i=>i.nome).join(", ")} abaixo do mínimo. Reponha antes de perder vendas.` });
  if (semPagar > 0) insights.push({ type:"warn", label:"Pagamentos pendentes", text:`${semPagar} pedido(s) confirmados ainda sem pagamento confirmado. Verifique o comprovante.` });
  if (cancelados > 0) insights.push({ type:"neg", label:"Cancelamentos", text:`${cancelados} pedido(s) cancelados no total. Analise o padrão para reduzir essa taxa.` });
  if (insights.length === 0) insights.push({ type:"pos", label:"Bem-vinda!", text:"Cadastre produtos e faça pedidos para ver as análises do seu negócio aqui." });

  const el = document.getElementById("dash-insights");
  if (el) el.innerHTML = insights.map(i =>
    `<div class="ai-insight ${i.type}"><div class="ai-insight-type">${i.label}</div><div class="ai-insight-text">${i.text}</div></div>`
  ).join("");
}

// ─── AI: BUSINESS ──────────────────────────────────────
async function askBusinessAI() {
  const input = document.getElementById("dash-ai-input");
  const q = input.value.trim();
  if (!q) return;
  const ctx = getBusinessContext();
  const responseEl = document.getElementById("dash-ai-response");
  responseEl.innerHTML = `<div class="ai-response-bubble">Pensando...</div>`;
  input.value = "";
  try {
    const resp = await callClaudeAPI(
      `Você é consultora de negócios da Panillo, confeitaria artesanal de cookies e brownies em Fortaleza, CE. Seja direta e prática.\n\nDados do negócio:\n${ctx}\n\nPergunta: ${q}`, 200
    );
    responseEl.innerHTML = `<div class="ai-response-bubble">${resp}</div>`;
  } catch {
    responseEl.innerHTML = `<div class="ai-response-bubble">Configure a API key da Anthropic no código para ativar a IA.</div>`;
  }
}

// ─── AI: IA PAGE ───────────────────────────────────────
function renderIASection() {
  renderPayMethodsChart();
  renderBdayList();
}

function renderBdayList() {
  const el = document.getElementById("bday-list");
  if (!el) return;
  const today = new Date();
  fbGet("clients").then(clients => {
    const bdays = clients.filter(c => {
      if (!c.bday) return false;
      const bd = new Date(c.bday+"T12:00");
      const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
      const diff = Math.ceil((bdThis-today)/(1000*60*60*24));
      return diff >= 0 && diff <= 30;
    }).sort((a,b) => {
      const da = new Date(today.getFullYear(), new Date(a.bday+"T12:00").getMonth(), new Date(a.bday+"T12:00").getDate());
      const db2 = new Date(today.getFullYear(), new Date(b.bday+"T12:00").getMonth(), new Date(b.bday+"T12:00").getDate());
      return da - db2;
    });
    el.innerHTML = bdays.length === 0
      ? `<div style="color:var(--muted);font-size:13px;">Nenhum aniversariante nos próximos 30 dias</div>`
      : bdays.map(c => {
          const bd = new Date(c.bday+"T12:00");
          const bdThis = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
          const diff = Math.ceil((bdThis-today)/(1000*60*60*24));
          return `<div class="order-row" style="padding:10px 0;">
            <div class="order-av" style="font-size:14px;">🎂</div>
            <div class="order-inf">
              <div class="order-name">${escHtml(c.nome)}</div>
              <div class="order-detail">${bd.toLocaleDateString("pt-BR",{day:"2-digit",month:"long"})} · ${diff===0?'🎉 Hoje!':diff===1?'Amanhã':`em ${diff} dias`}</div>
            </div>
            ${c.wpp ? `<button onclick="notifyBday('${escHtml(c.wpp)}','${escHtml(c.nome||"")}',this)" class="pay-confirm-btn" style="margin-left:8px;">🎁 Parabenizar</button>` : ''}
          </div>`;
        }).join("");
  }).catch(()=>{ el.innerHTML = `<div style="color:var(--muted);font-size:13px;">Erro ao carregar aniversariantes.</div>`; });
}

function notifyBday(wpp, nome, btn) {
  const msg = encodeURIComponent(`🎂 Feliz aniversário, ${nome.split(" ")[0]}! 🍪\n\nA Panillo te deseja um dia incrível! Que tal comemorar com nossos cookies artesanais? 🎉\n\nFaz teu pedido: ${window.location.origin}`);
  window.open(`https://wa.me/55${wpp.replace(/\D/g,"")}?text=${msg}`, "_blank");
  btn.textContent = "✓ Enviado";
}

function renderPayMethodsChart() {
  const el = document.getElementById("pay-methods-chart");
  if (!el) return;
  const counts = { pix:0, credito:0, debito:0, fiado:0 };
  const orders = _periodOrders();
  orders.forEach(o => { if (o.pagamento in counts) counts[o.pagamento]++; });
  const total = Object.values(counts).reduce((a,b)=>a+b,0) || 1;
  const labels = { pix:"Pix", credito:"Crédito", debito:"Débito", fiado:"Fiado" };
  const colors = { pix:"var(--teal-dark)", credito:"var(--gold)", debito:"#6B8E6B", fiado:"#993C1D" };
  el.innerHTML = Object.entries(counts).filter(([,v])=>v>0).map(([k,v]) => {
    const pct = Math.round(v/total*100);
    return `<div class="bar-item"><div class="bar-top"><span class="bar-name">${labels[k]}</span><span class="bar-pct">${pct}% (${v})</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[k]};"></div></div></div>`;
  }).join("") || `<div style="color:var(--muted);font-size:13px;">Sem dados no período</div>`;
}

function getBusinessContext() {
  const orders = _periodOrders();
  const fat = orders.reduce((s,o)=>s+(o.total||0),0);
  const lucro = _calcLucro(orders);
  const prodCount = {};
  orders.forEach(o=>(o.itens||[]).forEach(i=>{prodCount[i.nome]=(prodCount[i.nome]||0)+i.qty;}));
  const top = Object.entries(prodCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n,q])=>`${n}(${q})`).join(", ");
  const lowIng = allIngredients.filter(i=>Number(i.estoque||0)<Number(i.min||0)).map(i=>i.nome).join(", ");
  let plano = "";
  try {
    const pl = computePlano();
    const margens = pl.ranked.slice(0,8).map(i=>`${i.nome}: MC/un R$${i.cmUn.toFixed(2)}, MC/receita R$${i.cmRec.toFixed(2)}`).join(" ; ");
    const prejuizo = pl.loss.map(i=>i.nome).join(", ");
    plano = ` || PLANO DO MÊS (metodologia de margem de contribuição): pró-labore meta R$${pl.c.proLabore.toFixed(0)}, reserva R$${pl.c.reserva.toFixed(0)}, custo fixo total a cobrir R$${pl.custoFixoTotal.toFixed(2)}, valor da hora R$${pl.valorHora.toFixed(2)}. Para bater a meta: ~${pl.unidades} unidades/mês (~${pl.receitasTotal} receitas), meta semanal ~${pl.semanaUnid} unidades, uso de capacidade ${pl.usoCapacidade.toFixed(0)}%. Margem por produto (do melhor para o pior — ranqueie por MC/receita, pois o gargalo é o tempo de produção): ${margens}.${prejuizo ? " PRODUTOS NO PREJUÍZO (margem de contribuição negativa, não vale a pena vender pelo preço atual): " + prejuizo + "." : ""}`;
  } catch(e) {}
  return `Período: ${periodMode} | Faturamento: R$${fat.toFixed(2)} | Lucro estimado: R$${lucro.toFixed(2)} | Pedidos: ${orders.length} | Top produtos: ${top||"—"} | Ingredientes baixos: ${lowIng||"nenhum"} | Total clientes: ${allOrders.length}${plano}`;
}

// ─── ENGINE DE PRECIFICAÇÃO & PLANEJAMENTO (fonte única de verdade) ──────────
function _plPricePerG(ing){ return precoPorGrama(ing); }

function _planCfg(){
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("panillo-config")||"{}"); } catch(e){}
  const g = (id, def) => { const el = document.getElementById(id); const v = el ? parseFloat(el.value) : NaN; return isNaN(v) ? def : v; };
  return {
    proLabore:  g("pl-prolabore",  Number(saved.proLabore)||2500),
    reserva:    g("pl-reserva",    Number(saved.reserva)||0),
    contas:     g("pl-contas",     Number(saved.contasFixas)||200),
    cartao:     g("pl-cartao",     Number(saved.taxaCartao)||3.09)/100,
    horas:      g("pl-horas",      Number(saved.horasMes)||160),
    tempo:      g("pl-tempo",      Number(saved.tempoReceita)||55),
    perda:      g("pl-perda",      Number(saved.perda)||5)/100,
    capacidade: g("pl-capacidade", Number(saved.capacidadeReceitas)||80),
  };
}

function computePlano(){
  const c = _planCfg();
  const valorHora = c.horas > 0 ? c.proLabore / c.horas : 0;
  const prods = (allProducts||[]).filter(p => p.ingredientes && p.ingredientes.length > 0 && p.categoria !== "combo" && p.ativo !== false);
  const items = prods.map(p => {
    const rend = Number(p.rendimento) || 1;
    let ingReceita = 0;
    (p.ingredientes||[]).forEach(pi => {
      const ing = allIngredients.find(i => i.id === pi.ingId);
      if (ing) ingReceita += _plPricePerG(ing) * (Number(pi.grams)||0);
    });
    const ingUn   = (ingReceita/rend) * (1 + c.perda);
    const tempoAtivoProd = ((Number(p.tempoPreparoMin)||0) + (Number(p.tempoEmbalagemMin)||0)) > 0
      ? (Number(p.tempoPreparoMin)||0) + (Number(p.tempoEmbalagemMin)||0)
      : c.tempo;
    const laborUn = (tempoAtivoProd/rend) * valorHora / 60;
    const preco   = Number(p.preco) || 0;
    const cmUn    = preco*(1 - c.cartao) - ingUn - laborUn;
    return { id:p.id, nome:p.nome, emoji:p.emoji||"🍪", rend, preco, ingUn, laborUn, custoUn:ingUn+laborUn, cmUn, cmRec:cmUn*rend };
  });
  const sellable = items.filter(i => i.cmUn > 0);
  const loss     = items.filter(i => i.cmUn <= 0);
  const custoFixoTotal = c.contas + c.proLabore + c.reserva;
  const avgCm = sellable.length ? sellable.reduce((s,i)=>s+i.cmUn,0)/sellable.length : 0;
  const unidades = avgCm > 0 ? Math.ceil(custoFixoTotal/avgCm) : 0;
  const nProd = sellable.length || 1;
  const unitsPerProd = unidades/nProd;
  let receitasTotal = 0;
  const dist = sellable.map(i => {
    const receitas = Math.max(1, Math.ceil(unitsPerProd / i.rend));
    receitasTotal += receitas;
    return { ...i, receitas, unidadesReais: receitas*i.rend };
  });
  const semanaUnid = Math.ceil(unidades/4.33);
  const semanaRec  = Math.ceil(receitasTotal/4.33);
  const usoCapacidade = c.capacidade > 0 ? receitasTotal/c.capacidade*100 : 0;
  const faturamento = dist.reduce((s,d)=>s+d.unidadesReais*d.preco,0);
  const compraMap = {};
  dist.forEach(d => {
    const p = allProducts.find(x => x.id === d.id);
    (p.ingredientes||[]).forEach(pi => { compraMap[pi.ingId] = (compraMap[pi.ingId]||0) + (Number(pi.grams)||0)*d.receitas; });
  });
  const compras = Object.entries(compraMap).map(([ingId, grams]) => {
    const ing = allIngredients.find(i => i.id === ingId) || { nome:ingId, estoque:0, unit:"g", preco:0 };
    const estoque = Number(ing.estoque)||0;
    const comprar = Math.max(0, grams - estoque);
    return { nome:ing.nome, unit:ing.unit||"g", precisa:grams, estoque, comprar, custo:comprar*_plPricePerG(ing) };
  }).sort((a,b)=>b.custo-a.custo);
  const custoCompras = compras.reduce((s,x)=>s+x.custo,0);
  const ranked = [...sellable].sort((a,b)=>b.cmRec-a.cmRec);
  return { c, valorHora, items, sellable, loss, ranked, dist, custoFixoTotal, avgCm, unidades, receitasTotal, semanaUnid, semanaRec, usoCapacidade, faturamento, compras, custoCompras };
}

function loadPlanejamento(){
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("panillo-config")||"{}"); } catch(e){}
  const set = (id,v) => { const el = document.getElementById(id); if (el && v != null && v !== "") el.value = v; };
  set("pl-prolabore", saved.proLabore);
  set("pl-reserva", saved.reserva);
  set("pl-contas", saved.contasFixas);
  set("pl-cartao", saved.taxaCartao);
  set("pl-horas", saved.horasMes);
  set("pl-tempo", saved.tempoReceita);
  set("pl-perda", saved.perda);
  set("pl-capacidade", saved.capacidadeReceitas);
  recalcPlano();
}

function _brl(v){ return "R$ " + (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

function recalcPlano(){
  const pl = computePlano();
  const card = (lbl,val,sub) => `<div style="background:rgba(196,123,53,0.10);border-radius:10px;padding:14px 16px;">
      <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">${lbl}</div>
      <div style="font-size:24px;font-weight:600;color:var(--text);">${val}</div>
      ${sub?`<div style="font-size:11px;color:var(--muted);margin-top:2px;">${sub}</div>`:""}</div>`;

  document.getElementById("pl-resumo").innerHTML =
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">
      ${card("Cookies a vender no mês", pl.unidades, "para cobrir custo fixo + seu salário")}
      ${card("Receitas a produzir", pl.receitasTotal, `de ${pl.c.capacidade} possíveis (${Math.round(pl.usoCapacidade)}%)`)}
      ${card("Meta semanal", pl.semanaUnid + " un.", `≈ ${pl.semanaRec} receitas/semana`)}
      ${card("Faturamento estimado", _brl(pl.faturamento), "se vender tudo do plano")}
    </div>`;

  let aviso = "";
  if (pl.sellable.length === 0){
    aviso = `<div style="background:rgba(226,75,74,0.12);border-left:3px solid #E24B4A;border-radius:0 8px 8px 0;padding:12px 14px;margin-top:14px;font-size:13px;color:var(--text);">Nenhum produto com margem positiva encontrado. Cadastre produtos com ingredientes (com gramas e preços) na aba Suprimentos para o cálculo funcionar.</div>`;
  } else {
    if (pl.usoCapacidade > 100) aviso += `<div style="background:rgba(226,75,74,0.12);border-left:3px solid #E24B4A;border-radius:0 8px 8px 0;padding:12px 14px;margin-top:14px;font-size:13px;color:var(--text);"><strong>Atenção:</strong> esta meta exige ${pl.receitasTotal} receitas, acima da sua capacidade de ${pl.c.capacidade}/mês (${Math.round(pl.usoCapacidade)}%). Reduza o pró-labore/reserva, aumente preços ou foque nos produtos de melhor margem.</div>`;
    else if (pl.usoCapacidade > 85) aviso += `<div style="background:rgba(186,117,23,0.12);border-left:3px solid #BA7517;border-radius:0 8px 8px 0;padding:12px 14px;margin-top:14px;font-size:13px;color:var(--text);">Margem de segurança apertada: ${Math.round(pl.usoCapacidade)}% da capacidade. Sobra pouco espaço para imprevistos.</div>`;
    if (pl.loss.length) aviso += `<div style="background:rgba(186,117,23,0.12);border-left:3px solid #BA7517;border-radius:0 8px 8px 0;padding:12px 14px;margin-top:10px;font-size:13px;color:var(--text);"><strong>No prejuízo pelo preço atual:</strong> ${pl.loss.map(i=>i.nome).join(", ")} — cada unidade vendida tira dinheiro do seu bolso. Suba o preço ou tire do cardápio.</div>`;
  }
  document.getElementById("pl-aviso").innerHTML = aviso;

  if (pl.sellable.length){
    const rows = pl.ranked.map((i,idx) => {
      const d = pl.dist.find(x=>x.id===i.id) || {receitas:0,unidadesReais:0};
      const best = idx === 0 ? ` <span style="background:rgba(29,158,117,0.15);color:#1D9E75;font-size:10px;padding:2px 7px;border-radius:6px;">melhor margem</span>` : "";
      return `<tr>
        <td style="padding:9px 8px;">${i.emoji} ${i.nome}${best}</td>
        <td style="padding:9px 8px;text-align:right;">${_brl(i.preco)}</td>
        <td style="padding:9px 8px;text-align:right;">${_brl(i.cmUn)}</td>
        <td style="padding:9px 8px;text-align:right;font-weight:600;color:var(--gold);">${_brl(i.cmRec)}</td>
        <td style="padding:9px 8px;text-align:right;">${d.unidadesReais} un. / ${d.receitas} rec.</td>
      </tr>`;
    }).join("");
    document.getElementById("pl-produtos").innerHTML = `<div class="admin-card">
      <div class="ac-title">Melhores produtos para vender</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Ordenados por <strong>margem de contribuição por receita</strong> — é o que mais rende por sessão de produção, já que seu gargalo é o tempo, não o dinheiro. Vender mais dos primeiros da lista bate a meta com menos trabalho.</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid var(--border-mid);color:var(--muted);font-size:11px;text-align:left;">
          <th style="padding:8px;">Produto</th><th style="padding:8px;text-align:right;">Preço</th><th style="padding:8px;text-align:right;">Margem/un</th><th style="padding:8px;text-align:right;">Margem/receita</th><th style="padding:8px;text-align:right;">Plano do mês</th>
        </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;

    document.getElementById("pl-semanal").innerHTML = `<div class="admin-card">
      <div class="ac-title">Sua meta, semana a semana</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:8px;">
        ${[1,2,3,4].map(s=>`<div style="background:rgba(196,123,53,0.08);border-radius:9px;padding:12px;text-align:center;">
          <div style="font-size:12px;color:var(--muted);">Semana ${s}</div>
          <div style="font-size:20px;font-weight:600;color:var(--text);margin:4px 0;">${pl.semanaUnid} un.</div>
          <div style="font-size:11px;color:var(--muted);">≈ ${pl.semanaRec} receitas</div>
        </div>`).join("")}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:10px;">Bata ~${pl.semanaUnid} cookies por semana e você fecha o mês na meta. Valor da sua hora neste cenário: <strong>${_brl(pl.valorHora)}/h</strong>.</div>
    </div>`;

    const compraRows = pl.compras.map(x => `<tr>
      <td style="padding:8px;">${x.nome}</td>
      <td style="padding:8px;text-align:right;">${Math.round(x.precisa)} ${x.unit==="kg"?"g":x.unit}</td>
      <td style="padding:8px;text-align:right;color:var(--muted);">${Math.round(x.estoque)} ${x.unit==="kg"?"g":x.unit}</td>
      <td style="padding:8px;text-align:right;font-weight:600;color:${x.comprar>0?"var(--text)":"#1D9E75"};">${x.comprar>0?Math.round(x.comprar)+" "+(x.unit==="kg"?"g":x.unit):"tem em estoque"}</td>
      <td style="padding:8px;text-align:right;">${x.comprar>0?_brl(x.custo):"—"}</td>
    </tr>`).join("");
    document.getElementById("pl-compras").innerHTML = `<div class="admin-card">
      <div class="ac-title">Lista de compras para produzir tudo isso</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Calculada a partir das ${pl.receitasTotal} receitas do plano, descontando o que você já tem em estoque.</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid var(--border-mid);color:var(--muted);font-size:11px;text-align:left;">
          <th style="padding:8px;">Matéria-prima</th><th style="padding:8px;text-align:right;">Precisa</th><th style="padding:8px;text-align:right;">Em estoque</th><th style="padding:8px;text-align:right;">Comprar</th><th style="padding:8px;text-align:right;">Custo estimado</th>
        </tr></thead><tbody>${compraRows}</tbody></table></div>
      <div style="text-align:right;font-size:14px;margin-top:12px;color:var(--text);">Total a investir em ingredientes: <strong style="color:var(--gold);">${_brl(pl.custoCompras)}</strong></div>
    </div>`;
  } else {
    document.getElementById("pl-produtos").innerHTML = "";
    document.getElementById("pl-semanal").innerHTML = "";
    document.getElementById("pl-compras").innerHTML = "";
  }
}

async function savePlanejamento(){
  let existing = {};
  try { existing = JSON.parse(localStorage.getItem("panillo-config")||"{}"); } catch(e){}
  const v = id => { const el = document.getElementById(id); return el ? el.value : ""; };
  const cfg = { ...existing,
    proLabore:v("pl-prolabore"), reserva:v("pl-reserva"), contasFixas:v("pl-contas"),
    taxaCartao:v("pl-cartao"), horasMes:v("pl-horas"), tempoReceita:v("pl-tempo"),
    perda:v("pl-perda"), capacidadeReceitas:v("pl-capacidade") };
  localStorage.setItem("panillo-config", JSON.stringify(cfg));
  try {
    const docs = await fbGet("appConfig");
    if (docs.length > 0) await fbUpdate("appConfig", docs[0].id, { ...cfg, updatedAt: FB.serverTimestamp() });
    else await fbAdd("appConfig", cfg);
  } catch(e){ console.warn("Planejamento: Firebase indisponível, salvo localmente.", e); }
  showToast("Premissas salvas!");
  recalcPlano();
}

function exportPlanoCSV(){
  const pl = computePlano();
  let csv = "Materia-prima;Precisa;Em estoque;Comprar;Custo estimado (R$)\n";
  pl.compras.forEach(x => {
    const u = x.unit === "kg" ? "g" : x.unit;
    csv += `${x.nome};${Math.round(x.precisa)}${u};${Math.round(x.estoque)}${u};${x.comprar>0?Math.round(x.comprar)+u:"0"};${x.custo.toFixed(2)}\n`;
  });
  csv += `TOTAL;;;;${pl.custoCompras.toFixed(2)}\n`;
  const blob = new Blob(["\ufeff"+csv], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "lista_compras_panillo.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const IA_SYSTEM = `Você é consultora de confeitaria artesanal e negócios da Panillo (Fortaleza/CE). Responda em português, direta e prática, e MOSTRE a conta quando recomendar preço ou volume.

REGRA DE OURO — nunca precifique só por ingrediente + uma % genérica. Todo preço considera 3 custos reais: (1) custo fixo rateado (contas, existem mesmo vendendo zero); (2) pró-labore (o salário do dono); (3) tempo de produção (cada minuto ativo tem valor).

PREÇO: Custo Total/un = ingrediente/un + mão de obra/un + custo fixo rateado/un. Preço mínimo = Custo Total/un ÷ (1 − taxa cartão − imposto). Preço sugerido = Custo Total/un ÷ (1 − margem − taxa cartão − imposto).

VOLUME (quantos vender): Unidades necessárias = Custo Fixo Total (com pró-labore e reserva) ÷ Margem de Contribuição/un. Margem de Contribuição/un = Preço × (1 − taxa cartão) − ingrediente/un − mão de obra/un. REGRA: o custo fixo entra UMA vez só, no numerador, nunca dentro do custo da unidade.

TEMPO: Valor da hora = pró-labore ÷ horas/mês. Mão de obra/un = (tempo ativo da receita ÷ rendimento) × valor da hora ÷ 60. Só tempo ATIVO conta.

GARGALO: o limite é o TEMPO de produção, não o dinheiro. Ao indicar quais produtos priorizar, ranqueie pela margem de contribuição POR RECEITA, não por unidade.

DADOS AO VIVO: use os números do "Contexto do negócio" e do "PLANO DO MÊS" enviados junto — eles já vêm calculados pela mesma fórmula da aba Planejamento do Mês, então suas respostas devem bater com o que o app mostra lá. NUNCA invente preço, volume, meta ou pró-labore. Se faltar um dado para fechar a conta, peça antes de responder.`;

async function askIA() {
  const input = document.getElementById("ia-input");
  const q = input.value.trim();
  if (!q) return;
  iaHistory.push({ role:"user", content: q });
  input.value = "";
  const histEl = document.getElementById("ia-chat-history");
  histEl.innerHTML += `<div style="background:rgba(255,255,255,0.08);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:rgba(255,255,255,0.9);"><strong>Você:</strong> ${q}</div>`;
  histEl.innerHTML += `<div id="ia-typing" style="font-size:13px;color:rgba(255,255,255,0.5);padding:8px;">Digitando...</div>`;
  histEl.scrollTop = histEl.scrollHeight;
  try {
    const answer = await callGeminiAPI(q + "\n\nContexto do negócio: " + getBusinessContext(), 300, IA_SYSTEM);
    document.getElementById("ia-typing").remove();
    histEl.innerHTML += `<div style="background:rgba(200,144,42,0.1);border-left:3px solid var(--gold);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:rgba(255,255,255,0.9);"><strong>IA:</strong> ${answer}</div>`;
    iaHistory.push({ role:"assistant", content: answer });
  } catch {
    document.getElementById("ia-typing").remove();
    histEl.innerHTML += `<div style="font-size:13px;color:rgba(255,255,255,0.5);padding:8px;">Configure a GEMINI_API_KEY no Vercel para ativar a IA.</div>`;
  }
  histEl.scrollTop = histEl.scrollHeight;
}
function selectMktOpt(opt, el) {
  selectedMktOpt = opt;
  document.querySelectorAll(".gen-opt").forEach(o => o.classList.remove("sel"));
  el.classList.add("sel");
}

async function generateMktPost() {
  const text = document.getElementById("mkt-input").value.trim();
  if (!text) { showToast("Descreva o que quer divulgar!"); return; }
  document.getElementById("mkt-result").innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px 0;">Gerando postagem...</div>`;
  const prompt = `Você é especialista em marketing para confeitarias artesanais. Crie uma postagem de ${selectedMktOpt} para a Panillo, confeitaria de cookies e brownies artesanais em Fortaleza.\n\nProduto/campanha: ${text}\n\nGere uma legenda envolvente, autêntica, com emojis e no final inclua hashtags relevantes. Máximo 200 palavras. Responda somente com o texto da postagem, sem explicações adicionais.`;
  try {
    const post = await callGeminiAPI(prompt, 300, "Você é especialista em marketing digital para confeitarias artesanais. Responda apenas com o texto da postagem, sem explicações.");
    const tags = post.match(/#\w+/g) || [];
    const body = post.replace(/#\w+/g,"").trim();
    document.getElementById("mkt-result").innerHTML = `
      <div class="result-box">
        <div class="result-platform">${selectedMktOpt}</div>
        <div class="result-text" id="mkt-post-text">${body}</div>
        <div class="result-tags">${tags.map(t=>`<span class="result-tag">${t}</span>`).join("")}</div>
      </div>
      <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('mkt-post-text').textContent + ' ' + '${tags.join(" ")}').then(()=>showToast('Copiado!'))">Copiar texto</button>`;
  } catch {
    document.getElementById("mkt-result").innerHTML = `<div style="color:var(--muted);font-size:13px;">Configure a GEMINI_API_KEY no Vercel para usar a IA de marketing.</div>`;
  }
}

// ─── AI: PRODUCT DESC ──────────────────────────────────
async function generateDesc() {
  const nome = document.getElementById("pm-nome").value.trim();
  if (!nome) { showToast("Digite o nome do produto primeiro!"); return; }
  const icon = document.getElementById("desc-icon");
  const spin = document.getElementById("desc-spinner");
  icon.style.display = "none"; spin.style.display = "inline-block";

  // Coleta ingredientes já adicionados no modal para enriquecer a descrição
  const ingRows = document.querySelectorAll("#pm-ings .ing-row-modal");
  const ingredientesNomes = [];
  ingRows.forEach(row => {
    const sel = row.querySelector("select");
    if (sel && sel.value) {
      const ing = allIngredients.find(i => i.id === sel.value);
      if (ing) ingredientesNomes.push(ing.nome);
    }
  });
  const categoria = document.getElementById("pm-cat")?.value || "cookie";
  const catLabel = categoria === "brownie" ? "brownie" : categoria === "combo" ? "combo de cookies e brownies" : "cookie";

  let promptIngredientes = "";
  if (ingredientesNomes.length > 0) {
    promptIngredientes = `\nIngredientes principais: ${ingredientesNomes.join(", ")}.`;
  }

  const prompt = `Você é especialista em copywriting para confeitaria artesanal premium.
Crie uma descrição curta, única e irresistível para o ${catLabel} chamado "${nome}".${promptIngredientes}
Requisitos:
- Máximo 2 frases curtas
- Tom sensorial: evoque sabores, texturas, aromas
- Destaque o que torna este produto especial com base no nome e ingredientes
- Linguagem calorosa e artesanal, sem clichês genéricos
- Sem aspas, sem explicações, apenas o texto da descrição
NÃO use frases genéricas como "feito com ingredientes selecionados" — seja específico ao nome "${nome}".`;

  try {
    const desc = await callGeminiAPI(prompt, 100);
    document.getElementById("pm-desc").value = desc;
  } catch {
    // Fallback descritivo baseado no nome
    const categoriaText = categoria === "brownie" ? "Brownie" : categoria === "combo" ? "Combo" : "Cookie";
    document.getElementById("pm-desc").value = `${categoriaText} ${nome} artesanal, com sabor único e textura irresistível em cada mordida.`;
  }
  icon.style.display = "inline-block"; spin.style.display = "none";
}

