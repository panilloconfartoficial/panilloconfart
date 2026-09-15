// ─── TOGGLE ATIVO / DELETAR PRODUTO ───────────────────
async function toggleProdActive(id, tornandoAtivo) {
  const novoAtivo = tornandoAtivo === true;
  try {
    await fbUpdate("products", id, { ativo: novoAtivo });
  } catch(e) { console.warn(e); }
  allProducts = allProducts.map(p => p.id === id ? { ...p, ativo: novoAtivo } : p);
  renderAdminProducts();
  renderStoreProducts("todos");
  showToast(novoAtivo ? "Produto ativado!" : "Produto desativado!");
}

async function deleteProd(id, nome) {
  if (!confirm(`Deletar "${nome}" permanentemente? Esta ação não pode ser desfeita.`)) return;
  try {
    const { deleteDoc, doc: fbDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(fbDoc(db, "products", id));
  } catch(e) { console.warn("Firebase delete error:", e); }
  allProducts = allProducts.filter(p => p.id !== id);
  renderAdminProducts();
  renderStoreProducts("todos");
  showToast("Produto deletado!");
}

// ─── INGREDIENTS ───────────────────────────────────────
async function loadIngredients() {
  try { allIngredients = await fbGet("ingredients"); } catch { allIngredients = []; }
  renderIngredients();
}

function renderIngredients() {
  const tbody = document.getElementById("ing-tbody");
  if (!tbody) return;
  const today = new Date();
  tbody.innerHTML = allIngredients.length === 0
    ? `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Nenhum ingrediente cadastrado. Clique em "+ Ingrediente".</td></tr>`
    : allIngredients.map(i => {
        const ok = i.estoque >= (i.min || 0);
        const pricePerG = precoPorGrama(i);
        // Validade
        let validadeHtml = `<span style="color:var(--muted);font-size:11px;">—</span>`;
        if (i.validade) {
          const vd = new Date(i.validade + "T12:00");
          const diff = Math.ceil((vd - today)/(1000*60*60*24));
          if (diff < 0) validadeHtml = `<span style="background:#FAECE7;color:#993C1D;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;">❌ Vencido</span>`;
          else if (diff <= 3) validadeHtml = `<span style="background:#FDF6E8;color:#C8902A;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;">⚠️ ${diff}d</span>`;
          else if (diff <= 7) validadeHtml = `<span style="background:#FDF0E0;color:#8B4513;padding:2px 7px;border-radius:6px;font-size:11px;">✅ ${diff}d</span>`;
          else validadeHtml = `<span style="font-size:12px;color:var(--muted);">${vd.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>`;
        }
        return `<tr>
          <td class="ing-name">${i.nome}</td>
          <td>${i.estoque} ${i.unit}</td>
          <td>${i.min || "—"} ${i.unit}</td>
          <td>R$ ${Number(i.preco||0).toFixed(2)} / ${i.unit}</td>
          <td>R$ ${pricePerG.toFixed(4)}</td>
          <td>${validadeHtml}</td>
          <td><span class="${ok?'stock-ok':'stock-low'}">${ok?'OK':'Baixo'}</span></td>
          <td><div class="ing-actions">
            <button class="ing-act-btn" onclick="openIngModal('${i.id}')">Editar</button>
            <button class="ing-act-btn" style="color:#E24B4A;" onclick="deleteIngredient('${i.id}','${escHtml(i.nome)}')">Excluir</button>
          </div></td>
        </tr>`;
      }).join("");
  renderRecipes();
}

function renderRecipes() {
  const grid = document.getElementById("recipe-grid");
  if (!grid) return;
  const prods = allProducts.filter(p => p.ingredientes && p.ingredientes.length > 0);
  if (prods.length === 0) {
    grid.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:20px;">Cadastre produtos com ingredientes para ver o custo por receita.</div>`;
    return;
  }
  grid.innerHTML = prods.map(p => {
    let totalCost = 0;
    const rows = (p.ingredientes||[]).map(pi => {
      const ing = allIngredients.find(i => i.id === pi.ingId);
      if (!ing) return "";
      const pricePerG = precoPorGrama(ing);
      const cost = pricePerG * pi.grams;
      totalCost += cost;
      return `<div class="rc-row"><span class="rc-ing">${ing.nome}</span><span class="rc-gram">${pi.grams}g</span><span class="rc-cost">R$ ${cost.toFixed(2)}</span></div>`;
    }).join("");
    const rend = p.rendimento || 1;
    const _c = _planCfg();
    const _vh = _c.horas > 0 ? _c.proLabore/_c.horas : 0;
    const ingUn   = (totalCost/rend) * (1 + _c.perda);
    const tempoAtivoProd = ((Number(p.tempoPreparoMin)||0) + (Number(p.tempoEmbalagemMin)||0)) > 0
      ? (Number(p.tempoPreparoMin)||0) + (Number(p.tempoEmbalagemMin)||0)
      : _c.tempo;
    const laborUn = (tempoAtivoProd/rend) * _vh/60;
    const tempoLabel = ((Number(p.tempoPreparoMin)||0) + (Number(p.tempoEmbalagemMin)||0)) > 0
      ? `${tempoAtivoProd}min (${Number(p.tempoPreparoMin)||0}min preparo + ${Number(p.tempoEmbalagemMin)||0}min embalagem)`
      : `${tempoAtivoProd}min (global)`;
    const custoUn = ingUn + laborUn;
    const cmUn    = (p.preco||0)*(1 - _c.cartao) - ingUn - laborUn;
    const cmPct   = p.preco > 0 ? (cmUn/p.preco*100) : 0;
    const sugDen  = 1 - 0.30 - _c.cartao;
    const sugerido = sugDen > 0 ? custoUn/sugDen : 0;
    return `<div class="recipe-card">
      <div class="rc-header"><span class="rc-name">${p.nome}</span><span class="rc-emoji">${p.emoji||"🍪"}</span></div>
      <div class="rc-body">${rows || '<div style="padding:8px;color:var(--muted);font-size:12px;">Sem ingredientes</div>'}</div>
      <div class="rc-footer">
        <div class="rc-f-row"><span class="rc-f-lbl">Ingrediente / un (c/ ${Math.round(_c.perda*100)}% perda)</span><span class="rc-f-val">R$ ${ingUn.toFixed(2)}</span></div>
        <div class="rc-f-row"><span class="rc-f-lbl">Mão de obra / un <span style="font-size:10px;color:var(--muted);">(${tempoLabel})</span></span><span class="rc-f-val">R$ ${laborUn.toFixed(2)}</span></div>
        <div class="rc-f-row"><span class="rc-f-lbl">Custo real / un</span><span class="rc-f-val">R$ ${custoUn.toFixed(2)}</span></div>
        <div class="rc-profit-row">
          <span class="rc-profit-lbl">Margem de contribuição / un</span>
          <span class="rc-profit-val" style="${cmUn<=0?'color:#E24B4A;':''}">R$ ${cmUn.toFixed(2)} (${cmPct.toFixed(0)}%)</span>
        </div>
        <div class="rc-f-row" style="margin-top:6px;"><span class="rc-f-lbl">Preço sugerido (30% margem)</span><span class="rc-f-val">R$ ${sugerido.toFixed(2)}</span></div>
        <div class="rc-margin-wrap">
          <div class="rc-margin-top"><span>Margem de contribuição</span><span>${cmPct.toFixed(0)}%</span></div>
          <div class="rc-margin-bar"><div class="rc-margin-fill" style="width:${Math.max(0,Math.min(100,cmPct)).toFixed(0)}%;background:${cmUn>0?'var(--gold)':'#E24B4A'};"></div></div>
        </div>
      </div>
    </div>`;
  }).join("");
}

function openIngModal(id) {
  editingIngId = id || null;
  if (id) {
    const i = allIngredients.find(x => x.id === id);
    if (i) {
      document.getElementById("ing-nome").value     = i.nome;
      document.getElementById("ing-unit").value     = i.unit;
      document.getElementById("ing-preco").value    = i.preco;
      document.getElementById("ing-estoque").value  = i.estoque;
      document.getElementById("ing-min").value      = i.min || "";
      const vd = document.getElementById("ing-validade");
      if (vd) vd.value = i.validade || "";
      document.getElementById("ing-modal-title").textContent = "Editar ingrediente";
    }
  } else {
    ["ing-nome","ing-preco","ing-estoque","ing-min"].forEach(x => document.getElementById(x).value = "");
    const vd = document.getElementById("ing-validade"); if (vd) vd.value = "";
    document.getElementById("ing-modal-title").textContent = "Novo ingrediente";
  }
  document.getElementById("ing-modal").classList.add("open");
}

async function deleteIngredient(id, nome) {
  const usadoEm = (allProducts || []).filter(p => (p.ingredientes||[]).some(pi => pi.ingId === id)).map(p => p.nome);
  let msg = `Excluir "${nome}" permanentemente? Esta ação não pode ser desfeita.`;
  if (usadoEm.length) msg += `\n\nAtenção: usado na(s) receita(s): ${usadoEm.join(", ")}. O custo dessas receitas vai parar de considerar este ingrediente.`;
  if (!confirm(msg)) return;
  try {
    const { deleteDoc, doc: fbDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(fbDoc(db, "ingredients", id));
  } catch(e) { console.warn("Firebase delete error:", e); }
  allIngredients = allIngredients.filter(i => i.id !== id);
  renderIngredients();
  showToast("Ingrediente excluído!");
}

function closeIngModal() { document.getElementById("ing-modal").classList.remove("open"); }

async function saveIngredient() {
  const nome = document.getElementById("ing-nome").value.trim();
  const preco = parseFloat(document.getElementById("ing-preco").value);
  if (!nome || !preco) { showToast("Preencha nome e preço!"); return; }
  const validade = document.getElementById("ing-validade")?.value || "";
  const data = {
    nome, preco, validade,
    unit:    document.getElementById("ing-unit").value,
    estoque: parseFloat(document.getElementById("ing-estoque").value) || 0,
    min:     parseFloat(document.getElementById("ing-min").value) || 0
  };
  try {
    if (editingIngId) {
      await fbUpdate("ingredients", editingIngId, data);
      allIngredients = allIngredients.map(i => i.id === editingIngId ? {...i,...data} : i);
    } else {
      const ref = await fbAdd("ingredients", data);
      allIngredients.push({ id: ref.id, ...data });
    }
  } catch { allIngredients.push({ id: "i"+Date.now(), ...data }); }
  closeIngModal();
  renderIngredients();
  showToast("Ingrediente salvo!");
}

function showSupTab(tab, btn) {
  document.querySelectorAll("#tab-ing, #tab-receitas, #tab-baixa").forEach(t => t.classList.add("hidden"));
  document.getElementById("tab-" + tab).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "receitas") renderRecipes();
  if (tab === "baixa") initBaixa();
}

// ─── BAIXA POR PRODUÇÃO ────────────────────────────────
let baixaItens = []; // [{ prodId, prodNome, ingredientes:[{ingId,ingNome,gramsPorLote}], lotes, emoji }]

function initBaixa() {
  // Popula o select de produtos com ingredientes cadastrados
  const sel = document.getElementById("baixa-prod-sel");
  if (!sel) return;
  const comReceita = allProducts.filter(p => p.ingredientes && p.ingredientes.length > 0);
  sel.innerHTML = `<option value="">Selecione o produto...</option>` +
    comReceita.map(p => `<option value="${p.id}">${p.emoji||"🍪"} ${p.nome}</option>`).join("");
  renderBaixaItens();
  renderBaixaHistorico();
}

function adicionarItemBaixa() {
  const prodId = document.getElementById("baixa-prod-sel").value;
  const lotes  = parseInt(document.getElementById("baixa-lotes").value) || 1;
  if (!prodId) { showToast("Selecione um produto!"); return; }
  const prod = allProducts.find(p => p.id === prodId);
  if (!prod) return;

  const existente = baixaItens.findIndex(b => b.prodId === prodId);
  if (existente >= 0) {
    baixaItens[existente].lotes += lotes;
  } else {
    baixaItens.push({
      prodId,
      prodNome: prod.nome,
      emoji: prod.emoji || "🍪",
      ingredientes: (prod.ingredientes || []).map(pi => {
        const ing = allIngredients.find(i => i.id === pi.ingId);
        return {
          ingId: pi.ingId,
          ingNome: ing ? ing.nome : pi.ingId,
          gramsPorLote: pi.grams || 0
        };
      }),
      lotes
    });
  }
  document.getElementById("baixa-prod-sel").value = "";
  document.getElementById("baixa-lotes").value = "1";
  renderBaixaItens();
}

function renderBaixaItens() {
  const lista = document.getElementById("baixa-itens-lista");
  const vazia = document.getElementById("baixa-lista-vazia");
  const preview = document.getElementById("baixa-preview");
  const confirmar = document.getElementById("baixa-confirmar-btn");
  if (!lista) return;

  if (baixaItens.length === 0) {
    lista.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px 0;text-align:center;" id="baixa-lista-vazia">Nenhum item adicionado ainda.</div>`;
    if (preview) preview.classList.add("hidden");
    if (confirmar) confirmar.disabled = true;
    return;
  }

  lista.innerHTML = baixaItens.map((item, idx) => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);">
      <span style="font-size:22px;">${item.emoji}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;color:var(--text);">${item.prodNome}</div>
        <div style="font-size:11px;color:var(--muted);">${item.ingredientes.length} ingrediente${item.ingredientes.length!==1?"s":""} na receita</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button onclick="baixaChangeQty(${idx},-1)" style="background:var(--cream-dark);border:1px solid var(--border-mid);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">−</button>
        <span style="font-size:14px;font-weight:600;min-width:24px;text-align:center;">${item.lotes}</span>
        <button onclick="baixaChangeQty(${idx},1)" style="background:var(--cream-dark);border:1px solid var(--border-mid);width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">+</button>
        <span style="font-size:12px;color:var(--muted);">lote${item.lotes!==1?"s":""}</span>
      </div>
      <button onclick="baixaRemove(${idx})" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:18px;padding:4px;line-height:1;">✕</button>
    </div>
  `).join("");

  // Monta prévia dos descontos consolidados
  const descontos = {}; // ingId → { nome, totalGrams }
  baixaItens.forEach(item => {
    item.ingredientes.forEach(pi => {
      const total = pi.gramsPorLote * item.lotes;
      if (!descontos[pi.ingId]) descontos[pi.ingId] = { nome: pi.ingNome, totalGrams: 0 };
      descontos[pi.ingId].totalGrams += total;
    });
  });

  const previewList = document.getElementById("baixa-preview-list");
  const rows = Object.entries(descontos).map(([ingId, d]) => {
    const ing = allIngredients.find(i => i.id === ingId);
    const estoqueAtual = ing ? Number(ing.estoque || 0) : 0;
    const unidade = ing ? ing.unit : "g";
    const grams = d.totalGrams;
    const estoqueApos = Math.max(0, estoqueAtual - grams);
    const insuficiente = estoqueAtual < grams;
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:0.5px solid var(--border);font-size:12px;">
      <span style="color:var(--text-mid);">${d.nome}</span>
      <span style="display:flex;gap:12px;align-items:center;">
        <span style="color:var(--muted);">−${grams}${unidade === "kg" ? "g" : unidade}</span>
        <span style="color:${insuficiente ? "#993C1D" : "var(--teal-dark)"};font-weight:500;">
          ${insuficiente ? "⚠️ Insuficiente" : `Restará: ${estoqueApos}${unidade === "kg" ? "g" : unidade}`}
        </span>
      </span>
    </div>`;
  }).join("");

  if (previewList) previewList.innerHTML = rows || '<div style="color:var(--muted);font-size:12px;">Nenhum ingrediente mapeado.</div>';
  if (preview) preview.classList.remove("hidden");
  if (confirmar) confirmar.disabled = false;
}

