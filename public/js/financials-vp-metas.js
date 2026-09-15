
// ═══════════════════════════════════════════════════════
//  INDICADORES FINANCEIROS
// ═══════════════════════════════════════════════════════
let _indMode = "mes";

async function loadIndicadores(mode) {
  _indMode = mode;
  // Update button styles
  ["semana","mes","ano"].forEach(m => {
    const btn = document.getElementById("ind-btn-"+m);
    if (!btn) return;
    if (m === mode) { btn.style.background="var(--teal)"; btn.style.color="#fff"; btn.style.borderColor="var(--teal)"; }
    else { btn.style.background=""; btn.style.color=""; btn.style.borderColor=""; }
  });
  // Highlight custom range border when active
  const customRange = document.getElementById("ind-custom-range");
  if (customRange) customRange.style.borderColor = mode === "custom" ? "var(--teal)" : "var(--border)";

  let orders = allOrders;
  if (!orders || orders.length === 0) {
    try { orders = await fbGet("orders"); allOrders = orders; } catch { orders = []; }
  }

  const now = new Date();
  let cutoff, cutoffEnd, days;

  if (mode === "custom") {
    const fromVal = document.getElementById("ind-date-from")?.value;
    const toVal   = document.getElementById("ind-date-to")?.value;
    if (!fromVal || !toVal) { showToast("Selecione as duas datas!"); return; }
    cutoff    = new Date(fromVal + "T00:00:00");
    cutoffEnd = new Date(toVal   + "T23:59:59");
    days = Math.round((cutoffEnd - cutoff) / (1000*60*60*24)) + 1;
  } else {
    days = mode === "semana" ? 7 : mode === "mes" ? 30 : 365;
    cutoff    = new Date(now); cutoff.setDate(now.getDate() - days);
    cutoffEnd = now;
  }

  const active = ["confirmado","pronto","entregue"];
  const filtered = orders.filter(o => {
    if (!active.includes(o.status)) return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    return ts >= cutoff && ts <= cutoffEnd;
  });

  const totalRec = filtered.reduce((s,o) => s + Number(o.total||0), 0);
  const recebido = filtered.filter(o => o.pagamentoConfirmado).reduce((s,o) => s + Number(o.total||0), 0);
  const aReceber = totalRec - recebido;
  const _cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overheadCfg = (Number(_cfg.overhead) || 20) / 100;

  // Garante que produtos/ingredientes estão carregados para calcular custo real
  if (!allProducts.length)    { try { allProducts    = await fbGet("products");    } catch {} }
  if (!allIngredients.length) { try { allIngredients = await fbGet("ingredients"); } catch {} }

  // Custo real por unidade, baseado na receita cadastrada (mesma fórmula da aba Suprimentos)
  function productCostPerUnit(prod) {
    if (!prod || !prod.ingredientes || !prod.ingredientes.length) return null;
    let totalCost = 0;
    prod.ingredientes.forEach(pi => {
      const ing = allIngredients.find(i => i.id === pi.ingId);
      if (!ing) return;
      const pricePerG = precoPorGrama(ing);
      totalCost += pricePerG * pi.grams;
    });
    const withExtra = totalCost * 1.15;
    const rend = prod.rendimento || 1;
    return withExtra / rend;
  }

  // ── Mapa de produtos vendidos no período (com custo real quando disponível) ──
  const prodMap = {}; // { nome: { qty, receita, custoReal, temCusto } }
  let custoRealTotal = 0, receitaComCusto = 0, qtyComCusto = 0, totalQtyAll = 0;
  filtered.forEach(o => {
    (o.itens||[]).forEach(i => {
      const k = i.nome || "?";
      if (!prodMap[k]) prodMap[k] = { qty: 0, receita: 0, custoReal: 0, temCusto: false };
      const qty = Number(i.qty||1);
      const receita = qty * Number(i.preco||0);
      prodMap[k].qty     += qty;
      prodMap[k].receita += receita;
      totalQtyAll += qty;

      const prod = allProducts.find(p => p.nome === k);
      const costPerUnit = productCostPerUnit(prod);
      if (costPerUnit !== null) {
        prodMap[k].temCusto = true;
        const custo = costPerUnit * qty;
        prodMap[k].custoReal += custo;
        custoRealTotal += custo;
        receitaComCusto += receita;
        qtyComCusto += qty;
      }
    });
  });

  // Lucro: usa custo real de receita para os produtos que têm receita cadastrada,
  // e aplica o overhead configurado (fallback) apenas sobre a receita dos produtos
  // sem receita cadastrada — evita misturar dois critérios diferentes de margem.
  const receitaSemCusto = totalRec - receitaComCusto;
  const lucroComCusto = receitaComCusto - custoRealTotal;
  const lucroSemCusto = receitaSemCusto * (1 - overheadCfg);
  const lucro = lucroComCusto + lucroSemCusto;
  const margemReal = totalRec > 0 ? (lucro/totalRec*100) : 0;
  const coberturaReceitas = totalQtyAll > 0 ? Math.round((qtyComCusto/totalQtyAll)*100) : 0;

  const ticket = filtered.length ? totalRec / filtered.length : 0;
  const cancelados = orders.filter(o => {
    if (o.status !== "cancelado") return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    return ts >= cutoff && ts <= cutoffEnd;
  }).length;

  // Formas de pagamento
  const formas = {};
  filtered.forEach(o => { const p = o.pagamento||"—"; formas[p] = (formas[p]||0) + 1; });
  const formasHtml = Object.entries(formas).sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => `<span style="display:flex;justify-content:space-between;"><b>${{pix:"Pix",credito:"Crédito",debito:"Débito",dinheiro:"Dinheiro",fiado:"Fiado"}[k]||k}</b><span>${v}x</span></span>`).join("");

  // Fiado saldo
  let fiadoSaldo = 0;
  try { const accs = await fbGet("fiadoAccounts"); fiadoSaldo = accs.filter(a=>a.autorizado).reduce((s,a)=>s+Number(a.saldo||0),0); } catch {}

  // Update KPIs
  const fmt = v => "R$ " + Number(v).toFixed(2).replace(".",",");
  document.getElementById("ind-receita").textContent = fmt(totalRec);
  document.getElementById("ind-receita-delta").textContent = `${filtered.length} pedido(s) no período`;
  document.getElementById("ind-recebido").textContent = fmt(recebido);
  document.getElementById("ind-areceber").textContent = fmt(aReceber);
  document.getElementById("ind-lucro").textContent = fmt(lucro);
  document.getElementById("ind-lucro-pct").textContent = coberturaReceitas > 0
    ? `Margem real: ${margemReal.toFixed(1)}% (${coberturaReceitas}% das unidades com custo de receita; restante por overhead ${Math.round(overheadCfg*100)}%)`
    : `Margem estimada: ${Math.round((1-overheadCfg)*100)}% (overhead ${Math.round(overheadCfg*100)}% — cadastre receitas para custo real)`;
  document.getElementById("ind-pedidos").textContent = filtered.length;
  document.getElementById("ind-ticket").textContent = fmt(ticket);
  document.getElementById("ind-cancelados").textContent = cancelados;
  document.getElementById("ind-fiado").textContent = fmt(fiadoSaldo);
  document.getElementById("ind-formas").innerHTML = formasHtml || "—";

  // Build daily data — para custom gera bucket por cada dia do intervalo
  const buckets = {};
  for (let i = 0; i < Math.min(days, 366); i++) {
    const d = new Date(cutoff); d.setDate(cutoff.getDate() + i);
    if (d > cutoffEnd) break;
    const key = d.toISOString().split("T")[0];
    buckets[key] = { fat: 0, recebido: 0, aReceber: 0, pedidos: 0 };
  }
  filtered.forEach(o => {
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    const key = ts.toISOString().split("T")[0];
    if (buckets[key]) {
      buckets[key].fat += Number(o.total||0);
      buckets[key].pedidos++;
      if (o.pagamentoConfirmado) buckets[key].recebido += Number(o.total||0);
      else buckets[key].aReceber += Number(o.total||0);
    }
  });

  const labels = Object.keys(buckets);
  const fatData = labels.map(k => buckets[k].fat);
  const recData = labels.map(k => buckets[k].recebido);
  const arData  = labels.map(k => buckets[k].aReceber);
  const pedData = labels.map(k => buckets[k].pedidos);

  _drawLineChart("ind-chart-faturamento", "ind-tooltip-fat", labels, [
    { label: "Faturamento", data: fatData, color: "#8B4513" }
  ], v => "R$ " + v.toFixed(2).replace(".",","));

  _drawLineChart("ind-chart-pagamentos", "ind-tooltip-pag", labels, [
    { label: "Recebido",  data: recData, color: "#8B4513" },
    { label: "A Receber", data: arData,  color: "#C8902A" }
  ], v => "R$ " + v.toFixed(2).replace(".",","));

  _drawLineChart("ind-chart-pedidos", "ind-tooltip-ped", labels, [
    { label: "Pedidos", data: pedData, color: "#4B7FCC" }
  ], v => v + " pedido(s)");

  // ── Tipo de pedido ──────────────────────────────────────
  const encQty = filtered.filter(o => o.tipo === "encomenda").length;
  const peQty  = filtered.filter(o => o.tipo !== "encomenda").length;
  const encRec = filtered.filter(o => o.tipo === "encomenda").reduce((s,o)=>s+Number(o.total||0),0);
  const peRec  = filtered.filter(o => o.tipo !== "encomenda").reduce((s,o)=>s+Number(o.total||0),0);
  const el = id => document.getElementById(id);
  if (el("ind-encomendas"))     el("ind-encomendas").textContent   = encQty;
  if (el("ind-encomendas-sub")) el("ind-encomendas-sub").textContent = fmt(encRec);
  if (el("ind-pe"))             el("ind-pe").textContent            = peQty;
  if (el("ind-pe-sub"))         el("ind-pe-sub").textContent        = fmt(peRec);

  // ── Novos vs Recorrentes ─────────────────────────────────
  // Conta pedidos anteriores ao período para cada cliente
  const wppsPeriodo = {};
  filtered.forEach(o => {
    const w = (o.cliente?.wpp||"").replace(/\D/g,"");
    if (!w) return;
    if (!wppsPeriodo[w]) wppsPeriodo[w] = { total: 0, count: 0 };
    wppsPeriodo[w].total += Number(o.total||0);
    wppsPeriodo[w].count += 1;
  });
  const wppAntes = new Set(
    orders.filter(o => {
      if (!["confirmado","pronto","entregue"].includes(o.status)) return false;
      const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
      return ts < cutoff;
    }).map(o => (o.cliente?.wpp||"").replace(/\D/g,"")).filter(Boolean)
  );
  let novosWpps = [], recWpps = [];
  Object.entries(wppsPeriodo).forEach(([w, d]) => {
    if (wppAntes.has(w)) recWpps.push(d); else novosWpps.push(d);
  });
  const cliNovos = novosWpps.length;
  const cliRec   = recWpps.length;
  const ticketNovo = cliNovos ? novosWpps.reduce((s,d)=>s+d.total,0) / novosWpps.reduce((s,d)=>s+d.count,0) : 0;
  const ticketRec  = cliRec   ? recWpps.reduce((s,d)=>s+d.total,0)  / recWpps.reduce((s,d)=>s+d.count,0)   : 0;
  if (el("ind-cli-novos"))    el("ind-cli-novos").textContent    = cliNovos;
  if (el("ind-cli-rec"))      el("ind-cli-rec").textContent      = cliRec;
  if (el("ind-cli-rec-sub"))  el("ind-cli-rec-sub").textContent  = cliRec ? `${Math.round(cliRec/(cliNovos+cliRec||1)*100)}% dos compradores` : "";
  if (el("ind-ticket-rec"))   el("ind-ticket-rec").textContent   = fmt(ticketRec);
  if (el("ind-ticket-novo"))  el("ind-ticket-novo").textContent  = fmt(ticketNovo);

  // ── Ranking de Produtos ──────────────────────────────────
  const prodRank = Object.entries(prodMap).sort((a,b) => b[1].qty - a[1].qty);
  const maxQty   = prodRank[0]?.[1].qty || 1;

  // ── Totais por Categoria (cookie / brownie / combo / total) ──
  if (el("ind-cat-totais")) {
    const catMap = {}; // { categoria: { qty, receita } }
    let totalQty = 0, totalReceita = 0;
    Object.entries(prodMap).forEach(([nome, d]) => {
      const prod = allProducts.find(p => p.nome === nome);
      const cat = prod?.categoria || "outros";
      if (!catMap[cat]) catMap[cat] = { qty: 0, receita: 0 };
      catMap[cat].qty     += d.qty;
      catMap[cat].receita += d.receita;
      totalQty     += d.qty;
      totalReceita += d.receita;
    });
    const catLabels = { cookie: "🍪 Cookies", brownie: "🍫 Brownies", combo: "🎁 Combos", outros: "Outros" };
    const catOrder = ["cookie","brownie","combo","outros"];
    let catHtml = "";
    catOrder.forEach(cat => {
      if (!catMap[cat]) return;
      catHtml += `<div style="background:var(--cream);border-radius:10px;padding:14px;text-align:center;">
        <div style="font-size:12px;font-weight:600;color:var(--text-mid);margin-bottom:6px;">${catLabels[cat]}</div>
        <div style="font-size:22px;font-weight:700;color:var(--teal-dark);">${catMap[cat].qty}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${fmt(catMap[cat].receita)}</div>
      </div>`;
    });
    catHtml += `<div style="background:var(--teal-dark);border-radius:10px;padding:14px;text-align:center;">
      <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.75);margin-bottom:6px;">Total Geral</div>
      <div style="font-size:22px;font-weight:700;color:#fff;">${totalQty}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.65);margin-top:2px;">${fmt(totalReceita)}</div>
    </div>`;
    if (!totalQty) {
      el("ind-cat-totais").innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0;grid-column:1/-1;">Nenhum produto vendido no período</div>';
    } else {
      el("ind-cat-totais").innerHTML = catHtml;
    }
  }

  if (el("ind-ranking-produtos")) {
    if (!prodRank.length) {
      el("ind-ranking-produtos").innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0;">Nenhum produto vendido no período</div>';
    } else {
      el("ind-ranking-produtos").innerHTML = prodRank.slice(0,8).map(([nome, d], i) => {
        const pct = Math.round((d.qty / maxQty) * 100);
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}º`;
        return `<div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:var(--text);">${medal} ${nome}</span>
            <span style="font-size:11px;color:var(--muted);">${d.qty} un · ${fmt(d.receita)}</span>
          </div>
          <div style="height:7px;background:var(--cream-dark);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:var(--teal);border-radius:4px;transition:width .4s;"></div>
          </div>
        </div>`;
      }).join("");
    }
  }

  // Produto mais lucrativo (por receita)
  const prodLucro = Object.entries(prodMap).sort((a,b) => b[1].receita - a[1].receita)[0];
  if (el("ind-prod-lucro"))     el("ind-prod-lucro").textContent     = prodLucro ? prodLucro[0] : "—";
  if (el("ind-prod-lucro-sub")) el("ind-prod-lucro-sub").textContent = prodLucro ? `${fmt(prodLucro[1].receita)} em receita` : "";

  // "Em Alta": produto com maior crescimento de unidades vendidas vs. período anterior de mesma duração
  if (el("ind-prod-saida")) {
    const prevCutoffEnd = new Date(cutoff.getTime() - 1000); // 1s antes do início do período atual
    const prevCutoff = new Date(cutoff); prevCutoff.setDate(cutoff.getDate() - days);
    const prevFiltered = orders.filter(o => {
      if (!active.includes(o.status)) return false;
      const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
      return ts >= prevCutoff && ts <= prevCutoffEnd;
    });
    const prevMap = {};
    prevFiltered.forEach(o => (o.itens||[]).forEach(i => {
      const k = i.nome || "?";
      prevMap[k] = (prevMap[k]||0) + Number(i.qty||1);
    }));
    // Calcula variação para produtos vendidos no período atual
    const variacoes = prodRank.map(([nome, d]) => {
      const antes = prevMap[nome] || 0;
      const delta = d.qty - antes;
      const pct = antes > 0 ? (delta/antes*100) : (d.qty > 0 ? 100 : 0);
      return { nome, qty: d.qty, antes, delta, pct };
    }).filter(v => v.delta > 0); // só considera quem cresceu
    variacoes.sort((a,b) => b.delta - a.delta);
    const destaque = variacoes[0];
    if (destaque) {
      el("ind-prod-saida").textContent = destaque.nome;
      el("ind-prod-saida-sub").textContent = destaque.antes > 0
        ? `${destaque.qty} un. (+${destaque.delta} vs ${destaque.antes} no período anterior, +${Math.round(destaque.pct)}%)`
        : `${destaque.qty} un. — novo no período (não vendido antes)`;
    } else if (prodRank[0]) {
      // Nenhum produto cresceu — mostra o líder do período mesmo assim
      el("ind-prod-saida").textContent = prodRank[0][0];
      el("ind-prod-saida-sub").textContent = `${prodRank[0][1].qty} un. — sem crescimento vs período anterior`;
    } else {
      el("ind-prod-saida").textContent = "—";
      el("ind-prod-saida-sub").textContent = "";
    }
  }

  // ── Ranking de Clientes ──────────────────────────────────
  // Por gasto no período
  const cliMap = {}; // { wpp: { nome, total, count } }
  filtered.forEach(o => {
    const w = (o.cliente?.wpp||"").replace(/\D/g,"") || o.cliente?.nome || "?";
    const nome = o.cliente?.nome || "Anônimo";
    if (!cliMap[w]) cliMap[w] = { nome, total: 0, count: 0 };
    cliMap[w].total += Number(o.total||0);
    cliMap[w].count += 1;
  });
  const cliRankArr = Object.entries(cliMap).sort((a,b) => b[1].total - a[1].total);
  const maxCli = cliRankArr[0]?.[1].total || 1;

  if (el("ind-ranking-clientes")) {
    if (!cliRankArr.length) {
      el("ind-ranking-clientes").innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px 0;">Nenhum cliente no período</div>';
    } else {
      el("ind-ranking-clientes").innerHTML = cliRankArr.slice(0,8).map(([, d], i) => {
        const pct = Math.round((d.total / maxCli) * 100);
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}º`;
        return `<div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:600;color:var(--text);">${medal} ${escHtml(d.nome)}</span>
            <span style="font-size:11px;color:var(--muted);">${d.count} pedido(s) · ${fmt(d.total)}</span>
          </div>
          <div style="height:7px;background:var(--cream-dark);border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:var(--gold);border-radius:4px;transition:width .4s;"></div>
          </div>
        </div>`;
      }).join("");
    }
  }

  // Cliente mais fiel (mais pedidos no período) e maior gasto
  const cliMaisPedidos = Object.values(cliMap).sort((a,b) => b.count - a.count)[0];
  const cliMaisGasto   = cliRankArr[0]?.[1];
  if (el("ind-cli-top-nome"))  el("ind-cli-top-nome").textContent  = cliMaisPedidos ? cliMaisPedidos.nome : "—";
  if (el("ind-cli-top-sub"))   el("ind-cli-top-sub").textContent   = cliMaisPedidos ? `${cliMaisPedidos.count} pedido(s) · ${fmt(cliMaisPedidos.total)}` : "";
  if (el("ind-cli-gasto-nome")) el("ind-cli-gasto-nome").textContent = cliMaisGasto ? cliMaisGasto.nome : "—";
  if (el("ind-cli-gasto-sub"))  el("ind-cli-gasto-sub").textContent  = cliMaisGasto ? `${fmt(cliMaisGasto.total)} · ${cliMaisGasto.count} pedido(s)` : "";
}

