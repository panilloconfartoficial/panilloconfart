// ═══════════════════════════════════════════════════
//  DARK MODE ADMIN
// ═══════════════════════════════════════════════════
function toggleAdminDark() {
  const isDark = document.body.classList.toggle("admin-dark");
  localStorage.setItem("panillo-dark", isDark ? "1" : "0");
  const btn = document.getElementById("dark-toggle-btn");
  if (btn) btn.textContent = isDark ? "☀️" : "🌙";
}

function initAdminDark() {
  if (localStorage.getItem("panillo-dark") === "1") {
    document.body.classList.add("admin-dark");
    const btn = document.getElementById("dark-toggle-btn");
    if (btn) btn.textContent = "☀️";
  }
}

// ═══════════════════════════════════════════════════
//  DEPOIMENTOS — LOJA + ADMIN
// ═══════════════════════════════════════════════════
let _avalStar = 0;
let _allDepoimentos = [];

// ── Carregar e renderizar na loja ──────────────────
async function loadDepoimentos() {
  const grid = document.getElementById("depoimentos-grid");
  if (!grid) return;
  try {
    const docs = await fbGet("depoimentos");
    _allDepoimentos = docs || [];
    const visiveis = _allDepoimentos.filter(d => d.oculto !== true);
    if (!visiveis.length) {
      grid.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;grid-column:1/-1;">Seja o primeiro a avaliar! 🍪</div>';
      return;
    }
    grid.innerHTML = visiveis.map(d => {
      const estrelas = "★".repeat(d.estrelas||5) + "☆".repeat(5-(d.estrelas||5));
      const resposta = d.resposta ? `<div class="dep-reply"><div class="dep-reply-lbl">Resposta da Panillo</div><div class="dep-reply-txt">${d.resposta}</div></div>` : "";
      return `<div class="dep-card">
        <div class="dep-stars">${estrelas}</div>
        <div class="dep-text">"${escHtml(d.texto)}"</div>
        <div class="dep-name">${escHtml(d.clienteNome || "Cliente")}</div>
        ${resposta}
      </div>`;
    }).join("");
  } catch(e) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px;grid-column:1/-1;">Não foi possível carregar as avaliações.</div>';
  }
}

// ── Modal de avaliação ─────────────────────────────
function openAvaliacaoModal() {
  const saved = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  const temCadastro = !!(saved.nome && saved.wpp);

  document.getElementById("aval-state-nocadastro").style.display = temCadastro ? "none" : "";
  document.getElementById("aval-state-form").style.display       = temCadastro ? "" : "none";
  document.getElementById("aval-state-ok").style.display         = "none";

  if (temCadastro) {
    document.getElementById("aval-cliente-nome").textContent = "Olá, " + saved.nome.split(" ")[0] + "!";
    _avalStar = 0;
    document.getElementById("aval-texto").value = "";
    document.getElementById("aval-error").style.display = "none";
    renderAvalStars(0);
  }
  document.getElementById("aval-modal").classList.add("open");
}

function closeAvaliacaoModal() {
  document.getElementById("aval-modal").classList.remove("open");
}

function setAvalStar(n) {
  _avalStar = n;
  renderAvalStars(n);
}

function renderAvalStars(n) {
  document.querySelectorAll(".star-btn").forEach(b => {
    const v = parseInt(b.dataset.v);
    b.textContent = v <= n ? "★" : "☆";
    b.classList.toggle("sel", v <= n);
  });
}

function abrirWhatsAppAvaliacao() {
  const texto = document.getElementById("aval-texto").value.trim();
  const estrelas = _avalStar ? "★".repeat(_avalStar) + "☆".repeat(5-_avalStar) : "";
  const msg = encodeURIComponent(`Olá Panillo! Quero deixar minha avaliação:\n\n${estrelas}\n"${texto || "..."}"`);
  window.open(`https://wa.me/${WPP_NUMBER}?text=${msg}`, "_blank");
}

async function submitAvaliacao() {
  const saved  = JSON.parse(localStorage.getItem("panillo-cliente") || "{}");
  const texto  = document.getElementById("aval-texto").value.trim();
  const errEl  = document.getElementById("aval-error");
  const btn    = document.getElementById("aval-submit-btn");

  errEl.style.display = "none";
  if (!_avalStar) { errEl.textContent = "Selecione uma nota de 1 a 5 estrelas."; errEl.style.display = "block"; return; }
  if (!texto)     { errEl.textContent = "Escreva um comentário antes de publicar."; errEl.style.display = "block"; return; }

  btn.textContent = "Publicando..."; btn.disabled = true;

  try {
    // Bloquear duplicata — mesmo WhatsApp só pode ter 1 avaliação
    const wppNorm = (saved.wpp||"").replace(/\D/g,"");
    const existentes = await fbGet("depoimentos");
    const jaAvaliou = existentes.some(d => (d.clienteWpp||"").replace(/\D/g,"") === wppNorm && wppNorm);
    if (jaAvaliou) {
      errEl.textContent = "Você já enviou uma avaliação. Agradecemos seu feedback! 💛";
      errEl.style.display = "block";
      btn.textContent = "Publicar avaliação"; btn.disabled = false;
      return;
    }
    await fbAdd("depoimentos", {
      clienteNome: saved.nome || "Cliente",
      clienteWpp:  (saved.wpp||"").replace(/\D/g,""),
      estrelas:    _avalStar,
      texto,
      oculto:      false,
      resposta:    "",
      createdAt:   FB.serverTimestamp()
    });
    document.getElementById("aval-state-form").style.display = "none";
    document.getElementById("aval-state-ok").style.display   = "";
    loadDepoimentos();
    // atualiza badge admin se aberto
    renderDepoimentosAdmin();
  } catch(e) {
    errEl.textContent = "Erro ao publicar. Tente novamente.";
    errEl.style.display = "block";
  }
  btn.textContent = "Publicar avaliação"; btn.disabled = false;
}

