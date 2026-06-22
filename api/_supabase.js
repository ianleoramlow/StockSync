const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const crypto = require("crypto");

function mesmaOrigem(origin, host) {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch (error) {
    return false;
  }
}

function origemCors(req) {
  const configuradas = String(process.env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req?.headers?.origin || "";

  if (configuradas.length) {
    return configuradas.includes(origin) ? origin : configuradas[0];
  }

  if (mesmaOrigem(origin, req?.headers?.host)) return origin;
  if (req?.headers?.host) return `https://${req.headers.host}`;
  return "*";
}

function cors(reqOrRes, maybeRes) {
  const req = maybeRes ? reqOrRes : null;
  const res = maybeRes || reqOrRes;
  if (res.__stocksyncCorsApplied) return;

  res.setHeader("Access-Control-Allow-Origin", origemCors(req));
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept,Authorization,X-StockSync-Client,X-StockSync-Admin-Token");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.__stocksyncCorsApplied = true;
}

function json(res, status, payload) {
  cors(res);
  res.status(status).json(payload);
}

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_ENV_MISSING");
  }
}

function chaveValida(chave) {
  return /^ge_(empresas|solicitacoes_funcionarios|dados_[a-z0-9_-]+)$/i.test(chave);
}

function tokenSeguro(recebido, esperado) {
  if (!recebido || !esperado) return false;
  const recebidoBuffer = Buffer.from(String(recebido));
  const esperadoBuffer = Buffer.from(String(esperado));
  return recebidoBuffer.length === esperadoBuffer.length
    && crypto.timingSafeEqual(recebidoBuffer, esperadoBuffer);
}

function tokenRequisicao(req) {
  const authorization = req.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  return req.headers["x-stocksync-admin-token"] || bearer;
}

function requireAdminRequest(req, res) {
  const token = process.env.STOCKSYNC_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";
  if (!token) {
    json(res, 403, { ok: false, erro: "Rotina administrativa desativada." });
    return false;
  }

  if (!tokenSeguro(tokenRequisicao(req), token)) {
    json(res, 401, { ok: false, erro: "Acesso administrativo não autorizado." });
    return false;
  }

  return true;
}

function requireAppRequest(req, res) {
  if (req.headers["x-stocksync-client"] === "stocksync-web" || tokenSeguro(tokenRequisicao(req), process.env.STOCKSYNC_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "")) {
    return true;
  }

  json(res, 403, { ok: false, erro: "Acesso direto bloqueado." });
  return false;
}

function supabaseEndpoint(path) {
  return `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
}

async function supabaseFetch(path, options = {}) {
  requireSupabase();
  const usaChaveNova = SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_");
  const authHeaders = usaChaveNova
    ? { apikey: SUPABASE_SERVICE_ROLE_KEY }
    : {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      };

  const response = await fetch(supabaseEndpoint(path), {
    ...options,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message || body?.hint || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function getStorageValue(key) {
  const rows = await supabaseFetch(`app_storage?key=eq.${encodeURIComponent(key)}&select=key,value&limit=1`, {
    method: "GET"
  });
  return rows?.[0] || null;
}

async function setStorageValue(key, value) {
  const rows = await supabaseFetch("app_storage?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      key,
      value,
      updated_at: new Date().toISOString()
    })
  });
  return rows?.[0] || null;
}

async function exportStorage() {
  const rows = await supabaseFetch("app_storage?select=key,value,updated_at&order=key.asc", { method: "GET" });
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

module.exports = {
  cors,
  json,
  chaveValida,
  getStorageValue,
  setStorageValue,
  exportStorage,
  supabaseFetch,
  requireSupabase,
  requireAdminRequest,
  requireAppRequest
};