function _drawLineChart(canvasId, tooltipId, labels, series, fmtVal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const tooltip = document.getElementById(tooltipId);
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth || 400;
  const H = canvas.height || 200;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const PAD = { top: 20, right: 20, bottom: 36, left: 52 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  // Max value
  const allVals = series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals, 0.01);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = "#E8EDE8";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + cH - (i / 4) * cH;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = "#999"; ctx.font = "10px sans-serif"; ctx.textAlign = "right";
    ctx.fillText(fmtVal(maxVal * i / 4), PAD.left - 4, y + 3);
  }

  // X labels — only show some
  const maxLabels = Math.min(labels.length, 8);
  const step = Math.ceil(labels.length / maxLabels);
  ctx.fillStyle = "#999"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
  labels.forEach((lbl, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = PAD.left + (i / (labels.length - 1 || 1)) * cW;
    const d = new Date(lbl + "T12:00");
    const fmt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    ctx.fillText(fmt, x, H - 4);
  });

  // Draw each series
  series.forEach(({ label, data, color }) => {
    if (data.every(v => v === 0)) return;
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
    data.forEach((v, i) => {
      const x = PAD.left + (i / (data.length - 1 || 1)) * cW;
      const y = PAD.top + cH - (v / maxVal) * cH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Fill
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = color;
    ctx.lineTo(PAD.left + cW, PAD.top + cH);
    ctx.lineTo(PAD.left, PAD.top + cH);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // Dots
    data.forEach((v, i) => {
      if (v === 0) return;
      const x = PAD.left + (i / (data.length - 1 || 1)) * cW;
      const y = PAD.top + cH - (v / maxVal) * cH;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    });
  });

  // Tooltip on mousemove
  if (tooltip) {
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const idx = Math.round((mx - PAD.left) / (cW / (labels.length - 1 || 1)));
      if (idx < 0 || idx >= labels.length) { tooltip.style.display = "none"; return; }
      const d = new Date(labels[idx] + "T12:00");
      const dateFmt = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
      const lines = series.map(s => `<span style="color:${s.color};">■</span> ${s.label}: <b>${fmtVal(s.data[idx])}</b>`).join("<br>");
      tooltip.innerHTML = `<b>${dateFmt}</b><br>${lines}`;
      tooltip.style.display = "block";
      let tx = mx + 10; let ty = e.clientY - rect.top - 10;
      if (tx + 160 > W) tx = mx - 170;
      tooltip.style.left = tx + "px";
      tooltip.style.top = ty + "px";
    };
    canvas.onmouseleave = () => { tooltip.style.display = "none"; };
  }
}

