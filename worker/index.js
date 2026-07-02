// ===== MODO Nexo — Cloudflare Worker (D1) =====
// Deploy: wrangler deploy (produção) / wrangler deploy --env staging
// Secrets (configurar via `wrangler secret put NOME [--env staging]`):
//   FIREBASE_API_KEY, RESEND_API_KEY, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ADMIN_LINK_SECRET
// Bindings (wrangler.toml): DB (D1), RATE_LIMIT (KV)

const ADMIN_EMAILS = [
  "rocarniel@gmail.com",
  "olegarioadvogado@gmail.com",
];

// ── CORS ──────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://www.modonexo.com.br",
  "https://modonexo.com.br",
];

const CORS = {
  "Access-Control-Allow-Origin":  "https://www.modonexo.com.br",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Vary": "Origin",
};

function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function errorResponse(msg, status = 400) {
  return corsResponse({ error: msg }, status);
}

// ── Verificar token Firebase ──────────────────────
async function verifyFirebaseToken(token, env) {
  try {
    const [, payloadB64] = token.split(".");
    const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (payload.exp * 1000 < Date.now()) return null;
  } catch { return null; }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users?.[0];
  if (!user || user.disabled) return null;
  return {
    uid:   user.localId,
    email: user.email,
    admin: ADMIN_EMAILS.includes(user.email),
  };
}

// ── IDs de registro (formato compatível com o validador antigo) ──
function gerarRecordId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const arr = new Uint8Array(14);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < 14; i++) s += alphabet[arr[i] % alphabet.length];
  return "rec" + s;
}
function validarRecordId(id) {
  return typeof id === "string" && /^rec[a-z0-9]{14}$/.test(id);
}

// ── Token de compartilhamento público ─────────────
function gerarToken() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(36)).join("").slice(0, 16);
}
function validarToken(t) {
  return typeof t === "string" && /^[a-z0-9]{10,24}$/.test(t);
}

// ── Mapeamentos form → campos ──────────────────────
const TIPO_IMOVEL_MAP = {
  "Casa":       "Casa residencial",
  "Terreno":    "Terreno/Lote urbano",
  "Comercial":  "Sala comercial",
  "Rural":      "Gleba rural",
  "Galpão":     "Sala comercial",
};
const ESTADO_MAP = {
  AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",
  DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",
  MT:"Mato Grosso",MS:"Mato Grosso do Sul",MG:"Minas Gerais",PA:"Pará",
  PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",RJ:"Rio de Janeiro",
  RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
  RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins",
};
const FINALIDADE_VALIDA = new Set(["Venda","Locação","Permuta","Parceria","Lançamento","Incorporação","Loteamento"]);

// ── Camada de serialização D1 <-> formato de API (chaves em português) ──
const FIELD_MAPS = {
  parceiros: {
    "Nome Completo":    { col: "nome_completo",  type: "text" },
    "E-Mail":           { col: "email",          type: "text" },
    "Status":           { col: "status",         type: "text" },
    "CRECI":            { col: "creci",          type: "text" },
    "WhatsApp":         { col: "whatsapp",       type: "text" },
    "Data de cadastro": { col: "data_cadastro",  type: "text" },
  },
  oportunidades: {
    "Título":                    { col: "titulo",                 type: "text" },
    "Tipo de imóvel":            { col: "tipo_imovel",             type: "text" },
    "Tipo de negócio":           { col: "tipo_negocio",            type: "text" },
    "CEP":                       { col: "cep",                     type: "text" },
    "Endereço":                  { col: "endereco",                type: "text" },
    "Município":                 { col: "municipio",               type: "text" },
    "Estado":                    { col: "estado",                  type: "text" },
    "Área total (m²)":           { col: "area_total_m2",           type: "real" },
    "Área privativa (m²)":       { col: "area_privativa_m2",       type: "real" },
    "Valor pretendido (R$)":     { col: "valor_pretendido",        type: "real" },
    "Comissão (%)":              { col: "comissao_pct",            type: "real" },
    "Detalhes da comissão":      { col: "detalhes_comissao",       type: "text" },
    "Link de vídeo":             { col: "link_video",              type: "text" },
    "Link KMZ/KML":              { col: "link_kmz",                type: "text" },
    "Observações":               { col: "observacoes",             type: "text" },
    "Latitude":                  { col: "latitude",                type: "real" },
    "Longitude":                 { col: "longitude",               type: "real" },
    "Status":                    { col: "status",                  type: "text" },
    "Motivo (status negativo)":  { col: "motivo_status_negativo",  type: "text" },
    "Origem":                    { col: "origem",                  type: "text" },
    "Token de compartilhamento": { col: "token_compartilhamento",  type: "text" },
    "Data de entrada":           { col: "data_entrada",            type: "text" },
    "E-mail do solicitante":     { col: "email_solicitante",       type: "text" },
    "Arquivos (JSON)":           { col: "arquivos_json",           type: "text" },
    "Histórico (JSON)":          { col: "historico_json",          type: "text" },
  },
  mensagens: {
    "Mensagem":    { col: "mensagem",  type: "text" },
    "De":          { col: "de",        type: "text" },
    "Data e hora": { col: "data_hora", type: "text" },
    "Lida":        { col: "lida",      type: "bool" },
  },
  demandas: {
    "Título":                 { col: "titulo",               type: "text" },
    "Tipo de imóvel":         { col: "tipo_imovel",           type: "text" },
    "Localização desejada":   { col: "localizacao_desejada",  type: "text" },
    "Área mínima (m²)":       { col: "area_minima_m2",        type: "real" },
    "Área máxima (m²)":       { col: "area_maxima_m2",        type: "real" },
    "Valor máximo (R$)":      { col: "valor_maximo",          type: "real" },
    "Descrição":              { col: "descricao",             type: "text" },
    "Visível para parceiros": { col: "visivel_parceiros",     type: "bool" },
    "Data de publicação":     { col: "data_publicacao",       type: "text" },
  },
  leads: {
    "Nome":                      { col: "nome",                type: "text" },
    "WhatsApp":                  { col: "whatsapp",            type: "text" },
    "Token usado":               { col: "token_usado",         type: "text" },
    "Data e hora do acesso":     { col: "data_hora_acesso",    type: "text" },
    "Parceiro que compartilhou": { col: "parceiro_nome",       type: "text" },
    "E-mail do parceiro":        { col: "parceiro_email",      type: "text" },
    "Título da oportunidade":    { col: "oportunidade_titulo", type: "text" },
    "ID da oportunidade":        { col: "oportunidade_id",     type: "text" },
  },
};

function rowToRecord(tableName, row) {
  const map = FIELD_MAPS[tableName];
  const fields = {};
  for (const [apiKey, spec] of Object.entries(map)) {
    let v = row[spec.col];
    if (v === null || v === undefined) continue;
    if (spec.type === "bool") v = !!v;
    fields[apiKey] = v;
  }
  return { id: row.id, fields };
}
function rowsToRecords(tableName, rows) {
  return { records: rows.map(r => rowToRecord(tableName, r)) };
}
function fieldsToRow(tableName, fieldsBody) {
  const map = FIELD_MAPS[tableName];
  const row = {};
  for (const [apiKey, spec] of Object.entries(map)) {
    if (!(apiKey in fieldsBody)) continue;
    let v = fieldsBody[apiKey];
    if (spec.type === "bool") v = v ? 1 : 0;
    row[spec.col] = v;
  }
  return row;
}

