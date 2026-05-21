const { cors, json, requireSupabase, supabaseFetch } = require("./_supabase");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    requireSupabase();
    const rows = await supabaseFetch("app_storage?select=key&limit=1", { method: "GET" });
    json(res, 200, {
      ok: true,
      app: "StockSync",
      database: "supabase-postgres",
      storageReachable: Array.isArray(rows)
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      app: "StockSync",
      database: "supabase-postgres",
      erro: error.message === "SUPABASE_ENV_MISSING"
        ? "Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas."
        : "Não foi possível conectar ao Supabase."
    });
  }
};
