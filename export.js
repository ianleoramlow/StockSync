const { cors, json, exportStorage } = require("./_supabase");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido." });

  try {
    const storage = await exportStorage();
    json(res, 200, {
      meta: {
        app: "StockSync",
        exportedAt: new Date().toISOString(),
        database: "supabase-postgres"
      },
      storage
    });
  } catch (error) {
    json(res, error.status || 500, { ok: false, erro: "Não foi possível exportar os dados." });
  }
};
