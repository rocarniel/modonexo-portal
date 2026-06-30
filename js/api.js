// ===== MODO Nexo — API (Cloudflare Worker) =====

async function apiRequest(method, path, body = null) {
  const token = await getIdToken();
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (body)  opts.body = JSON.stringify(body);

  const res = await fetch(CONFIG.workerUrl + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
    throw new Error(err.error || "Erro " + res.status);
  }
  return res.json();
}

// ── Oportunidades ────────────────────────────────
const API = {
  oportunidades: {
    listar:  (params = {}) => apiRequest("GET", "/oportunidades?" + new URLSearchParams(params)),
    obter:   (id)          => apiRequest("GET", "/oportunidades/" + id),
    criar:   (data)        => apiRequest("POST", "/oportunidades", data),
    atualizar: (id, data)  => apiRequest("PATCH", "/oportunidades/" + id, data),
    gerarToken: (id)       => apiRequest("POST", "/oportunidades/" + id + "/compartilhar"),
  },

  parceiros: {
    listar:    ()          => apiRequest("GET", "/parceiros"),
    atualizar: (id, data)  => apiRequest("PATCH", "/parceiros/" + id, data),
    cadastrar: (data)      => apiRequest("POST", "/parceiros/publico", data),
  },

  avisos: {
    listar: ()       => apiRequest("GET", "/avisos"),
    criar:  (data)   => apiRequest("POST", "/avisos", data),
  },

  demandas: {
    listar:    ()         => apiRequest("GET", "/demandas"),
    criar:     (data)     => apiRequest("POST", "/demandas", data),
    atualizar: (id, data) => apiRequest("PATCH", "/demandas/" + id, data),
  },

  leads: {
    listar:   ()     => apiRequest("GET", "/leads"),
    registrar: (data) => apiRequest("POST", "/leads/publico", data),
  },

  mensagens: {
    listar: (opId)        => apiRequest("GET", "/mensagens?opId=" + opId),
    enviar: (opId, texto) => apiRequest("POST", "/mensagens", { opId, texto }),
  },

  publico: {
    oportunidade: (token) => fetch(CONFIG.workerUrl + "/publico/oportunidade/" + token).then(r => r.json()),
  },
};

// ── Upload Cloudinary ────────────────────────────
async function uploadCloudinary(file, folder = "modo") {
  const limitBytes = (folder === "modo-videos" ? CONFIG.limits.videoMB :
                      folder === "modo-docs"   ? CONFIG.limits.documentoMB :
                                                 CONFIG.limits.imagemMB) * 1024 * 1024;

  if (file.size > limitBytes) {
    const mb = (limitBytes / 1024 / 1024).toFixed(0);
    throw new Error(`Arquivo muito grande. Limite: ${mb} MB`);
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CONFIG.cloudinary.preset);
  fd.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloud}/auto/upload`, {
    method: "POST", body: fd,
  });
  if (!res.ok) throw new Error("Falha no upload do arquivo");
  return res.json(); // { secure_url, public_id, resource_type, ... }
}

// ── CEP ─────────────────────────────────────────
async function buscarCEP(cep) {
  const limpo = cep.replace(/\D/g, "");
  if (limpo.length !== 8) throw new Error("CEP inválido");
  const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
  const data = await res.json();
  if (data.erro) throw new Error("CEP não encontrado");
  return data; // { logradouro, bairro, localidade, uf }
}

// ── UI Helpers ───────────────────────────────────
function showToast(msg, type = "info") {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function showLoading(show = true) {
  let el = document.querySelector(".loading-overlay");
  if (!el) return;
  el.classList.toggle("hidden", !show);
}

function badgeStatus(status) {
  const map = {
    "Recebido":              "badge-recebido",
    "Em análise":            "badge-analise",
    "Em negociação":         "badge-negociacao",
    "Aguardando documentos": "badge-documentos",
    "Viável":                "badge-viavel",
    "Condições inviáveis":   "badge-inviavel",
    "Descartado":            "badge-descartado",
    "Pendente":              "badge-pendente",
    "Ativo":                 "badge-ativo",
    "Inativo":               "badge-inativo",
    "Suspenso":              "badge-suspenso",
  };
  const cls = map[status] || "badge-recebido";
  return `<span class="badge ${cls}">${status || "—"}</span>`;
}

function formatMoeda(valor) {
  if (!valor && valor !== 0) return "—";
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatData(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
}

function gerarTokenLocal() {
  return Math.random().toString(36).substr(2, 10) + Date.now().toString(36);
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Renderiza balões de chat. `eu` = "Admin" ou "Parceiro" (alinha à direita as próprias mensagens).
function renderChat(box, msgs, eu) {
  if (!msgs.length) {
    box.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px">Nenhuma mensagem ainda. Inicie a conversa.</p>';
    return;
  }
  box.innerHTML = msgs.map(m => {
    const de   = m.fields["De"] || "";
    const mine = de === eu;
    const hora = m.fields["Data e hora"]
      ? new Date(m.fields["Data e hora"]).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "";
    const corner = mine ? "border-bottom-right-radius:4px" : "border-bottom-left-radius:4px";
    return `<div style="align-self:${mine ? "flex-end" : "flex-start"};width:fit-content;max-width:78%;background:${mine ? "var(--navy)" : "#eef1f5"};color:${mine ? "#fff" : "#1e293b"};padding:6px 10px;border-radius:14px;${corner};font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 1.5px rgba(0,0,0,.08)">
      ${escapeHtml(m.fields["Mensagem"])}
      <span style="font-size:10px;opacity:.6;margin-left:8px;white-space:nowrap">${hora}</span>
    </div>`;
  }).join("");
  box.scrollTop = box.scrollHeight;
}

// Monta a mensagem profissional de compartilhamento de uma oportunidade.
function montarMensagemOportunidade(f, link) {
  const linhas = ["🏢 Oportunidade Imobiliária — MODO Nexo", ""];
  const local    = [f["Município"], f["Estado"]].filter(Boolean).join("/");
  const tipoLocal = [f["Tipo de imóvel"], local].filter(Boolean).join(" · ");
  if (tipoLocal) linhas.push(tipoLocal);

  if (f["Área total (m²)"] != null) linhas.push("Área: " + Number(f["Área total (m²)"]).toLocaleString("pt-BR") + " m²");

  const matchFin = (f["Observações"] || "").match(/^Finalidades:\s*(.+?)(\n|$)/);
  const fin = (Array.isArray(f["Finalidades"]) && f["Finalidades"].join(", ")) || (matchFin && matchFin[1]) || f["Tipo de negócio"];
  if (fin) linhas.push("Finalidade: " + fin);

  if (f["Valor pretendido (R$)"]) linhas.push("Valor pretendido: " + formatMoeda(f["Valor pretendido (R$)"]));

  linhas.push("", "Detalhes completos, fotos e documentação no link abaixo:", link);
  return linhas.join("\n");
}

// Dispara o compartilhamento: menu nativo no mobile, WhatsApp Web como fallback.
async function compartilharOportunidade(f, link) {
  if (!link) return;
  const texto = montarMensagemOportunidade(f, link);
  if (navigator.share) {
    try { await navigator.share({ title: f["Título"] || "Oportunidade", text: texto }); return; }
    catch (e) { if (e.name === "AbortError") return; }  // usuário cancelou
  }
  window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
}
