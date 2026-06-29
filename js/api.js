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

  const resourceType = (folder === 'modo-docs' || folder === 'modo-kmz') ? 'raw' : 'auto';
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloud}/${resourceType}/upload`, {
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
