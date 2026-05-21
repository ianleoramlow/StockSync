const crypto = require("crypto");
const { supabaseFetch } = require("./_supabase");

const TABLES = {
  empresas: "stocksync_empresas",
  funcionarios: "stocksync_funcionarios",
  solicitacoes: "stocksync_solicitacoes_funcionarios",
  equipamentos: "stocksync_equipamentos",
  eventos: "stocksync_eventos",
  eventoEquipamentos: "stocksync_evento_equipamentos",
  locacoes: "stocksync_locacoes",
  locacaoEquipamentos: "stocksync_locacao_equipamentos",
  manutencoes: "stocksync_manutencoes",
  logs: "stocksync_logs"
};

const EMPTY_DB = {
  equipamentos: [],
  eventos: [],
  locacoes: [],
  manutencoes: [],
  funcionarios: [],
  solicitacoesFuncionarios: [],
  logs: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function keyEmpresa(id) {
  return `ge_dados_${id}`;
}

function hashId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha1").update(JSON.stringify(value ?? {})).digest("hex").slice(0, 24)}`;
}

function rowId(value, fields, prefix) {
  for (const field of fields) {
    if (value?.[field]) return String(value[field]);
  }
  return hashId(prefix, value);
}

function normalizeDb(db = {}) {
  return {
    ...EMPTY_DB,
    ...clone(db),
    equipamentos: safeArray(db.equipamentos),
    eventos: safeArray(db.eventos),
    locacoes: safeArray(db.locacoes),
    manutencoes: safeArray(db.manutencoes),
    funcionarios: safeArray(db.funcionarios),
    solicitacoesFuncionarios: safeArray(db.solicitacoesFuncionarios),
    logs: safeArray(db.logs)
  };
}

function entityMap(items, getKey) {
  const map = new Map();
  safeArray(items).forEach((item) => {
    const key = getKey(item);
    if (key) map.set(String(key), item);
  });
  return map;
}

function changed(a, b) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