// ═══════════════════════════════════════════════════════
//  VENDA PRESENCIAL
// ═══════════════════════════════════════════════════════
let _vpClient = null;
let _vpItems = []; // [{prodId, nome, preco, qty}]
let _vpTipo = "varejo"; // "varejo" | "revenda"
let _vpPedidoTipo = "pronta-entrega"; // "pronta-entrega" | "encomenda"

function vpSetPedidoTipo(tipo) {
  _vpPedidoTipo = tipo;
  const btnPE  = document.getElementById("vp-pedido-tipo-pe");
  const btnEnc = document.getElementById("vp-pedido-tipo-enc");
  const encFields = document.getElementById("vp-encomenda-fields");
  const title = document.getElementById("vp-modal-title");
  const submitBtn = document.getElementById("vp-submit-btn");
  if (btnPE && btnEnc) {
    btnPE.style.background  = tipo === "pronta-entrega" ? "var(--teal)" : "#fff";
    btnPE.style.color       = tipo === "pronta-entrega" ? "#fff" : "var(--muted)";
    btnPE.style.borderColor = tipo === "pronta-entrega" ? "var(--teal)" : "var(--border)";
    btnEnc.style.background  = tipo === "encomenda" ? "var(--teal)" : "#fff";
    btnEnc.style.color       = tipo === "encomenda" ? "#fff" : "var(--muted)";
    btnEnc.style.borderColor = tipo === "encomenda" ? "var(--teal)" : "var(--border)";
  }
  if (encFields) encFields.style.display = tipo === "encomenda" ? "block" : "none";
  if (title) title.textContent = tipo === "encomenda" ? "📅 Registrar Encomenda" : "🛒 Venda Presencial";
  if (submitBtn) submitBtn.textContent = tipo === "encomenda" ? "Registrar Encomenda" : "Registrar Venda";
}

function vpSetTipo(tipo) {
  _vpTipo = tipo;
  const btnV = document.getElementById("vp-tipo-varejo");
  const btnR = document.getElementById("vp-tipo-revenda");
  const aviso = document.getElementById("vp-revenda-aviso");
  if (btnV && btnR) {
    btnV.style.background    = tipo === "varejo" ? "var(--teal)" : "#fff";
    btnV.style.color         = tipo === "varejo" ? "#fff" : "var(--muted)";
    btnV.style.borderColor   = tipo === "varejo" ? "var(--teal)" : "var(--border)";
    btnR.style.background    = tipo === "revenda" ? "var(--teal)" : "#fff";
    btnR.style.color         = tipo === "revenda" ? "#fff" : "var(--muted)";
    btnR.style.borderColor   = tipo === "revenda" ? "var(--teal)" : "var(--border)";
  }
  if (aviso) aviso.style.display = tipo === "revenda" ? "block" : "none";
  // Atualiza preços nos itens que têm precoRevenda
  _vpItems = _vpItems.map(item => {
    const prod = allProducts.find(p => p.id === item.prodId);
    if (!prod) return item;
    const novoPreco = tipo === "revenda" && prod.precoRevenda
      ? Number(prod.precoRevenda)
      : Number(prod.preco);
    return { ...item, preco: novoPreco };
  });
  vpRenderItems();
  vpCalcTotal();
}