function baixaChangeQty(idx, delta) {
  baixaItens[idx].lotes = Math.max(1, baixaItens[idx].lotes + delta);
  renderBaixaItens();
}

function baixaRemove(idx) {
  baixaItens.splice(idx, 1);
  renderBaixaItens();
}

function limparBaixa() {
  baixaItens = [];
  renderBaixaItens();
}

async function confirmarBaixa() {
  if (baixaItens.length === 0) return;
  const btn = document.getElementById("baixa-confirmar-btn");
  btn.disabled = true;
  btn.textContent = "Registrando...";

  // Consolida descontos
  const descontos = {};
  baixaItens.forEach(item => {
    item.ingredientes.forEach(pi => {
      const total = pi.gramsPorLote * item.lotes;
      if (!descontos[pi.ingId]) descontos[pi.ingId] = 0;
      descontos[pi.ingId] += total;
    });
  });

  let erros = 0;
  for (const [ingId, grams] of Object.entries(descontos)) {
    const ing = allIngredients.find(i => i.id === ingId);
    if (!ing) continue;
    const novoEstoque = Math.max(0, Number(ing.estoque || 0) - grams);
    try {
      await fbUpdate("ingredients", ingId, { estoque: novoEstoque });
      allIngredients = allIngredients.map(i => i.id === ingId ? { ...i, estoque: novoEstoque } : i);
    } catch(e) {
      console.warn("Erro ao dar baixa em", ing.nome, e);
      erros++;
    }
  }

  // Salva no histórico local
  const agora = new Date();
  const entrada = {
    data: agora.toLocaleDateString("pt-BR"),
    hora: agora.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" }),
    itens: baixaItens.map(b => `${b.lotes}× ${b.prodNome}`).join(", "),
    descontos: Object.fromEntries(
      Object.entries(descontos).map(([id, g]) => {
        const ing = allIngredients.find(i => i.id === id);
        return [ing ? ing.nome : id, g];
      })
    )
  };
  try {
    await fbAdd("producaoLog", {
      ...entrada,
      itensBrutos: baixaItens,
      createdAt: new Date().toISOString()
    });
  } catch(e) {}

  if (erros === 0) {
    showToast("✅ Baixa registrada no estoque!", "success");
  } else {
    showToast(`⚠️ Baixa parcial — ${erros} ingrediente(s) com erro.`);
  }

  // Guarda os itens para o modal de transferência ANTES de limpar
  const itensBaixados = [...baixaItens];

  baixaItens = [];
  renderIngredients();
  renderBaixaItens();
  renderBaixaHistorico();
  btn.disabled = false;
  btn.textContent = "✅ Confirmar baixa no estoque";

  // Abre modal perguntando se quer transferir para PE
  abrirModalTransferenciaPE(itensBaixados);
}