// Anexa campos sintéticos (não são coluna própria) a registros de Oportunidades:
// Mensagens (array de ids), Finalidades (array), Parceiro (link) e Nome Completo (from Parceiros)
async function anexarSinteticosOportunidade(env, rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const idPlaceholders = ids.map(() => "?").join(",");
  const parceiroIds = [...new Set(rows.map(r => r.parceiro_id).filter(Boolean))];

  const [msgRes, finRes, parRes] = await Promise.all([
    env.DB.prepare(`SELECT id, oportunidade_id FROM mensagens WHERE oportunidade_id IN (${idPlaceholders})`).bind(...ids).all(),
    env.DB.prepare(`SELECT oportunidade_id, finalidade FROM oportunidade_finalidades WHERE oportunidade_id IN (${idPlaceholders}) ORDER BY ordem`).bind(...ids).all(),
    parceiroIds.length
      ? env.DB.prepare(`SELECT id, nome_completo FROM parceiros WHERE id IN (${parceiroIds.map(() => "?").join(",")})`).bind(...parceiroIds).all()
      : Promise.resolve({ results: [] }),
  ]);

  const msgsByOp = {};
  for (const m of msgRes.results) {
    if (!msgsByOp[m.oportunidade_id]) msgsByOp[m.oportunidade_id] = [];
    msgsByOp[m.oportunidade_id].push(m.id);
  }
  const finsByOp = {};
  for (const f of finRes.results) {
    if (!finsByOp[f.oportunidade_id]) finsByOp[f.oportunidade_id] = [];
    finsByOp[f.oportunidade_id].push(f.finalidade);
  }
  const nomeByParceiro = {};
  for (const p of parRes.results) nomeByParceiro[p.id] = p.nome_completo;

  return rows.map(row => {
    const rec = rowToRecord("oportunidades", row);
    rec.fields["Mensagens"] = msgsByOp[row.id] || [];
    if (finsByOp[row.id]) rec.fields["Finalidades"] = finsByOp[row.id];
    if (row.parceiro_id) {
      rec.fields["Parceiro"] = [row.parceiro_id];
      if (nomeByParceiro[row.parceiro_id]) rec.fields["Nome Completo (from Parceiros)"] = [nomeByParceiro[row.parceiro_id]];
    }
    return rec;
  });
}

// ── Monta campos de Oportunidade a partir do payload recebido ──
function camposOportunidade(payload) {
  const tipoMapeado   = TIPO_IMOVEL_MAP[payload.tipo] || payload.tipo;
  const estadoMapeado = ESTADO_MAP[payload.estado]    || payload.estado;
  const finalidades = (payload.finalidade || "").split(", ").map(f => f.trim()).filter(f => FINALIDADE_VALIDA.has(f));
  const titulo = [tipoMapeado, payload.municipio, payload.estado].filter(Boolean).join(" · ");

  const campos = {
    "Título":                    titulo,
    "Tipo de imóvel":            tipoMapeado    || null,
    "Finalidades":               finalidades.length ? finalidades : null,
    "Tipo de negócio":           finalidades[0] || null,
    "CEP":                       payload.cep         || null,
    "Endereço":                  payload.endereco    || null,
    "Município":                 payload.municipio   || null,
    "Estado":                    estadoMapeado  || null,
    "Área total (m²)":           payload.area          || null,
    "Área privativa (m²)":       payload.areaPrivativa || null,
    "Valor pretendido (R$)":     payload.valor       || null,
    "Comissão (%)":              payload.comissao != null ? payload.comissao / 100 : null,
    "Detalhes da comissão":      payload.detComissao || null,
    "Link de vídeo":             validarUrlSimples(payload.videoLink) ? payload.videoLink : null,
    "Link KMZ/KML":              validarUrlSimples(payload.kmlLink)   ? payload.kmlLink   : null,
    "Observações":               payload.observacoes || null,
    "Latitude":                  payload.lat         || null,
    "Longitude":                 payload.lng         || null,
    "Status":                    "Recebido",
    "Origem":                    payload.origem      || "Parceiro",
    "Token de compartilhamento":  payload.token      || gerarToken(),
    "Data de entrada":           new Date().toISOString().split("T")[0],
    "E-mail do solicitante":     payload.emailParceiro || null,
    "Arquivos (JSON)":           payload.arquivos?.length ? JSON.stringify(payload.arquivos) : null,
  };

  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null));
}

// ── Assinatura de upload Cloudinary ────────────────
async function gerarAssinaturaCloudinary(params, apiSecret) {
  const stringToSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + apiSecret;
  const hashBuffer = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(stringToSign));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Enviar email via Resend ────────────────────────
async function sendEmail(env, { to, subject, html }) {
  console.log("sendEmail → para:", to, "| assunto:", subject);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MODOnexo <noreply@modonexo.com.br>",
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Resend error:", res.status, JSON.stringify(body));
  } else {
    console.log("Resend OK:", body.id);
  }
}

// ── Criar usuário no Firebase (ignora "já existe") ──
// Retorna true se a conta foi CRIADA agora (senha nova vale); false se já existia.
async function criarUsuarioFirebase(env, email, senha) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: senha, returnSecureToken: false }),
    }
  );
  const data = await res.json();
  if (res.ok) return true;
  if (data?.error?.message !== "EMAIL_EXISTS") {
    console.error("Firebase signUp error:", data?.error?.message);
  }
  return false;
}