async function openVendaPresencial() {
  _vpClient = null;
  _vpItems = [];
  document.getElementById("vp-client-search").value = "";
  document.getElementById("vp-client-list").style.display = "none";
  document.getElementById("vp-client-selected").style.display = "none";
  document.getElementById("vp-client-manual").style.display = "block";
  document.getElementById("vp-client-manual-nome").value = "";
  document.getElementById("vp-client-manual-wpp").value = "";
  document.getElementById("vp-client-manual-register").checked = false;
  document.getElementById("vp-obs").value = "";
  document.getElementById("vp-pagamento").value = "pix";
  document.getElementById("vp-desconto").value = "";
  window._vpDescontoTipo = "R$";
  vpSetDescontoTipo("R$");
  _vpTipo = "varejo";
  vpSetTipo("varejo");
  document.getElementById("vp-enc-data").value = "";
  document.getElementById("vp-enc-periodo").value = "Manhã";
  _vpPedidoTipo = "pronta-entrega";
  vpSetPedidoTipo("pronta-entrega");
  vpRenderItems();
  vpAddItem();
  // Load clients
  if (allClients.length === 0) {
    try { allClients = await fbGet("clients"); } catch { allClients = []; }
  }
  document.getElementById("modal-venda-presencial").style.display = "block";
}

function closeVendaPresencial() {
  document.getElementById("modal-venda-presencial").style.display = "none";
}

let _vpSearchResults = []; // cache dos resultados para seleção por índice

function vpSearchClient(q) {
  const list = document.getElementById("vp-client-list");
  if (!q.trim()) { list.style.display = "none"; _vpSearchResults = []; return; }
  _vpSearchResults = allClients.filter(c =>
    (c.nome||"").toLowerCase().includes(q.toLowerCase()) ||
    (c.wpp||"").includes(q)
  ).slice(0, 6);
  if (!_vpSearchResults.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:12px;">Nenhum cliente encontrado</div>';
    list.style.display = "block";
    return;
  }
  list.innerHTML = _vpSearchResults.map((c, i) => `
    <div onclick="vpSelectClient(${i})" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" onmouseover="this.style.background='var(--cream)'" onmouseout="this.style.background=''">
      <strong>${escHtml(c.nome||"?")}</strong> <span style="color:var(--muted);font-size:11px;">${escHtml(c.wpp||"")}</span>
    </div>`).join("");
  list.style.display = "block";
}

function vpSelectClient(idx) {
  const c = _vpSearchResults[idx];
  if (!c) return;
  _vpClient = c;
  document.getElementById("vp-client-search").value = c.nome || "";
  document.getElementById("vp-client-list").style.display = "none";
  document.getElementById("vp-client-manual").style.display = "none";
  const sel = document.getElementById("vp-client-selected");
  sel.style.display = "block";
  sel.innerHTML = `<span style="color:var(--teal);font-weight:600;">✓ ${escHtml(c.nome)}</span> · ${escHtml(c.wpp||"")} <button onclick="vpDeselectClient(this)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;margin-left:8px;">remover</button>`;
}

function vpDeselectClient(btn) {
  _vpClient = null;
  btn.parentElement.style.display = "none";
  document.getElementById("vp-client-search").value = "";
  document.getElementById("vp-client-manual").style.display = "block";
}

function vpAddItem() {
  _vpItems.push({ prodId: "", nome: "", preco: 0, qty: 1 });
  vpRenderItems();
}

function vpRenderItems() {
  const container = document.getElementById("vp-items");
  if (!container) return;
  container.innerHTML = _vpItems.map((item, i) => {
    // Estoque disponível para cada linha
    const stockInfo = allProducts.filter(p => p.ativo !== false).map(p => {
      const s = allStock[p.id];
      const qty = s && s.ativo ? (s.qty || 0) : null; // null = sem controle de estoque
      const esgotado = qty !== null && qty === 0;
      const label = qty === null
        ? `${p.nome} — R$ ${Number(p.preco||0).toFixed(2).replace(".",",")} `
        : esgotado
          ? `${p.nome} — R$ ${Number(p.preco||0).toFixed(2).replace(".",",")}  ⚠ ESGOTADO`
          : `${p.nome} — R$ ${Number(p.preco||0).toFixed(2).replace(".",",")}  (${qty} em estoque)`;
      return { p, qty, esgotado, label };
    });

    // Cor de borda da linha se produto selecionado estiver zerado
    const selInfo = item.prodId ? stockInfo.find(x => x.p.id === item.prodId) : null;
    const rowBorder = selInfo && selInfo.esgotado
      ? "1.5px solid #D9534F"
      : "1.5px solid var(--border)";
    const maxQty = selInfo && selInfo.qty !== null ? selInfo.qty : 999;

    return `<div style="display:flex;gap:8px;align-items:flex-start;flex-direction:column;margin-bottom:4px;">
      <div style="display:flex;gap:8px;align-items:center;width:100%;">
        <select onchange="vpSetProd(${i},this.value)" style="flex:1;padding:8px 10px;border:${rowBorder};border-radius:8px;font-size:12px;color:var(--text);background:#fff;">
          <option value="">Selecionar produto...</option>
          ${stockInfo.map(({ p, esgotado, label }) =>
            `<option value="${p.id}" ${item.prodId===p.id?'selected':''} ${esgotado?'style="color:#999;"':''}>${label}</option>`
          ).join("")}
        </select>
        <input type="number" min="1" max="${maxQty}" value="${item.qty}"
          onchange="vpSetQty(${i},this.value)"
          style="width:58px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;text-align:center;">
        <button onclick="vpRemoveItem(${i})" style="background:none;border:none;color:#993C1D;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
      ${selInfo && selInfo.esgotado
        ? `<div style="font-size:11px;color:#D9534F;font-weight:500;padding-left:2px;">⚠ Este produto está sem estoque. Remova ou aguarde reposição.</div>`
        : selInfo && selInfo.qty !== null && item.qty > selInfo.qty
          ? `<div style="font-size:11px;color:#C47B35;font-weight:500;padding-left:2px;">⚠ Quantidade pedida (${item.qty}) maior que o estoque disponível (${selInfo.qty}).</div>`
          : ""}
    </div>`;
  }).join("");
  vpCalcTotal();
}

function vpSetProd(i, prodId) {
  const p = allProducts.find(x => x.id === prodId);
  if (p) {
    _vpItems[i].prodId = p.id;
    _vpItems[i].nome   = p.nome;
    // Usa preço de revenda se modo revenda estiver ativo e produto tiver esse preço
    _vpItems[i].preco  = (_vpTipo === "revenda" && p.precoRevenda)
      ? Number(p.precoRevenda)
      : Number(p.preco || 0);
    const s = allStock[p.id];
    const maxQty = s && s.ativo ? (s.qty || 0) : 999;
    if (maxQty > 0) {
      _vpItems[i].qty = Math.min(_vpItems[i].qty, maxQty);
    }
  }
  vpRenderItems();
}

function vpSetQty(i, v) {
  const prodId = _vpItems[i]?.prodId;
  const s = prodId ? allStock[prodId] : null;
  const maxQty = s && s.ativo ? (s.qty || 0) : 999;
  const requested = Math.max(1, parseInt(v)||1);
  if (maxQty > 0 && requested > maxQty) {
    _vpItems[i].qty = maxQty;
    showToast(`Estoque máximo: ${maxQty} unidade(s)`);
  } else {
    _vpItems[i].qty = requested;
  }
  vpRenderItems();
}

function vpRemoveItem(i) {
  _vpItems.splice(i, 1);
  vpRenderItems();
}