// ─── MODAL: TRANSFERÊNCIA PARA PRONTA ENTREGA ─────────
function abrirModalTransferenciaPE(itensBaixados) {
  // Só mostra produtos que realmente existem no sistema
  const produtosValidos = itensBaixados.filter(b => allProducts.find(p => p.id === b.prodId));
  if (produtosValidos.length === 0) return;

  // Cria o modal dinamicamente se não existir
  let modal = document.getElementById("modal-transf-pe");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "modal-transf-pe";
    modal.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;padding:16px;
    `;
    document.body.appendChild(modal);
  }

  // Calcula sugestão: lotes × rendimento do produto
  const linhas = produtosValidos.map(item => {
    const prod = allProducts.find(p => p.id === item.prodId);
    const rendimento = prod?.rendimento || 1;
    const sugestao = item.lotes * rendimento;
    const estoqueAtual = allStock[item.prodId]?.qty || 0;
    return { item, prod, rendimento, sugestao, estoqueAtual };
  });

  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:20px;width:100%;max-width:480px;
      overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.22);
      animation:fadeIn .25s ease;
    ">
      <!-- Header -->
      <div style="background:var(--teal-dark);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-family:var(--font-display);font-size:20px;font-weight:600;color:#fff;">
            Transferir para Pronta Entrega
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:3px;">
            Quantos já estão assados e prontos para venda?
          </div>
        </div>
        <button onclick="fecharModalTransfPE()" style="
          background:rgba(255,255,255,0.1);border:none;color:#fff;
          width:32px;height:32px;border-radius:50%;cursor:pointer;
          display:flex;align-items:center;justify-content:center;font-size:18px;
        ">×</button>
      </div>

      <!-- Aviso congelados -->
      <div style="background:#EDF7FF;border-bottom:1px solid #BDE0F7;padding:11px 24px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🧊</span>
        <span style="font-size:12px;color:#2A6090;line-height:1.5;">
          Os produtos <strong>congelados</strong> ficam no freezer. Informe apenas os que já foram <strong>assados e estão prontos</strong> para pronta entrega agora.
        </span>
      </div>

      <!-- Lista de produtos -->
      <div style="padding:20px 24px;max-height:360px;overflow-y:auto;" id="transf-pe-lista">
        ${linhas.map(({ item, prod, rendimento, sugestao, estoqueAtual }, idx) => `
          <div style="
            padding:14px;border-radius:12px;border:1.5px solid var(--border);
            margin-bottom:12px;background:var(--cream);
          " id="transf-row-${idx}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
              <span style="font-size:24px;">${item.emoji}</span>
              <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;color:var(--teal-dark);">${item.prodNome}</div>
                <div style="font-size:11px;color:var(--muted);">
                  ${item.lotes} lote${item.lotes!==1?"s":""} produzido${item.lotes!==1?"s":""} ×
                  ${rendimento} unid./lote =
                  <strong>${sugestao} unid. total</strong>
                  · Estoque PE atual: ${estoqueAtual} unid.
                </div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <label style="font-size:12px;color:var(--muted);white-space:nowrap;">Prontos para PE agora:</label>
              <input
                type="number" min="0" max="${sugestao}" value="${sugestao}"
                id="transf-qty-${idx}"
                oninput="atualizarResumoTransf()"
                style="
                  width:80px;padding:8px 10px;border:1.5px solid var(--border-mid);
                  border-radius:8px;font-size:15px;font-weight:600;
                  color:var(--teal-dark);text-align:center;outline:none;
                "
                onchange="this.value=Math.min(Math.max(0,parseInt(this.value)||0),${sugestao});atualizarResumoTransf();"
              >
              <span style="font-size:12px;color:var(--muted);">unidades</span>
              <span style="font-size:11px;color:#2A7055;margin-left:auto;" id="transf-congelados-${idx}">
                🧊 ${sugestao} congelados
              </span>
            </div>
          </div>
        `).join("")}
      </div>

      <!-- Rodapé -->
      <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="fecharModalTransfPE()" style="
          background:var(--cream);border:1px solid var(--border-mid);
          color:var(--muted);padding:10px 22px;border-radius:10px;font-size:13px;cursor:pointer;
        ">Deixar para depois</button>
        <button onclick="confirmarTransferenciaPE(${JSON.stringify(linhas.map(l=>({prodId:l.item.prodId, sugestao:l.sugestao})))})" style="
          background:var(--teal-dark);color:#fff;border:none;
          padding:10px 26px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;
        " id="transf-confirmar-btn">
          ✅ Transferir para PE
        </button>
      </div>
    </div>
  `;

  modal.style.display = "flex";
  // Inicializa o cálculo de congelados
  atualizarResumoTransf();
}