// ── Ativa parceiro: cria conta Firebase com senha aleatória e envia e-mail de boas-vindas.
// Chamado diretamente de PATCH /parceiros/:id e de /aprovar/parceiro (um único caminho de ativação).
async function ativarParceiroEEnviarBoasVindas(env, nome, email) {
  if (!email) return;
  const senhaTemp = gerarSenhaTemp();
  const criada = await criarUsuarioFirebase(env, email, senhaTemp);
  if (!criada) return;

  const urlPortal = "https://modonexo.com.br";
  const primeiroNome = (nome || "").split(" ")[0] || "parceiro";
  await sendEmail(env, {
    to: email,
    subject: "Bem-vindo ao Portal MODOnexo! Seu acesso foi aprovado ✅",
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
        <div style="background:#1a1a2e;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px">Portal MODOnexo</h1>
          <p style="color:#94a3b8;margin:6px 0 0">Oportunidades imobiliárias exclusivas</p>
        </div>
        <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="color:#16a34a;margin-top:0">Olá, ${esc(primeiroNome)}! Seja bem-vindo 👋</h2>
          <p>Seu cadastro foi <strong>aprovado</strong> e você já faz parte da rede de parceiros da <strong>MODO - Planejamento e Gestão Imobiliária</strong>.</p>
          <p>Através do portal você terá acesso a oportunidades imobiliárias exclusivas, captações, compartilhamento com clientes e muito mais.</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
          <p style="margin-bottom:16px;font-weight:600">Suas credenciais de acesso:</p>
          <div style="background:#f8fafc;border-radius:10px;padding:20px 24px;margin-bottom:24px;border:1px solid #e2e8f0">
            <table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:8px 0;color:#64748b;font-size:14px;width:80px">E-mail</td>
                <td style="padding:8px 0;font-weight:600;font-size:14px">${esc(email)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#64748b;font-size:14px">Senha</td>
                <td style="padding:8px 0;font-size:18px;font-weight:700;letter-spacing:2px;color:#1a1a2e">${esc(senhaTemp)}</td>
              </tr>
            </table>
          </div>
          <p style="color:#64748b;font-size:13px;margin-bottom:20px">Recomendamos alterar sua senha após o primeiro acesso. Use a opção "Esqueci minha senha" na tela de login.</p>
          <div style="text-align:center;margin:24px 0">
            <a href="${urlPortal}"
               style="background:#1a1a2e;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;display:inline-block">
              Acessar o portal →
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px">
            MODO - Planejamento e Gestão Imobiliária · Portal MODOnexo<br>
            Em caso de dúvidas, responda este e-mail.
          </p>
        </div>
      </div>`,
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// Valida a estrutura de "arquivos" (imagens/documentos) antes de gravar.
function validarArquivos(arquivos) {
  if (!Array.isArray(arquivos)) return null;
  if (arquivos.length > 40) return null;
  const validos = [];
  for (const item of arquivos) {
    if (!item || typeof item !== "object") return null;
    const { url, nome, tipo } = item;
    if (typeof url !== "string" || !/^https:\/\/res\.cloudinary\.com\//.test(url)) return null;
    if (typeof nome !== "string" || nome.length > 200 || /[<>]/.test(nome)) return null;
    if (tipo !== "imagem" && tipo !== "documento") return null;
    validos.push({ url, nome, tipo });
  }
  return validos;
}

// Valida links de vídeo/KMZ: precisa ser http(s) e sem caracteres de injeção.
function validarUrlSimples(url) {
  return typeof url === "string" && url.length <= 500 && /^https?:\/\//.test(url) && !/[<>"']/.test(url);
}

// Gera senha temporária: "user@" + 4 dígitos aleatórios.
function gerarSenhaTemp() {
  const arr = new Uint8Array(2);
  crypto.getRandomValues(arr);
  const n = ((arr[0] << 8) | arr[1]) % 10000;
  return "user@" + String(n).padStart(4, "0");
}

// Faz parse do body JSON com erro controlado.
async function parseBody(request) {
  try { return await request.json(); }
  catch { return null; }
}

// Rate limit por chave usando KV. Retorna { ok, retryAfterSec }.
async function checkRateLimit(env, key, maxTentativas, janelaSegundos) {
  const agora = Date.now();
  const atual = await env.RATE_LIMIT.get(key, { type: "json" });
  if (!atual || agora - atual.inicio > janelaSegundos * 1000) {
    await env.RATE_LIMIT.put(key, JSON.stringify({ inicio: agora, contagem: 1 }), { expirationTtl: janelaSegundos });
    return { ok: true };
  }
  if (atual.contagem >= maxTentativas) {
    const retryAfterSec = Math.ceil((janelaSegundos * 1000 - (agora - atual.inicio)) / 1000);
    return { ok: false, retryAfterSec };
  }
  await env.RATE_LIMIT.put(key, JSON.stringify({ inicio: atual.inicio, contagem: atual.contagem + 1 }), { expirationTtl: janelaSegundos });
  return { ok: true };
}

function respostaRateLimit(retryAfterSec) {
  const minutos = Math.max(1, Math.ceil(retryAfterSec / 60));
  const tempo   = minutos === 1 ? "1 minuto" : `${minutos} minutos`;
  const msg = `Para preservar a integridade e a eficiência dos nossos servidores, foi detectado um excesso de solicitações vindas deste acesso. Por gentileza, aguarde cerca de ${tempo} antes de tentar novamente. Atenciosamente, Equipe MODOnexo.`;
  return new Response(JSON.stringify({ error: msg }), {
    status: 429,
    headers: { ...CORS, "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
  });
}

function compararConstante(a, b) {
  const bufA = new TextEncoder().encode(String(a || ""));
  const bufB = new TextEncoder().encode(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

async function validarSecretAdmin(request, env, secretRecebido) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rl = await checkRateLimit(env, `secretadmin:${ip}`, 10, 3600);
  if (!rl.ok) return { autorizado: false, respostaLimite: respostaRateLimit(rl.retryAfterSec) };
  return { autorizado: compararConstante(secretRecebido, env.ADMIN_LINK_SECRET) };
}

const URL_CONSULTA_CRECI = "https://imobisec.com.br/busca";

// ── ROTEADOR ──────────────────────────────────────
export default {
  async fetch(request, env) {
    const reqOrigin     = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : null;
    try {
      const res = await handleRequest(request, env);
      if (!allowedOrigin) return res;
      const h = new Headers(res.headers);
      h.set("Access-Control-Allow-Origin", allowedOrigin);
      h.set("Vary", "Origin");
      return new Response(res.body, { status: res.status, headers: h });
    } catch (err) {
      console.error("Worker unhandled:", err);
      const corsH = allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin" } : {};
      return new Response(JSON.stringify({ error: err.message || "Erro interno" }), {
        status: 500,
        headers: { ...CORS, ...corsH, "Content-Type": "application/json" },
      });
    }
  },
};

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const url    = new URL(request.url);
  const path   = url.pathname;
  const method = request.method;
  const workerOrigin = url.origin;

  // ── Aprovar / Rejeitar parceiro por link no email (secret próprio, sem Firebase) ──

  if (path === "/aprovar/parceiro" && method === "GET") {
    const secret    = url.searchParams.get("secret");
    const recordId  = url.searchParams.get("recordId");
    const _sv = await validarSecretAdmin(request, env, secret);
    if (_sv.respostaLimite) return _sv.respostaLimite;
    if (!_sv.autorizado || !recordId || !validarRecordId(recordId)) return errorResponse("Não autorizado", 401);

    await env.DB.prepare(
      "UPDATE parceiros SET status = 'Ativo', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(recordId).run();
    const rec = await env.DB.prepare("SELECT * FROM parceiros WHERE id = ?").bind(recordId).first();
    if (!rec) return errorResponse("Parceiro não encontrado", 404);

    await ativarParceiroEEnviarBoasVindas(env, rec.nome_completo, rec.email);

    const HTML_HEADERS = {
      "Content-Type": "text/html;charset=UTF-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };
    return new Response(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:#16a34a">✅ Parceiro aprovado!</h2>
        <p><strong>${esc(rec.nome_completo)}</strong> agora tem acesso ao portal MODOnexo.</p>
        <p style="color:#666">Um e-mail de boas-vindas foi enviado para <strong>${esc(rec.email)}</strong>.</p>
        <p style="color:#666">Você pode fechar esta aba.</p>
      </body></html>`, { headers: HTML_HEADERS });
  }

  if (path === "/rejeitar/parceiro" && method === "GET") {
    const secret   = url.searchParams.get("secret");
    const recordId = url.searchParams.get("recordId");
    const _sv = await validarSecretAdmin(request, env, secret);
    if (_sv.respostaLimite) return _sv.respostaLimite;
    if (!_sv.autorizado || !recordId || !validarRecordId(recordId)) return errorResponse("Não autorizado", 401);

    await env.DB.prepare(
      "UPDATE parceiros SET status = 'Suspenso', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(recordId).run();
    const rec = await env.DB.prepare("SELECT nome_completo FROM parceiros WHERE id = ?").bind(recordId).first();

    return new Response(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:#dc2626">❌ Parceiro rejeitado</h2>
        <p><strong>${esc(rec?.nome_completo || "")}</strong> foi marcado como Suspenso.</p>
        <p style="color:#666">Você pode fechar esta aba.</p>
      </body></html>`, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    });
  }

  // ── Rotas públicas (sem auth) ──────────────────

  // Cadastro público de parceiro
  if (path === "/parceiros/publico" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await checkRateLimit(env, `signup:${ip}`, 5, 3600);
    if (!rl.ok) return respostaRateLimit(rl.retryAfterSec);
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    if (!body.nome || !body.email) return errorResponse("Nome e e-mail obrigatórios");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return errorResponse("E-mail inválido");
    if (body.nome.length > 120 || body.email.length > 120) return errorResponse("Campo excede tamanho permitido");
    const uf   = (body.creciUf   || "").toUpperCase();
    const tipo = (body.creciTipo || "").toUpperCase();
    const creciLabel = [
      uf   ? `CRECI-${uf}` : "",
      body.creci || "",
      tipo ? `(${tipo})` : "",
    ].filter(Boolean).join(" ");

    const id = gerarRecordId();
    await env.DB.prepare(
      "INSERT INTO parceiros (id, nome_completo, email, creci, whatsapp) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, body.nome, body.email, creciLabel, body.whatsapp || "").run();

    const primeiroNome = (body.nome || "").split(" ")[0];
    await sendEmail(env, {
      to: body.email,
      subject: "Recebemos seu cadastro — Portal MODOnexo",
      html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
          <div style="background:#1a1a2e;padding:20px 28px;border-radius:10px 10px 0 0;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px">Portal MODOnexo</h1>
          </div>
          <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
            <h2 style="color:#1a1a2e;margin-top:0">Olá, ${esc(primeiroNome)}!</h2>
            <p>Recebemos seu pedido de cadastro como parceiro da <strong>MODO - Planejamento e Gestão Imobiliária</strong>.</p>
            <p>Nossa equipe irá analisar suas informações e você receberá um e-mail de confirmação em breve com as instruções de acesso ao portal.</p>
            <div style="background:#f8fafc;border-left:4px solid #1a1a2e;padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0">
              <p style="margin:0;font-size:14px;color:#475569">
                <strong>Dados enviados:</strong><br>
                Nome: ${esc(body.nome)}<br>
                E-mail: ${esc(body.email)}<br>
                CRECI: ${esc(creciLabel || "—")}
              </p>
            </div>
            <p style="color:#64748b;font-size:14px">Se você não solicitou este cadastro, desconsidere este e-mail.</p>
            <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px">
              MODO - Planejamento e Gestão Imobiliária · Portal MODOnexo
            </p>
          </div>
        </div>`,
    });

    const urlAprovar  = `${workerOrigin}/aprovar/parceiro?recordId=${id}&secret=${env.ADMIN_LINK_SECRET}`;
    const urlRejeitar = `${workerOrigin}/rejeitar/parceiro?recordId=${id}&secret=${env.ADMIN_LINK_SECRET}`;
    await sendEmail(env, {
      to: "modogestaonexo@gmail.com",
      subject: "Novo parceiro aguardando aprovação — Portal MODO",
      html: `
        <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
          <div style="background:#1a1a2e;padding:20px 28px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">Novo parceiro cadastrado</h2>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:8px 0;color:#64748b;width:90px">Nome</td><td style="padding:8px 0;font-weight:600">${esc(body.nome)}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">E-mail</td><td style="padding:8px 0">${esc(body.email)}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">WhatsApp</td><td style="padding:8px 0">${esc(body.whatsapp || "—")}</td></tr>
              <tr>
                <td style="padding:8px 0;color:#64748b">CRECI</td>
                <td style="padding:8px 0">
                  <strong>${esc(creciLabel || "—")}</strong>
                  &nbsp;<a href="${URL_CONSULTA_CRECI}" target="_blank" style="color:#2563eb;font-size:13px;text-decoration:none">🔍 Consultar no IMOBISEC</a>
                </td>
              </tr>
            </table>
            <div style="margin-top:8px">
              <a href="${urlAprovar}" style="background:#16a34a;color:#fff;padding:13px 28px;border-radius:7px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">✅ Aprovar</a>
              &nbsp;&nbsp;
              <a href="${urlRejeitar}" style="background:#dc2626;color:#fff;padding:13px 28px;border-radius:7px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">❌ Rejeitar</a>
            </div>
          </div>
        </div>`,
    });

    return corsResponse({ id });
  }

  // Registro de lead (acesso a link público)
  if (path === "/leads/publico" && method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await checkRateLimit(env, `lead:${ip}`, 20, 3600);
    if (!rl.ok) return respostaRateLimit(rl.retryAfterSec);
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    if (!body.nome || !body.whatsapp || !body.token) return errorResponse("Dados incompletos");
    if (!validarToken(body.token)) return errorResponse("Token inválido", 400);
    if (body.nome.length > 120 || body.whatsapp.length > 30) return errorResponse("Campo excede tamanho permitido", 400);
    if (/[<>]/.test(body.nome)) return errorResponse("Nome contém caracteres inválidos", 400);
    if (!/^[\d\s()+-]+$/.test(body.whatsapp)) return errorResponse("WhatsApp inválido", 400);

    const op = await env.DB.prepare(
      "SELECT id, titulo, email_solicitante FROM oportunidades WHERE token_compartilhamento = ?"
    ).bind(body.token).first();

    let nomeParceiro = "";
    if (op?.email_solicitante) {
      const p = await env.DB.prepare("SELECT nome_completo FROM parceiros WHERE lower(email) = lower(?)").bind(op.email_solicitante).first();
      nomeParceiro = p?.nome_completo || "";
    }

    const id = gerarRecordId();
    await env.DB.prepare(
      `INSERT INTO leads (id, nome, whatsapp, token_usado, parceiro_nome, parceiro_email, oportunidade_titulo, oportunidade_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.nome, body.whatsapp, body.token, nomeParceiro, op?.email_solicitante || "", op?.titulo || "", op?.id || null).run();

    return corsResponse({ ok: true });
  }

  // Oportunidade pública pelo token
  if (path.startsWith("/publico/oportunidade/") && method === "GET") {
    const token = path.split("/").pop();
    if (!validarToken(token)) return errorResponse("Token inválido", 400);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rl = await checkRateLimit(env, `view:${ip}`, 60, 3600);
    if (!rl.ok) return respostaRateLimit(rl.retryAfterSec);

    const op = await env.DB.prepare("SELECT * FROM oportunidades WHERE token_compartilhamento = ?").bind(token).first();
    if (!op) return errorResponse("Oportunidade não encontrada", 404);

    let parceiro = null;
    if (op.email_solicitante) {
      const p = await env.DB.prepare("SELECT nome_completo, whatsapp FROM parceiros WHERE lower(email) = lower(?)").bind(op.email_solicitante).first();
      if (p) parceiro = { nome: p.nome_completo, whatsapp: p.whatsapp };
    }

    const modo = url.searchParams.get("modo") === "completo" ? "completo" : "previa";
    const CAMPOS_PREVIA = new Set([
      "Título","Tipo de imóvel","Município","Estado","Latitude","Longitude","Link KMZ/KML",
      "Token de compartilhamento","Arquivos (JSON)",
    ]);
    const CAMPOS_COMPLETO = new Set([
      ...CAMPOS_PREVIA,
      "Finalidades","Tipo de negócio","CEP","Endereço",
      "Área total (m²)","Área privativa (m²)","Valor pretendido (R$)",
      "Observações","Link de vídeo",
    ]);
    const camposPermitidos = modo === "completo" ? CAMPOS_COMPLETO : CAMPOS_PREVIA;

    const recordCompleto = rowToRecord("oportunidades", op);
    if (camposPermitidos.has("Finalidades")) {
      const { results: finRows } = await env.DB.prepare(
        "SELECT finalidade FROM oportunidade_finalidades WHERE oportunidade_id = ? ORDER BY ordem"
      ).bind(op.id).all();
      if (finRows.length) recordCompleto.fields["Finalidades"] = finRows.map(f => f.finalidade);
    }

    const fieldsFiltrados = Object.fromEntries(
      Object.entries(recordCompleto.fields).filter(([k]) => camposPermitidos.has(k))
    );
    fieldsFiltrados._parceiro = parceiro;

    if (op.arquivos_json) {
      try {
        const todos = JSON.parse(op.arquivos_json);
        fieldsFiltrados._imagens    = todos.filter(a => a.tipo === "imagem").map(a => a.url);
        fieldsFiltrados._documentos = todos.filter(a => a.tipo === "documento");
      } catch { /* JSON inválido — ignora */ }
    }

    return corsResponse({ id: op.id, fields: fieldsFiltrados });
  }

  // ── Autenticação obrigatória abaixo ────────────
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return errorResponse("Não autorizado", 401);

  const user = await verifyFirebaseToken(authHeader.slice(7), env);
  if (!user) return errorResponse("Token inválido", 401);

  // Assinatura de upload — exige login, evita upload direto/anônimo no Cloudinary
  if (path === "/cloudinary/assinatura" && method === "POST") {
    const rl = await checkRateLimit(env, `upload:${user.email}`, 60, 3600);
    if (!rl.ok) return respostaRateLimit(rl.retryAfterSec);
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    const foldersValidos = new Set(["modo-imagens", "modo-docs", "modo-kmz"]);
    const folder = foldersValidos.has(body.folder) ? body.folder : "modo-imagens";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await gerarAssinaturaCloudinary({ folder, timestamp }, env.CLOUDINARY_API_SECRET);
    return corsResponse({
      signature, timestamp, folder,
      apiKey: env.CLOUDINARY_API_KEY,
      cloudName: "dlyebtufy",
    });
  }

  // ── Oportunidades ──────────────────────────────

  if (path === "/oportunidades" && method === "GET") {
    const params = url.searchParams;
    const limit  = Math.min(parseInt(params.get("limit") || "100", 10) || 100, 500);

    let where = "";
    let bindings = [];
    if (user.admin && params.get("todos") === "true") {
      where = "";
    } else if (user.admin) {
      where = "WHERE origem != ?";
      bindings = ["MODO"];
    } else {
      where = "WHERE lower(email_solicitante) = lower(?)";
      bindings = [user.email];
    }

    const sql = `SELECT * FROM oportunidades ${where} ORDER BY data_entrada DESC LIMIT ?`;
    const { results } = await env.DB.prepare(sql).bind(...bindings, limit).all();
    const records = await anexarSinteticosOportunidade(env, results);
    return corsResponse({ records });
  }

  if (path === "/oportunidades" && method === "POST") {
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    if (body.arquivos) {
      const arquivosValidos = validarArquivos(body.arquivos);
      if (!arquivosValidos) return errorResponse("Arquivos em formato inválido", 400);
      body.arquivos = arquivosValidos;
    }
    if (!user.admin) { body.emailParceiro = user.email; body.origem = "Parceiro"; }

    const emailParceiro = body.emailParceiro || null;
    const parceiro = emailParceiro
      ? await env.DB.prepare("SELECT id FROM parceiros WHERE lower(email) = lower(?)").bind(emailParceiro).first()
      : null;

    const campos = camposOportunidade(body);
    const id  = gerarRecordId();
    const row = fieldsToRow("oportunidades", campos);
    const cols = Object.keys(row);
    const allCols = [...cols, "parceiro_id"];
    const sql = `INSERT INTO oportunidades (id, ${allCols.join(", ")}) VALUES (?, ${allCols.map(() => "?").join(", ")})`;
    await env.DB.prepare(sql).bind(id, ...cols.map(c => row[c]), parceiro ? parceiro.id : null).run();

    if (campos["Finalidades"]) {
      await env.DB.batch(campos["Finalidades"].map((f, i) =>
        env.DB.prepare("INSERT INTO oportunidade_finalidades (oportunidade_id, finalidade, ordem) VALUES (?, ?, ?)")
          .bind(id, f, i)));
    }

    await sendEmail(env, {
      to: "modogestaonexo@gmail.com",
      subject: `Nova oportunidade cadastrada — ${campos["Título"]}`,
      html: `<p>Nova oportunidade recebida no portal:</p>
             <ul>
               <li><strong>Título:</strong> ${esc(campos["Título"])}</li>
               <li><strong>Tipo:</strong> ${esc(campos["Tipo de imóvel"] || "")}</li>
               <li><strong>Município:</strong> ${esc(campos["Município"] || "")}</li>
               <li><strong>Parceiro:</strong> ${esc(emailParceiro || "")}</li>
             </ul>
             <p>Acesse o painel para ver os detalhes.</p>`,
    });

    return corsResponse({ id });
  }

  const opMatch = path.match(/^\/oportunidades\/([^/]+)$/);
  if (opMatch) {
    const id = opMatch[1];
    if (!validarRecordId(id)) return errorResponse("ID inválido", 400);

    if (method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM oportunidades WHERE id = ?").bind(id).first();
      if (!row) return errorResponse("Oportunidade não encontrada", 404);
      if (!user.admin && row.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
        return errorResponse("Acesso negado", 403);
      }
      const [record] = await anexarSinteticosOportunidade(env, [row]);
      if (row.arquivos_json) {
        try {
          const todos = JSON.parse(row.arquivos_json);
          record.fields._imagens    = todos.filter(a => a.tipo === "imagem").map(a => a.url);
          record.fields._documentos = todos.filter(a => a.tipo === "documento");
        } catch { /* JSON inválido — ignora */ }
      }
      return corsResponse(record);
    }

    if (method === "PATCH") {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);

      const atual = await env.DB.prepare("SELECT * FROM oportunidades WHERE id = ?").bind(id).first();
      if (!atual) return errorResponse("Oportunidade não encontrada", 404);

      if (!user.admin) {
        if (atual.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
          return errorResponse("Acesso negado", 403);
        }
        delete body.status;
        delete body.motivo;
      }

      const campos = {};
      if (body.status) campos["Status"]                   = body.status;
      if (body.motivo) campos["Motivo (status negativo)"] = body.motivo;

      const ehEdicaoCompleta = body.tipo || body.municipio || body.area != null || body.valor != null;
      let novasFinalidades = null;
      if (ehEdicaoCompleta) {
        const finalidades = (body.finalidade || "").split(", ").map(f => f.trim()).filter(f => FINALIDADE_VALIDA.has(f));
        const tipoMapeado   = TIPO_IMOVEL_MAP[body.tipo]  || body.tipo   || null;
        const estadoMapeado = ESTADO_MAP[body.estado]     || body.estado || null;
        const titulo = [tipoMapeado, body.municipio, body.estado].filter(Boolean).join(" · ");
        if (titulo)                     campos["Título"]                = titulo;
        if (tipoMapeado)                campos["Tipo de imóvel"]        = tipoMapeado;
        if (finalidades.length)       { novasFinalidades = finalidades;
                                        campos["Tipo de negócio"]       = finalidades[0]; }
        if (body.cep)                   campos["CEP"]                   = body.cep;
        if (body.endereco)              campos["Endereço"]              = body.endereco;
        if (body.municipio)             campos["Município"]             = body.municipio;
        if (estadoMapeado)              campos["Estado"]                = estadoMapeado;
        if (body.area           != null) campos["Área total (m²)"]      = body.area;
        if (body.areaPrivativa  != null) campos["Área privativa (m²)"]  = body.areaPrivativa;
        if (body.valor          != null) campos["Valor pretendido (R$)"] = body.valor;
        if (body.comissao       != null) campos["Comissão (%)"]         = body.comissao / 100;
        if (body.detComissao)           campos["Detalhes da comissão"]  = body.detComissao;
        if (body.videoLink) {
          if (!validarUrlSimples(body.videoLink)) return errorResponse("Link de vídeo inválido", 400);
          campos["Link de vídeo"] = body.videoLink;
        }
        if (body.kmlLink) {
          if (!validarUrlSimples(body.kmlLink)) return errorResponse("Link KMZ/KML inválido", 400);
          campos["Link KMZ/KML"] = body.kmlLink;
        }
        if (body.lat != null)           campos["Latitude"]             = body.lat;
        if (body.lng != null)           campos["Longitude"]            = body.lng;
        campos["Observações"] = body.observacoes || "";
      }
      if (body.arquivos) {
        const arquivosValidos = validarArquivos(body.arquivos);
        if (!arquivosValidos) return errorResponse("Arquivos em formato inválido", 400);
        campos["Arquivos (JSON)"] = JSON.stringify(arquivosValidos);
      }

      // ── Log de auditoria — usa `atual` já obtido acima ──
      if (ehEdicaoCompleta || body.status || body.arquivos) {
        const LABELS = {
          "Título": "Título", "Tipo de imóvel": "Tipo de imóvel",
          "Área total (m²)": "Área total", "Área privativa (m²)": "Área privativa",
          "Valor pretendido (R$)": "Valor pretendido",
          "CEP": "CEP", "Endereço": "Endereço", "Município": "Município",
          "Estado": "Estado", "Observações": "Observações",
          "Link de vídeo": "Vídeo", "Link KMZ/KML": "KMZ/KML",
          "Status": "Status", "Arquivos (JSON)": "Arquivos",
        };
        const atualFields = rowToRecord("oportunidades", atual).fields;
        const alteracoes = [];
        for (const [campo, novoValor] of Object.entries(campos)) {
          if (campo === "Finalidades") continue; // campo sintético (tabela de junção) — não comparável aqui
          const label = LABELS[campo] || campo;
          const anterior = atualFields[campo];
          const anteriorStr = campo === "Arquivos (JSON)"
            ? (anterior ? `${JSON.parse(anterior).length} arquivo(s)` : "nenhum")
            : (anterior != null ? String(anterior) : "—");
          const novoStr = campo === "Arquivos (JSON)"
            ? `${JSON.parse(novoValor).length} arquivo(s)`
            : String(novoValor);
          if (anteriorStr !== novoStr) alteracoes.push({ campo: label, de: anteriorStr, para: novoStr });
        }
        if (alteracoes.length) {
          let historico = [];
          try { historico = JSON.parse(atual.historico_json || "[]"); } catch {}
          historico.push({
            data: new Date().toISOString(),
            email: user.email,
            nome: user.email,
            admin: user.admin || false,
            alteracoes,
          });
          campos["Histórico (JSON)"] = JSON.stringify(historico);
        }
      }

      const row = fieldsToRow("oportunidades", campos);
      const cols = Object.keys(row);
      if (cols.length) {
        const setClauses = cols.map(c => `${c} = ?`);
        setClauses.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        const sql = `UPDATE oportunidades SET ${setClauses.join(", ")} WHERE id = ?`;
        await env.DB.prepare(sql).bind(...cols.map(c => row[c]), id).run();
      }
      if (novasFinalidades) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM oportunidade_finalidades WHERE oportunidade_id = ?").bind(id),
          ...novasFinalidades.map((f, i) =>
            env.DB.prepare("INSERT INTO oportunidade_finalidades (oportunidade_id, finalidade, ordem) VALUES (?, ?, ?)")
              .bind(id, f, i)),
        ]);
      }

      const atualizado = await env.DB.prepare("SELECT * FROM oportunidades WHERE id = ?").bind(id).first();
      const [record] = await anexarSinteticosOportunidade(env, [atualizado]);
      return corsResponse(record);
    }

    if (method === "DELETE") {
      if (!user.admin) {
        const atual = await env.DB.prepare("SELECT email_solicitante FROM oportunidades WHERE id = ?").bind(id).first();
        if (!atual) return errorResponse("Oportunidade não encontrada", 404);
        if (atual.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
          return errorResponse("Acesso negado", 403);
        }
      }
      await env.DB.prepare("DELETE FROM oportunidades WHERE id = ?").bind(id).run();
      return corsResponse({ message: "Oportunidade deletada" });
    }
  }

  // Gerar/regenerar token de compartilhamento
  const compartilharMatch = path.match(/^\/oportunidades\/([^/]+)\/compartilhar$/);
  if (compartilharMatch && method === "POST") {
    const id = compartilharMatch[1];
    if (!validarRecordId(id)) return errorResponse("ID de oportunidade inválido", 400);
    const op = await env.DB.prepare("SELECT email_solicitante FROM oportunidades WHERE id = ?").bind(id).first();
    if (!op) return errorResponse("Oportunidade não encontrada", 404);
    if (!user.admin && op.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
      return errorResponse("Acesso negado", 403);
    }
    const token = gerarToken();
    await env.DB.prepare("UPDATE oportunidades SET token_compartilhamento = ? WHERE id = ?").bind(token, id).run();
    return corsResponse({ token });
  }

  // ── Parceiros ──────────────────────────────────

  if (path === "/parceiros" && method === "GET") {
    if (!user.admin) return errorResponse("Acesso negado", 403);
    const { results } = await env.DB.prepare("SELECT * FROM parceiros ORDER BY data_cadastro DESC").all();
    const ids = results.map(r => r.id);
    let opsByParceiro = {};
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const { results: opRows } = await env.DB.prepare(
        `SELECT id, parceiro_id FROM oportunidades WHERE parceiro_id IN (${placeholders})`
      ).bind(...ids).all();
      for (const o of opRows) {
        if (!opsByParceiro[o.parceiro_id]) opsByParceiro[o.parceiro_id] = [];
        opsByParceiro[o.parceiro_id].push(o.id);
      }
    }
    const records = results.map(row => {
      const rec = rowToRecord("parceiros", row);
      rec.fields["Oportunidades"] = opsByParceiro[row.id] || [];
      return rec;
    });
    return corsResponse({ records });
  }

  const parceiroMatch = path.match(/^\/parceiros\/([^/]+)$/);
  if (parceiroMatch && method === "PATCH" && user.admin) {
    const id = parceiroMatch[1];
    if (!validarRecordId(id)) return errorResponse("ID inválido", 400);
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    if (!body.status) return errorResponse("Nada para atualizar", 400);

    await env.DB.prepare(
      "UPDATE parceiros SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).bind(body.status, id).run();
    const atualizado = await env.DB.prepare("SELECT * FROM parceiros WHERE id = ?").bind(id).first();
    if (!atualizado) return errorResponse("Parceiro não encontrado", 404);

    // Ativação inline — único caminho de ativação, sem depender de webhook externo
    if (body.status === "Ativo") {
      await ativarParceiroEEnviarBoasVindas(env, atualizado.nome_completo, atualizado.email);
    }

    return corsResponse(rowToRecord("parceiros", atualizado));
  }

  // ── Avisos ─────────────────────────────────────

  if (path === "/avisos" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM avisos ORDER BY data_hora DESC").all();
    const records = results.map(row => ({
      id: row.id,
      fields: { "Mensagem": row.mensagem, "Data e hora": row.data_hora },
    }));
    return corsResponse({ records });
  }

  if (path === "/avisos" && method === "POST" && user.admin) {
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    const id = gerarRecordId();
    await env.DB.prepare("INSERT INTO avisos (id, mensagem) VALUES (?, ?)").bind(id, body.mensagem).run();
    const row = await env.DB.prepare("SELECT * FROM avisos WHERE id = ?").bind(id).first();
    return corsResponse({ id: row.id, fields: { "Mensagem": row.mensagem, "Data e hora": row.data_hora } });
  }

  // ── Demandas ───────────────────────────────────

  if (path === "/demandas" && method === "GET") {
    const where = user.admin ? "" : "WHERE visivel_parceiros = 1";
    const { results } = await env.DB.prepare(`SELECT * FROM demandas ${where} ORDER BY data_publicacao DESC`).all();
    return corsResponse(rowsToRecords("demandas", results));
  }

  if (path === "/demandas" && method === "POST" && user.admin) {
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    const campos = {
      "Título":                 body.titulo,
      "Tipo de imóvel":         body.tipo || null,
      "Localização desejada":   body.local || null,
      "Área mínima (m²)":       body.areaMin || null,
      "Área máxima (m²)":       body.areaMax || null,
      "Valor máximo (R$)":      body.valor || null,
      "Descrição":              body.descricao || null,
      "Visível para parceiros": body.visivel ?? false,
    };
    const cleaned = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null));
    const id = gerarRecordId();
    const row = fieldsToRow("demandas", cleaned);
    const cols = Object.keys(row);
    await env.DB.prepare(
      `INSERT INTO demandas (id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`
    ).bind(id, ...cols.map(c => row[c])).run();
    const created = await env.DB.prepare("SELECT * FROM demandas WHERE id = ?").bind(id).first();
    return corsResponse(rowToRecord("demandas", created));
  }

  const demandaMatch = path.match(/^\/demandas\/([^/]+)$/);
  if (demandaMatch && method === "PATCH" && user.admin) {
    const id = demandaMatch[1];
    if (!validarRecordId(id)) return errorResponse("ID inválido", 400);
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    const campos = {};
    if (body.titulo    !== undefined) campos["Título"]                 = body.titulo;
    if (body.tipo      !== undefined) campos["Tipo de imóvel"]         = body.tipo;
    if (body.local     !== undefined) campos["Localização desejada"]   = body.local;
    if (body.areaMin   !== undefined) campos["Área mínima (m²)"]       = body.areaMin;
    if (body.areaMax   !== undefined) campos["Área máxima (m²)"]       = body.areaMax;
    if (body.valor     !== undefined) campos["Valor máximo (R$)"]      = body.valor;
    if (body.descricao !== undefined) campos["Descrição"]              = body.descricao;
    if (body.visivel   !== undefined) campos["Visível para parceiros"] = body.visivel;
    const row = fieldsToRow("demandas", campos);
    const cols = Object.keys(row);
    if (cols.length) {
      const sql = `UPDATE demandas SET ${cols.map(c => `${c} = ?`).join(", ")} WHERE id = ?`;
      await env.DB.prepare(sql).bind(...cols.map(c => row[c]), id).run();
    }
    const atualizado = await env.DB.prepare("SELECT * FROM demandas WHERE id = ?").bind(id).first();
    if (!atualizado) return errorResponse("Demanda não encontrada", 404);
    return corsResponse(rowToRecord("demandas", atualizado));
  }

  // ── Leads ──────────────────────────────────────

  if (path === "/leads" && method === "GET") {
    const opId = url.searchParams.get("opId");
    if (user.admin) {
      const { results } = opId
        ? await env.DB.prepare("SELECT * FROM leads WHERE oportunidade_id = ? ORDER BY data_hora_acesso DESC").bind(opId).all()
        : await env.DB.prepare("SELECT * FROM leads ORDER BY data_hora_acesso DESC").all();
      return corsResponse(rowsToRecords("leads", results));
    } else {
      if (!opId) return errorResponse("opId obrigatório", 400);
      const op = await env.DB.prepare("SELECT email_solicitante FROM oportunidades WHERE id = ?").bind(opId).first();
      if (!op || op.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
        return errorResponse("Acesso negado", 403);
      }
      const { results } = await env.DB.prepare(
        "SELECT * FROM leads WHERE oportunidade_id = ? ORDER BY data_hora_acesso DESC"
      ).bind(opId).all();
      return corsResponse(rowsToRecords("leads", results));
    }
  }

  // ── Chat por oportunidade ──────────────────────

  if (path === "/mensagens" && method === "GET") {
    const opId = url.searchParams.get("opId");
    if (!opId) return errorResponse("opId obrigatório", 400);
    if (!validarRecordId(opId)) return errorResponse("ID de oportunidade inválido", 400);
    const op = await env.DB.prepare("SELECT email_solicitante FROM oportunidades WHERE id = ?").bind(opId).first();
    if (!op) return errorResponse("Oportunidade não encontrada", 404);
    if (!user.admin && op.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
      return errorResponse("Acesso negado", 403);
    }
    const { results } = await env.DB.prepare(
      "SELECT * FROM mensagens WHERE oportunidade_id = ? ORDER BY data_hora ASC"
    ).bind(opId).all();
    return corsResponse(rowsToRecords("mensagens", results));
  }

  if (path === "/mensagens" && method === "POST") {
    const body = await parseBody(request);
    if (!body) return errorResponse("Corpo da requisição inválido", 400);
    if (!body.opId || !body.texto?.trim()) return errorResponse("Dados incompletos");
    if (body.texto.length > 4000) return errorResponse("Mensagem muito longa (máx 4000 chars)");
    if (!validarRecordId(body.opId)) return errorResponse("ID de oportunidade inválido", 400);

    const op = await env.DB.prepare("SELECT * FROM oportunidades WHERE id = ?").bind(body.opId).first();
    if (!op) return errorResponse("Oportunidade não encontrada", 404);
    if (!user.admin && op.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
      return errorResponse("Acesso negado", 403);
    }

    if (!user.admin) {
      const parceiro = await env.DB.prepare("SELECT status FROM parceiros WHERE lower(email) = lower(?)").bind(user.email).first();
      if (!parceiro || parceiro.status !== "Ativo") {
        return errorResponse("Conta suspensa ou inativa", 403);
      }
    }

    const msgId = gerarRecordId();
    const de = user.admin ? "Admin" : "Parceiro";
    await env.DB.prepare(
      "INSERT INTO mensagens (id, mensagem, oportunidade_id, de, lida) VALUES (?, ?, ?, ?, 0)"
    ).bind(msgId, body.texto.trim(), body.opId, de).run();

    // Notificar a outra parte por e-mail (no máximo 1 a cada 3h por conversa/remetente)
    const titulo = op.titulo || "oportunidade";
    const texto  = esc(body.texto.trim());
    const rodapeAntiSpam = `<p style="color:#94a3b8;font-size:12px;margin-top:20px;line-height:1.5">📬 Para manter sua caixa de entrada organizada, o Portal MODOnexo envia no máximo <strong>uma notificação a cada 3 horas</strong> por conversa — independente da quantidade de mensagens recebidas no período. Para acompanhar a conversa em tempo real, acesse o portal diretamente.</p>`;

    const tresHorasAtras = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const recente = await env.DB.prepare(
      "SELECT id FROM mensagens WHERE oportunidade_id = ? AND de = ? AND data_hora > ? AND id != ? LIMIT 1"
    ).bind(body.opId, de, tresHorasAtras, msgId).first();
    const deveEnviarEmail = !recente;

    if (deveEnviarEmail) {
      if (user.admin) {
        const emailParceiro = op.email_solicitante || "";
        if (emailParceiro) {
          const link = `https://modonexo.com.br/parceiro/oportunidade.html?id=${body.opId}`;
          await sendEmail(env, {
            to: emailParceiro,
            subject: `Nova mensagem sobre "${titulo}" — Portal MODOnexo`,
            html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
              <div style="background:#1a1a2e;padding:20px 28px;border-radius:10px 10px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">Nova mensagem no portal</h2>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
                <p>Você recebeu uma mensagem sobre <strong>${esc(titulo)}</strong>:</p>
                <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;border-left:3px solid #1a1a2e;white-space:pre-wrap;font-size:15px">${texto}</div>
                <a href="${link}" style="background:#1a1a2e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Ver no portal →</a>
                ${rodapeAntiSpam}
              </div>
            </div>`,
          });
        }
      } else {
        const link = `https://modonexo.com.br/admin/oportunidade.html?id=${body.opId}`;
        await sendEmail(env, {
          to: "modogestaonexo@gmail.com",
          subject: `Mensagem de parceiro sobre "${titulo}"`,
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1a2e">
            <div style="background:#1a1a2e;padding:20px 28px;border-radius:10px 10px 0 0">
              <h2 style="color:#fff;margin:0;font-size:18px">Nova mensagem de parceiro</h2>
            </div>
            <div style="background:#fff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
              <p>Mensagem de <strong>${esc(user.email)}</strong> sobre <strong>${esc(titulo)}</strong>:</p>
              <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;border-left:3px solid #c09a5a;white-space:pre-wrap;font-size:15px">${texto}</div>
              <a href="${link}" style="background:#1a1a2e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Ver no portal →</a>
              ${rodapeAntiSpam}
            </div>
          </div>`,
        });
      }
    }

    return corsResponse({ ok: true });
  }

  // Marcar mensagens como lidas
  if (path === "/mensagens/ler" && method === "POST") {
    const body = await parseBody(request);
    if (!body || !body.opId) return errorResponse("opId obrigatório");
    if (!validarRecordId(body.opId)) return errorResponse("ID de oportunidade inválido", 400);
    const op = await env.DB.prepare("SELECT email_solicitante FROM oportunidades WHERE id = ?").bind(body.opId).first();
    if (!op) return errorResponse("Oportunidade não encontrada", 404);
    if (!user.admin && op.email_solicitante.toLowerCase() !== user.email.toLowerCase()) {
      return errorResponse("Acesso negado", 403);
    }
    const outroDe = user.admin ? "Parceiro" : "Admin";
    const result = await env.DB.prepare(
      "UPDATE mensagens SET lida = 1 WHERE oportunidade_id = ? AND de = ? AND lida = 0"
    ).bind(body.opId, outroDe).run();
    return corsResponse({ ok: true, lidas: result.meta?.changes || 0 });
  }

  // Contar mensagens não-lidas do usuário
  if (path === "/mensagens/nao-lidas" && method === "GET") {
    const outroDe = user.admin ? "Parceiro" : "Admin";
    let sql, bindings;
    if (user.admin) {
      sql = "SELECT oportunidade_id, COUNT(*) AS n FROM mensagens WHERE de = ? AND lida = 0 GROUP BY oportunidade_id";
      bindings = [outroDe];
    } else {
      sql = `SELECT m.oportunidade_id, COUNT(*) AS n
             FROM mensagens m
             JOIN oportunidades o ON o.id = m.oportunidade_id
             WHERE lower(o.email_solicitante) = lower(?) AND m.de = ? AND m.lida = 0
             GROUP BY m.oportunidade_id`;
      bindings = [user.email, outroDe];
    }
    const { results } = await env.DB.prepare(sql).bind(...bindings).all();
    const porOportunidade = {};
    let count = 0;
    for (const row of results) { porOportunidade[row.oportunidade_id] = row.n; count += row.n; }
    return corsResponse({ count, porOportunidade });
  }

  return errorResponse("Rota não encontrada", 404);
}
