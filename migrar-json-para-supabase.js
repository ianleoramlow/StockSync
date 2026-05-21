const fs = require("fs");
const path = require("path");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbPath = process.argv[2] || path.join(__dirname, "..", "data", "stocksync-db.json");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de migrar.");
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Banco JSON nao encontrado em: ${dbPath}`);
  process.exit(1);
}

function endpoint(pathname) {
  return `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${pathname}`;
}

async function salvar(key, value) {
  const usaChaveNova = serviceRoleKey.startsWith("sb_");
  const authHeaders = usaChaveNova
    ? { apikey: serviceRoleKey }
    : {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      };

  const response = await fetch(endpoint("app_storage?on_conflict=key"), {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${key}: ${response.status} ${text}`);
  }
}

(async () => {
  const banco = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const storage = banco.storage || {};
  const keys = Object.keys(storage);

  for (const key of keys) {
    await salvar(key, storage[key]);
    console.log(`Migrado: ${key}`);
  }

  console.log(`Migração concluída. ${keys.length} chave(s) enviadas para o Supabase.`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