async function upsertRows(table, conflict, rows) {
  if (!rows.length) return [];
  return supabaseFetch(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function deleteRow(table, filters) {
  const query = Object.entries(filters)
    .map(([key, value]) => `${encodeURIComponent(key)}=eq.${encodeURIComponent(value)}`)
    .join("&");
  return supabaseFetch(`${table}?${query}`, { method: "DELETE" });
}

async function replaceRelations(table, filters, conflict, rows) {
  await deleteRow(table, filters);
  if (rows.length) await upsertRows(table, conflict, rows);
}

function logId(log) {
  return log.id || hashId("log", [log.data, log.usuario, log.acao, log.detalhes, log.tipo]);
}

function manutencaoId(item) {
  return item.id || hashId("man", [item.codigo, item.data, item.problema, item.origem, item.eventoId, item.status]);
}

async function syncEmpresas(empresas = []) {
  const rows = safeArray(empresas).map((empresa) => ({
    id: String(empresa.id || empresa.codigo || empresa.nome).trim(),
    codigo: String(empresa.codigo || empresa.id || empresa.nome).trim(),
    nome: empresa.nome || empresa.codigo || empresa.id,
    criada_em: empresa.criadaEm || empresa.criada_em || null,
    data: empresa
  })).filter((row) => row.id);

  await upsertRows(TABLES.empresas, "id", rows);
  return rows.length;
}

async function syncEntityList({ empresaId, table, conflict, previous, current, getKey, toRow, afterUpsert, afterDelete, deleteMissing = true }) {
  const prevMap = entityMap(previous, getKey);
  const currMap = entityMap(current, getKey);
  const rows = [];

  currMap.forEach((item, key) => {
    if (!prevMap.has(key) || changed(prevMap.get(key), item)) rows.push(toRow(item, key));
  });

  if (rows.length) await upsertRows(table, conflict, rows);
  if (afterUpsert) {
    for (const row of rows) await afterUpsert(row);
  }

  if (deleteMissing) {
    for (const key of prevMap.keys()) {
      if (!currMap.has(key)) {
        await deleteRow(table, { empresa_id: empresaId, [conflict.split(",").at(-1)]: key });
        if (afterDelete) await afterDelete(key);
      }
    }
  }

  return { upserts: rows.length, deletes: deleteMissing ? [...prevMap.keys()].filter((key) => !currMap.has(key)).length : 0 };
}

async function syncEmpresa({ empresaId, empresa, previousDb, db }) {
  if (!empresaId) throw new Error("empresaId obrigatorio");
  const previous = normalizeDb(previousDb);
  const current = normalizeDb(db);
  let writes = 0;

  if (empresa) writes += await syncEmpresas([{ ...empresa, id: empresaId }]);

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.funcionarios,
    conflict: "empresa_id,email",
    previous: previous.funcionarios,
    current: current.funcionarios,
    getKey: (item) => item.email && String(item.email).toLowerCase(),
    toRow: (item) => ({
      empresa_id: empresaId,
      email: String(item.email).toLowerCase(),
      nome: item.nome || "",
      cargo: item.cargo || "Freelancer",
      status: item.status || "Ativo",
      data: item
    })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.solicitacoes,
    conflict: "id",
    previous: previous.solicitacoesFuncionarios,
    current: current.solicitacoesFuncionarios,
    getKey: (item) => rowId(item, ["id"], "sol"),
    toRow: (item, id) => ({
      id,
      empresa_id: empresaId,
      email: item.email || "",
      status: item.status || "Pendente",
      data: { ...item, id }
    })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.equipamentos,
    conflict: "empresa_id,codigo",
    previous: previous.equipamentos,
    current: current.equipamentos,
    getKey: (item) => item.codigo,
    toRow: (item) => ({
      empresa_id: empresaId,
      codigo: item.codigo,
      nome: item.nome || "",
      categoria: item.categoria || "",
      status: item.status || "disponivel",
      data: item
    })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.eventos,
    conflict: "empresa_id,id",
    previous: previous.eventos,
    current: current.eventos,
    getKey: (item) => item.id,
    toRow: (item) => ({
      empresa_id: empresaId,
      id: item.id,
      nome: item.nome || "",
      data_evento: item.data || null,
      status: item.status || "Ativo",
      data: item
    }),
    afterUpsert: async (row) => {
      const evento = row.data || {};
      const internos = safeArray(evento.equipamentos).map((codigo) => ({
        empresa_id: empresaId,
        evento_id: row.id,
        codigo,
        tipo: "interno",
        quantidade: 1,
        data: { codigo, tipo: "interno" }
      }));
      const externos = safeArray(evento.equipamentosExternos).map((item, index) => ({
        empresa_id: empresaId,
        evento_id: row.id,
        codigo: `externo-${index + 1}`,
        tipo: "externo",
        quantidade: Math.max(Number(item.quantidade) || 1, 1),
        data: item
      }));
      await replaceRelations(TABLES.eventoEquipamentos, { empresa_id: empresaId, evento_id: row.id }, "empresa_id,evento_id,codigo,tipo", [...internos, ...externos]);
    },
    afterDelete: async (id) => deleteRow(TABLES.eventoEquipamentos, { empresa_id: empresaId, evento_id: id })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.locacoes,
    conflict: "empresa_id,id",
    previous: previous.locacoes,
    current: current.locacoes,
    getKey: (item) => rowId(item, ["id"], "loc"),
    toRow: (item, id) => ({
      empresa_id: empresaId,
      id,
      cliente: item.empresa || item.cliente || "",
      status: item.status || "Em Andamento",
      data: { ...item, id }
    }),
    afterUpsert: async (row) => {
      const locacao = row.data || {};
      const rows = safeArray(locacao.equipamentos).map((codigo) => ({
        empresa_id: empresaId,
        locacao_id: row.id,
        codigo,
        quantidade: 1,
        data: { codigo }
      }));
      await replaceRelations(TABLES.locacaoEquipamentos, { empresa_id: empresaId, locacao_id: row.id }, "empresa_id,locacao_id,codigo", rows);
    },
    afterDelete: async (id) => deleteRow(TABLES.locacaoEquipamentos, { empresa_id: empresaId, locacao_id: id })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.manutencoes,
    conflict: "empresa_id,id",
    previous: previous.manutencoes,
    current: current.manutencoes,
    getKey: manutencaoId,
    toRow: (item, id) => ({
      empresa_id: empresaId,
      id,
      codigo: item.codigo || "",
      status: item.status || "Em Manutencao",
      data: { ...item, id }
    })
  })).upserts;

  writes += (await syncEntityList({
    empresaId,
    table: TABLES.logs,
    conflict: "id",
    previous: previous.logs,
    current: current.logs,
    getKey: logId,
    toRow: (item, id) => ({
      id,
      empresa_id: empresaId,
      data_log: item.data || "",
      usuario: item.usuario || "",
      acao: item.acao || "",
      tipo: item.tipo || "badge-purple",
      detalhes: item.detalhes || "",
      data: { ...item, id }
    }),
    deleteMissing: false
  })).upserts;

  return { ok: true, writes };
}

