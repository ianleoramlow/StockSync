const { cors, json, requireSupabase, supabaseFetch } = require("./_supabase");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    requireSupabase();
    const rows = await supabaseFetch("stocksync_empresas?select=id&limit=1", { method: "GET" });
    json(res, 200, {
      ok: true,
      app: "StockSync",
      database: "supabase-postgres-normalized",
      normalizedTablesReachable: Array.isArray(rows)
    });
  } catch (error) {
    json(res, 500, {
      ok: false,
      app: "StockSync",
      database: "supabase-postgres-normalized",
      erro: error.message === "SUPABASE_ENV_MISSING"
        ? "Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas."
        : "Não foi possível conectar às tabelas normalizadas do Supabase. Execute o supabase-schema.sql atualizado."
    });
  }
};
