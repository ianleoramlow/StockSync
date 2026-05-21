const { cors, json, exportStorage } = require("./_supabase");
const { syncEmpresas, syncEmpresa, exportNormalizedStorage, importStorageNormalized } = require("./_normalized");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      let storage = await exportNormalizedStorage();
      if (!(storage.ge_empresas || []).length) {
        const legacyStorage = await exportStorage();
        if ((legacyStorage.ge_empresas || []).length) {
          await importStorageNormalized(legacyStorage);
          storage = await exportNormalizedStorage();
        }
      }
      const key = req.query?.key;
      if (key) {
        return json(res, 200, {
          ok: true,
          exists: Object.prototype.hasOwnProperty.call(storage, key),
          value: Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null
        });
      }

      return json(res, 200, {
        ok: true,
        meta: {
          app: "StockSync",
          exportedAt: new Date().toISOString(),
          database: "supabase-postgres-normalized"
        },
        storage
      });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const action = req.body?.action || "syncEmpresa";

      if (action === "syncEmpresas") {
        const count = await syncEmpresas(req.body?.empresas || []);
        return json(res, 200, { ok: true, empresas: count });
      }

      if (action === "importStorage") {
        const result = await importStorageNormalized(req.body?.storage || {});
        return json(res, 200, { ok: true, ...result });
      }

      if (action === "syncEmpresa") {
        const result = await syncEmpresa({
          empresaId: req.body?.empresaId,
          empresa: req.body?.empresa || null,
          previousDb: req.body?.previousDb || {},
          db: req.body?.db || {}
        });
        return json(res, 200, result);
      }

      return json(res, 400, { ok: false, erro: "Ação de sincronização inválida." });
    }

    return json(res, 405, { ok: false, erro: "Método não permitido." });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      erro: "Não foi possível sincronizar as tabelas do StockSync.",
      detalhe: error.message
    });
  }
};