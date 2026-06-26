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
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
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
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users?.[0];
  if (!user) return null;
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
    filterByFormula: `{E-Mail} = "${email}"`,
    maxRecords: 1,
  });
  return data.records?.[0] || null;
}

// ── Gerar token único ─────────────────────────────
function gerarToken() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(36)).join("").slice(0, 16);
}

// ── Montar campos de Oportunidade para Airtable ──
function camposOportunidade(payload, parceiro) {
  const titulo = [
    payload.tipo,
    payload.municipio,
    payload.estado,
  ].filter(Boolean).join(" · ");

  const campos = {
    "Título":                   titulo,
    "Tipo de imóvel":           payload.tipo        || null,
    "Tipo de negócio":          payload.finalidade  || null,
    "CEP":                      payload.cep         || null,
    "Endereço":                 payload.endereco    || null,
    "Município":                payload.municipio   || null,
    "Estado":                   payload.estado      || null,
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
  };

  if (parceiro) campos["Parceiro"] = [parceiro.id];

  // Remove nulls
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null));
}

// ── Enviar email via Resend ───────────────────────
async function sendEmail(env, { to, subject, html }) {
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
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
  }
}

// ── Criar usuário no Firebase ─────────────────────
async function criarUsuarioFirebase(env, email, senha) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: senha, returnSecureToken: false }),
    }
  );
  return res.ok;
}

// ── Renovar webhooks Airtable ─────────────────────
const WEBHOOKS = [
  "ach7DkgzzJEvs2gxa", // parceiros
  "achAVwGhSXSiDTUhJ", // oportunidades
];

async function renovarWebhooks(env) {
  for (const id of WEBHOOKS) {
    await fetch(
      `https://api.airtable.com/v0/bases/appt6mRYfyo5Aq6Db/webhooks/${id}/refresh`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
      }
    );
  }
}

