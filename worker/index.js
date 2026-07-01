// ===== MODO Nexo — Cloudflare Worker =====
// Deploy: wrangler deploy
// Vars (configurar no painel Cloudflare → Workers → Settings → Variables):
//   AIRTABLE_API_KEY   — chave da API do Airtable
//   FIREBASE_API_KEY   — chave do Firebase Web
//   AIRTABLE_BASE      — appt6mRYfyo5Aq6Db

const ADMIN_EMAILS = [
  "rocarniel@gmail.com",
  "olegarioadvogado@gmail.com",
];

// IDs das tabelas (fixos — não mudam)
const TBL = {
  parceiros:     "tblQSJNfoSTabmt3q",
  oportunidades: "tblAPZlD7YJnhZcWF",
  documentos:    "tblQOsRwdZOOLlp74",
  mensagens:     "tblSSuGygem5rKKZt",
  demandas:      "tblziA6PNm0Ya9O8W",
  leads:         "tblhAGE5p6m9ipfd0",
};

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
  // Verificar expiração pelo payload JWT antes de chamar a API (CRÍTICO 2)
  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
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

// ── Airtable helper ───────────────────────────────
async function airtable(env, method, table, recordId = "", params = {}, body = null) {
  const base = `https://api.airtable.com/v0/${env.AIRTABLE_BASE}/${table}`;
  let url = recordId ? `${base}/${recordId}` : base;

  if (method === "GET" && Object.keys(params).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === "object") {
            for (const [sk, sv] of Object.entries(item)) {
              qs.append(`${k}[${i}][${sk}]`, sv);
            }
          } else {
            qs.append(k, item);
          }
        });
      } else {
        qs.append(k, v);
      }
    }
    url += "?" + qs.toString();
  }

  const opts = {
    method,
    headers: {
      Authorization:  `Bearer ${env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erro Airtable");
  return data;
}

// ── Buscar parceiro pelo email ────────────────────
async function getParceiroPorEmail(env, email) {
  const data = await airtable(env, "GET", TBL.parceiros, "", {
    filterByFormula: `{E-Mail} = "${escFormula(email)}"`,
    maxRecords: 1,
  });
  return data.records?.[0] || null;
}

// ── Verificar acesso de parceiro a uma oportunidade ──
// Retorna o registro da oportunidade; lança { status, message } se negado.
async function verificarAcessoOportunidade(env, user, opId) {
  if (!validarRecordId(opId)) throw { status: 400, message: "ID de oportunidade inválido" };
  const op = await airtable(env, "GET", TBL.oportunidades, opId);
  if (!user.admin) {
    const emailOp = (op.fields?.["E-mail do solicitante"] || "").toLowerCase();
    if (emailOp !== user.email.toLowerCase()) throw { status: 403, message: "Acesso negado" };
  }
  return op;
}

// ── Gerar token único ─────────────────────────────
function gerarToken() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(36)).join("").slice(0, 16);
}

// ── Mapeamentos form → Airtable ──────────────────
const TIPO_IMOVEL_MAP = {
  "Casa":       "Casa residencial",
  "Terreno":    "Terreno/Lote urbano",
  "Comercial":  "Sala comercial",
  "Rural":      "Gleba rural",
  "Galpão":     "Sala comercial", // fallback até adicionar no Airtable
};
const ESTADO_MAP = {
  AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",
  DF:"Distrito Federal",ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",
  MT:"Mato Grosso",MS:"Mato Grosso do Sul",MG:"Minas Gerais",PA:"Pará",
  PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",RJ:"Rio de Janeiro",
  RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
  RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins",
};
// Opções válidas para Finalidades (multipleSelects) e Tipo de negócio (singleSelect)
const FINALIDADE_VALIDA = new Set(["Venda","Locação","Permuta","Parceria","Lançamento","Incorporação","Loteamento"]);

// ── Montar campos de Oportunidade para Airtable ──
function camposOportunidade(payload, parceiro) {
  const tipoMapeado   = TIPO_IMOVEL_MAP[payload.tipo] || payload.tipo;
  const estadoMapeado = ESTADO_MAP[payload.estado]    || payload.estado;

  // Finalidades: lista completa no multipleSelects; a primeira vai no singleSelect (compat)
  const finalidades = (payload.finalidade || "").split(", ").map(f => f.trim()).filter(f => FINALIDADE_VALIDA.has(f));

  const titulo = [tipoMapeado, payload.municipio, payload.estado].filter(Boolean).join(" · ");

  const campos = {
    "Título":                   titulo,
    "Tipo de imóvel":           tipoMapeado    || null,
    "Finalidades":              finalidades.length ? finalidades : null,
    "Tipo de negócio":          finalidades[0] || null,
    "CEP":                      payload.cep         || null,
    "Endereço":                 payload.endereco    || null,
    "Município":                payload.municipio   || null,
    "Estado":                   estadoMapeado  || null,
    "Área total (m²)":          payload.area          || null,
    "Área privativa (m²)":      payload.areaPrivativa || null,
    "Valor pretendido (R$)":    payload.valor       || null,
    "Comissão (%)":             payload.comissao != null ? payload.comissao / 100 : null,
    "Detalhes da comissão":     payload.detComissao || null,
    "Link de vídeo":            payload.videoLink   || null,
    "Link KMZ/KML":             payload.kmlLink     || null,
    "Observações":              payload.observacoes || null,
    "Latitude":                 payload.lat         || null,
    "Longitude":                payload.lng         || null,
    "Status":                   "Recebido",
    "Origem":                   payload.origem      || "Parceiro",
    "Token de compartilhamento": payload.token      || gerarToken(),
    "Data de entrada":          new Date().toISOString().split("T")[0],
    "E-mail do solicitante":    payload.emailParceiro || null,
    "Arquivos (JSON)":          payload.arquivos?.length ? JSON.stringify(payload.arquivos) : null,
  };

  if (parceiro) campos["Parceiro"] = [parceiro.id];

  // Remove nulls
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null));
}

// ── Enviar email via Resend ───────────────────────
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
  // EMAIL_EXISTS não é erro — usuário já foi criado antes
  if (!res.ok && data?.error?.message !== "EMAIL_EXISTS") {
    console.error("Firebase signUp error:", data?.error?.message);
  }
  return true;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

// Escapa aspas duplas em valores usados dentro de fórmulas Airtable (CRÍTICO 3)
function escFormula(s) {
  return String(s || "").replace(/\\/g,"\\\\").replace(/"/g,'\\"');
}

// Valida formato de token de compartilhamento (apenas alfanumérico minúsculo, 10-24 chars)
function validarToken(t) {
  return typeof t === "string" && /^[a-z0-9]{10,24}$/.test(t);
}

// Valida formato de record ID do Airtable (rec + 14 chars alfanuméricos)
function validarRecordId(id) {
  return typeof id === "string" && /^rec[a-zA-Z0-9]{14}$/.test(id);
}

// Gera senha temporária: "user@" + 4 dígitos aleatórios (CRÍTICO 1)
function gerarSenhaTemp() {
  const arr = new Uint8Array(2);
  crypto.getRandomValues(arr);
  const n = ((arr[0] << 8) | arr[1]) % 10000;
  return "user@" + String(n).padStart(4, "0");
}

// Faz parse do body JSON com erro controlado (MÉDIO 3)
async function parseBody(request) {
  try { return await request.json(); }
  catch { return null; }
}

// ── URLs de consulta CRECI por UF ────────────────────
const URL_CONSULTA_CRECI = "https://imobisec.com.br/busca";

// ── Webhooks Airtable ─────────────────────────────
// IDs são atualizados dinamicamente via /webhooks/recriar
// IDs hardcoded — CF Workers são stateless, mutações de módulo não persistem.
// Após /webhooks/recriar, atualizar estes valores manualmente e re-deploiar.
const WEBHOOKS = {
  parceiros:     "achi9mucKX4tCMZZz",
  oportunidades: "achCjaYV9Z3207Efo",
};

const WORKER_URL = "https://modonexo-worker.modonexo.workers.dev";

async function renovarWebhooks(env) {
  for (const id of Object.values(WEBHOOKS)) {
    await fetch(
      `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks/${id}/refresh`,
      { method: "POST", headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
    );
  }
}

async function recriarWebhooks(env) {
  const base = env.AIRTABLE_BASE;
  const headers = {
    Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
    "Content-Type": "application/json",
  };
  const secret = env.WEBHOOK_SECRET;

  const criar = async (notificationUrl, tableId, especificacao) => {
    const r = await fetch(`https://api.airtable.com/v0/bases/${base}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ notificationUrl, specification: especificacao }),
    });
    return r.json();
  };

  const wParceiros = await criar(
    `${WORKER_URL}/webhook/parceiro?secret=${secret}`,
    TBL.parceiros,
    {
      options: {
        filters: {
          fromSources: ["client", "publicApi"],
          dataTypes: ["tableData"],
          recordChangeScope: TBL.parceiros,
        },
      },
    }
  );

  const wOportunidades = await criar(
    `${WORKER_URL}/webhook/oportunidade?secret=${secret}`,
    TBL.oportunidades,
    {
      options: {
        filters: {
          fromSources: ["client", "publicApi"],
          dataTypes: ["tableData"],
          recordChangeScope: TBL.oportunidades,
        },
      },
    }
  );

  return { parceiros: wParceiros, oportunidades: wOportunidades };
}

