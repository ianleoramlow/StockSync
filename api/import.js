const { cors, json, chaveValida, setStorageValue, requireAdminRequest } = require("./_supabase");

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return json(res, 405, { ok: false, erro: "Método não permitido." });
  if (!requireAdminRequest(req, res)) return;

  try {
    const storage = req.body?.storage;
    if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
      return json(res, 400, { ok: false, erro: "Arquivo de banco inválido." });
    }

    const keys = Object.keys(storage).filter(chaveValida);
    for (const key of keys) {
      await setStorageValue(key, storage[key]);
    }

    json(res, 200, { ok: true, imported: keys.length });
  } catch (error) {
    json(res, error.status || 500, { ok: false, erro: "Não foi possível importar os dados." });
  }
};