// ── Admin: renderizar lista ────────────────────────
async function renderDepoimentosAdmin() {
  const list = document.getElementById("dep-admin-list");
  if (!list) return;

  // Usa _allDepoimentos mantido pelo listener em tempo real.
  // Se ainda estiver vazio, faz um fetch manual como fallback.
  if (!_allDepoimentos.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px;">Carregando...</div>';
    try {
      const docs = await fbGet("depoimentos");
      _allDepoimentos = docs || [];
    } catch {}
  }

  // Atualiza badge da sidebar
  const badge = document.getElementById("badge-depoimentos");
  if (badge) {
    badge.textContent = _allDepoimentos.length;
    badge.style.display = _allDepoimentos.length ? "" : "none";
  }

  const filtro = document.getElementById("dep-filter")?.value || "todos";
  let filtrados = _allDepoimentos;
  if (filtro === "visiveis") filtrados = filtrados.filter(d => !d.oculto);
  if (filtro === "ocultos")  filtrados = filtrados.filter(d =>  d.oculto);

  if (!filtrados.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px;">Nenhuma avaliação encontrada.</div>';
    return;
  }

  // Ordenar por data desc
  filtrados.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

  try {
    list.innerHTML = filtrados.map(d => {
      const estrelas = "★".repeat(d.estrelas||5) + "☆".repeat(5-(d.estrelas||5));
      const data = d.createdAt?.seconds ? new Date(d.createdAt.seconds*1000).toLocaleDateString("pt-BR") : "—";
      const ocultoBtnLabel = d.oculto ? "👁 Mostrar" : "🙈 Ocultar";
      const wppBtn = d.clienteWpp
        ? `<a href="https://wa.me/${d.clienteWpp}" target="_blank" style="background:none;border:1.5px solid #25D366;color:#128C7E;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"><i class="ti ti-brand-whatsapp" style="font-size:13px;"></i> WhatsApp</a>` : "";
      const respostaAtual = escHtml(d.resposta || "");
      const respostaPreview = respostaAtual ? `<div class="dep-reply" style="margin-top:10px;"><div class="dep-reply-lbl">Sua resposta</div><div class="dep-reply-txt">${respostaAtual}</div></div>` : "";
      return `<div class="dep-admin-card" id="dep-card-${d.id}" style="${d.oculto ? 'opacity:.55;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div class="dep-admin-stars">${estrelas}</div>
            <div class="dep-admin-texto">"${escHtml(d.texto)}"</div>
            <div class="dep-admin-meta">
              <strong>${escHtml(d.clienteNome||"Cliente")}</strong>
              ${d.clienteWpp ? ' · ' + d.clienteWpp : ''}
              · ${data}
              ${d.oculto ? ' · <span style="color:#993C1D;font-weight:600;">OCULTO</span>' : ''}
            </div>
          </div>
        </div>
        ${respostaPreview}
        <div class="dep-admin-actions" style="margin-top:12px;">
          <button onclick="toggleOcultarDepoimento('${d.id}',${!d.oculto})" style="background:none;border:1.5px solid var(--border-mid);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text-mid);">${ocultoBtnLabel}</button>
          <button onclick="toggleRespostaAdmin('${d.id}')" style="background:none;border:1.5px solid var(--teal-light);border-radius:8px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;color:var(--teal);">💬 Responder</button>
          ${wppBtn}
        </div>
        <div class="dep-admin-reply-wrap" id="dep-reply-wrap-${d.id}">
          <textarea id="dep-reply-txt-${d.id}" style="width:100%;margin-top:10px;padding:10px 12px;border:1.5px solid var(--border-mid);border-radius:8px;font-size:13px;resize:none;box-sizing:border-box;" rows="3" placeholder="Digite sua resposta pública...">${respostaAtual}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">
            <button onclick="toggleRespostaAdmin('${d.id}')" style="background:none;border:1.5px solid var(--border-mid);border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;">Cancelar</button>
            <button onclick="salvarRespostaAdmin('${d.id}')" style="background:var(--teal-dark);color:#fff;border:none;border-radius:8px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer;">Salvar resposta</button>
          </div>
        </div>
      </div>`;
    }).join("");
  } catch(e) {
    list.innerHTML = '<div style="color:#993C1D;font-size:13px;text-align:center;padding:40px;">Erro ao renderizar depoimentos.</div>';
  }
}

function toggleRespostaAdmin(id) {
  const wrap = document.getElementById("dep-reply-wrap-" + id);
  if (!wrap) return;
  wrap.classList.toggle("open");
  if (wrap.classList.contains("open")) {
    wrap.querySelector("textarea")?.focus();
  }
}

async function toggleOcultarDepoimento(id, ocultar) {
  try {
    await fbUpdate("depoimentos", id, { oculto: ocultar });
    showToast(ocultar ? "Depoimento ocultado." : "Depoimento visível novamente.");
    renderDepoimentosAdmin();
    loadDepoimentos();
  } catch(e) { showToast("Erro ao atualizar depoimento."); }
}

async function salvarRespostaAdmin(id) {
  const txt = document.getElementById("dep-reply-txt-" + id)?.value.trim() || "";
  try {
    await fbUpdate("depoimentos", id, { resposta: txt });
    showToast("Resposta salva!");
    toggleRespostaAdmin(id);
    renderDepoimentosAdmin();
    loadDepoimentos();
  } catch(e) { showToast("Erro ao salvar resposta."); }
}
