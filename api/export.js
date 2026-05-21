const { cors, json, exportStorage } = require("./_supabase");
const { exportNormalizedStorage } = require("./_normalized");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { ok: false, erro: "Método não permitido." });

  try {
    let storage;
    let database = "supabase-postgres-normalized";

    try {
      storage = await exportNormalizedStorage();
      if (!(storage.ge_empresas || []).length) {
        const legacyStorage = await exportStorage();
        if ((legacyStorage.ge_empresas || []).length) {
          const { importStorageNormalized } = require("./_normalized");
          await importStorageNormalized(legacyStorage);
          storage = await exportNormalizedStorage();
        }
      }
    } catch (normalizedError) {
      storage = await exportStorage();
      database = "supabase-postgres-storage-legacy";
    }

    json(res, 200, {
      meta: {
        app: "StockSync",
        exportedAt: new Date().toISOString(),
        database
      },
      storage
    });
  } catch (error) {
    json(res, error.status || 500, { ok: false, erro: "Não foi possível exportar os dados." });
  }
};