function vpSetDescontoTipo(tipo) {
  window._vpDescontoTipo = tipo;
  const btnR = document.getElementById("vp-desc-tipo-R");
  const btnP = document.getElementById("vp-desc-tipo-P");
  if (btnR && btnP) {
    btnR.style.background = tipo === "R$" ? "var(--teal)" : "#fff";
    btnR.style.color      = tipo === "R$" ? "#fff" : "var(--muted)";
    btnP.style.background = tipo === "%" ? "var(--teal)" : "#fff";
    btnP.style.color      = tipo === "%" ? "#fff" : "var(--muted)";
  }
  vpCalcTotal();
}

function vpCalcTotal() {
  const subtotal = _vpItems.reduce((s, item) => s + (item.preco * item.qty), 0);
  const descontoInput = parseFloat(document.getElementById("vp-desconto")?.value) || 0;
  const tipo = window._vpDescontoTipo || "R$";
  let descontoValor = tipo === "%" ? subtotal * (descontoInput / 100) : descontoInput;
  descontoValor = Math.min(descontoValor, subtotal); // não pode ser maior que subtotal
  const total = Math.max(0, subtotal - descontoValor);

  // Subtotal row
  const subtotalRow = document.getElementById("vp-subtotal-row");
  const subtotalEl  = document.getElementById("vp-subtotal");
  const descontoRow = document.getElementById("vp-desconto-row");
  const descontoEl  = document.getElementById("vp-desconto-valor");
  const totalEl     = document.getElementById("vp-total");

  if (descontoValor > 0) {
    if (subtotalRow) { subtotalRow.style.display = "flex"; }
    if (subtotalEl)  subtotalEl.textContent = "R$ " + subtotal.toFixed(2).replace(".",",");
    if (descontoRow) { descontoRow.style.display = "flex"; }
    if (descontoEl)  descontoEl.textContent = "– R$ " + descontoValor.toFixed(2).replace(".",",");
  } else {
    if (subtotalRow) subtotalRow.style.display = "none";
    if (descontoRow) descontoRow.style.display = "none";
  }

  if (totalEl) totalEl.textContent = "R$ " + total.toFixed(2).replace(".",",");
  return { subtotal, descontoValor, total };
}

async function submitVendaPresencial() {
  const items = _vpItems.filter(i => i.prodId);
  if (!items.length) { showToast("Adicione ao menos um produto", "error"); return; }

  // ── Validação de estoque antes de registrar (só faz sentido para venda
  // imediata — encomenda é produzida até a data de retirada) ──────────
  if (_vpPedidoTipo !== "encomenda") {
    const semEstoque = [];
    const excessoEstoque = [];
    for (const item of items) {
      const s = allStock[item.prodId];
      if (!s || !s.ativo) continue; // produto sem controle de estoque — permite
      const disponivel = s.qty || 0;
      if (disponivel === 0) {
        semEstoque.push(item.nome);
      } else if (item.qty > disponivel) {
        excessoEstoque.push(`${item.nome} (pedido: ${item.qty}, disponível: ${disponivel})`);
      }
    }
    if (semEstoque.length) {
      showToast(`Estoque zerado: ${semEstoque.join(", ")}. Remova o produto ou atualize o estoque.`, "error");
      return;
    }
    if (excessoEstoque.length) {
      showToast(`Quantidade maior que o estoque: ${excessoEstoque.join(" | ")}`, "error");
      return;
    }
  }

  const isEncomenda = _vpPedidoTipo === "encomenda";

  let dataRetirada, periodo;
  if (isEncomenda) {
    dataRetirada = document.getElementById("vp-enc-data").value;
    periodo = document.getElementById("vp-enc-periodo").value;
    if (!dataRetirada) { showToast("Informe a data de retirada da encomenda", "error"); return; }
  } else {
    dataRetirada = new Date().toISOString().split("T")[0];
    periodo = "Presencial";
  }

  // ── Resolve cliente: selecionado na busca, ou digitado manualmente ──
  const manualNome = document.getElementById("vp-client-manual-nome")?.value.trim() || "";
  const manualWppNorm = (document.getElementById("vp-client-manual-wpp")?.value.trim() || "").replace(/\D/g,"");
  const shouldRegister = document.getElementById("vp-client-manual-register")?.checked;

  let clienteInfo = _vpClient ? { nome: _vpClient.nome, wpp: _vpClient.wpp } : null;
  let clienteRec  = _vpClient || null; // registro completo (pedidos/totalGasto) para atualizar depois

  if (!clienteInfo && manualNome) {
    if (shouldRegister) {
      if (manualWppNorm.length < 8) {
        showToast("Informe um WhatsApp válido para cadastrar o cliente", "error");
        return;
      }
      const existing = allClients.find(c => (c.wpp||"").replace(/\D/g,"") === manualWppNorm);
      if (existing) {
        clienteRec = existing;
      } else {
        try {
          await fbSetMerge("clients", manualWppNorm, {
            nome: manualNome, wpp: manualWppNorm, lastCadastroAt: FB.serverTimestamp()
          });
          clienteRec = { id: manualWppNorm, nome: manualNome, wpp: manualWppNorm, pedidos: 0, totalGasto: 0 };
        } catch(e) {
          console.error(e);
          showToast("Erro ao cadastrar cliente. Nada foi registrado.", "error");
          return;
        }
      }
    }
    clienteInfo = { nome: manualNome, wpp: manualWppNorm };
  }
  if (!clienteInfo) clienteInfo = { nome: isEncomenda ? "Encomenda" : "Venda Presencial", wpp: "" };

  const { subtotal, descontoValor, total } = vpCalcTotal();
  const pagamento = document.getElementById("vp-pagamento").value;
  const obs = document.getElementById("vp-obs").value;

  // Build order object
  const orderNum = (isEncomenda ? "ENC-" : "VP-") + Date.now().toString().slice(-6);
  const order = {
    tipo: _vpPedidoTipo,
    tipoVenda: _vpTipo || "varejo",
    status: isEncomenda ? "pendente" : "entregue",
    cliente: clienteInfo,
    clienteId: clienteRec?.id || null,
    itens: items.map(i => ({ prodId: i.prodId||null, nome: i.nome, qty: i.qty, preco: i.preco })),
    subtotal,
    desconto: descontoValor,
    descontoTipo: window._vpDescontoTipo || "R$",
    total,
    pagamento,
    pagamentoConfirmado: isEncomenda ? false : pagamento !== "fiado",
    dataRetirada,
    periodo,
    obs,
    orderNum,
    createdAt: { seconds: Math.floor(Date.now()/1000) },
    _stockDecremented: false
  };

  try {
    const ref = await fbAdd("orders", order);
    order.id = ref;
    allOrders.unshift(order);
    // If fiado: link to client's account
    if (pagamento === "fiado" && clienteInfo.wpp) {
      let accounts = [];
      try { accounts = await fbGet("fiadoAccounts"); } catch {}
      const wpp = clienteInfo.wpp.replace(/\D/g,"");
      const acc = accounts.find(a => a.clientWpp?.replace(/\D/g,"") === wpp);
      if (acc) {
        await fbUpdate("fiadoAccounts", acc.id, { saldo: Number(acc.saldo||0) + total });
      } else {
        await fbAdd("fiadoAccounts", { clientNome: clienteInfo.nome, clientWpp: clienteInfo.wpp, saldo: total, autorizado: true, createdAt: new Date().toISOString() });
      }
    }
    // Update client stats if linked (cliente selecionado ou recém-cadastrado)
    if (clienteRec?.id) {
      const pedidos = Number(clienteRec.pedidos||0) + 1;
      const totalGasto = Number(clienteRec.totalGasto||0) + total;
      await fbUpdate("clients", clienteRec.id, { pedidos, totalGasto });
    }
    showToast(isEncomenda ? "Encomenda registrada com sucesso!" : "Venda registrada com sucesso!", "success");
    addAuditLog(orderNum, `${isEncomenda ? "Encomenda" : "Venda presencial"} #${orderNum} — ${order.cliente.nome} — R$ ${total.toFixed(2)} — ${payLabel(pagamento)}`, "pedido");

    if (!isEncomenda) {
      // ── Baixa imediata no estoque (venda presencial = entregue na hora) ──
      let stockChanged = false;
      for (const item of items) {
        if (!item.prodId) continue;
        const s = allStock[item.prodId];
        if (!s?.id) continue;
        const newQty = Math.max(0, (s.qty || 0) - (item.qty || 1));
        try {
          await FB.updateDoc(FB.doc(db, "stock", s.id), { qty: newQty });
          allStock[item.prodId] = { ...s, qty: newQty };
          stockChanged = true;
        } catch(e) { console.warn("VP: erro ao baixar estoque:", e); }
      }
      // Marca o pedido como já descontado
      try { await fbUpdate("orders", ref, { _stockDecremented: true }); } catch(e) {}
      allOrders = allOrders.map(o => o.id === ref ? { ...o, _stockDecremented: true } : o);
      if (stockChanged) { renderStockAdmin(); renderPEProducts(); }
    }

    closeVendaPresencial();
    renderOrders();
  } catch(e) {
    console.error(e);
    showToast(isEncomenda ? "Erro ao registrar encomenda" : "Erro ao registrar venda", "error");
  }
}