// ── ROTEADOR ──────────────────────────────────────
export default {
  async scheduled(event, env) {
    await renovarWebhooks(env);
  },

  async fetch(request, env) {
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
      const webhookId = "ach7DkgzzJEvs2gxa";
      const payloadRes = await fetch(
        `https://api.airtable.com/v0/bases/appt6mRYfyo5Aq6Db/webhooks/${webhookId}/payloads`,
        { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }
      );
      const payloadData = await payloadRes.json();
      const changedRecords = [...new Set(payloadData?.payloads?.flatMap(p =>
        Object.keys(p.changedTablesById?.tblQSJNfoSTabmt3q?.changedRecordsById || {})
      ) || [])];

      for (const recordId of changedRecords) {
        const rec    = await airtable(env, "GET", TBL.parceiros, recordId);
        const fields = rec.fields || {};
        const status = fields["Status"];
        const nome   = fields["Nome Completo"] || "";
        const email  = fields["E-Mail"] || "";
        const creci  = fields["CRECI"] || "";

        if (status === "Pendente") {
          const urlAprovar = `https://modonexo-worker.modonexo.workers.dev/aprovar/parceiro?recordId=${recordId}&secret=${env.WEBHOOK_SECRET}`;
          const urlRejeitar = `https://modonexo-worker.modonexo.workers.dev/rejeitar/parceiro?recordId=${recordId}&secret=${env.WEBHOOK_SECRET}`;
          await sendEmail(env, {
            to: "modogestaonexo@gmail.com",
            subject: "Novo parceiro aguardando aprovação — Portal MODO",
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                <h2 style="color:#1a1a2e">Novo parceiro cadastrado</h2>
                <ul>
                  <li><strong>Nome:</strong> ${nome}</li>
                  <li><strong>E-mail:</strong> ${email}</li>
                  <li><strong>CRECI:</strong> ${creci}</li>
                </ul>
                <div style="margin-top:24px;display:flex;gap:12px">
                  <a href="${urlAprovar}" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">✅ Aprovar</a>
                  &nbsp;&nbsp;
                  <a href="${urlRejeitar}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">❌ Rejeitar</a>
                </div>
              </div>`,
          });
        }

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
      const webhookId = "achAVwGhSXSiDTUhJ";
      const payloadRes = await fetch(
        `https://api.airtable.com/v0/bases/appt6mRYfyo5Aq6Db/webhooks/${webhookId}/payloads`,
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

      if (email) await criarUsuarioFirebase(env, email, "Modo@2030");

      return new Response(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2 style="color:#16a34a">✅ Parceiro aprovado!</h2>
          <p><strong>${nome}</strong> agora tem acesso ao portal MODOnexo.</p>
          <p style="color:#666">Você pode fechar esta aba.</p>
        </body></html>`, {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
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
          <p><strong>${nome}</strong> foi marcado como Suspenso.</p>
          <p style="color:#666">Você pode fechar esta aba.</p>
        </body></html>`, {
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }

    // ── Rotas públicas (sem auth) ──────────────────

    // Cadastro público de parceiro
    if (path === "/parceiros/publico" && method === "POST") {
      const body = await request.json();
      if (!body.nome || !body.email) return errorResponse("Nome e e-mail obrigatórios");
      const record = await airtable(env, "POST", TBL.parceiros, "", {}, {
        fields: {
          "Nome Completo":    body.nome,
          "E-Mail":           body.email,
          "CRECI":            body.creci || "",
          "WhatsApp":         body.whatsapp || "",
          "Status":           "Pendente",
          "Data de cadastro": new Date().toISOString().split("T")[0],
        },
      });
      return corsResponse({ id: record.id });
    }

    // Registro de lead (acesso a link público)
    if (path === "/leads/publico" && method === "POST") {
      const body = await request.json();
      if (!body.nome || !body.whatsapp || !body.token) return errorResponse("Dados incompletos");

      // Buscar oportunidade pelo token
      const opData = await airtable(env, "GET", TBL.oportunidades, "", {
        filterByFormula: `{Token de compartilhamento} = "${body.token}"`,
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
      const data  = await airtable(env, "GET", TBL.oportunidades, "", {
        filterByFormula: `{Token de compartilhamento} = "${token}"`,
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

      // Oportunidades internas da MODO não têm link público
      if (op.fields["Origem"] === "MODO") return errorResponse("Link não disponível", 403);

      // Buscar arquivos da tabela Documentos
      const arquivos = { imagens: [], documentos: [] };
      if (op.fields["Documentos"]?.length) {
        const docsData = await airtable(env, "GET", TBL.documentos, "", {
          filterByFormula: `RECORD_ID() = "${op.fields["Documentos"][0]}"`,
          fields: ["Categoria", "Arquivo"],
        });
        // Simplificação: apenas retornar URLs se disponíveis
      }

      return corsResponse({
        id: op.id,
        fields: {
          ...op.fields,
          _parceiro: parceiro,
        },
      });
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
      const body     = await request.json();
      const parceiro = user.admin ? null : await getParceiroPorEmail(env, user.email);
      const campos   = camposOportunidade(body, parceiro);
      const record   = await airtable(env, "POST", TBL.oportunidades, "", {}, { fields: campos });
      return corsResponse({ id: record.id });
    }

    const opMatch = path.match(/^\/oportunidades\/([^/]+)$/);
    if (opMatch) {
      const id = opMatch[1];

      if (method === "GET") {
        const data = await airtable(env, "GET", TBL.oportunidades, id);
        // Verificar acesso: parceiro só pode ver a própria
        if (!user.admin && data.fields["E-mail do solicitante"] !== user.email) {
          return errorResponse("Acesso negado", 403);
        }
        return corsResponse(data);
      }

      if (method === "PATCH" && user.admin) {
        const body   = await request.json();
        const campos = {};
        if (body.status) campos["Status"]               = body.status;
        if (body.motivo) campos["Motivo (status negativo)"] = body.motivo;
        const data = await airtable(env, "PATCH", TBL.oportunidades, id, {}, { fields: campos });
        return corsResponse(data);
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
      const body   = await request.json();
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
      const body = await request.json();
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
      const body = await request.json();
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
      const body = await request.json();
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
      if (!user.admin) return errorResponse("Acesso negado", 403);
      const data = await airtable(env, "GET", TBL.leads, "", {
        sort: [{ field: "Data e hora do acesso", direction: "desc" }],
      });
      return corsResponse(data);
    }

    if (path === "/mensagem/parceiro" && method === "POST") {
      if (!user.admin) return errorResponse("Acesso negado", 403);
      const { emailParceiro, nomeParceiro, tituloOp, mensagem } = await req.json();
      if (!emailParceiro || !mensagem) return errorResponse("Dados incompletos");
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "MODO Nexo <noreply@modonexo.com.br>",
          to: emailParceiro,
          subject: `📩 Mensagem sobre: ${tituloOp}`,
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#1e3a5f;padding:20px 24px;border-radius:8px 8px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">📩 Mensagem da equipe MODO</h2>
              </div>
              <div style="background:#f8f9fa;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
                <p style="margin-bottom:8px">Olá, <strong>${nomeParceiro}</strong>!</p>
                <p style="margin-bottom:16px">Recebemos uma mensagem sobre a oportunidade <strong>${tituloOp}</strong>:</p>
                <div style="background:#fff;border-left:4px solid #1e3a5f;padding:14px 18px;border-radius:4px;font-size:15px;line-height:1.6;color:#333">
                  ${mensagem.replace(/\n/g, "<br>")}
                </div>
                <p style="margin-top:20px;color:#666;font-size:13px">
                  Caso tenha dúvidas, responda este e-mail ou acesse o portal.
                </p>
              </div>
            </div>`,
        }),
      });
      if (!emailRes.ok) {
        const err = await emailRes.text();
        return errorResponse("Erro ao enviar e-mail: " + err, 500);
      }
      return corsResponse({ ok: true });
    }

    return errorResponse("Rota não encontrada", 404);
  },
};