function atualizarResumoTransf() {
  const lista = document.getElementById("transf-pe-lista");
  if (!lista) return;
  // Para cada linha, recalcula quantos ficam congelados
  lista.querySelectorAll("[id^='transf-qty-']").forEach(input => {
    const idx = input.id.replace("transf-qty-","");
    const max = parseInt(input.max) || 0;
    const val = parseInt(input.value) || 0;
    const congelados = Math.max(0, max - val);
    const tag = document.getElementById("transf-congelados-" + idx);
    if (tag) {
      tag.textContent = congelados > 0
        ? `🧊 ${congelados} vão congelados`
        : "🔥 Todos assados";
      tag.style.color = congelados > 0 ? "#2A6090" : "#1A7A44";
    }
  });
}

function fecharModalTransfPE() {
  const modal = document.getElementById("modal-transf-pe");
  if (modal) modal.style.display = "none";
}

async function confirmarTransferenciaPE(linhas) {
  const btn = document.getElementById("transf-confirmar-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Transferindo..."; }

  let transferidos = 0;
  let erros = 0;

  for (let idx = 0; idx < linhas.length; idx++) {
    const { prodId } = linhas[idx];
    const inputQty = document.getElementById("transf-qty-" + idx);
    const qty = parseInt(inputQty?.value) || 0;
    if (qty <= 0) continue;

    const s      = allStock[prodId];
    const novaQty = (s?.qty || 0) + qty;

    try {
      if (s?.id) {
        // Produto já tem entrada no estoque — atualiza diretamente
        await FB.updateDoc(FB.doc(db, "stock", s.id), { qty: novaQty, ativo: true });
        allStock[prodId] = { ...s, qty: novaQty, ativo: true };
      } else {
        // Cria registro de estoque PE ativando o produto
        const ref = await fbAdd("stock", { prodId, qty: novaQty, ativo: true });
        allStock[prodId] = { id: ref.id, qty: novaQty, ativo: true };
      }
      transferidos++;
    } catch(e) {
      console.warn("Erro ao transferir para PE:", prodId, e);
      erros++;
    }
  }

  fecharModalTransfPE();

  if (transferidos > 0 && erros === 0) {
    showToast(`✅ ${transferidos} produto${transferidos!==1?"s":""} adicionado${transferidos!==1?"s":""} à Pronta Entrega!`);
  } else if (transferidos > 0) {
    showToast(`⚠️ ${transferidos} transferido${transferidos!==1?"s":""}, ${erros} com erro.`);
  } else if (erros > 0) {
    showToast("❌ Erro ao transferir para Pronta Entrega.");
  } else {
    showToast("Nenhuma unidade informada para transferir.");
  }

  renderStockAdmin();
  renderPEProducts();
}

