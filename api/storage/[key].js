const { cors, json, chaveValida, getStorageValue, setStorageValue } = require("../_supabase");

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = req.query.key;
  if (!key || !chaveValida(key)) {
    return json(res, 400, { ok: false, erro: "Chave de banco inválida." });
  }

  try {
    if (req.method === "GET") {
      const row = await getStorageValue(key);
      return json(res, 200, {
        ok: true,
        exists: Boolean(row),
        value: row ? row.value : null
      });
    }

    if (req.method === "PUT" || req.method === "POST") {
      await setStorageValue(key, req.body?.value ?? null);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { ok: false, erro: "Método não permitido." });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      erro: "Não foi possível acessar o banco Supabase."
    });
  }
};