// ═══════════════════════════════════════════════════════
//  METAS & LUCRO
// ═══════════════════════════════════════════════════════
async function loadMetas() {
  // Load saved meta for current month
  const key = `metas_${new Date().getFullYear()}_${new Date().getMonth()+1}`;
  let saved = {};
  try {
    const docs = await fbGet("metas");
    saved = docs.find(d => d.key === key) || {};
  } catch {}
  // Also try localStorage fallback
  const local = JSON.parse(localStorage.getItem("panillo-metas-" + key) || "{}");
  const meta = { ...local, ...saved };

  // Load config overhead
  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overheadPct = Number(cfg.overhead || 20);

  // Fill inputs
  document.getElementById("meta-faturamento").value   = meta.faturamento || "";
  document.getElementById("meta-lucro").value         = meta.lucro || "";
  document.getElementById("meta-reserva-pct").value   = meta.reservaPct || "";
  document.getElementById("meta-overhead-local").value= meta.overhead || overheadPct;

  metasCalc();
  metasLoadHistory();
}

async function metasCalc() {
  const metaFat   = Number(document.getElementById("meta-faturamento")?.value) || 0;
  const metaLucro = Number(document.getElementById("meta-lucro")?.value) || 0;
  const reservaPct= Number(document.getElementById("meta-reserva-pct")?.value) || 0;
  const overhead  = Number(document.getElementById("meta-overhead-local")?.value) || 20;

  // Current month actual
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let orders = allOrders;
  if (!orders.length) { try { orders = await fbGet("orders"); allOrders = orders; } catch {} }
  const activeStatus = ["confirmado","pronto","entregue"];
  const monthOrders = orders.filter(o => {
    if (!activeStatus.includes(o.status)) return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    return ts >= monthStart;
  });
  const fatAtual = monthOrders.reduce((s,o) => s + Number(o.total||0), 0);
  const lucroAtual = fatAtual * (1 - overhead/100);
  const reservaAtual = fatAtual * (reservaPct/100);

  // Projections
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  const projFat = dayOfMonth > 0 ? (fatAtual / dayOfMonth) * daysInMonth : 0;
  const projLucro = projFat * (1 - overhead/100);
  const projReserva = projFat * (reservaPct/100);
  const projAnual = projFat * 12;

  const fmt = v => "R$ " + Number(v).toFixed(2).replace(".",",");
  const pct = metaFat > 0 ? Math.min(100, (fatAtual/metaFat)*100) : 0;
  const daysLeft = daysInMonth - dayOfMonth;

  // KPIs
  document.getElementById("metas-kpis").innerHTML = `
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Faturado este mês</div>
      <div style="font-size:22px;font-weight:700;color:var(--teal-dark);">${fmt(fatAtual)}</div>
      <div style="font-size:11px;color:var(--muted);">${monthOrders.length} pedidos</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Lucro estimado</div>
      <div style="font-size:22px;font-weight:700;color:#8B4513;">${fmt(lucroAtual)}</div>
      <div style="font-size:11px;color:var(--muted);">Overhead: ${overhead}%</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Reserva constituída</div>
      <div style="font-size:22px;font-weight:700;color:#4B7FCC;">${fmt(reservaAtual)}</div>
      <div style="font-size:11px;color:var(--muted);">${reservaPct}% do faturamento</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Projeção mensal</div>
      <div style="font-size:22px;font-weight:700;color:var(--gold-dark);">${fmt(projFat)}</div>
      <div style="font-size:11px;color:var(--muted);">${daysLeft} dias restantes</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Projeção anual</div>
      <div style="font-size:22px;font-weight:700;color:var(--teal-dark);">${fmt(projAnual)}</div>
      <div style="font-size:11px;color:var(--muted);">lucro proj. ${fmt(projLucro*12)}</div>
    </div>`;

  // Progress bars
  const progressHtml = (label, atual, meta, color) => {
    const p = meta > 0 ? Math.min(100,(atual/meta)*100) : 0;
    const diff = atual - meta;
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <span style="font-size:12px;font-weight:600;color:var(--text);">${label}</span>
        <span style="font-size:12px;color:var(--muted);">${fmt(atual)} / ${fmt(meta)} <b style="color:${diff>=0?'#8B4513':'#993C1D'}">(${diff>=0?'+':''}${fmt(diff)})</b></span>
      </div>
      <div style="height:12px;background:var(--cream-dark);border-radius:8px;overflow:hidden;">
        <div style="height:100%;width:${p.toFixed(1)}%;background:${color};border-radius:8px;transition:width .4s;"></div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">${p.toFixed(1)}% da meta</div>
    </div>`;
  };
  document.getElementById("metas-progress").innerHTML =
    (metaFat ? progressHtml("🎯 Faturamento", fatAtual, metaFat, "var(--teal)") : "") +
    (metaLucro ? progressHtml("💰 Lucro", lucroAtual, metaLucro, "#8B4513") : "") +
    (metaFat && reservaPct ? progressHtml("🏦 Reserva", reservaAtual, metaFat*(reservaPct/100), "#4B7FCC") : "") +
    (!metaFat && !metaLucro ? `<div style="color:var(--muted);font-size:13px;">Defina as metas acima para ver o progresso.</div>` : "");

  // Weekly breakdown
  const weeksInMonth = Math.ceil(daysInMonth / 7);
  const metaSemanal = metaFat / weeksInMonth;
  const currentWeek = Math.ceil(dayOfMonth / 7);
  let weeklyHtml = "";
  for (let w = 1; w <= weeksInMonth; w++) {
    const wStart = new Date(now.getFullYear(), now.getMonth(), (w-1)*7+1);
    const wEnd   = new Date(now.getFullYear(), now.getMonth(), Math.min(w*7, daysInMonth));
    const wFat = monthOrders.filter(o => {
      const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
      return ts >= wStart && ts <= wEnd;
    }).reduce((s,o) => s+Number(o.total||0), 0);
    const isCurrent = w === currentWeek;
    const wp = metaSemanal > 0 ? Math.min(100,(wFat/metaSemanal)*100) : 0;
    weeklyHtml += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;${isCurrent?'background:var(--cream);padding:8px;border-radius:8px;':''}">
      <span style="font-size:12px;font-weight:600;color:var(--text);min-width:60px;">Semana ${w}${isCurrent?' <span style="background:var(--teal);color:#fff;border-radius:4px;padding:1px 5px;font-size:9px;">atual</span>':''}</span>
      <div style="flex:1;height:10px;background:var(--cream-dark);border-radius:6px;overflow:hidden;">
        <div style="height:100%;width:${wp.toFixed(0)}%;background:${w<currentWeek?'var(--teal-dark)':isCurrent?'var(--teal)':'#ccc'};border-radius:6px;transition:width .4s;"></div>
      </div>
      <span style="font-size:12px;color:var(--muted);min-width:90px;text-align:right;">${fmt(wFat)} / ${fmt(metaSemanal)}</span>
    </div>`;
  }
  document.getElementById("metas-weekly").innerHTML = metaFat ? weeklyHtml : `<div style="color:var(--muted);font-size:13px;">Defina a meta mensal para ver a distribuição semanal.</div>`;
}

async function metasSaveCurrent() {
  const now = new Date();
  const key = `metas_${now.getFullYear()}_${now.getMonth()+1}`;
  const monthLabel = now.toLocaleDateString("pt-BR", { month:"long", year:"numeric" });
  const metaData = {
    key, monthLabel,
    faturamento:  Number(document.getElementById("meta-faturamento")?.value) || 0,
    lucro:        Number(document.getElementById("meta-lucro")?.value) || 0,
    reservaPct:   Number(document.getElementById("meta-reserva-pct")?.value) || 0,
    overhead:     Number(document.getElementById("meta-overhead-local")?.value) || 20,
    savedAt: new Date().toISOString()
  };
  // Save to Firebase
  try {
    const docs = await fbGet("metas");
    const existing = docs.find(d => d.key === key);
    if (existing) await fbUpdate("metas", existing.id, metaData);
    else await fbAdd("metas", metaData);
    showToast("Meta do mês salva!", "success");
  } catch {
    localStorage.setItem("panillo-metas-" + key, JSON.stringify(metaData));
    showToast("Meta salva localmente!", "success");
  }
  metasLoadHistory();
}