async function renderBaixaHistorico() {
  const el = document.getElementById("baixa-historico");
  if (!el) return;
  let logs = [];
  try { logs = await fbGet("producaoLog"); } catch {}
  if (logs.length === 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;">Nenhuma produção registrada ainda.</div>`;
    return;
  }
  // Ordena mais recente primeiro
  logs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  el.innerHTML = logs.slice(0, 20).map(log => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--border);">
      <div style="width:38px;height:38px;border-radius:50%;background:var(--gold-pale);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;">🧁</div>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:500;color:var(--text);">${log.itens || "—"}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${log.data || ""} às ${log.hora || ""}</div>
        <div style="font-size:11px;color:var(--teal-dark);margin-top:4px;">
          Descontados: ${Object.entries(log.descontos || {}).map(([n,g])=>`${n}: ${g}g`).join(" · ")}
        </div>
      </div>
    </div>`).join("");
}

async function interpretarProducaoIA() {
  const input = document.getElementById("baixa-ia-input");
  const texto = input.value.trim();
  if (!texto) { showToast("Descreva o que produziu!"); return; }

  const btn = document.getElementById("baixa-ia-btn");
  const fb  = document.getElementById("baixa-ia-feedback");
  btn.disabled = true;
  fb.textContent = "Interpretando...";

  const produtosDisponiveis = allProducts
    .filter(p => p.ingredientes && p.ingredientes.length > 0)
    .map(p => `"${p.nome}" (id:${p.id})`)
    .join(", ");

  const prompt = `Analise este texto de produção de uma confeitaria e extraia os produtos e quantidades de lotes.
Texto: "${texto}"
Produtos disponíveis no sistema: ${produtosDisponiveis || "nenhum cadastrado com receita"}

Responda SOMENTE com um JSON válido neste formato (sem markdown, sem explicação):
[{"prodId":"ID_DO_PRODUTO","lotes":NUMERO},...]

Se um produto mencionado não existir na lista, use o nome mais próximo. Se não encontrar nenhum, retorne [].`;

  try {
    const resposta = await callGeminiAPI(prompt, 200, "Você é um extrator de dados preciso. Responda APENAS com JSON válido, sem formatação.");
    const clean = resposta.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fb.textContent = "Não consegui identificar produtos. Adicione manualmente abaixo.";
      btn.disabled = false;
      return;
    }
    let adicionados = 0;
    parsed.forEach(item => {
      const prod = allProducts.find(p => p.id === item.prodId);
      if (!prod || !prod.ingredientes || prod.ingredientes.length === 0) return;
      const lotes = parseInt(item.lotes) || 1;
      const existente = baixaItens.findIndex(b => b.prodId === item.prodId);
      if (existente >= 0) {
        baixaItens[existente].lotes += lotes;
      } else {
        baixaItens.push({
          prodId: prod.id,
          prodNome: prod.nome,
          emoji: prod.emoji || "🍪",
          ingredientes: (prod.ingredientes || []).map(pi => {
            const ing = allIngredients.find(i => i.id === pi.ingId);
            return { ingId: pi.ingId, ingNome: ing ? ing.nome : pi.ingId, gramsPorLote: pi.grams || 0 };
          }),
          lotes
        });
      }
      adicionados++;
    });
    renderBaixaItens();
    fb.textContent = adicionados > 0 ? `✅ ${adicionados} produto(s) adicionado(s)! Confira abaixo e confirme.` : "Não encontrei produtos com receita cadastrada para o que você descreveu.";
    input.value = "";
  } catch(e) {
    fb.textContent = "Erro ao interpretar. Configure a GEMINI_API_KEY ou adicione manualmente.";
  }
  btn.disabled = false;
}

