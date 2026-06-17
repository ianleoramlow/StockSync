const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 5500);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.STOCKSYNC_DATA_DIR || path.join(root, "data");
const dbPath = process.env.STOCKSYNC_DB || path.join(dataDir, "stocksync-db.json");
const maxBodyBytes = 50 * 1024 * 1024;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function garantirBanco() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    salvarBanco({
      meta: {
        app: "StockSync",
        criadoEm: new Date().toISOString(),
        versao: 1
      },
      storage: {}
    });
  }
}

function lerBanco() {
  garantirBanco();
  try {
    const texto = fs.readFileSync(dbPath, "utf8");
    const banco = JSON.parse(texto || "{}");
    if (!banco.storage || typeof banco.storage !== "object") banco.storage = {};
    return banco;
  } catch (error) {
    const backup = `${dbPath}.${Date.now()}.corrompido`;
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backup);
    const banco = {
      meta: {
        app: "StockSync",
        criadoEm: new Date().toISOString(),
        recuperadoEm: new Date().toISOString(),
        backupCorrompido: path.basename(backup),
        versao: 1
      },
      storage: {}
    };
    salvarBanco(banco);
    return banco;
  }
}

function salvarBanco(banco) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const temporario = `${dbPath}.tmp`;
  banco.meta = {
    ...(banco.meta || {}),
    atualizadoEm: new Date().toISOString()
  };
  fs.writeFileSync(temporario, JSON.stringify(banco, null, 2), "utf8");
  fs.renameSync(temporario, dbPath);
}

function responderJSON(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept"
  });
  res.end(JSON.stringify(payload));
}

function supabaseConfigurado() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function supabaseEndpoint(pathname) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${pathname}`;
}

async function supabaseFetch(pathname, options = {}) {
  const usaChaveNova = supabaseServiceRoleKey.startsWith("sb_");
  const authHeaders = usaChaveNova
    ? { apikey: supabaseServiceRoleKey }
    : {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`
      };

  const response = await fetch(supabaseEndpoint(pathname), {
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
    const error = new Error(body?.message || response.statusText);
    error.status = response.status;
    throw error;
  }

  return body;
}

async function lerStorage(chave) {
  if (supabaseConfigurado()) {
    const rows = await supabaseFetch(`app_storage?key=eq.${encodeURIComponent(chave)}&select=key,value&limit=1`, { method: "GET" });
    return rows?.[0] ? { exists: true, value: rows[0].value } : { exists: false, value: null };
  }

  const banco = lerBanco();
  const exists = Object.prototype.hasOwnProperty.call(banco.storage, chave);
  return { exists, value: exists ? banco.storage[chave] : null };
}

async function salvarStorage(chave, value) {
  if (supabaseConfigurado()) {
    await supabaseFetch("app_storage?on_conflict=key", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key: chave, value, updated_at: new Date().toISOString() })
    });
    return;
  }

  const banco = lerBanco();
  banco.storage[chave] = value;
  salvarBanco(banco);
}

async function exportarStorage() {
  if (supabaseConfigurado()) {
    const rows = await supabaseFetch("app_storage?select=key,value&order=key.asc", { method: "GET" });
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  }

  return lerBanco().storage;
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });

    req.on("end", () => {
      const texto = Buffer.concat(partes).toString("utf8");
      if (!texto) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(texto));
      } catch (error) {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

function chaveValida(chave) {
  return /^ge_(empresas|solicitacoes_funcionarios|dados_[a-z0-9_-]+)$/i.test(chave);
}

async function tratarAPI(req, res, url) {
  if (req.method === "OPTIONS") {
    responderJSON(res, 204, {});
    return true;
  }

  if (url.pathname === "/api/health") {
    const storage = supabaseConfigurado() ? await exportarStorage() : lerBanco().storage;
    responderJSON(res, 200, {
      ok: true,
      app: "StockSync",
      database: supabaseConfigurado() ? "supabase-postgres" : "json-local",
      storageKeys: Object.keys(storage).length,
      databaseId: crypto.createHash("sha1").update(supabaseConfigurado() ? supabaseUrl : dbPath).digest("hex").slice(0, 8)
    });
    return true;
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    responderJSON(res, 200, {
      meta: { app: "StockSync", exportedAt: new Date().toISOString(), database: supabaseConfigurado() ? "supabase-postgres" : "json-local" },
      storage: await exportarStorage()
    });
    return true;
  }

  if (url.pathname === "/api/import" && req.method === "POST") {
    try {
      const corpo = await lerCorpo(req);
      if (!corpo || typeof corpo.storage !== "object") {
        responderJSON(res, 400, { ok: false, erro: "Arquivo de banco inválido." });
        return true;
      }
      const keys = Object.keys(corpo.storage).filter(chaveValida);
      for (const chave of keys) {
        await salvarStorage(chave, corpo.storage[chave]);
      }
      responderJSON(res, 200, { ok: true, imported: keys.length });
    } catch (error) {
      responderJSON(res, 400, { ok: false, erro: "Não foi possível importar o banco." });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/storage/")) {
    const chave = decodeURIComponent(url.pathname.replace("/api/storage/", ""));
    if (!chaveValida(chave)) {
      responderJSON(res, 400, { ok: false, erro: "Chave de banco inválida." });
      return true;
    }

    if (req.method === "GET") {
      const item = await lerStorage(chave);
      responderJSON(res, 200, { ok: true, exists: item.exists, value: item.value });
      return true;
    }

    if (req.method === "PUT" || req.method === "POST") {
      try {
        const corpo = await lerCorpo(req);
        await salvarStorage(chave, corpo.value);
        responderJSON(res, 200, { ok: true });
      } catch (error) {
        responderJSON(res, error.message === "BODY_TOO_LARGE" ? 413 : 400, { ok: false, erro: "Não foi possível salvar no banco." });
      }
      return true;
    }
  }

  return false;
}

function servirArquivo(res, pathname) {
  const file = path.normalize(path.join(root, pathname));

  if (!file.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo nao encontrado");
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);

  try {
    if (await tratarAPI(req, res, url)) return;
  } catch (error) {
    responderJSON(res, 500, { ok: false, erro: "Erro interno do servidor." });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/01-login.html";
  servirArquivo(res, pathname);
}).listen(port, host, () => {
  garantirBanco();
  const localUrl = `http://localhost:${port}/01-login.html`;
  console.log(`StockSync rodando em ${localUrl}`);
  console.log(`Banco de dados: ${dbPath}`);
});