async function fetchTable(table, query = "") {
  return supabaseFetch(`${table}?${query}`, { method: "GET" });
}

function ensureCompanyDb(map, empresaId) {
  if (!map.has(empresaId)) map.set(empresaId, clone(EMPTY_DB));
  return map.get(empresaId);
}

async function exportNormalizedStorage() {
  const [empresasRows, funcionarios, solicitacoes, equipamentos, eventos, locacoes, manutencoes, logs] = await Promise.all([
    fetchTable(TABLES.empresas, "select=*&order=nome.asc"),
    fetchTable(TABLES.funcionarios, "select=*&order=nome.asc"),
    fetchTable(TABLES.solicitacoes, "select=*&order=id.asc"),
    fetchTable(TABLES.equipamentos, "select=*&order=codigo.asc"),
    fetchTable(TABLES.eventos, "select=*&order=id.asc"),
    fetchTable(TABLES.locacoes, "select=*&order=id.asc"),
    fetchTable(TABLES.manutencoes, "select=*&order=id.asc"),
    fetchTable(TABLES.logs, "select=*&order=id.desc&limit=2000")
  ]);

  const empresas = empresasRows.map((row) => ({
    ...(row.data || {}),
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    criadaEm: row.criada_em || row.data?.criadaEm
  }));

  const dbMap = new Map();
  empresas.forEach((empresa) => ensureCompanyDb(dbMap, empresa.id));

  funcionarios.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).funcionarios.push(row.data || row));
  solicitacoes.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).solicitacoesFuncionarios.push(row.data || row));
  equipamentos.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).equipamentos.push(row.data || row));
  eventos.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).eventos.push(row.data || row));
  locacoes.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).locacoes.push(row.data || row));
  manutencoes.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).manutencoes.push(row.data || row));
  logs.forEach((row) => ensureCompanyDb(dbMap, row.empresa_id).logs.push(row.data || row));

  const storage = { ge_empresas: empresas };
  const globais = [];
  dbMap.forEach((db, empresaId) => {
    db.solicitacoesFuncionarios.forEach((item) => {
      if (item.status === "Pendente") globais.push(item);
    });
    storage[keyEmpresa(empresaId)] = db;
  });
  storage.ge_solicitacoes_funcionarios = globais;

  return storage;
}

async function importStorageNormalized(storage = {}) {
  const empresas = safeArray(storage.ge_empresas);
  await syncEmpresas(empresas);

  let empresasImportadas = 0;
  for (const empresa of empresas) {
    const empresaId = empresa.id;
    if (!empresaId) continue;
    const db = storage[keyEmpresa(empresaId)] || EMPTY_DB;
    await syncEmpresa({ empresaId, empresa, previousDb: EMPTY_DB, db });
    empresasImportadas += 1;
  }

  return { empresas: empresasImportadas };
}

module.exports = {
  TABLES,
  syncEmpresas,
  syncEmpresa,
  exportNormalizedStorage,
  importStorageNormalized
};