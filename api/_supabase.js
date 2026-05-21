const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Accept,Authorization");
  res.setHeader("Cache-Control", "no-store");
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

function supabaseEndpoint(path) {
  return `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
}

async function supabaseFetch(path, options = {}) {
  requireSupabase();

  const response = await fetch(supabaseEndpoint(path), {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
  requireSupabase
};