async function metasLoadHistory() {
  const el = document.getElementById("metas-history");
  if (!el) return;
  let history = [];
  try { history = await fbGet("metas"); } catch {
    // fallback localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("panillo-metas-")) {
        try { history.push(JSON.parse(localStorage.getItem(k))); } catch {}
      }
    }
  }
  history.sort((a,b) => (b.key||"").localeCompare(a.key||""));
  if (!history.length) { el.innerHTML = `<div style="color:var(--muted);font-size:13px;">Nenhuma meta salva ainda. Defina e clique em "Salvar mês".</div>`; return; }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
    <thead><tr style="background:var(--cream);">
      <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Mês</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Meta Fat.</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Meta Lucro</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Reserva %</th>
      <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;">Overhead %</th>
    </tr></thead>
    <tbody>${history.map(h => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px 12px;font-size:13px;font-weight:600;color:var(--teal-dark);">${h.monthLabel||h.key}</td>
      <td style="padding:10px 12px;text-align:right;font-size:13px;">R$ ${Number(h.faturamento||0).toFixed(2).replace(".",",")}</td>
      <td style="padding:10px 12px;text-align:right;font-size:13px;color:#8B4513;">R$ ${Number(h.lucro||0).toFixed(2).replace(".",",")}</td>
      <td style="padding:10px 12px;text-align:right;font-size:13px;color:#4B7FCC;">${h.reservaPct||0}%</td>
      <td style="padding:10px 12px;text-align:right;font-size:13px;color:#C8902A;">${h.overhead||20}%</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

// ═══════════════════════════════════════════════════════
//  FLUXO DE CAIXA
// ═══════════════════════════════════════════════════════
let _fluxoMode = "mes";

async function loadFluxo(mode = "mes") {
  _fluxoMode = mode;
  ["s","m","a"].forEach(k => {
    const b = document.getElementById("fluxo-btn-"+k);
    if (!b) return;
    b.style.background = ""; b.style.color = ""; b.style.borderColor = "";
  });
  const btnMap = {semana:"s", mes:"m", ano:"a"};
  if (mode !== "custom") {
    const btn = document.getElementById("fluxo-btn-"+btnMap[mode]);
    if (btn) { btn.style.background="var(--teal)"; btn.style.color="#fff"; btn.style.borderColor="var(--teal)"; }
  }

  let orders = allOrders;
  if (!orders.length) { try { orders = await fbGet("orders"); allOrders = orders; } catch { orders = []; } }

  const cfg = JSON.parse(localStorage.getItem("panillo-config") || "{}");
  const overhead = Number(cfg.overhead || 20) / 100;
  const now = new Date();

  let cutoff, cutoffEnd, days;

  if (mode === "custom") {
    const fromVal = document.getElementById("fluxo-date-from")?.value;
    const toVal   = document.getElementById("fluxo-date-to")?.value;
    if (!fromVal || !toVal) { showToast("Selecione as duas datas!"); return; }
    cutoff    = new Date(fromVal + "T00:00:00");
    cutoffEnd = new Date(toVal   + "T23:59:59");
    days = Math.round((cutoffEnd - cutoff) / (1000*60*60*24)) + 1;
  } else {
    days = mode === "semana" ? 7 : mode === "mes" ? 30 : 365;
    cutoff    = new Date(now); cutoff.setDate(now.getDate() - days);
    cutoffEnd = now;
  }

  // Load metas for reserva %
  let reservaPct = 0;
  try {
    const metaDocs = await fbGet("metas");
    const curKey = `metas_${now.getFullYear()}_${now.getMonth()+1}`;
    const curMeta = metaDocs.find(d => d.key === curKey);
    if (curMeta) reservaPct = Number(curMeta.reservaPct || 0) / 100;
  } catch {}

  const active = ["confirmado","pronto","entregue"];
  const filtered = orders.filter(o => {
    if (!active.includes(o.status)) return false;
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    return ts >= cutoff && ts <= cutoffEnd;
  });

  // Buckets — um por dia no intervalo
  const buckets = {};
  for (let i = 0; i < Math.min(days, 366); i++) {
    const d = new Date(cutoff); d.setDate(cutoff.getDate() + i);
    if (d > cutoffEnd) break;
    const k = d.toISOString().split("T")[0];
    buckets[k] = { entradas:0, confirmado:0, aReceber:0, pedidos:0 };
  }
  filtered.forEach(o => {
    const ts = o.createdAt?.seconds ? new Date(o.createdAt.seconds*1000) : new Date(o.dataRetirada+"T12:00");
    const k = ts.toISOString().split("T")[0];
    if (!buckets[k]) return;
    buckets[k].entradas += Number(o.total||0);
    buckets[k].pedidos++;
    if (o.pagamentoConfirmado) buckets[k].confirmado += Number(o.total||0);
    else buckets[k].aReceber += Number(o.total||0);
  });

  const labels = Object.keys(buckets);
  const entrData = labels.map(k => buckets[k].entradas);
  const recData  = labels.map(k => buckets[k].confirmado);
  const arvData  = labels.map(k => buckets[k].aReceber);

  const totalEnt = filtered.reduce((s,o) => s+Number(o.total||0), 0);
  const totalRec = filtered.filter(o=>o.pagamentoConfirmado).reduce((s,o)=>s+Number(o.total||0),0);
  const totalArec = totalEnt - totalRec;
  const totalLucro = totalEnt * (1-overhead);
  const totalReserva = totalEnt * reservaPct;

  const fmt = v => "R$ " + Number(v).toFixed(2).replace(".",",");

  document.getElementById("fluxo-kpis").innerHTML = [
    ["💰 Total Entradas", fmt(totalEnt), "var(--teal-dark)"],
    ["✅ Confirmado", fmt(totalRec), "#8B4513"],
    ["⏳ A Receber", fmt(totalArec), "#C8902A"],
    ["📈 Lucro Est.", fmt(totalLucro), "var(--teal)"],
    ["🏦 Reserva Est.", fmt(totalReserva), "#4B7FCC"],
  ].map(([lbl,val,color]) => `<div class="admin-card" style="padding:14px;text-align:center;">
    <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">${lbl}</div>
    <div style="font-size:18px;font-weight:700;color:${color};">${val}</div>
  </div>`).join("");

  _drawLineChart("fluxo-chart", "fluxo-tooltip", labels, [
    { label:"Entradas",   data: entrData, color:"var(--teal)" },
    { label:"Confirmado", data: recData,  color:"#8B4513" },
    { label:"A Receber",  data: arvData,  color:"#C8902A" },
  ], v => "R$ "+v.toFixed(2).replace(".",","));

  // Table — only rows with activity, newest first
  const tableRows = labels.slice().reverse().filter(k => buckets[k].entradas > 0).map(k => {
    const b = buckets[k];
    const d = new Date(k+"T12:00");
    const reservaVal = b.entradas * reservaPct;
    const lucroVal   = b.entradas * (1-overhead);
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:10px 14px;font-size:12px;">${d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric"})}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:var(--teal-dark);">${fmt(b.entradas)}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;color:#8B4513;">${fmt(b.confirmado)}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;color:#C8902A;">${fmt(b.aReceber)}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;color:#4B7FCC;">${fmt(reservaVal)}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;color:var(--teal);">${fmt(lucroVal)}</td>
    </tr>`;
  });
  document.getElementById("fluxo-tbody").innerHTML = tableRows.length
    ? tableRows.join("")
    : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);">Nenhuma movimentação no período</td></tr>`;
}

// ═══════════════════════════════════════════════════════
//  PRODUÇÃO
// ═══════════════════════════════════════════════════════
async function loadProducao() {
  let orders = allOrders;
  if (!orders.length) { try { orders = await fbGet("orders"); allOrders = orders; } catch {} }
  let ings = allIngredients;
  if (!ings.length) { try { ings = await fbGet("ingredients"); allIngredients = ings; } catch {} }
  let prods = allProducts;
  if (!prods.length) { try { prods = await fbGet("products"); allProducts = prods; } catch {} }

  const pending = orders.filter(o => ["confirmado","pronto"].includes(o.status));

  // Aggregate items to produce
  const itemCount = {};
  pending.forEach(o => (o.itens||[]).forEach(i => {
    itemCount[i.nome] = (itemCount[i.nome]||0) + (i.qty||0);
  }));

  const itensEl = document.getElementById("producao-itens");
  if (!Object.keys(itemCount).length) {
    itensEl.innerHTML = `<div style="color:var(--muted);font-size:13px;">Nenhum pedido confirmado pendente de produção.</div>`;
  } else {
    itensEl.innerHTML = Object.entries(itemCount).sort((a,b)=>b[1]-a[1]).map(([nome, qty]) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;font-weight:600;color:var(--text);">${nome}</span>
        <span style="background:var(--teal);color:#fff;padding:3px 12px;border-radius:20px;font-size:13px;font-weight:700;">${qty} un.</span>
      </div>`).join("");
  }

  // Aggregate ingredients needed
  const ingNeeded = {};
  pending.forEach(o => (o.itens||[]).forEach(item => {
    const prod = prods.find(p => p.nome === item.nome || p.id === item.prodId);
    if (!prod?.ingredientes) return;
    prod.ingredientes.forEach(pi => {
      ingNeeded[pi.ingId] = (ingNeeded[pi.ingId]||0) + pi.grams * (item.qty||0);
    });
  }));

  const ingsEl = document.getElementById("producao-ingredientes");
  if (!Object.keys(ingNeeded).length) {
    ingsEl.innerHTML = `<div style="color:var(--muted);font-size:13px;">Cadastre ingredientes nos produtos para ver a projeção.</div>`;
  } else {
    ingsEl.innerHTML = Object.entries(ingNeeded).map(([ingId, grams]) => {
      const ing = ings.find(i => i.id === ingId);
      if (!ing) return "";
      const disponivel = ing.unit === "kg" ? (ing.estoque||0)*1000 : (ing.estoque||0);
      const falta = grams - disponivel;
      const ok = falta <= 0;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);">${ing.nome}</div>
          <div style="font-size:11px;color:var(--muted);">Necessário: ${grams}g · Disponível: ${disponivel}g</div>
        </div>
        <span style="background:${ok?'#FDF0E0':'#FAECE7'};color:${ok?'#8B4513':'#993C1D'};padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600;">
          ${ok ? '✅ OK' : `⚠️ Falta ${Math.abs(falta).toFixed(0)}g`}
        </span>
      </div>`;
    }).filter(Boolean).join("") || `<div style="color:var(--muted);font-size:13px;">Nenhum ingrediente necessário encontrado.</div>`;
  }

  // Expiry alerts
  const today = new Date();
  const expiring = ings.filter(i => {
    if (!i.validade) return false;
    const diff = Math.ceil((new Date(i.validade+"T12:00") - today)/(1000*60*60*24));
    return diff <= 14;
  }).sort((a,b) => new Date(a.validade) - new Date(b.validade));

  const valEl = document.getElementById("producao-validade");
  valEl.innerHTML = expiring.length ? expiring.map(i => {
    const diff = Math.ceil((new Date(i.validade+"T12:00") - today)/(1000*60*60*24));
    const expired = diff < 0;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text);">${i.nome}</div>
        <div style="font-size:11px;color:var(--muted);">Validade: ${new Date(i.validade+"T12:00").toLocaleDateString("pt-BR")}</div>
      </div>
      <span style="background:${expired?'#FAECE7':'#FDF6E8'};color:${expired?'#993C1D':'#C8902A'};padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;">
        ${expired ? '❌ Vencido' : `⚠️ ${diff}d`}
      </span>
    </div>`;
  }).join("") : `<div style="color:#8B4513;font-size:13px;">✅ Todos os ingredientes dentro da validade</div>`;
}

// ═══════════════════════════════════════════════════════
//  CLIENTES INATIVOS TOGGLE
// ═══════════════════════════════════════════════════════
// Toggle sort direction on column header click
function setClientsSort(asc, desc) {
  const sel = document.getElementById("clients-sort");
  if (!sel) return;
  // If already on asc, switch to desc; otherwise set asc
  sel.value = sel.value === asc && desc ? desc : asc;
  renderClients();
}

let _showInactive = false;

function toggleInactiveFilter() {
  _showInactive = !_showInactive;
  const btn = document.getElementById("btn-inactive-filter");
  if (btn) {
    btn.textContent = _showInactive ? "👥 Ver todos" : "🔕 Ver inativos";
    btn.style.background = _showInactive ? "#FAECE7" : "#FDF6E8";
    btn.style.color = _showInactive ? "#993C1D" : "#C8902A";
    btn.style.borderColor = _showInactive ? "#993C1D44" : "#C8902A44";
  }
  renderClients();
}

// ── Patch renderClients to support inactive filter ──
const _renderClientsOriginal = renderClients;
renderClients = async function() {
  if (!_showInactive) return _renderClientsOriginal();

  let clients = allClients;
  if (!clients.length) { try { clients = await fbGet("clients"); allClients = clients; } catch {} }
  let orders = allOrders;
  if (!orders.length) { try { orders = await fbGet("orders"); allOrders = orders; } catch {} }

  const days = Number(document.getElementById("inactive-days")?.value) || 60;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);

  const inactive = clients.filter(c => {
    const clientOrders = orders.filter(o => (o.cliente?.wpp||"").replace(/\D/g,"") === (c.wpp||"").replace(/\D/g,""));
    if (!clientOrders.length) return true; // never ordered
    const lastOrder = clientOrders.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
    const lastDate = lastOrder.createdAt?.seconds ? new Date(lastOrder.createdAt.seconds*1000) : new Date(lastOrder.dataRetirada+"T12:00");
    return lastDate < cutoff;
  });

  const countEl = document.getElementById("clients-count");
  if (countEl) countEl.textContent = `${inactive.length} cliente(s) inativo(s) há mais de ${days} dias`;

  const tbody = document.getElementById("clients-tbody");
  tbody.innerHTML = inactive.length === 0
    ? `<tr><td colspan="9" style="text-align:center;padding:24px;color:#8B4513;font-weight:600;">✅ Nenhum cliente inativo há mais de ${days} dias!</td></tr>`
    : inactive.map(c => {
        const clientOrders = orders.filter(o => (o.cliente?.wpp||"").replace(/\D/g,"") === (c.wpp||"").replace(/\D/g,""));
        const lastOrder = clientOrders.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))[0];
        const lastDate = lastOrder ? (lastOrder.createdAt?.seconds ? new Date(lastOrder.createdAt.seconds*1000) : new Date(lastOrder.dataRetirada+"T12:00")) : null;
        const diffDays = lastDate ? Math.floor((new Date()-lastDate)/(1000*60*60*24)) : 999;
        const idSafe = (c.id||"").replace(/'/g,"\\'");
        const wppSafe = (c.wpp||"").replace(/\D/g,"");
        const msg = encodeURIComponent(`Olá, ${c.nome?.split(" ")[0] || ""}! 😊 Sentimos sua falta na Panillo! Que tal fazer um pedido de cookies artesanais? Confira nosso cardápio: ${window.location.origin}`);
        return `<tr>
          <td><div class="client-av" style="background:#C8902A;">${escHtml((c.nome||"?").substring(0,2).toUpperCase())}</div></td>
          <td class="client-name">${escHtml(c.nome||"—")}</td>
          <td>${escHtml(c.wpp||"—")}</td>
          <td style="font-size:12px;color:#993C1D;font-weight:600;">${lastDate ? lastDate.toLocaleDateString("pt-BR") : "Nunca pediu"}</td>
          <td style="text-align:center;font-weight:700;color:#993C1D;">${diffDays === 999 ? "—" : diffDays+"d"}</td>
          <td>${c.pedidos||0}</td>
          <td>R$ ${Number(c.totalGasto||0).toFixed(2).replace(".",",")}</td>
          <td>—</td>
          <td>
            <div style="display:flex;gap:6px;">
              ${c.wpp ? `<a href="https://wa.me/55${wppSafe}?text=${msg}" target="_blank" style="background:#25D366;color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap;">💬 Reativar</a>` : ""}
              <button class="pay-confirm-btn" onclick="openClientDetail('${idSafe}')">📋 Ver</button>
            </div>
          </td>
        </tr>`;
      }).join("");
};