// ── ROTEADOR ──────────────────────────────────────
export default {
  async scheduled(event, env) {
    await renovarWebhooks(env);
  },

  async fetch(request, env) {
    const reqOrigin    = request.headers.get("Origin") || "";
    const allowedOrigin = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : null;
    try {
      const res = await this._handle(request, env);
      if (!allowedOrigin) return res; // chamada server-to-server — sem override de CORS
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

  async _handle(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url      = new URL(request.url);
    const path     = url.pathname;
    const method   = request.method;

    // ── Webhooks do Airtable (sem auth — validados por secret) ──

    // Webhook: novo parceiro (tabela Parceiros)
    if (path === "/webhook/parceiro" && method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);

      await request.json(); // consumir body
      const webhookId = WEBHOOKS.parceiros;
      const payloadRes = await fetch(
        `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks/${webhookId}/payloads`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
      );
      const payloadData = await payloadRes.json();
      const changedRecords = [...new Set(payloadData?.payloads?.flatMap(p => [
        ...Object.keys(p.changedTablesById?.tblQSJNfoSTabmt3q?.createdRecordsById || {}),
        ...Object.keys(p.changedTablesById?.tblQSJNfoSTabmt3q?.changedRecordsById || {}),
      ]) || [])];

      for (const recordId of changedRecords) {
        const rec    = await airtable(env, "GET", TBL.parceiros, recordId);
        const fields = rec.fields || {};
        const status = fields["Status"];
        const email  = fields["E-Mail"] || "";

        if (status === "Ativo" && email) {
          await criarUsuarioFirebase(env, email, "Modo@2030");
        }
      }

      return corsResponse({ ok: true });
    }

    // Webhook: nova oportunidade (tabela Oportunidades)
    if (path === "/webhook/oportunidade" && method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);

      await request.json(); // consumir body
      const webhookId = WEBHOOKS.oportunidades;
      const payloadRes = await fetch(
        `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks/${webhookId}/payloads`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
      );
      const payloadData = await payloadRes.json();
      const createdRecords = [...new Set(payloadData?.payloads?.flatMap(p => [
        ...Object.keys(p.changedTablesById?.tblAPZlD7YJnhZcWF?.createdRecordsById || {}),
        ...Object.keys(p.changedTablesById?.tblAPZlD7YJnhZcWF?.changedRecordsById || {}),
      ]) || [])];

      for (const recordId of createdRecords) {
        const rec    = await airtable(env, "GET", TBL.oportunidades, recordId);
        const fields = rec.fields || {};
        const titulo        = fields["Título"] || "sem título";
        const emailParceiro = fields["E-mail do solicitante"] || "";
        const municipio     = fields["Município"] || "";
        const tipo          = fields["Tipo de imóvel"] || "";

        if (emailParceiro && !fields["Parceiro"]) {
          const parceiro = await getParceiroPorEmail(env, emailParceiro);
          if (parceiro) {
            await airtable(env, "PATCH", TBL.oportunidades, recordId, {}, {
              fields: { "Parceiro": [parceiro.id] },
            });
          }
        }

        await sendEmail(env, {
          to: "modogestaonexo@gmail.com",
          subject: `Nova oportunidade cadastrada — ${titulo}`,
          html: `<p>Nova oportunidade recebida no portal:</p>
                 <ul>
                   <li><strong>Título:</strong> ${titulo}</li>
                   <li><strong>Tipo:</strong> ${tipo}</li>
                   <li><strong>Município:</strong> ${municipio}</li>
                   <li><strong>Parceiro:</strong> ${emailParceiro}</li>
                 </ul>
                 <p>Acesse o Airtable para ver os detalhes.</p>`,
        });
      }

      return corsResponse({ ok: true });
    }

    // ── Aprovar / Rejeitar parceiro por link no email ──

    if (path === "/aprovar/parceiro" && method === "GET") {
      const secret = url.searchParams.get("secret");
      const recordId = url.searchParams.get("recordId");
      if (secret !== env.WEBHOOK_SECRET || !recordId) return errorResponse("Não autorizado", 401);

      const rec = await airtable(env, "PATCH", TBL.parceiros, recordId, {}, {
        fields: { "Status": "Ativo" },
      });
      const nome  = rec.fields?.["Nome Completo"] || "";
      const email = rec.fields?.["E-Mail"] || "";

      if (email) {
        const senhaTemp = gerarSenhaTemp();
        await criarUsuarioFirebase(env, email, senhaTemp);

        const urlPortal = `https://modonexo.com.br`;
        const primeiroNome = nome.split(" ")[0];
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
                <h2 style="color:#16a34a;margin-top:0">Olá, ${primeiroNome}! Seja bem-vindo 👋</h2>
                <p>Seu cadastro foi <strong>aprovado</strong> e você já faz parte da rede de parceiros da <strong>MODO - Planejamento e Gestão Imobiliária</strong>.</p>
                <p>Através do portal você terá acesso a oportunidades imobiliárias exclusivas, captações, compartilhamento com clientes e muito mais.</p>
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
                <p style="margin-bottom:16px;font-weight:600">Suas credenciais de acesso:</p>
                <div style="background:#f8fafc;border-radius:10px;padding:20px 24px;margin-bottom:24px;border:1px solid #e2e8f0">
                  <table style="width:100%;border-collapse:collapse">
                    <tr>
                      <td style="padding:8px 0;color:#64748b;font-size:14px;width:80px">E-mail</td>
                      <td style="padding:8px 0;font-weight:600;font-size:14px">${email}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 0;color:#64748b;font-size:14px">Senha</td>
                      <td style="padding:8px 0;font-size:18px;font-weight:700;letter-spacing:2px;color:#1a1a2e">${senhaTemp}</td>
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

      const HTML_HEADERS = {
        "Content-Type": "text/html;charset=UTF-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      };
      return new Response(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#16a34a">✅ Parceiro aprovado!</h2>
          <p><strong>${esc(nome)}</strong> agora tem acesso ao portal MODOnexo.</p>
          <p style="color:#666">Um e-mail de boas-vindas foi enviado para <strong>${esc(email)}</strong>.</p>
          <p style="color:#666">Você pode fechar esta aba.</p>
        </body></html>`, { headers: HTML_HEADERS });
    }

    if (path === "/rejeitar/parceiro" && method === "GET") {
      const secret = url.searchParams.get("secret");
      const recordId = url.searchParams.get("recordId");
      if (secret !== env.WEBHOOK_SECRET || !recordId) return errorResponse("Não autorizado", 401);

      const rec = await airtable(env, "PATCH", TBL.parceiros, recordId, {}, {
        fields: { "Status": "Suspenso" },
      });
      const nome = rec.fields?.["Nome Completo"] || "";

      return new Response(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#dc2626">❌ Parceiro rejeitado</h2>
          <p><strong>${esc(nome)}</strong> foi marcado como Suspenso.</p>
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

    // Diagnóstico / renovação manual de webhooks
    if (path === "/webhooks/listar" && method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);
      const r = await fetch(
        `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
      );
      const d = await r.json();
      return corsResponse(d);
    }

    if (path === "/webhooks/status" && method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);
      const results = [];
      for (const [nome, id] of Object.entries(WEBHOOKS)) {
        const r = await fetch(
          `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks/${id}`,
          { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
        );
        const d = await r.json();
        results.push({ nome, id, expiresAt: d.expirationTime, isEnabled: d.isHookEnabled, error: d.error });
      }
      return corsResponse({ webhooks: results });
    }

    if (path === "/webhooks/renovar" && method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);
      await renovarWebhooks(env);
      return corsResponse({ ok: true, renovadoEm: new Date().toISOString() });
    }

    if (path === "/webhooks/recriar" && method === "GET") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) return errorResponse("Não autorizado", 401);
      const resultado = await recriarWebhooks(env);
      return corsResponse(resultado);
    }

    if (path === "/webhooks/deletar" && method === "GET") {
      const secret = url.searchParams.get("secret");
      const id     = url.searchParams.get("id");
      if (secret !== env.WEBHOOK_SECRET || !id) return errorResponse("Não autorizado", 401);
      const r = await fetch(
        `https://api.airtable.com/v0/bases/${env.AIRTABLE_BASE}/webhooks/${id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
      );
      return corsResponse({ ok: r.ok, status: r.status });
    }

    // Cadastro público de parceiro
    if (path === "/parceiros/publico" && method === "POST") {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      if (!body.nome || !body.email) return errorResponse("Nome e e-mail obrigatórios");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return errorResponse("E-mail inválido");
      if (body.nome.length > 120 || body.email.length > 120) return errorResponse("Campo excede tamanho permitido");
      const uf         = (body.creciUf   || "").toUpperCase();
      const tipo       = (body.creciTipo || "").toUpperCase(); // PF ou PJ
      const creciLabel = [
        uf   ? `CRECI-${uf}` : "",
        body.creci || "",
        tipo ? `(${tipo})` : "",
      ].filter(Boolean).join(" ");
      const record = await airtable(env, "POST", TBL.parceiros, "", {}, {
        fields: {
          "Nome Completo":    body.nome,
          "E-Mail":           body.email,
          "CRECI":            creciLabel,
          "WhatsApp":         body.whatsapp || "",
          "Status":           "Pendente",
          "Data de cadastro": new Date().toISOString().split("T")[0],
        },
      });
      // Email de confirmação para o solicitante
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
              <h2 style="color:#1a1a2e;margin-top:0">Olá, ${primeiroNome}!</h2>
              <p>Recebemos seu pedido de cadastro como parceiro da <strong>MODO - Planejamento e Gestão Imobiliária</strong>.</p>
              <p>Nossa equipe irá analisar suas informações e você receberá um e-mail de confirmação em breve com as instruções de acesso ao portal.</p>
              <div style="background:#f8fafc;border-left:4px solid #1a1a2e;padding:16px 20px;border-radius:0 8px 8px 0;margin:24px 0">
                <p style="margin:0;font-size:14px;color:#475569">
                  <strong>Dados enviados:</strong><br>
                  Nome: ${body.nome}<br>
                  E-mail: ${body.email}<br>
                  CRECI: ${creciLabel || "—"}
                </p>
              </div>
              <p style="color:#64748b;font-size:14px">Se você não solicitou este cadastro, desconsidere este e-mail.</p>
              <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:32px">
                MODO - Planejamento e Gestão Imobiliária · Portal MODOnexo
              </p>
            </div>
          </div>`,
      });

      // Email direto para o admin — não depende de webhook
      const recordId   = record.id;
      const urlAprovar  = `${WORKER_URL}/aprovar/parceiro?recordId=${recordId}&secret=${env.WEBHOOK_SECRET}`;
      const urlRejeitar = `${WORKER_URL}/rejeitar/parceiro?recordId=${recordId}&secret=${env.WEBHOOK_SECRET}`;
      const urlCreci = URL_CONSULTA_CRECI;
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
                <tr><td style="padding:8px 0;color:#64748b;width:90px">Nome</td><td style="padding:8px 0;font-weight:600">${body.nome}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b">E-mail</td><td style="padding:8px 0">${body.email}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b">WhatsApp</td><td style="padding:8px 0">${body.whatsapp || "—"}</td></tr>
                <tr>
                  <td style="padding:8px 0;color:#64748b">CRECI</td>
                  <td style="padding:8px 0">
                    <strong>${creciLabel || "—"}</strong>
                    ${urlCreci ? `&nbsp;<a href="${urlCreci}" target="_blank" style="color:#2563eb;font-size:13px;text-decoration:none">🔍 Consultar no IMOBISEC</a>` : ""}
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

      return corsResponse({ id: record.id });
    }

    // Registro de lead (acesso a link público)
    if (path === "/leads/publico" && method === "POST") {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      if (!body.nome || !body.whatsapp || !body.token) return errorResponse("Dados incompletos");
      if (!validarToken(body.token)) return errorResponse("Token inválido", 400);

      // Buscar oportunidade pelo token
      const opData = await airtable(env, "GET", TBL.oportunidades, "", {
        filterByFormula: `{Token de compartilhamento} = "${escFormula(body.token)}"`,
        maxRecords: 1,
        fields: ["Título", "E-mail do solicitante", "Token de compartilhamento"],
      });
      const op = opData.records?.[0];

      // Buscar nome do parceiro
      let nomeParceiro = "";
      if (op?.fields["E-mail do solicitante"]) {
        const p = await getParceiroPorEmail(env, op.fields["E-mail do solicitante"]);
        nomeParceiro = p?.fields["Nome Completo"] || "";
      }

      await airtable(env, "POST", TBL.leads, "", {}, {
        fields: {
          "Nome":                      body.nome,
          "WhatsApp":                  body.whatsapp,
          "Token usado":               body.token,
          "Data e hora do acesso":     new Date().toISOString(),
          "Parceiro que compartilhou": nomeParceiro,
          "E-mail do parceiro":        op?.fields["E-mail do solicitante"] || "",
          "Título da oportunidade":    op?.fields["Título"] || "",
          "ID da oportunidade":        op?.id || "",
        },
      });
      return corsResponse({ ok: true });
    }

    // Oportunidade pública pelo token
    if (path.startsWith("/publico/oportunidade/") && method === "GET") {
      const token = path.split("/").pop();
      if (!validarToken(token)) return errorResponse("Token inválido", 400);
      const data  = await airtable(env, "GET", TBL.oportunidades, "", {
        filterByFormula: `{Token de compartilhamento} = "${escFormula(token)}"`,
        maxRecords: 1,
      });
      const op = data.records?.[0];
      if (!op) return errorResponse("Oportunidade não encontrada", 404);

      // Buscar dados do parceiro
      const emailParceiro = op.fields["E-mail do solicitante"];
      let parceiro = null;
      if (emailParceiro) {
        const p = await getParceiroPorEmail(env, emailParceiro);
        if (p) parceiro = { nome: p.fields["Nome Completo"], whatsapp: p.fields["WhatsApp"] };
      }

      // Allowlist de campos públicos — comissão, histórico e dados internos não são expostos (MÉDIO 8)
      const CAMPOS_PUBLICOS = new Set([
        "Título","Tipo de imóvel","Finalidades","Tipo de negócio",
        "Município","Estado","CEP","Endereço",
        "Área total (m²)","Área privativa (m²)","Valor pretendido (R$)",
        "Observações","Latitude","Longitude","Link de vídeo","Link KMZ/KML",
        "Token de compartilhamento","Arquivos (JSON)",
      ]);
      const fieldsFiltrados = Object.fromEntries(
        Object.entries(op.fields).filter(([k]) => CAMPOS_PUBLICOS.has(k))
      );
      fieldsFiltrados._parceiro = parceiro;

      const arquivosJson = op.fields["Arquivos (JSON)"];
      if (arquivosJson) {
        try {
          const todos = JSON.parse(arquivosJson);
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

    // ── Oportunidades ──────────────────────────────

    if (path === "/oportunidades" && method === "GET") {
      const params = url.searchParams;
      let formula;

      if (user.admin && params.get("todos") === "true") {
        formula = ""; // Admins veem tudo
      } else {
        // Parceiro vê só as próprias; admins sem ?todos veem tudo exceto captações internas
        formula = user.admin
          ? `NOT({Origem} = "MODO")`
          : `{E-mail do solicitante} = "${user.email}"`;
      }

      const airtableParams = {
        sort: [{ field: "Data de entrada", direction: "desc" }],
        pageSize: params.get("limit") || 100,
      };
      if (formula) airtableParams.filterByFormula = formula;

      const data = await airtable(env, "GET", TBL.oportunidades, "", airtableParams);
      return corsResponse(data);
    }

    if (path === "/oportunidades" && method === "POST") {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      const parceiro = user.admin ? null : await getParceiroPorEmail(env, user.email);
      const campos   = camposOportunidade(body, parceiro);
      const record   = await airtable(env, "POST", TBL.oportunidades, "", {}, { fields: campos });
      return corsResponse({ id: record.id });
    }

    const opMatch = path.match(/^\/oportunidades\/([^/]+)$/);
    if (opMatch) {
      const id = opMatch[1];
      if (!validarRecordId(id)) return errorResponse("ID inválido", 400);

      if (method === "GET") {
        const data = await airtable(env, "GET", TBL.oportunidades, id);
        // Verificar acesso: parceiro só pode ver a própria
        if (!user.admin && data.fields["E-mail do solicitante"] !== user.email) {
          return errorResponse("Acesso negado", 403);
        }
        // Desserializar arquivos Cloudinary
        const arquivosJson = data.fields["Arquivos (JSON)"];
        if (arquivosJson) {
          try {
            const todos = JSON.parse(arquivosJson);
            data.fields._imagens    = todos.filter(a => a.tipo === "imagem").map(a => a.url);
            data.fields._documentos = todos.filter(a => a.tipo === "documento");
          } catch { /* JSON inválido — ignora */ }
        }
        return corsResponse(data);
      }

      if (method === "PATCH") {
        const body = await parseBody(request);
        if (!body) return errorResponse("Corpo da requisição inválido", 400);

        // GET único — reaproveitado tanto para verificação de acesso quanto para o log de auditoria (ALTO 5)
        const atual = await airtable(env, "GET", TBL.oportunidades, id);
        if (!user.admin) {
          if ((atual.fields["E-mail do solicitante"] || "").toLowerCase() !== user.email.toLowerCase()) {
            return errorResponse("Acesso negado", 403);
          }
          delete body.status;
          delete body.motivo;
        }

        const campos = {};
        // Atualização de status (pipeline — admin only, já filtrado acima)
        if (body.status) campos["Status"]                   = body.status;
        if (body.motivo) campos["Motivo (status negativo)"] = body.motivo;

        // Edição completa (formulário)
        const ehEdicaoCompleta = body.tipo || body.municipio || body.area != null || body.valor != null;
        if (ehEdicaoCompleta) {
          const finalidades = (body.finalidade || "").split(", ").map(f => f.trim()).filter(f => FINALIDADE_VALIDA.has(f));
          const tipoMapeado   = TIPO_IMOVEL_MAP[body.tipo]  || body.tipo   || null;
          const estadoMapeado = ESTADO_MAP[body.estado]     || body.estado || null;
          const titulo = [tipoMapeado, body.municipio, body.estado].filter(Boolean).join(" · ");
          if (titulo)                     campos["Título"]                = titulo;
          if (tipoMapeado)                campos["Tipo de imóvel"]        = tipoMapeado;
          if (finalidades.length)       { campos["Finalidades"]          = finalidades;
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
          if (body.videoLink)             campos["Link de vídeo"]         = body.videoLink;
          if (body.kmlLink)               campos["Link KMZ/KML"]         = body.kmlLink;
          if (body.lat != null)           campos["Latitude"]             = body.lat;
          if (body.lng != null)           campos["Longitude"]            = body.lng;
          campos["Observações"] = body.observacoes || "";
        }
        if (body.arquivos) campos["Arquivos (JSON)"] = JSON.stringify(body.arquivos);

        // ── Log de auditoria — usa o `atual` já obtido acima (sem segundo GET) ──
        if (ehEdicaoCompleta || body.status || body.arquivos) {
          const LABELS = {
            "Título": "Título", "Tipo de imóvel": "Tipo de imóvel",
            "Finalidades": "Finalidade", "Tipo de negócio": "Finalidade (principal)", "Área total (m²)": "Área total",
            "Área privativa (m²)": "Área privativa", "Valor pretendido (R$)": "Valor pretendido",
            "CEP": "CEP", "Endereço": "Endereço", "Município": "Município",
            "Estado": "Estado", "Observações": "Observações",
            "Link de vídeo": "Vídeo", "Link KMZ/KML": "KMZ/KML",
            "Status": "Status", "Arquivos (JSON)": "Arquivos",
          };
          const alteracoes = [];
          for (const [campo, novoValor] of Object.entries(campos)) {
            const label    = LABELS[campo] || campo;
            const anterior = atual.fields[campo];
            const anteriorStr = campo === "Arquivos (JSON)"
              ? (anterior ? `${JSON.parse(anterior).length} arquivo(s)` : "nenhum")
              : (anterior != null ? String(anterior) : "—");
            const novoStr = campo === "Arquivos (JSON)"
              ? `${JSON.parse(novoValor).length} arquivo(s)`
              : String(novoValor);
            if (anteriorStr !== novoStr) {
              alteracoes.push({ campo: label, de: anteriorStr, para: novoStr });
            }
          }
          if (alteracoes.length) {
            const entrada = {
              data:      new Date().toISOString(),
              email:     user.email,
              nome:      user.email,
              admin:     user.admin || false,
              alteracoes,
            };
            const historicoAtual = atual.fields["Histórico (JSON)"] || "[]";
            let historico = [];
            try { historico = JSON.parse(historicoAtual); } catch {}
            historico.push(entrada);
            campos["Histórico (JSON)"] = JSON.stringify(historico);
          }
        }

        const data = await airtable(env, "PATCH", TBL.oportunidades, id, {}, { fields: campos });
        return corsResponse(data);
      }

      if (method === "DELETE") {
        if (!user.admin) {
          const atual = await airtable(env, "GET", TBL.oportunidades, id);
          if ((atual.fields["E-mail do solicitante"] || "").toLowerCase() !== user.email.toLowerCase()) {
            return errorResponse("Acesso negado", 403);
          }
        }
        await airtable(env, "DELETE", TBL.oportunidades, id, {});
        return corsResponse({ message: "Oportunidade deletada" });
      }
    }

    // Gerar token de compartilhamento
    const compartilharMatch = path.match(/^\/oportunidades\/([^/]+)\/compartilhar$/);
    if (compartilharMatch && method === "POST") {
      const id    = compartilharMatch[1];
      const token = gerarToken();
      await airtable(env, "PATCH", TBL.oportunidades, id, {}, {
        fields: { "Token de compartilhamento": token },
      });
      return corsResponse({ token });
    }

    // ── Parceiros ──────────────────────────────────

    if (path === "/parceiros" && method === "GET") {
      if (!user.admin) return errorResponse("Acesso negado", 403);
      const data = await airtable(env, "GET", TBL.parceiros, "", {
        sort: [{ field: "Data de cadastro", direction: "desc" }],
      });
      return corsResponse(data);
    }

    const parceiroMatch = path.match(/^\/parceiros\/([^/]+)$/);
    if (parceiroMatch && method === "PATCH" && user.admin) {
      const id     = parceiroMatch[1];
      if (!validarRecordId(id)) return errorResponse("ID inválido", 400);
      const body   = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      const campos = {};
      if (body.status) campos["Status"] = body.status;
      const data = await airtable(env, "PATCH", TBL.parceiros, id, {}, { fields: campos });
      return corsResponse(data);
    }

    // ── Avisos ─────────────────────────────────────

    if (path === "/avisos" && method === "GET") {
      const data = await airtable(env, "GET", TBL.mensagens, "", {
        sort: [{ field: "Data e hora", direction: "desc" }],
        filterByFormula: `{De} = "MODO"`,
      });
      return corsResponse(data);
    }

    if (path === "/avisos" && method === "POST" && user.admin) {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      const data = await airtable(env, "POST", TBL.mensagens, "", {}, {
        fields: {
          "Mensagem":   body.mensagem,
          "De":         "MODO",
          "Data e hora": new Date().toISOString(),
        },
      });
      return corsResponse(data);
    }

    // ── Demandas ───────────────────────────────────

    if (path === "/demandas" && method === "GET") {
      const formula = user.admin ? "" : `{Visível para parceiros} = 1`;
      const params  = { sort: [{ field: "Data de publicação", direction: "desc" }] };
      if (formula) params.filterByFormula = formula;
      const data = await airtable(env, "GET", TBL.demandas, "", params);
      return corsResponse(data);
    }

    if (path === "/demandas" && method === "POST" && user.admin) {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      const data = await airtable(env, "POST", TBL.demandas, "", {}, {
        fields: {
          "Título":                 body.titulo,
          "Tipo de imóvel":         body.tipo || null,
          "Localização desejada":   body.local || null,
          "Área mínima (m²)":       body.areaMin || null,
          "Área máxima (m²)":       body.areaMax || null,
          "Valor máximo (R$)":      body.valor || null,
          "Descrição":              body.descricao || null,
          "Visível para parceiros": body.visivel ?? false,
          "Data de publicação":     new Date().toISOString().split("T")[0],
        },
      });
      return corsResponse(data);
    }

    const demandaMatch = path.match(/^\/demandas\/([^/]+)$/);
    if (demandaMatch && method === "PATCH" && user.admin) {
      const id   = demandaMatch[1];
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
      const data = await airtable(env, "PATCH", TBL.demandas, id, {}, { fields: campos });
      return corsResponse(data);
    }

    // ── Leads ──────────────────────────────────────

    if (path === "/leads" && method === "GET") {
      const opId = url.searchParams.get("opId");
      if (user.admin) {
        // Admin: todos os leads, ou filtrado por oportunidade
        const params = { sort: [{ field: "Data e hora do acesso", direction: "desc" }] };
        if (opId) params.filterByFormula = `{ID da oportunidade} = "${opId}"`;
        const data = await airtable(env, "GET", TBL.leads, "", params);
        return corsResponse(data);
      } else {
        // Parceiro: só leads de suas próprias oportunidades
        if (!opId) return errorResponse("opId obrigatório", 400);
        // Verifica que a oportunidade pertence a este parceiro
        const op = await airtable(env, "GET", TBL.oportunidades, opId);
        const emailOp = op.fields?.["E-mail do solicitante"] || "";
        if (emailOp.toLowerCase() !== user.email.toLowerCase()) return errorResponse("Acesso negado", 403);
        const data = await airtable(env, "GET", TBL.leads, "", {
          filterByFormula: `{ID da oportunidade} = "${opId}"`,
          sort: [{ field: "Data e hora do acesso", direction: "desc" }],
        });
        return corsResponse(data);
      }
    }

    // ── Chat por oportunidade ──────────────────────
    if (path === "/mensagens" && method === "GET") {
      const opId = url.searchParams.get("opId");
      if (!opId) return errorResponse("opId obrigatório", 400);
      let op;
      try { op = await verificarAcessoOportunidade(env, user, opId); }
      catch (e) { return errorResponse(e.message, e.status || 400); }
      const msgIds = op.fields?.["Mensagens"] || [];
      if (!msgIds.length) return corsResponse({ records: [] });
      const formula = "OR(" + msgIds.map(id => `RECORD_ID()='${id}'`).join(",") + ")";
      const data = await airtable(env, "GET", TBL.mensagens, "", {
        filterByFormula: formula,
        sort: [{ field: "Data e hora", direction: "asc" }],
      });
      return corsResponse(data);
    }

    if (path === "/mensagens" && method === "POST") {
      const body = await parseBody(request);
      if (!body) return errorResponse("Corpo da requisição inválido", 400);
      if (!body.opId || !body.texto?.trim()) return errorResponse("Dados incompletos");
      if (body.texto.length > 4000) return errorResponse("Mensagem muito longa (máx 4000 chars)");
      let op;
      try { op = await verificarAcessoOportunidade(env, user, body.opId); }
      catch (e) { return errorResponse(e.message, e.status || 400); }

      // Parceiro suspenso/inativo não pode enviar mensagens (MÉDIO 6)
      if (!user.admin) {
        const parceiro = await getParceiroPorEmail(env, user.email);
        if (!parceiro || parceiro.fields["Status"] !== "Ativo") {
          return errorResponse("Conta suspensa ou inativa", 403);
        }
      }
      await airtable(env, "POST", TBL.mensagens, "", {}, {
        fields: {
          "Mensagem":     body.texto.trim(),
          "Oportunidade": [body.opId],
          "De":           user.admin ? "Admin" : "Parceiro",
          "Data e hora":  new Date().toISOString(),
          "Lida":         false,
        },
      });

      // Notificar a outra parte por e-mail (no máximo 1 a cada 3h por conversa, anti-spam)
      const titulo = op.fields["Título"] || "oportunidade";
      const texto  = esc(body.texto.trim());
      const rodapeAntiSpam = `<p style="color:#94a3b8;font-size:12px;margin-top:20px;line-height:1.5">📬 Para manter sua caixa de entrada organizada, o Portal MODOnexo envia no máximo <strong>uma notificação a cada 3 horas</strong> por conversa — independente da quantidade de mensagens recebidas no período. Para acompanhar a conversa em tempo real, acesse o portal diretamente.</p>`;

      const senderDe = user.admin ? "Admin" : "Parceiro";
      const msgIdsAnteriores = op.fields["Mensagens"] || [];
      let deveEnviarEmail = true;
      if (msgIdsAnteriores.length > 0) {
        const tresHorasAtras = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        const formula = `AND(OR(${msgIdsAnteriores.map(i => `RECORD_ID()='${escFormula(i)}'`).join(",")}),{De}="${escFormula(senderDe)}",IS_AFTER({Data e hora},"${tresHorasAtras}"))`;
        const recentes = await airtable(env, "GET", TBL.mensagens, "", {
          filterByFormula: formula,
          fields: ["Data e hora"],
          maxRecords: 1,
        });
        if (recentes.records?.length > 0) deveEnviarEmail = false;
      }

      if (deveEnviarEmail) {
        if (user.admin) {
          const emailParceiro = op.fields["E-mail do solicitante"] || "";
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

    // Marcar mensagens como lidas (batch PATCH)
    if (path === "/mensagens/ler" && method === "POST") {
      const body = await parseBody(request);
      if (!body || !body.opId) return errorResponse("opId obrigatório");
      let op;
      try { op = await verificarAcessoOportunidade(env, user, body.opId); }
      catch (e) { return errorResponse(e.message, e.status || 400); }
      const msgIds = op.fields?.["Mensagens"] || [];
      if (!msgIds.length) return corsResponse({ ok: true, lidas: 0 });
      const outroDe = user.admin ? "Parceiro" : "Admin";
      const formula = `AND(OR(${msgIds.map(i => `RECORD_ID()='${escFormula(i)}'`).join(",")}),{De}="${escFormula(outroDe)}",{Lida}=FALSE())`;
      const data = await airtable(env, "GET", TBL.mensagens, "", { filterByFormula: formula, fields: ["Mensagem"] });
      const unread = data.records || [];
      for (let i = 0; i < unread.length; i += 10) {
        const batch = unread.slice(i, i + 10).map(r => ({ id: r.id, fields: { "Lida": true } }));
        await airtable(env, "PATCH", TBL.mensagens, "", {}, { records: batch });
      }
      return corsResponse({ ok: true, lidas: unread.length });
    }

    // Contar mensagens não-lidas do usuário
    if (path === "/mensagens/nao-lidas" && method === "GET") {
      const outroDe = user.admin ? "Parceiro" : "Admin";
      let formula;
      if (user.admin) {
        formula = `AND({De}="${outroDe}",{Lida}=FALSE())`;
      } else {
        // Busca opIds do parceiro para filtrar
        const opsData = await airtable(env, "GET", TBL.oportunidades, "", {
          filterByFormula: `{E-mail do solicitante}="${user.email}"`,
          fields: ["Mensagens"],
        });
        const allMsgIds = (opsData.records || []).flatMap(r => r.fields["Mensagens"] || []);
        if (!allMsgIds.length) return corsResponse({ count: 0, porOportunidade: {} });
        formula = `AND(OR(${allMsgIds.map(i => `RECORD_ID()='${escFormula(i)}'`).join(",")}),{De}="${escFormula(outroDe)}",{Lida}=FALSE())`;
      }
      const data = await airtable(env, "GET", TBL.mensagens, "", {
        filterByFormula: formula,
        fields: ["Oportunidade"],
      });
      const msgs = data.records || [];
      const porOp = {};
      for (const m of msgs) {
        const opId = m.fields["Oportunidade"]?.[0];
        if (opId) porOp[opId] = (porOp[opId] || 0) + 1;
      }
      return corsResponse({ count: msgs.length, porOportunidade: porOp });
    }

    return errorResponse("Rota não encontrada", 404);
  },
};
