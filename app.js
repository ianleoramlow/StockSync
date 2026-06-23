const GE = (() => {
  const LEGACY_KEY = "ge_dados";
  const EMPRESAS_KEY = "ge_empresas";
  const EMPRESA_ATUAL_KEY = "empresaAtualId";
  const USUARIO_KEY = "usuario";
  const SESSAO_KEY = "usuarioLogado";
  const TEMA_KEY = "stocksyncTema";
  const SOLICITACOES_KEY = "ge_solicitacoes_funcionarios";
  const API_CLIENT_HEADER = "stocksync-web";
  const BACKEND_MISSING = Symbol("backend_missing");
  const backendCache = new Map();
  const backendWriteTimers = new Map();
  const backendWriteQueue = new Map();
  let backendDisponivel = null;
  let ultimaGravacaoLocal = 0;
  let sincronizacaoEmAndamento = false;
  let ultimaAssinaturaRemota = "";
  const snapshotsEmpresa = new Map();

  function chaveCompartilhada(chave) {
    return chave === EMPRESAS_KEY
      || chave === SOLICITACOES_KEY
      || chave.startsWith("ge_dados_");
  }

  function requisicaoBackend(metodo, caminho, corpo = null) {
    if (!location.protocol.startsWith("http")) return null;

    try {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, caminho, false);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.setRequestHeader("X-StockSync-Client", API_CLIENT_HEADER);
      if (corpo !== null) xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(corpo !== null ? JSON.stringify(corpo) : null);

      if (xhr.status < 200 || xhr.status >= 300) return null;
      return xhr.responseText ? JSON.parse(xhr.responseText) : {};
    } catch (error) {
      backendDisponivel = false;
      return null;
    }
  }

  function requisicaoBackendAsync(metodo, caminho, corpo = null, opcoes = {}) {
    if (!location.protocol.startsWith("http") || typeof fetch !== "function") return Promise.resolve(null);

    return fetch(caminho, {
      method: metodo,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-StockSync-Client": API_CLIENT_HEADER
      },
      body: corpo !== null ? JSON.stringify(corpo) : undefined,
      keepalive: Boolean(opcoes.keepalive)
    }).then((response) => {
      backendDisponivel = response.ok;
      return response.ok ? response : null;
    }).catch(() => {
      backendDisponivel = false;
      return null;
    });
  }

  function backendAtivo() {
    if (backendDisponivel !== null) return backendDisponivel;
    const resposta = requisicaoBackend("GET", "/api/health");
    backendDisponivel = Boolean(resposta?.ok);
    return backendDisponivel;
  }

  function lerBackend(chave) {
    if (!chaveCompartilhada(chave) || backendDisponivel === false) return BACKEND_MISSING;
    if (backendCache.has(chave)) return backendCache.get(chave);

    const resposta = requisicaoBackend("GET", `/api/storage/${encodeURIComponent(chave)}`);
    backendDisponivel = Boolean(resposta?.ok);
    if (!resposta?.exists) return BACKEND_MISSING;

    backendCache.set(chave, resposta.value);
    return resposta.value;
  }

  function salvarBackend(chave, valor) {
    if (!chaveCompartilhada(chave)) return;

    backendCache.set(chave, valor);
    backendWriteQueue.set(chave, valor);

    clearTimeout(backendWriteTimers.get(chave));
    backendWriteTimers.set(chave, setTimeout(() => {
      const value = backendWriteQueue.get(chave);
      backendWriteQueue.delete(chave);
      backendWriteTimers.delete(chave);
      requisicaoBackendAsync("PUT", `/api/storage/${encodeURIComponent(chave)}`, { value });
    }, 250));
  }

  function assinaturaStorage(storage) {
    try {
      return JSON.stringify(storage || {});
    } catch (error) {
      return String(Date.now());
    }
  }

  function deveRecarregarAposSync(chavesAlteradas) {
    if (!chavesAlteradas.length) return false;
    if (/01-login\.html$/i.test(location.pathname)) return false;
    return chavesAlteradas.some((chave) => chaveCompartilhada(chave));
  }

  function chavesSincronizacaoBackend() {
    const chaves = [EMPRESAS_KEY, SOLICITACOES_KEY];
    const empresaId = empresaAtualId();
    if (empresaId) chaves.push(chaveEmpresa(empresaId));
    return [...new Set(chaves)];
  }

  async function lerBackendAsync(chave) {
    const response = await fetch(`/api/storage/${encodeURIComponent(chave)}`, {
      headers: {
        "Accept": "application/json",
        "X-StockSync-Client": API_CLIENT_HEADER
      },
      cache: "no-store"
    });

    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.exists ? payload.value : null;
  }

  async function sincronizarBackend(remotoObrigatorio = false) {
    if (!location.protocol.startsWith("http") || typeof fetch !== "function") return;
    if (sincronizacaoEmAndamento) return;
    if (backendWriteQueue.size) return;
    if (!remotoObrigatorio && Date.now() - ultimaGravacaoLocal < 3000) return;
    if (document.visibilityState && document.visibilityState !== "visible") return;

    sincronizacaoEmAndamento = true;
    try {
      const storage = {};
      const chaves = chavesSincronizacaoBackend();

      await Promise.all(chaves.map(async (chave) => {
        const valor = await lerBackendAsync(chave);
        if (valor !== null) storage[chave] = valor;
      }));

      backendDisponivel = true;
      const assinatura = assinaturaStorage(storage);
      if (assinatura && assinatura === ultimaAssinaturaRemota) return;
      ultimaAssinaturaRemota = assinatura;

      const chavesAlteradas = [];
      Object.entries(storage).forEach(([chave, valor]) => {
        if (!chaveCompartilhada(chave) || backendWriteQueue.has(chave)) return;
        const remoto = JSON.stringify(valor ?? null);
        const local = localStorage.getItem(chave);
        if (local !== remoto) {
          localStorage.setItem(chave, remoto);
          backendCache.set(chave, valor);
          chavesAlteradas.push(chave);
        }
      });

      if (deveRecarregarAposSync(chavesAlteradas)) {
        sessionStorage.setItem("stocksyncSyncReload", String(Date.now()));
        location.reload();
      }
    } catch (error) {
      backendDisponivel = false;
    } finally {
      sincronizacaoEmAndamento = false;
    }
  }

  function iniciarSincronizacaoBackend() {
    if (!location.protocol.startsWith("http") || typeof fetch !== "function") return;
    setTimeout(() => sincronizarBackend(true), 900);
    setInterval(() => sincronizarBackend(false), 12000);
    window.addEventListener("focus", () => sincronizarBackend(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sincronizarBackend(true);
    });
  }

  function flushBackendWrites() {
    if (!backendWriteQueue.size) return;

    backendWriteQueue.forEach((value, chave) => {
      clearTimeout(backendWriteTimers.get(chave));
      backendWriteTimers.delete(chave);

      const caminho = `/api/storage/${encodeURIComponent(chave)}`;
      requisicaoBackendAsync("POST", caminho, { value }, { keepalive: true });
    });

    backendWriteQueue.clear();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flushBackendWrites);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushBackendWrites();
    });
  }
  function temaSalvo() {
    return localStorage.getItem(TEMA_KEY) || "escuro";
  }

  function aplicarTema(tema = temaSalvo()) {
    const temaFinal = tema === "claro" ? "light" : "dark";
    document.documentElement.dataset.theme = temaFinal;
    localStorage.setItem(TEMA_KEY, temaFinal === "light" ? "claro" : "escuro");
    atualizarBotoesTema();
    atualizarLogosTema();
  }

  function textoTemaAtual() {
    return document.documentElement.dataset.theme === "light" ? "Tema claro" : "Tema escuro";
  }

  function proximoTextoTema() {
    return document.documentElement.dataset.theme === "light" ? "Usar escuro" : "Usar claro";
  }

  function atualizarBotoesTema() {
    document.querySelectorAll(".theme-toggle").forEach((botao) => {
      const claro = document.documentElement.dataset.theme === "light";
      botao.setAttribute("aria-label", proximoTextoTema());
      botao.title = proximoTextoTema();
      botao.innerHTML = `
        <span>${textoTemaAtual()}</span>
        <span class="theme-toggle-icon">${claro ? "CL" : "ES"}</span>
      `;
    });
  }

  function atualizarLogosTema() {
    const claro = document.documentElement.dataset.theme === "light";

    document.querySelectorAll('img[src*="logo-stocksync"]').forEach((img) => {
      const atual = img.getAttribute("src") || "";
      const logoEscura = img.dataset.logoDark || atual.replace("-light.png", ".png");
      const logoClara = img.dataset.logoLight || logoEscura.replace(".png", "-light.png");

      img.dataset.logoDark = logoEscura;
      img.dataset.logoLight = logoClara;
      img.src = claro ? logoClara : logoEscura;
    });
  }

  aplicarTema(temaSalvo());

  const categoriasEstoquePadrao = ["Som", "Iluminação", "Painel de LED", "Cabos", "Energia", "Estrutura", "Consumo"];

  function chaveCategoriaEstoque(categoria) {
    return normalizar(categoria).replace(/[^a-z0-9]+/g, " ").trim();
  }

  function categoriaEstoqueCanonica(categoria, fallback = "Sem categoria") {
    const texto = String(categoria || "").trim().replace(/\s+/g, " ");
    const chave = chaveCategoriaEstoque(texto);
    if (!chave) return fallback;

    const mapa = {
      som: "Som",
      audio: "Som",
      iluminacao: "Iluminação",
      luz: "Iluminação",
      luzes: "Iluminação",
      painel: "Painel de LED",
      led: "Painel de LED",
      "painel led": "Painel de LED",
      "painel de led": "Painel de LED",
      cabo: "Cabos",
      cabos: "Cabos",
      cabeamento: "Cabos",
      energia: "Energia",
      eletrica: "Energia",
      estrutura: "Estrutura",
      estruturas: "Estrutura",
      consumo: "Consumo",
      consumivel: "Consumo",
      descartavel: "Consumo",
      descartaveis: "Consumo"
    };

    if (mapa[chave]) return mapa[chave];
    const padrao = categoriasEstoquePadrao.find((item) => chaveCategoriaEstoque(item) === chave);
    return padrao || texto || fallback;
  }

  function listaUnicaTexto(lista) {
    const vistos = new Set();
    return (Array.isArray(lista) ? lista : [])
      .map((item) => categoriaEstoqueCanonica(item, ""))
      .filter(Boolean)
      .filter((item) => {
        const chave = chaveCategoriaEstoque(item);
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
  }

  const statusInfo = {
    disponivel: { texto: "Disponível", classe: "badge-green" },
    reservado: { texto: "Reservado p/ Evento", classe: "badge-purple" },
    separacao: { texto: "Em Separação", classe: "badge-yellow" },
    caminhao: { texto: "No Caminhão", classe: "badge-yellow" },
    evento: { texto: "Em Evento", classe: "badge-cyan" },
    retornando: { texto: "Retornando", classe: "badge-purple" },
    retornado: { texto: "Retornado do Evento", classe: "badge-green" },
    locado: { texto: "Locado", classe: "badge-yellow" },
    locado_externo: { texto: "Locado de Terceiros", classe: "badge-yellow" },
    manutencao: { texto: "Em Manutenção", classe: "badge-red" }
  };

  const inicial = {
    equipamentos: [
      { codigo: "EQP001", nome: "Caixa Ativa JBL PRX 715", categoria: "Som", status: "disponivel", descricao: "Caixa ativa de 15 polegadas, 1500W" },
      { codigo: "EQP002", nome: "Mesa de Som Behringer X32", categoria: "Som", status: "evento", descricao: "Mesa digital de 32 canais" },
      { codigo: "EQP003", nome: "Refletor LED 200W RGB", categoria: "Iluminação", status: "locado", descricao: "Refletor RGB para palco" },
      { codigo: "EQP004", nome: "Microfone Shure SM58", categoria: "Som", status: "manutencao", descricao: "Microfone dinâmico vocal" },
      { codigo: "EQP005", nome: "Moving Head Beam 230", categoria: "Iluminação", status: "disponivel", descricao: "Moving beam para eventos" }
    ],
    materiaisConsumo: estoqueInicialConsumo(),
    eventos: [
      { id: "EVT123", nome: "Show de Verão 2024", data: "2024-01-20", dataSaida: "2024-01-18", local: "Arena Anhembi", equipamentos: ["EQP002"], responsavel: "João Silva" }
    ],
    locacoes: [
      { empresa: "TechSom Eventos", saida: "2024-01-15", retorno: "2024-01-25", equipamentos: ["EQP003"], status: "Em Andamento" },
      { empresa: "Luz & Cia Produções", saida: "2024-01-05", retorno: "2024-01-18", equipamentos: [], status: "Finalizada" },
      { empresa: "Sound Experience", saida: "2023-12-20", retorno: "2024-01-02", equipamentos: [], status: "Finalizada" }
    ],
    manutencoes: [
      { codigo: "EQP004", problema: "Sem áudio, cápsula danificada", data: "2024-01-08", status: "Em Manutenção" }
    ],
    funcionarios: [
      { nome: "João Silva", email: "joao@stocksync.com", senha: "123", cargo: "Freelancer" },
      { nome: "Maria Santos", email: "maria@stocksync.com", senha: "123", cargo: "Administrador" },
      { nome: "Pedro Oliveira", email: "pedro@stocksync.com", senha: "123", cargo: "Técnico" }
    ],
    logs: [
      { data: "10/01 14:32", usuario: "Maria Santos", acao: "Separou Equipamentos", tipo: "badge-cyan", detalhes: "3 equipamentos para EVT123" },
      { data: "10/01 09:15", usuario: "João Silva", acao: "Registrou Retorno", tipo: "badge-green", detalhes: "EQP002 - Mesa de Som" },
      { data: "09/01 16:45", usuario: "Pedro Oliveira", acao: "Criou Locação", tipo: "badge-purple", detalhes: "TechSom Eventos - 8 equipamentos" },
      { data: "09/01 10:20", usuario: "Ana Costa", acao: "Enviou para Manutenção", tipo: "badge-red", detalhes: "EQP004 - Microfone SM58" }
    ]
  };

  function clone(objeto) {
    return JSON.parse(JSON.stringify(objeto));
  }

  function estoqueInicialEquipamentos() {
    const lista = [
      { codigo: "SOM001", nome: "Mesa de Som Behringer X32", categoria: "Som", status: "disponivel", descricao: "Mesa digital de 32 canais para eventos de médio e grande porte" },
      { codigo: "SOM002", nome: "Mesa de Som Yamaha MG16XU", categoria: "Som", status: "disponivel", descricao: "Mesa analógica de 16 canais com efeitos integrados" },
      { codigo: "SOM003", nome: "Caixa Ativa JBL PRX 715", categoria: "Som", status: "disponivel", descricao: "Caixa ativa de 15 polegadas para PA" },
      { codigo: "SOM004", nome: "Caixa Ativa JBL PRX 715 02", categoria: "Som", status: "disponivel", descricao: "Caixa ativa de 15 polegadas para PA" },
      { codigo: "SOM005", nome: "Subwoofer JBL PRX 818XLFW", categoria: "Som", status: "disponivel", descricao: "Subwoofer ativo de 18 polegadas" },
      { codigo: "SOM006", nome: "Subwoofer JBL PRX 818XLFW 02", categoria: "Som", status: "disponivel", descricao: "Subwoofer ativo de 18 polegadas" },
      { codigo: "SOM007", nome: "Retorno de Palco Attack VRM 1230A", categoria: "Som", status: "disponivel", descricao: "Monitor ativo para retorno de palco" },
      { codigo: "SOM008", nome: "Retorno de Palco Attack VRM 1230A 02", categoria: "Som", status: "disponivel", descricao: "Monitor ativo para retorno de palco" },
      { codigo: "LED001", nome: "Processadora NovaStar VX4S", categoria: "Painel de LED", status: "disponivel", descricao: "Processadora de vídeo para painel de LED" },
      { codigo: "LED002", nome: "Sender Box NovaStar MCTRL300", categoria: "Painel de LED", status: "disponivel", descricao: "Controladora para envio de sinal de LED" },
      { codigo: "LUZ001", nome: "Mesa DMX Avolites Titan Mobile", categoria: "Iluminação", status: "disponivel", descricao: "Controladora DMX para iluminação profissional" },
      { codigo: "LUZ002", nome: "Máquina de Fumaça 1500W", categoria: "Iluminação", status: "disponivel", descricao: "Máquina de fumaça para efeitos de palco" },
      { codigo: "EST001", nome: "Totem Box Truss Q30 2m", categoria: "Estrutura", status: "disponivel", descricao: "Totem de treliça Q30 para suporte de luz" },
      { codigo: "EST002", nome: "Totem Box Truss Q30 2m 02", categoria: "Estrutura", status: "disponivel", descricao: "Totem de treliça Q30 para suporte de luz" },
      { codigo: "ENE001", nome: "Main Power 12 Canais", categoria: "Energia", status: "disponivel", descricao: "Distribuidor de energia para palco" },
      { codigo: "ENE002", nome: "Nobreak SMS 3200VA", categoria: "Energia", status: "disponivel", descricao: "Nobreak para mesa de som, processadoras e computadores" }
    ];

    const grupos = [
      { prefixo: "MIC", total: 8, nome: "Microfone Shure SM58", categoria: "Som", descricao: "Microfone dinâmico vocal com fio" },
      { prefixo: "MICF", total: 4, nome: "Microfone Sem Fio Kadosh K-502M", categoria: "Som", descricao: "Microfone sem fio duplo UHF" },
      { prefixo: "XLR", total: 20, nome: "Cabo XLR 10m", categoria: "Cabos", descricao: "Cabo balanceado XLR para microfones e sinal de áudio" },
      { prefixo: "P10", total: 12, nome: "Cabo P10 5m", categoria: "Cabos", descricao: "Cabo P10 para instrumentos e conexões de áudio" },
      { prefixo: "HDMI", total: 8, nome: "Cabo HDMI 15m", categoria: "Cabos", descricao: "Cabo HDMI para vídeo e painel de LED" },
      { prefixo: "ENER", total: 16, nome: "Extensão de Energia 20m", categoria: "Energia", descricao: "Extensão elétrica para distribuição no evento" },
      { prefixo: "LED", total: 24, nome: "Placa Painel de LED P3.91", categoria: "Painel de LED", descricao: "Módulo de painel de LED indoor/outdoor P3.91" },
      { prefixo: "MOV", total: 8, nome: "Moving Head Beam 230", categoria: "Iluminação", descricao: "Moving head beam para efeitos de palco" },
      { prefixo: "PAR", total: 16, nome: "Par LED RGBW 18x12W", categoria: "Iluminação", descricao: "Refletor PAR LED RGBW para palco e decoração" },
      { prefixo: "STB", total: 4, nome: "Strobo LED 1500W", categoria: "Iluminação", descricao: "Strobo LED para efeitos de impacto" }
    ];

    grupos.forEach((grupo) => {
      for (let i = 1; i <= grupo.total; i++) {
        lista.push({
          codigo: `${grupo.prefixo}${String(i).padStart(3, "0")}`,
          nome: `${grupo.nome} ${String(i).padStart(2, "0")}`,
          categoria: grupo.categoria,
          status: "disponivel",
          descricao: grupo.descricao
        });
      }
    });

    return lista;
  }

  function estoqueInicialConsumo() {
    return [
      { codigo: "CONS001", nome: "Fita Isolante Preta", categoria: "Consumo", quantidade: 20, unidade: "rolo", estoqueMinimo: 5, descricao: "Material descartável para acabamento e isolação em eventos" },
      { codigo: "CONS002", nome: "Fita Gaffer Preta", categoria: "Consumo", quantidade: 12, unidade: "rolo", estoqueMinimo: 3, descricao: "Fita gaffer para palco, cabos e fixação temporária" },
      { codigo: "CONS003", nome: "Fita Gaffer Branca", categoria: "Consumo", quantidade: 8, unidade: "rolo", estoqueMinimo: 2, descricao: "Fita gaffer branca para marcação e acabamento" },
      { codigo: "CONS004", nome: "Abraçadeira Nylon 200mm", categoria: "Consumo", quantidade: 500, unidade: "unidade", estoqueMinimo: 100, descricao: "Abraçadeira plástica descartável para organização de cabos" },
      { codigo: "CONS005", nome: "Pilha AA", categoria: "Consumo", quantidade: 80, unidade: "unidade", estoqueMinimo: 20, descricao: "Pilhas para microfones, controles e acessórios" },
      { codigo: "CONS006", nome: "Pilha 9V", categoria: "Consumo", quantidade: 24, unidade: "unidade", estoqueMinimo: 8, descricao: "Pilhas 9V para equipamentos sem fio e instrumentos" },
      { codigo: "CONS007", nome: "Lacre Plástico", categoria: "Consumo", quantidade: 300, unidade: "unidade", estoqueMinimo: 80, descricao: "Lacre de segurança para cases e organização" },
      { codigo: "CONS008", nome: "Spray Limpa Contato", categoria: "Consumo", quantidade: 10, unidade: "frasco", estoqueMinimo: 3, descricao: "Produto de limpeza para conectores e contatos elétricos" }
    ];
  }

  function normalizarMaterialConsumo(material = {}) {
    const codigo = String(material.codigo || material.id || "").trim().toUpperCase();
    const id = codigo || ("CONS-" + Date.now());
    return {
      id,
      codigo: id,
      nome: String(material.nome || "").trim(),
      categoria: categoriaEstoqueCanonica(material.categoria || "Consumo", "Consumo"),
      quantidade: Math.max(Number(material.quantidade) || 0, 0),
      unidade: String(material.unidade || "unidade").trim() || "unidade",
      estoqueMinimo: Math.max(Number(material.estoqueMinimo ?? material.minimo) || 0, 0),
      descricao: String(material.descricao || "").trim()
    };
  }

  function normalizarConsumosEvento(consumos = []) {
    return (Array.isArray(consumos) ? consumos : [])
      .map((item) => ({
        codigo: String(item.codigo || item.id || "").trim().toUpperCase(),
        nome: String(item.nome || "").trim(),
        categoria: categoriaEstoqueCanonica(item.categoria || "Consumo", "Consumo"),
        quantidade: Math.max(Number(item.quantidade) || 0, 0),
        unidade: String(item.unidade || "unidade").trim() || "unidade"
      }))
      .filter((item) => item.quantidade > 0 && (item.codigo || item.nome));
  }

  function imagemEquipamento(equipamento = {}) {
    const nome = normalizar(equipamento.nome || "");
    const categoria = normalizar(equipamento.categoria || "");
    const base = "assets/equipamentos";

    if (nome.includes("microfone")) return `${base}/microfone.svg`;
    if (nome.includes("mesa") && nome.includes("som")) return `${base}/mesa-som.svg`;
    if (nome.includes("caixa") || nome.includes("subwoofer") || nome.includes("retorno")) return `${base}/caixa-som.svg`;
    if (nome.includes("fumaca")) return `${base}/fumaca.svg`;
    if (categoria.includes("painel") || nome.includes("painel") || nome.includes("novastar") || nome.includes("sender")) return `${base}/painel-led.svg`;
    if (categoria.includes("cabo") || nome.includes("cabo")) return `${base}/cabos.svg`;
    if (categoria.includes("energia") || nome.includes("power") || nome.includes("nobreak") || nome.includes("extensao")) return `${base}/energia.svg`;
    if (categoria.includes("estrutura") || nome.includes("truss") || nome.includes("totem")) return `${base}/estrutura.svg`;
    if (categoria.includes("iluminacao") || nome.includes("moving") || nome.includes("par led") || nome.includes("strobo") || nome.includes("refletor") || nome.includes("dmx")) return `${base}/iluminacao.svg`;

    return `${base}/equipamento.svg`;
  }

  function aplicarImagensEquipamentos(db) {
    if (!db || !Array.isArray(db.equipamentos)) return false;

    let alterou = false;
    db.equipamentos.forEach((eq) => {
      const imagem = imagemEquipamento(eq);
      if (!eq.imagem || eq.imagem === "assets/equipamentos/fumaça.svg") {
        eq.imagem = imagem;
        alterou = true;
      }
    });

    return alterou;
  }

  function lerJSON(chave, fallback = null) {
    if (chaveCompartilhada(chave) && backendDisponivel !== false) {
      const valorBackend = lerBackend(chave);
      if (valorBackend !== BACKEND_MISSING) {
        if (valorBackend) localStorage.setItem(chave, JSON.stringify(valorBackend));
        return valorBackend || fallback;
      }
    }

    try {
      const valorLocal = JSON.parse(localStorage.getItem(chave) || "null");
      if (valorLocal) return valorLocal;
    } catch (error) {
      return fallback;
    }

    if (!chaveCompartilhada(chave)) {
      const valorBackend = lerBackend(chave);
      if (valorBackend !== BACKEND_MISSING) {
        if (valorBackend) localStorage.setItem(chave, JSON.stringify(valorBackend));
        return valorBackend || fallback;
      }
    }

    return fallback;
  }

  function salvarJSON(chave, valor) {
    ultimaGravacaoLocal = Date.now();
    localStorage.setItem(chave, JSON.stringify(valor));
    salvarBackend(chave, valor);
  }

  function solicitacoesGlobais() {
    return lerJSON(SOLICITACOES_KEY, []);
  }

  function salvarSolicitacoesGlobais(lista) {
    salvarJSON(SOLICITACOES_KEY, lista);
  }

  function solicitacoesFuncionarioEmpresa(id = empresaAtualId()) {
    const pendentesEmpresa = (dadosDaEmpresa(id).solicitacoesFuncionarios || []).filter((item) => item.status === "Pendente");
    const pendentesGlobais = solicitacoesGlobais().filter((item) => item.empresaId === id && item.status === "Pendente");
    const mapa = new Map();

    [...pendentesEmpresa, ...pendentesGlobais].forEach((item) => {
      mapa.set(item.id || `${item.empresaId}-${normalizar(item.email)}`, item);
    });

    return [...mapa.values()];
  }

  function cargoSistema(cargo) {
    return cargo === "Operador" ? "Freelancer" : (cargo || "Freelancer");
  }

  function dadosVazios() {
    return {
      equipamentos: [],
      materiaisConsumo: [],
      categoriasEstoque: [],
      eventos: [],
      locacoes: [],
      manutencoes: [],
      funcionarios: [],
      solicitacoesFuncionarios: [],
      logs: []
    };
  }

  function chaveEmpresa(id) {
    return `ge_dados_${id}`;
  }

  function codigoBaseEmpresa(nome) {
    const partes = normalizar(nome).split(/[^a-z0-9]+/).filter(Boolean);
    if (!partes.length) return "empresa";
    const primeiraParte = partes[0];
    if (primeiraParte.length >= 3) return primeiraParte.slice(0, 12);
    const sigla = partes.map((parte) => parte[0]).join("").slice(0, 8);
    return sigla.length >= 2 ? sigla : primeiraParte;
  }

  function criarCodigoEmpresa(nome, existentes = empresasSemMigracao()) {
    const base = codigoBaseEmpresa(nome)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 12) || "empresa";
    let codigo = base;
    let contador = 2;

    while (existentes.some((empresa) => limparCodigoEmpresa(empresa.codigo || empresa.id || empresa.nome) === codigo)) {
      codigo = `${base}${contador}`;
      contador += 1;
    }

    return codigo;
  }

  function criarIdEmpresa(nome) {
    return criarCodigoEmpresa(nome);
  }

  function corrigirAcentosDados(db) {
    let texto = JSON.stringify(db || {});
    const mojibakeRun = /(?:[\u00C3\u00C2][\u0080-\u00BF\u00A0-\u00FF]|\u00E2[\u0080-\u00BF\u00A0-\u00FF]{1,2})+/g;

    for (let i = 0; i < 5; i += 1) {
      const corrigido = texto.replace(mojibakeRun, (trecho) => {
        try {
          return decodeURIComponent(escape(trecho));
        } catch (error) {
          return trecho;
        }
      });

      if (corrigido === texto) break;
      texto = corrigido;
    }

    return JSON.parse(texto);
  }
  function garantirEstrutura(db) {
    const base = dadosVazios();
    const corrigido = corrigirAcentosDados(db || {});
    Object.keys(base).forEach((chave) => {
      if (!Array.isArray(corrigido[chave])) corrigido[chave] = [];
    });
    corrigido.funcionarios = corrigido.funcionarios.map((funcionario) => ({ ...funcionario, cargo: cargoSistema(funcionario.cargo) }));
    corrigido.solicitacoesFuncionarios = corrigido.solicitacoesFuncionarios.map((solicitacao) => ({ ...solicitacao, cargo: cargoSistema(solicitacao.cargo) }));
    corrigido.equipamentos = corrigido.equipamentos.map((equipamento) => ({
      ...equipamento,
      categoria: categoriaEstoqueCanonica(equipamento.categoria, "Sem categoria")
    }));
    corrigido.materiaisConsumo = corrigido.materiaisConsumo.map(normalizarMaterialConsumo).filter((item) => item.nome);
    corrigido.categoriasEstoque = listaUnicaTexto(corrigido.categoriasEstoque);
    corrigido.preferencias = corrigido.preferencias && typeof corrigido.preferencias === "object" ? corrigido.preferencias : {};
    corrigido.eventos = corrigido.eventos.map((evento) => ({
      ...evento,
      dataSaida: evento.dataSaida || evento.data_saida || evento.saida || evento.data || "",
      consumos: normalizarConsumosEvento(evento.consumos || evento.materiaisConsumo || [])
    }));
    return corrigido;
  }

  function empresasSemMigracao() {
    return lerJSON(EMPRESAS_KEY, []);
  }

  function salvarEmpresas(lista) {
    salvarJSON(EMPRESAS_KEY, lista);
  }

  function garantirCodigosEmpresas() {
    const lista = empresasSemMigracao();
    let alterou = false;
    const atualizadas = lista.map((empresa, index) => {
      if (empresa.codigo) return empresa;
      const anteriores = lista.slice(0, index).map((item) => item.codigo ? item : { ...item, codigo: item.id });
      const codigo = criarCodigoEmpresa(empresa.nome || empresa.id || "empresa", anteriores);
      alterou = true;
    
  return { ...empresa, codigo };
    });

    if (alterou) salvarEmpresas(atualizadas);
    return alterou ? atualizadas : lista;
  }

  function migrarLegadoSeNecessario() {
    const jaMigrado = lerJSON(EMPRESAS_KEY, null);
    if (jaMigrado) return;

    const dadosAntigos = lerJSON(LEGACY_KEY, null);
    const usuarioAntigo = lerJSON(SESSAO_KEY, null) || lerJSON(USUARIO_KEY, null);
    if (!dadosAntigos && !usuarioAntigo) {
      salvarEmpresas([]);
      return;
    }

    const nomeEmpresa = usuarioAntigo?.empresaNome || usuarioAntigo?.empresa || "Empresa Demo";
    const id = usuarioAntigo?.empresaId || criarIdEmpresa(nomeEmpresa);
    const empresa = { id, codigo: criarCodigoEmpresa(nomeEmpresa), nome: nomeEmpresa, criadaEm: new Date().toISOString() };
    const db = garantirEstrutura(dadosAntigos || clone(inicial));

    if (usuarioAntigo && !db.funcionarios.some((funcionario) => funcionario.email === usuarioAntigo.email)) {
      db.funcionarios.unshift({
        nome: usuarioAntigo.nome,
        email: usuarioAntigo.email,
        senha: usuarioAntigo.senha,
        cargo: cargoSistema(usuarioAntigo.cargo || "Administrador")
      });
    }

    db.funcionarios = db.funcionarios.map((funcionario) => ({ ...funcionario, empresaId: id, empresaCodigo: empresa.codigo, empresaNome: nomeEmpresa }));
    salvarEmpresas([empresa]);
    salvarJSON(chaveEmpresa(id), db);

    if (usuarioAntigo) {
      const usuarioMigrado = { ...usuarioAntigo, empresaId: id, empresaCodigo: empresa.codigo, empresaNome: nomeEmpresa };
      salvarJSON(USUARIO_KEY, usuarioMigrado);
      salvarJSON(SESSAO_KEY, usuarioMigrado);
      localStorage.setItem(EMPRESA_ATUAL_KEY, id);
    }
  }

  function empresas() {
    migrarLegadoSeNecessario();
    return garantirCodigosEmpresas();
  }

  function sessaoAtiva() {
    return lerJSON(SESSAO_KEY, null);
  }

  function empresaAtualId() {
    const usuario = sessaoAtiva();
    return usuario?.empresaId || localStorage.getItem(EMPRESA_ATUAL_KEY) || "";
  }

  function empresaAtual() {
    const id = empresaAtualId();
    return empresas().find((empresa) => empresa.id === id) || null;
  }

  function codigoAcessoEmpresa(empresa = empresaAtual()) {
    return empresa?.codigo || empresa?.id || "";
  }

  function limparCodigoEmpresa(codigo) {
    return normalizar(codigo)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function buscarEmpresa(codigo) {
    const codigoLimpo = limparCodigoEmpresa(codigo);
    return empresas().find((empresa) =>
      limparCodigoEmpresa(empresa.codigo) === codigoLimpo
      || limparCodigoEmpresa(empresa.id) === codigoLimpo
      || limparCodigoEmpresa(empresa.nome) === codigoLimpo
    ) || null;
  }

  function dadosDaEmpresa(id) {
    const db = garantirEstrutura(lerJSON(chaveEmpresa(id), dadosVazios()));
    let alterou = false;

    if (!db.estoqueInicialCriado) {
      db.estoqueInicialCriado = true;
      alterou = true;
    }

    if (!db.estoqueGeralCriado) {
      db.estoqueGeralCriado = true;
      alterou = true;
    }

    if (!db.consumoInicialCriado) {
      db.consumoInicialCriado = true;
      alterou = true;
    }

    if (aplicarImagensEquipamentos(db)) alterou = true;
    if (alterou) salvarJSON(chaveEmpresa(id), db);

    snapshotsEmpresa.set(id, clone(db));
    return db;
  }

  function dados() {
    const id = empresaAtualId();
    if (!id) return dadosVazios();
    return dadosDaEmpresa(id);
  }

  function salvar(dadosAtualizados) {
    const id = empresaAtualId();
    if (!id) return;
    const db = garantirEstrutura(dadosAtualizados);
    aplicarImagensEquipamentos(db);
    salvarJSON(chaveEmpresa(id), db);
  }

  function categoriasEstoque() {
    const db = dados();
    return listaUnicaTexto([...categoriasEstoquePadrao, ...(db.categoriasEstoque || [])]);
  }

  function salvarCategoriasEstoque(lista) {
    const db = dados();
    db.categoriasEstoque = listaUnicaTexto(lista);
    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Atualizou Categorias",
      tipo: "badge-purple",
      detalhes: db.categoriasEstoque.join(", ") || "Categorias padrão"
    });
    salvar(db);
    return categoriasEstoque();
  }

  function salvarEmpresaAtual(dadosEmpresa = {}) {
    const atual = empresaAtual();
    if (!atual) return null;

    const nome = String(dadosEmpresa.nome || atual.nome || "").trim();
    if (!nome) return { erro: "Informe o nome da empresa." };

    const atualizada = {
      ...atual,
      nome,
      telefone: String(dadosEmpresa.telefone || "").trim(),
      email: String(dadosEmpresa.email || "").trim(),
      cnpj: String(dadosEmpresa.cnpj || "").trim(),
      endereco: String(dadosEmpresa.endereco || "").trim(),
      observacoes: String(dadosEmpresa.observacoes || "").trim(),
      atualizadaEm: new Date().toISOString()
    };

    const lista = empresas().map((empresa) => empresa.id === atual.id ? atualizada : empresa);
    salvarEmpresas(lista);

    const db = dados();
    db.funcionarios = (db.funcionarios || []).map((funcionario) => ({
      ...funcionario,
      empresaNome: atualizada.nome,
      empresaCodigo: atualizada.codigo || atualizada.id
    }));
    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Atualizou Empresa",
      tipo: "badge-purple",
      detalhes: atualizada.nome
    });
    salvar(db);

    [USUARIO_KEY, SESSAO_KEY].forEach((chave) => {
      const usuario = lerJSON(chave, null);
      if (usuario?.empresaId === atual.id) {
        salvarJSON(chave, { ...usuario, empresaNome: atualizada.nome, empresaCodigo: atualizada.codigo || atualizada.id });
      }
    });

    return atualizada;
  }

  function emailExisteEmOutraEmpresa(email, empresaIgnorada = "") {
    return empresas().some((empresa) => {
      if (empresa.id === empresaIgnorada) return false;
      const db = dadosDaEmpresa(empresa.id);
      return db.funcionarios.some((funcionario) => normalizar(funcionario.email) === normalizar(email))
        || (db.solicitacoesFuncionarios || []).some((funcionario) => normalizar(funcionario.email) === normalizar(email) && funcionario.status === "Pendente")
        || solicitacoesGlobais().some((funcionario) => funcionario.empresaId === empresa.id && normalizar(funcionario.email) === normalizar(email) && funcionario.status === "Pendente");
    });
  }

  function cadastrarEmpresa({ empresa, nome, email, senha, cargo = "Administrador" }) {
    if (!empresa || !nome || !email || !senha) return null;
    if (emailExisteEmOutraEmpresa(email)) return { erro: "Já existe um usuário cadastrado com esse e-mail." };

    const id = criarIdEmpresa(empresa);
    const registroEmpresa = { id, codigo: id, nome: empresa.trim(), criadaEm: new Date().toISOString() };
    const admin = {
      nome: nome.trim(),
      email: email.trim(),
      senha,
      cargo,
      empresaId: id,
      empresaCodigo: registroEmpresa.codigo,
      empresaNome: registroEmpresa.nome
    };
    const lista = empresas();
    lista.push(registroEmpresa);
    salvarEmpresas(lista);
    salvarJSON(chaveEmpresa(id), {
      ...dadosVazios(),
      estoqueInicialCriado: true,
      estoqueGeralCriado: true,
      consumoInicialCriado: true,
      funcionarios: [admin],
      logs: [{ data: hojeCurto(), usuario: admin.nome, acao: "Criou Empresa", tipo: "badge-green", detalhes: registroEmpresa.nome }]
    });
    salvarJSON(USUARIO_KEY, admin);
    salvarJSON(SESSAO_KEY, admin);
    localStorage.setItem(EMPRESA_ATUAL_KEY, id);
    return admin;
  }

  function autenticar(email, senha, codigoEmpresa = "") {
    const emailNormalizado = normalizar(email);
    const empresaEscolhida = codigoEmpresa ? buscarEmpresa(codigoEmpresa) : null;
    const listaEmpresas = empresaEscolhida ? [empresaEscolhida] : empresas();

    if (codigoEmpresa && !empresaEscolhida) return null;

    for (const empresa of listaEmpresas) {
      const db = dadosDaEmpresa(empresa.id);
      const funcionario = db.funcionarios.find((item) => normalizar(item.email) === emailNormalizado && item.senha === senha);
      if (funcionario) {
        const usuario = { ...funcionario, empresaId: empresa.id, empresaCodigo: codigoAcessoEmpresa(empresa), empresaNome: empresa.nome };
        salvarJSON(USUARIO_KEY, usuario);
        salvarJSON(SESSAO_KEY, usuario);
        localStorage.setItem(EMPRESA_ATUAL_KEY, empresa.id);
        return usuario;
      }

      const pendente = (db.solicitacoesFuncionarios || []).find((item) => normalizar(item.email) === emailNormalizado && item.senha === senha && item.status === "Pendente");
      const pendenteGlobal = solicitacoesGlobais().find((item) => item.empresaId === empresa.id && normalizar(item.email) === emailNormalizado && item.senha === senha && item.status === "Pendente");
      if (pendente || pendenteGlobal) {
      
  return { erro: "Seu cadastro ainda está aguardando aprovação de um administrador." };
      }
    }

    return null;
  }

  function cadastrarFuncionarioPorCodigo(codigoEmpresa, funcionario) {
    const empresa = buscarEmpresa(codigoEmpresa);
    if (!empresa) return { erro: "Código da empresa não encontrado." };

    const db = dadosDaEmpresa(empresa.id);
    const emailNormalizado = normalizar(funcionario.email);
    const existente = db.funcionarios.some((item) => normalizar(item.email) === emailNormalizado);
    const pendente = (db.solicitacoesFuncionarios || []).some((item) => normalizar(item.email) === emailNormalizado && item.status === "Pendente");
    const pendenteGlobal = solicitacoesGlobais().some((item) => item.empresaId === empresa.id && normalizar(item.email) === emailNormalizado && item.status === "Pendente");

    if (existente) return { erro: "Já existe um funcionário com esse e-mail nessa empresa." };

    if (pendente) return { erro: "Já existe uma solicitação pendente para esse e-mail." };

    if (pendenteGlobal) return { erro: "Já existe uma solicitação pendente para esse e-mail." };

    const registro = {
      id: `SOL-${Date.now()}`,
      nome: funcionario.nome.trim(),
      email: funcionario.email.trim(),
      senha: funcionario.senha,
      telefone: funcionario.telefone || "",
      cargo: cargoSistema(funcionario.cargo),
      empresaId: empresa.id,
      empresaCodigo: codigoAcessoEmpresa(empresa),
      empresaNome: empresa.nome,
      status: "Pendente",
      solicitadoEm: new Date().toISOString().slice(0, 10)
    };

    db.solicitacoesFuncionarios = db.solicitacoesFuncionarios || [];
    db.solicitacoesFuncionarios.unshift(registro);
    salvarSolicitacoesGlobais([registro, ...solicitacoesGlobais()]);
    db.logs.unshift({
      data: hojeCurto(),
      usuario: registro.nome,
      acao: "Criou Conta de Funcionário",
      tipo: "badge-green",
      detalhes: `${registro.nome} entrou em ${empresa.nome}`
    });

    salvarJSON(chaveEmpresa(empresa.id), db);
    return registro;
  }

  function hojeCurto() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function dataBR(dataISO) {
    if (!dataISO) return "-";
    const [ano, mes, dia] = dataISO.split("-");
    return dia ? `${dia}/${mes}/${ano}` : dataISO;
  }

  function usuarioAtual() {
    const usuario = sessaoAtiva() || lerJSON(USUARIO_KEY, null) || { nome: "Freelancer", cargo: "Freelancer" };
  
  return { ...usuario, cargo: cargoSistema(usuario.cargo) };
  }

  function log(acao, detalhes, tipo = "badge-purple") {
    const db = dados();
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao, detalhes, tipo });
    salvar(db);
  }

  function normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function badge(status) {
    const info = statusInfo[status] || statusInfo.disponivel;
    return `<span class="badge ${info.classe}">${info.texto}</span>`;
  }

  function getEquipamento(codigo) {
    return dados().equipamentos.find((eq) => eq.codigo === codigo);
  }

  function trocarCodigoEquipamentoNasReferencias(db, codigoAntigo, codigoNovo) {
    if (!codigoAntigo || !codigoNovo || codigoAntigo === codigoNovo) return;
    const trocar = (codigo) => codigo === codigoAntigo ? codigoNovo : codigo;

    db.manutencoes = (db.manutencoes || []).map((manutencao) =>
      manutencao.codigo === codigoAntigo ? { ...manutencao, codigo: codigoNovo } : manutencao
    );
    db.eventos = (db.eventos || []).map((evento) => ({
      ...evento,
      equipamentos: (evento.equipamentos || []).map(trocar)
    }));
    db.locacoes = (db.locacoes || []).map((locacao) => ({
      ...locacao,
      equipamentos: (locacao.equipamentos || []).map(trocar)
    }));
  }

  function trocarCodigoMaterialNasReferencias(db, codigoAntigo, codigoNovo) {
    if (!codigoAntigo || !codigoNovo || codigoAntigo === codigoNovo) return;
    db.eventos = (db.eventos || []).map((evento) => ({
      ...evento,
      consumos: normalizarConsumosEvento(evento.consumos).map((item) =>
        item.codigo === codigoAntigo ? { ...item, codigo: codigoNovo } : item
      )
    }));
  }

  function salvarEquipamento(equipamento, codigoOriginal = "") {
    const db = dados();
    const codigo = equipamento.codigo.trim().toUpperCase();
    const original = String(codigoOriginal || codigo).trim().toUpperCase();
    const indiceOriginal = db.equipamentos.findIndex((eq) => eq.codigo === original);
    const existente = db.equipamentos.findIndex((eq) => eq.codigo === codigo);

    if (!codigo) return { erro: "Informe o código do equipamento." };
    if (codigo !== original && existente >= 0) {
      return { erro: "Já existe um equipamento com esse código." };
    }

    const registroBase = { ...equipamento, codigo, categoria: categoriaEstoqueCanonica(equipamento.categoria, "Sem categoria"), status: equipamento.status || "disponivel" };
    const indiceImagem = indiceOriginal >= 0 ? indiceOriginal : existente;
    const registro = {
      ...registroBase,
      imagem: equipamento.imagem || db.equipamentos[indiceImagem]?.imagem || imagemEquipamento(registroBase)
    };

    if (indiceOriginal >= 0) {
      db.equipamentos[indiceOriginal] = { ...db.equipamentos[indiceOriginal], ...registro };
      trocarCodigoEquipamentoNasReferencias(db, original, codigo);
      const detalheCodigo = original !== codigo ? `${original} -> ${codigo}` : codigo;
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Equipamento", tipo: "badge-purple", detalhes: `${detalheCodigo} - ${registro.nome}` });
    } else if (existente >= 0) {
      db.equipamentos[existente] = { ...db.equipamentos[existente], ...registro };
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Equipamento", tipo: "badge-purple", detalhes: `${codigo} - ${registro.nome}` });
    } else {
      db.equipamentos.push(registro);
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Cadastrou Equipamento", tipo: "badge-green", detalhes: `${codigo} - ${registro.nome}` });
    }

    salvar(db);
    return { ok: true, codigo };
  }

  function salvarEquipamentosEmLote(equipamento, quantidade) {
    const total = Math.max(1, Number(quantidade) || 1);
    const db = dados();
    const codigoBase = equipamento.codigo.trim().toUpperCase();
    const categoriaCanonica = categoriaEstoqueCanonica(equipamento.categoria, "Sem categoria");
    const equipamentoBase = { ...equipamento, categoria: categoriaCanonica };
    const match = codigoBase.match(/^(.*?)(\d+)$/);
    const criados = [];

    for (let i = 0; i < total; i++) {
      const codigo = match
        ? `${match[1]}${String(Number(match[2]) + i).padStart(match[2].length, "0")}`
        : total === 1 ? codigoBase : `${codigoBase}-${String(i + 1).padStart(2, "0")}`;

      if (db.equipamentos.some((eq) => eq.codigo === codigo)) continue;

      db.equipamentos.push({
        ...equipamentoBase,
        codigo,
        nome: total > 1 ? `${equipamento.nome} ${String(i + 1).padStart(2, "0")}` : equipamento.nome,
        status: equipamento.status || "disponivel",
        imagem: equipamento.imagem || imagemEquipamento(equipamentoBase)
      });
      criados.push(codigo);
    }

    if (criados.length) {
      db.logs.unshift({
        data: hojeCurto(),
        usuario: usuarioAtual().nome,
        acao: "Cadastrou Equipamentos",
        tipo: "badge-green",
        detalhes: `${criados.length} unidades - ${equipamento.nome}`
      });
    }

    salvar(db);
    return criados;
  }

  function getMaterialConsumo(codigo) {
    const chave = String(codigo || "").trim().toUpperCase();
    return (dados().materiaisConsumo || []).find((item) => item.codigo === chave || item.id === chave);
  }

  function salvarMaterialConsumo(material, codigoOriginal = "") {
    const db = dados();
    db.materiaisConsumo = db.materiaisConsumo || [];
    const registro = normalizarMaterialConsumo(material);
    if (!registro.codigo || !registro.nome || !registro.categoria) return null;

    const original = String(codigoOriginal || registro.codigo).trim().toUpperCase();
    const indiceOriginal = db.materiaisConsumo.findIndex((item) => item.codigo === original || item.id === original);
    const indice = db.materiaisConsumo.findIndex((item) => item.codigo === registro.codigo || item.id === registro.codigo);

    if (registro.codigo !== original && indice >= 0) {
      return { erro: "Já existe um material com esse código." };
    }

    if (indiceOriginal >= 0) {
      db.materiaisConsumo[indiceOriginal] = { ...db.materiaisConsumo[indiceOriginal], ...registro };
      trocarCodigoMaterialNasReferencias(db, original, registro.codigo);
      const detalheCodigo = original !== registro.codigo ? original + " -> " + registro.codigo : registro.codigo;
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Material de Consumo", tipo: "badge-purple", detalhes: detalheCodigo + " - " + registro.nome });
    } else if (indice >= 0) {
      db.materiaisConsumo[indice] = { ...db.materiaisConsumo[indice], ...registro };
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Material de Consumo", tipo: "badge-purple", detalhes: registro.codigo + " - " + registro.nome });
    } else {
      db.materiaisConsumo.push(registro);
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Cadastrou Material de Consumo", tipo: "badge-green", detalhes: registro.codigo + " - " + registro.nome });
    }

    salvar(db);
    return registro;
  }

  function removerMaterialConsumo(codigo) {
    const db = dados();
    const chave = String(codigo || "").trim().toUpperCase();
    const material = (db.materiaisConsumo || []).find((item) => item.codigo === chave || item.id === chave);
    if (!material) return false;

    db.materiaisConsumo = (db.materiaisConsumo || []).filter((item) => item.codigo !== chave && item.id !== chave);
    db.eventos.forEach((evento) => {
      evento.consumos = normalizarConsumosEvento(evento.consumos).filter((item) => item.codigo !== chave);
    });
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Excluiu Material de Consumo", tipo: "badge-red", detalhes: material.codigo + " - " + material.nome });
    salvar(db);
    return true;
  }

  function mapaQuantidadeConsumo(consumos = []) {
    const mapa = new Map();
    normalizarConsumosEvento(consumos).forEach((item) => {
      const chave = item.codigo || normalizar(item.nome);
      mapa.set(chave, (mapa.get(chave) || 0) + item.quantidade);
    });
    return mapa;
  }

  function aplicarMovimentoConsumosEvento(db, consumosAntigos = [], consumosNovos = []) {
    const antigos = mapaQuantidadeConsumo(consumosAntigos);
    const novos = mapaQuantidadeConsumo(consumosNovos);
    const chaves = new Set([...antigos.keys(), ...novos.keys()]);

    chaves.forEach((codigo) => {
      const delta = (novos.get(codigo) || 0) - (antigos.get(codigo) || 0);
      if (!delta) return;
      const material = (db.materiaisConsumo || []).find((item) => item.codigo === codigo || item.id === codigo);
      if (!material) return;
      material.quantidade = Math.max(0, (Number(material.quantidade) || 0) - delta);
    });
  }

  function removerEquipamento(codigo) {
    const db = dados();
    const eq = db.equipamentos.find((item) => item.codigo === codigo);
    db.equipamentos = db.equipamentos.filter((item) => item.codigo !== codigo);
    db.manutencoes = db.manutencoes.filter((item) => item.codigo !== codigo);
    db.eventos.forEach((evento) => evento.equipamentos = evento.equipamentos.filter((item) => item !== codigo));
    db.locacoes.forEach((locacao) => locacao.equipamentos = locacao.equipamentos.filter((item) => item !== codigo));
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Excluiu Equipamento", tipo: "badge-red", detalhes: `${codigo}${eq ? " - " + eq.nome : ""}` });
    salvar(db);
  }

  function enviarManutencao(codigo, problema = "Manutenção solicitada", extras = {}) {
    const db = dados();
    const eq = db.equipamentos.find((item) => item.codigo === codigo);
    if (!eq) return false;
    eq.status = "manutencao";
    const jaExiste = db.manutencoes.find((item) => item.codigo === codigo && item.status !== "Finalizada");
    if (!jaExiste) {
      db.manutencoes.unshift({ codigo, problema, data: new Date().toISOString().slice(0, 10), status: "Em Manutenção", ...extras });
    } else {
      Object.assign(jaExiste, {
        problema,
        status: jaExiste.status || "Em Manutenção",
        ...extras
      });
    }
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Enviou para Manutenção", tipo: "badge-red", detalhes: `${codigo} - ${eq.nome}` });
    salvar(db);
    return true;
  }

  function finalizarManutencao(codigo, observacao = "") {
    const db = dados();
    const eq = db.equipamentos.find((item) => item.codigo === codigo);
    const manutencao = db.manutencoes.find((item) => item.codigo === codigo && item.status !== "Finalizada");

    if (!eq) return false;
    if (!manutencao && eq.status !== "manutencao") return false;

    eq.status = "disponivel";
    if (manutencao) {
      manutencao.status = "Finalizada";
      manutencao.finalizadaEm = new Date().toISOString().slice(0, 10);
      manutencao.observacaoFinal = observacao;
    }

    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Finalizou Manutenção",
      tipo: "badge-green",
      detalhes: `${codigo} - ${eq.nome}`
    });

    salvar(db);
    return true;
  }

  function salvarEvento(evento) {
    const db = dados();
    const idBase = evento.id.trim().toUpperCase();
    const equipamentos = evento.equipamentos.map((codigo) => codigo.trim().toUpperCase()).filter(Boolean);
    const equipamentosExternos = evento.equipamentosExternos || [];
    const consumos = normalizarConsumosEvento(evento.consumos || evento.materiaisConsumo || []);
    let id = idBase;
    let contador = 2;

    while (db.eventos.some((item) => item.id === id)) {
      id = `${idBase}-${contador}`;
      contador += 1;
    }

    const registro = { ...evento, id, dataSaida: evento.dataSaida || evento.data_saida || evento.saida || evento.data, equipamentos, equipamentosExternos, consumos, responsavel: usuarioAtual().nome };
    db.eventos.unshift(registro);
    aplicarMovimentoConsumosEvento(db, [], consumos);
    db.equipamentos.forEach((eq) => {
      if (equipamentos.includes(eq.codigo)) eq.status = "reservado";
    });
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Criou Evento", tipo: "badge-purple", detalhes: `${id} - ${registro.nome} | materiais pendentes de separação` });
    salvar(db);
    return registro;
  }

  function editarEvento(idOriginal, evento) {
    const db = dados();
    const indice = db.eventos.findIndex((item) => item.id === idOriginal);
    if (indice < 0) return null;

    const idBase = evento.id.trim().toUpperCase();
    const equipamentos = evento.equipamentos.map((codigo) => codigo.trim().toUpperCase()).filter(Boolean);
    const equipamentosExternos = evento.equipamentosExternos || [];
    const consumos = normalizarConsumosEvento(evento.consumos || evento.materiaisConsumo || []);
    const antigos = db.eventos[indice].equipamentos || [];
    const consumosAntigos = normalizarConsumosEvento(db.eventos[indice].consumos || db.eventos[indice].materiaisConsumo || []);
    let id = idBase;
    let contador = 2;

    while (db.eventos.some((item, itemIndice) => itemIndice !== indice && item.id === id)) {
      id = `${idBase}-${contador}`;
      contador += 1;
    }

    const registro = {
      ...db.eventos[indice],
      ...evento,
      id,
      dataSaida: evento.dataSaida || evento.data_saida || evento.saida || evento.data || db.eventos[indice].dataSaida || db.eventos[indice].data || "",
      equipamentos,
      equipamentosExternos,
      consumos,
      responsavel: usuarioAtual().nome
    };

    db.eventos[indice] = registro;

    db.equipamentos.forEach((eq) => {
      if (antigos.includes(eq.codigo) && !equipamentos.includes(eq.codigo)) {
        const usadoEmOutroEvento = db.eventos.some((item) => item.id !== id && (item.equipamentos || []).includes(eq.codigo));
        const usadoEmLocacao = db.locacoes.some((item) => (item.equipamentos || []).includes(eq.codigo) && item.status !== "Finalizada");
        const emManutencao = db.manutencoes.some((item) => item.codigo === eq.codigo && item.status !== "Finalizada");

        if (!usadoEmOutroEvento && !usadoEmLocacao && !emManutencao) {
          eq.status = "disponivel";
        }
      }

      if (equipamentos.includes(eq.codigo) && !antigos.includes(eq.codigo)) eq.status = "reservado";
    });

    aplicarMovimentoConsumosEvento(db, consumosAntigos, consumos);

    const adicionados = equipamentos.filter((codigo) => !antigos.includes(codigo));
    const removidos = antigos.filter((codigo) => !equipamentos.includes(codigo));
    const movimentosEvento = [];
    if (adicionados.length) movimentosEvento.push("adicionados: " + adicionados.join(", "));
    if (removidos.length) movimentosEvento.push("removidos: " + removidos.join(", "));
    const detalhesEdicaoEvento = id + " - " + registro.nome + (movimentosEvento.length ? " | " + movimentosEvento.join(" | ") : "");
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Evento", tipo: "badge-purple", detalhes: detalhesEdicaoEvento });
    salvar(db);
    return registro;
  }

  function atualizarStatusEvento(eventoId, codigos, status) {
    const db = dados();
    const evento = db.eventos.find((item) => item.id === eventoId);
    if (!evento || !statusInfo[status]) return false;

    const codigosNormalizados = codigos.map((codigo) => codigo.trim().toUpperCase());
    db.equipamentos.forEach((eq) => {
      if (codigosNormalizados.includes(eq.codigo) && (evento.equipamentos || []).includes(eq.codigo)) {
        eq.status = status;
      }
    });

    const itemTexto = codigosNormalizados.length === 1 ? "item" : "itens";


    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Atualizou Status do Evento",
      tipo: statusInfo[status].classe,
      detalhes: `${evento.id} - ${statusInfo[status].texto} (${codigosNormalizados.length} ${itemTexto}): ${codigosNormalizados.join(", ")}`
    });
    salvar(db);
    return true;
  }

  function excluirEventoFinalizado(eventoId) {
    const db = dados();
    const indice = db.eventos.findIndex((item) => item.id === eventoId);
    if (indice < 0) return false;

    const evento = db.eventos[indice];
    if (evento.status !== "Finalizado") return false;

    db.eventos.splice(indice, 1);
    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Excluiu Evento Finalizado",
      tipo: "badge-red",
      detalhes: `${evento.id} - ${evento.nome}`
    });

    salvar(db);
    return true;
  }

  function finalizarEvento(eventoId, observacao = "") {
    const db = dados();
    const evento = db.eventos.find((item) => item.id === eventoId);
    if (!evento) return false;

    evento.status = "Finalizado";
    evento.finalizadoEm = new Date().toISOString().slice(0, 10);
    evento.observacaoFinal = observacao;

    const codigos = evento.equipamentos || [];
    db.equipamentos.forEach((eq) => {
      if (codigos.includes(eq.codigo) && eq.status !== "manutencao") {
        eq.status = "disponivel";
      }
    });

    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Finalizou Evento",
      tipo: "badge-green",
      detalhes: `${evento.id} - ${evento.nome} | ${codigos.join(", ")}`
    });

    salvar(db);
    return true;
  }

  function salvarLocacao(locacao) {
    const db = dados();
    const equipamentos = locacao.equipamentos.map((codigo) => codigo.trim().toUpperCase()).filter(Boolean);
    db.locacoes.unshift({ ...locacao, equipamentos, status: "Em Andamento" });
    db.equipamentos.forEach((eq) => {
      if (equipamentos.includes(eq.codigo)) eq.status = "locado";
    });
    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Criou Locação", tipo: "badge-purple", detalhes: `${locacao.empresa} - ${equipamentos.length} equipamentos` });
    salvar(db);
  }

  function aprovarSolicitacaoFuncionario(id) {
    const db = dados();
    db.solicitacoesFuncionarios = db.solicitacoesFuncionarios || [];
    let indice = db.solicitacoesFuncionarios.findIndex((item) => item.id === id);
    const global = solicitacoesGlobais();
    const indiceGlobal = global.findIndex((item) => item.id === id);
    if (indice < 0 && indiceGlobal < 0) return null;

    const solicitacao = indice >= 0 ? db.solicitacoesFuncionarios[indice] : global[indiceGlobal];
    const funcionario = {
      nome: solicitacao.nome,
      email: solicitacao.email,
      senha: solicitacao.senha,
      telefone: solicitacao.telefone || "",
      cargo: cargoSistema(solicitacao.cargo),
      empresaId: solicitacao.empresaId,
      empresaCodigo: solicitacao.empresaCodigo || codigoAcessoEmpresa(empresaAtual()),
      empresaNome: solicitacao.empresaNome,
      status: "Ativo",
      aprovadoEm: new Date().toISOString().slice(0, 10),
      aprovadoPor: usuarioAtual().nome
    };

    db.funcionarios.push(funcionario);
    if (indice >= 0) db.solicitacoesFuncionarios.splice(indice, 1);
    if (indiceGlobal >= 0) {
      global.splice(indiceGlobal, 1);
      salvarSolicitacoesGlobais(global);
    }
    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Aprovou Funcionário",
      tipo: "badge-green",
      detalhes: `${funcionario.nome} - ${funcionario.email}`
    });
    salvar(db);
    return funcionario;
  }

  function recusarSolicitacaoFuncionario(id) {
    const db = dados();
    db.solicitacoesFuncionarios = db.solicitacoesFuncionarios || [];
    let indice = db.solicitacoesFuncionarios.findIndex((item) => item.id === id);
    const global = solicitacoesGlobais();
    const indiceGlobal = global.findIndex((item) => item.id === id);
    if (indice < 0 && indiceGlobal < 0) return false;

    const solicitacao = indice >= 0 ? db.solicitacoesFuncionarios[indice] : global[indiceGlobal];
    if (indice >= 0) db.solicitacoesFuncionarios.splice(indice, 1);
    if (indiceGlobal >= 0) {
      global.splice(indiceGlobal, 1);
      salvarSolicitacoesGlobais(global);
    }
    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Recusou Funcionário",
      tipo: "badge-red",
      detalhes: `${solicitacao.nome} - ${solicitacao.email}`
    });
    salvar(db);
    return true;
  }

  function salvarFuncionario(funcionario) {
    const id = empresaAtualId();
    const empresa = empresaAtual();
    if (!id || !empresa) return { erro: "Nenhuma empresa ativa." };
    if (emailExisteEmOutraEmpresa(funcionario.email, id)) return { erro: "Já existe um usuário cadastrado com esse e-mail em outra empresa." };

    const db = dados();
    db.funcionarios = db.funcionarios || [];
    const existente = db.funcionarios.findIndex((item) => normalizar(item.email) === normalizar(funcionario.email));
    const registro = {
      ...funcionario,
      email: funcionario.email.trim(),
      cargo: cargoSistema(funcionario.cargo),
      empresaId: id,
      empresaCodigo: codigoAcessoEmpresa(empresa),
      empresaNome: empresa.nome
    };

    if (existente >= 0) {
      db.funcionarios[existente] = { ...db.funcionarios[existente], ...registro };
    } else {
      db.funcionarios.push(registro);
    }

    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Cadastrou Usuário", tipo: "badge-green", detalhes: `${registro.nome} - ${registro.cargo}` });
    salvar(db);
    return registro;
  }

  function atualizarCargoFuncionario(email, cargo) {
    const atual = usuarioAtual();
    if (atual.cargo !== "Administrador") return { erro: "Apenas administradores podem alterar cargos." };

    const db = dados();
    const novoCargo = cargoSistema(cargo);
    const indice = (db.funcionarios || []).findIndex((funcionario) => normalizar(funcionario.email) === normalizar(email));
    if (indice < 0) return { erro: "Funcionário não encontrado." };

    const funcionario = db.funcionarios[indice];
    const admins = db.funcionarios.filter((item) => cargoSistema(item.cargo) === "Administrador");
    const removendoUltimoAdmin = cargoSistema(funcionario.cargo) === "Administrador" && novoCargo !== "Administrador" && admins.length <= 1;
    if (removendoUltimoAdmin) return { erro: "A empresa precisa manter pelo menos um administrador." };

    db.funcionarios[indice] = { ...funcionario, cargo: novoCargo };
    db.logs.unshift({
      data: hojeCurto(),
      usuario: atual.nome,
      acao: "Alterou Cargo",
      tipo: "badge-purple",
      detalhes: `${funcionario.nome} - ${novoCargo}`
    });
    salvar(db);

    if (normalizar(atual.email) === normalizar(funcionario.email)) {
      const atualizado = { ...atual, cargo: novoCargo };
      salvarJSON(USUARIO_KEY, atualizado);
      salvarJSON(SESSAO_KEY, atualizado);
    }

    return db.funcionarios[indice];
  }

  function excluirFuncionario(email) {
    const atual = usuarioAtual();
    if (atual.cargo !== "Administrador") return { erro: "Apenas administradores podem excluir funcionarios." };

    const db = dados();
    db.funcionarios = db.funcionarios || [];
    const indice = db.funcionarios.findIndex((funcionario) => normalizar(funcionario.email) === normalizar(email));
    if (indice < 0) return { erro: "Funcionario nao encontrado." };

    const funcionario = db.funcionarios[indice];
    if (normalizar(funcionario.email) === normalizar(atual.email)) {
    
  return { erro: "Voce nao pode excluir a propria conta enquanto esta logado." };
    }

    const admins = db.funcionarios.filter((item) => cargoSistema(item.cargo) === "Administrador");
    if (cargoSistema(funcionario.cargo) === "Administrador" && admins.length <= 1) {
    
  return { erro: "A empresa precisa manter pelo menos um administrador." };
    }

    db.funcionarios.splice(indice, 1);
    db.logs.unshift({
      data: hojeCurto(),
      usuario: atual.nome,
      acao: "Excluiu Funcionario",
      tipo: "badge-red",
      detalhes: `${funcionario.nome} - ${funcionario.email}`
    });
    salvar(db);
    return funcionario;
  }
  function atualizarUsuarioAtual(dadosUsuario) {
    const atual = usuarioAtual();
    const db = dados();
    const empresaId = empresaAtualId();
    const emailAtual = normalizar(atual.email || "");
    const emailNovo = normalizar(dadosUsuario.email || atual.email || "");

    if (dadosUsuario.email && emailNovo !== emailAtual) {
      const existeNaEmpresa = (db.funcionarios || []).some((funcionario) => normalizar(funcionario.email) === emailNovo && normalizar(funcionario.email) !== emailAtual);
      const pendenteNaEmpresa = (db.solicitacoesFuncionarios || []).some((funcionario) => normalizar(funcionario.email) === emailNovo && funcionario.status === "Pendente");
      if (existeNaEmpresa || pendenteNaEmpresa || emailExisteEmOutraEmpresa(dadosUsuario.email, empresaId)) {
      
  return { erro: "Ja existe um usuario cadastrado com esse e-mail." };
      }
    }

    const atualizado = {
      ...atual,
      ...dadosUsuario,
      nome: (dadosUsuario.nome || atual.nome || "").trim(),
      email: (dadosUsuario.email || atual.email || "").trim()
    };

    salvarJSON(USUARIO_KEY, atualizado);
    salvarJSON(SESSAO_KEY, atualizado);

    const indice = db.funcionarios.findIndex((funcionario) => normalizar(funcionario.email) === normalizar(atual.email));
    if (indice >= 0) {
      db.funcionarios[indice] = { ...db.funcionarios[indice], ...atualizado };
      db.logs.unshift({ data: hojeCurto(), usuario: atualizado.nome, acao: "Editou Perfil", tipo: "badge-purple", detalhes: atualizado.email || atualizado.nome });
      salvar(db);
    }

    return atualizado;
  }

  function configurarLogout() {
    document.querySelectorAll(".btn-logout").forEach((botao) => {
      botao.addEventListener("click", () => {
        localStorage.removeItem(SESSAO_KEY);
        localStorage.removeItem(EMPRESA_ATUAL_KEY);
        window.location.href = "01-login.html";
      });
    });
  }

  function iniciaisUsuario(nome) {
    return String(nome || "U")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte[0] || "")
      .join("")
      .toUpperCase() || "U";
  }

  function atualizarCabecalhoUsuario(container) {
    const usuario = usuarioAtual();
    const avatar = container.querySelector(".user-avatar");
    const nome = container.querySelector(".user-name");
    const cargo = container.querySelector(".user-role");

    if (avatar) {
      avatar.textContent = iniciaisUsuario(usuario.nome);
      if (usuario.foto) avatar.style.backgroundImage = `url(${usuario.foto})`;
    }
    if (nome) nome.textContent = usuario.nome || "Usuário";
    if (cargo) cargo.textContent = usuario.cargo || "Freelancer";
  }

  function configurarCabecalhoUsuarioGlobal() {
    if (!document.querySelector(".sidebar") || !document.querySelector(".main")) return;
    if (/01-login\.html$/i.test(location.pathname)) return;

    const parametrosPagina = new URLSearchParams(location.search);
    const cadastroPublico = /02-cadastro-funcionario\.html$/i.test(location.pathname) && parametrosPagina.has("novo");
    if (cadastroPublico) {
      document.querySelectorAll(".mobile-header-user, .topbar .user-info").forEach((item) => item.remove());
      return;
    }

    let userInfo = document.querySelector(".topbar .user-info, .mobile-header-user");
    if (!userInfo) {
      userInfo = document.createElement("div");
      userInfo.className = "user-info mobile-header-user";
      userInfo.innerHTML = `
        <div class="bell" title="Notificações" aria-label="Notificações">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
        </div>
        <div class="user-profile-trigger" title="Abrir perfil">
          <div class="user-avatar"></div>
          <div>
            <div class="user-name"></div>
            <div class="user-role"></div>
          </div>
        </div>`;
      document.body.appendChild(userInfo);
    }

    atualizarCabecalhoUsuario(userInfo);
    userInfo.querySelector(".bell")?.addEventListener("click", () => mensagem("Nenhuma notificação nova.", "info"));
    userInfo.querySelector(".user-profile-trigger")?.addEventListener("click", () => {
      if (/03-dashboard\.html$/i.test(location.pathname)) return;
      location.href = "03-dashboard.html";
    });
  }

  function viewportMobileAtivo() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches;
  }

  function limparMobileShellDesktop() {
    document.body.classList.remove("mobile-shell-ready", "mobile-more-open", "mobile-row-detail-open", "mobile-summary-ready");
    document.querySelectorAll(".mobile-appbar, .mobile-bottom-nav, .mobile-more-backdrop, .mobile-more-sheet, .mobile-row-detail-backdrop, .mobile-row-detail-sheet").forEach((item) => item.remove());
    document.querySelectorAll(".mobile-summary-row").forEach((linha) => {
      linha.classList.remove("mobile-summary-row", "is-expanded");
      linha.removeAttribute("data-mobile-summary-hash");
      delete linha.dataset.mobileSummaryHash;
      linha.querySelector(".mobile-row-summary")?.remove();
      linha.querySelector(".mobile-row-toggle")?.remove();
      linha.querySelectorAll("td.mobile-row-hidden-cell").forEach((celula) => celula.classList.remove("mobile-row-hidden-cell"));
    });
  }

  function mobileIcone(nome) {
    const atributos = 'xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icones = {
      menu: '<svg ' + atributos + '><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
      dashboard: '<svg ' + atributos + '><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
      equipamentos: '<svg ' + atributos + '><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
      eventos: '<svg ' + atributos + '><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
      locacoes: '<svg ' + atributos + '><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
      manutencao: '<svg ' + atributos + '><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.8 7.8l-6.4 6.4a2 2 0 1 1-2.8-2.8l6.4-6.4a6 6 0 0 1 7.8-7.8Z"/></svg>',
      funcionarios: '<svg ' + atributos + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      logs: '<svg ' + atributos + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
      configuracoes: '<svg ' + atributos + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.05 1.57V22a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1.05-1.57 1.7 1.7 0 0 0-1.86.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.57-1.05H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 8.4a1.7 1.7 0 0 0-.34-1.86l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.95 4.05 1.7 1.7 0 0 0 10 2.48V2a2 2 0 0 1 4 0v.48a1.7 1.7 0 0 0 1.05 1.57 1.7 1.7 0 0 0 1.86-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 8.4a1.7 1.7 0 0 0 1.57 1.55H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
      bell: '<svg ' + atributos + '><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
      close: '<svg ' + atributos + '><path d="M18 6 6 18M6 6l12 12"/></svg>',
      mais: '<svg ' + atributos + '><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      tema: '<svg ' + atributos + '><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
      sair: '<svg ' + atributos + '><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>'
    };
    return icones[nome] || icones.dashboard;
  }

  function configurarMobileShell() {
    if (!document.querySelector('.sidebar') || !document.querySelector('.main')) {
      limparMobileShellDesktop();
      return;
    }
    if (/01-login\.html$/i.test(location.pathname)) {
      limparMobileShellDesktop();
      return;
    }
  
    const parametrosPagina = new URLSearchParams(location.search);
    const cadastroPublico = /02-cadastro-funcionario\.html$/i.test(location.pathname) && parametrosPagina.has('novo');
    if (cadastroPublico || !viewportMobileAtivo()) {
      limparMobileShellDesktop();
      return;
    }
  
    document.body.classList.add('mobile-shell-ready');
    document.querySelectorAll('.mobile-appbar, .mobile-bottom-nav, .mobile-more-backdrop, .mobile-more-sheet').forEach((item) => item.remove());
  
    const usuario = usuarioAtual();
    const empresa = empresaAtual();
    const avatarFoto = usuario.foto ? ' style="background-image:url(&quot;' + textoInterfaceSeguro(usuario.foto) + '&quot;)"' : '';
    const avatarTexto = usuario.foto ? '' : textoInterfaceSeguro(iniciaisUsuario(usuario.nome));
  
    const appbar = document.createElement('header');
    appbar.className = 'mobile-appbar';
    appbar.innerHTML = `
      <button class="mobile-icon-button mobile-menu-open" type="button" aria-label="Abrir menu">${mobileIcone('menu')}</button>
      <a class="mobile-brand" href="03-dashboard.html" aria-label="StockSync">
        <img src="assets/logo-stocksync-icon.png" alt="StockSync">
        <span>StockSync</span>
      </a>
      <button class="mobile-icon-button bell mobile-bell" type="button" aria-label="Notifica\u00e7\u00f5es">${mobileIcone('bell')}</button>
      <button class="mobile-profile-chip" type="button" aria-label="Abrir perfil">
        <span class="mobile-profile-avatar"${avatarFoto}>${avatarTexto}</span>
      </button>
    `;
  
    const linksPrincipais = [
      { href: '03-dashboard.html', label: 'Dashboard', icone: 'dashboard', teste: /03-dashboard\.html$/i },
      { href: '04-equipamentos.html', label: 'Equipamentos', icone: 'equipamentos', teste: /04-equipamentos\.html|05-cadastro-equipamento\.html|06-detalhe-equipamento\.html/i },
      { href: '08-eventos.html', label: 'Eventos', icone: 'eventos', teste: /08-eventos\.html/i }
    ];
  
    const paginaAtual = location.pathname.split('/').pop() || '';
    const maisAtivo = !linksPrincipais.some((item) => item.teste.test(paginaAtual));
    const bottom = document.createElement('nav');
    bottom.className = 'mobile-bottom-nav';
    bottom.innerHTML = linksPrincipais.map((item) => `
      <a class="mobile-bottom-link ${item.teste.test(paginaAtual) ? 'active' : ''}" href="${item.href}">
        ${mobileIcone(item.icone)}
        <span>${item.label}</span>
      </a>
    `).join('') + `
      <button class="mobile-bottom-link mobile-bottom-more ${maisAtivo ? 'active' : ''}" type="button">
        ${mobileIcone('mais')}
        <span>Mais</span>
      </button>
    `;
  
    const backdrop = document.createElement('div');
    backdrop.className = 'mobile-more-backdrop';
  
    const sheet = document.createElement('aside');
    sheet.className = 'mobile-more-sheet';
    sheet.innerHTML = `
      <div class="mobile-more-handle"></div>
      <div class="mobile-more-head">
        <div class="mobile-more-user">
          <span class="mobile-more-avatar"${avatarFoto}>${avatarTexto}</span>
          <div>
            <strong>${textoInterfaceSeguro(usuario.nome || 'Usu\u00e1rio')}</strong>
            <span>${textoInterfaceSeguro(usuario.cargo || 'Freelancer')} \u00b7 C\u00f3digo: ${textoInterfaceSeguro(codigoAcessoEmpresa(empresa))}</span>
          </div>
        </div>
        <button class="mobile-icon-button mobile-more-close" type="button" aria-label="Fechar menu">${mobileIcone('close')}</button>
      </div>
      <div class="mobile-more-list">
        <a href="09-locacoes.html">${mobileIcone('locacoes')}<span>Loca\u00e7\u00f5es</span></a>
        <a href="10-manutencao-registrar.html">${mobileIcone('manutencao')}<span>Manuten\u00e7\u00e3o</span></a>
        <a href="02-cadastro-funcionario.html">${mobileIcone('funcionarios')}<span>Funcion\u00e1rios</span></a>
        <a href="12-logs.html">${mobileIcone('logs')}<span>Logs do Sistema</span></a>
        <a href="13-configuracoes.html">${mobileIcone('configuracoes')}<span>Configura\u00e7\u00f5es</span></a>
        <button class="mobile-more-theme" type="button">${mobileIcone('tema')}<span>Alternar tema</span></button>
        <button class="mobile-more-logout" type="button">${mobileIcone('sair')}<span>Sair</span></button>
      </div>
    `;
  
    document.body.append(appbar, bottom, backdrop, sheet);
  
    const abrirMenu = () => {
      backdrop.classList.add('is-open');
      sheet.classList.add('is-open');
      document.body.classList.add('mobile-more-open');
    };
    const fecharMenu = () => {
      backdrop.classList.remove('is-open');
      sheet.classList.remove('is-open');
      document.body.classList.remove('mobile-more-open');
    };
    const alternarTema = () => aplicarTema(document.documentElement.dataset.theme === 'light' ? 'escuro' : 'claro');
  
    appbar.querySelector('.mobile-menu-open')?.addEventListener('click', abrirMenu);
    bottom.querySelector('.mobile-bottom-more')?.addEventListener('click', abrirMenu);
    backdrop.addEventListener('click', fecharMenu);
    sheet.querySelector('.mobile-more-close')?.addEventListener('click', fecharMenu);
    sheet.querySelector('.mobile-more-theme')?.addEventListener('click', alternarTema);
    sheet.querySelector('.mobile-more-logout')?.addEventListener('click', () => {
      localStorage.removeItem(SESSAO_KEY);
      localStorage.removeItem(EMPRESA_ATUAL_KEY);
      window.location.href = '01-login.html';
    });
    appbar.querySelector('.mobile-bell')?.addEventListener('click', () => mensagem('Nenhuma notifica\u00e7\u00e3o nova.', 'info'));
    appbar.querySelector('.mobile-profile-chip')?.addEventListener('click', () => {
      const abrirPerfil = document.getElementById('abrirPerfil');
      if (abrirPerfil && /03-dashboard\.html$/i.test(location.pathname)) {
        abrirPerfil.click();
        return;
      }
      window.location.href = '03-dashboard.html';
    });
  }

  function configurarMobileCardsResumidos() {
    if (!viewportMobileAtivo() || !document.body.classList.contains('mobile-shell-ready')) {
      limparMobileShellDesktop();
      return;
    }
    document.body.classList.remove('mobile-summary-ready');
  
    const textoCelula = (celula) => String(celula?.textContent || '').replace(/\s+/g, ' ').trim();
    const rotuloLimpo = (texto) => normalizar(texto || '').replace(/[^a-z0-9]+/g, ' ').trim();
    const textoCurto = (texto, limite = 72) => {
      const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
      return limpo.length > limite ? limpo.slice(0, limite - 3).trimEnd() + '...' : limpo;
    };
  
    const primeiroCodigo = (texto) => {
      const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
      const candidato = limpo.split(/[,;|]/)[0]?.trim() || limpo.split(/\s+/)[0] || '';
      return candidato.replace(/[^a-zA-Z0-9_-]/g, '');
    };
    const htmlStatusResumo = (celula) => {
      if (!celula) return '';
      const controle = celula.querySelector('.status-pill-control');
      if (controle) {
        const select = controle.querySelector('select');
        const texto = (select ? select.options[select.selectedIndex]?.textContent : controle.textContent || '').trim();
        const classes = Array.from(controle.classList)
          .filter((classe) => classe !== 'status-pill-control' && classe !== 'is-disabled')
          .join(' ');
        return '<span class="status-pill-control ' + textoInterfaceSeguro(classes) + ' is-static"><span>' + textoInterfaceSeguro(texto || 'Status') + '</span></span>';
      }
  
      const badge = celula.querySelector('.badge, .event-name-badge, .consumption-badge');
      if (badge) return badge.outerHTML;
  
      const texto = textoCelula(celula);
      return texto ? '<span class="mobile-row-status-text">' + textoInterfaceSeguro(textoCurto(texto, 28)) + '</span>' : '';
    };
  
  
    const rotulosTabela = (tabela, celulas) => {
      const cabecalhos = Array.from(tabela.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      return celulas.map((celula, index) => celula.dataset.label || cabecalhos[index] || `Campo ${index + 1}`);
    };
  
    const indicePorRotulo = (rotulos, termos) => {
      const normalizados = termos.map(rotuloLimpo);
      return rotulos.findIndex((rotulo) => {
        const atual = rotuloLimpo(rotulo);
        return normalizados.some((termo) => atual === termo || atual.includes(termo));
      });
    };
  
    const resumoParaLinha = (linha, celulas, rotulos) => {
      const envoltorio = linha.closest('.table-wrap, .mobile-card-table, .maintenance-table');
      const pagina = location.pathname.split('/').pop() || '';
      const tabelaLogs = Boolean(envoltorio?.classList.contains('logs-table'));
      const tabelaEventos = Boolean(envoltorio?.classList.contains('event-list-table'));
      const tabelaDetalheEvento = Boolean(envoltorio?.classList.contains('event-detail-table'));
      const tabelaLocacoes = Boolean(envoltorio?.classList.contains('locacoes-table'));
      const tabelaManutencao = Boolean(envoltorio?.classList.contains('maintenance-table'));
      const tabelaFuncionarios = linha.parentElement?.id === 'funcionariosTabela' || linha.parentElement?.id === 'solicitacoesTabela';
      const tabelaEquipamentos = /04-equipamentos\.html$/i.test(pagina);
  
      const idx = {
        codigo: indicePorRotulo(rotulos, ['codigo', 'codigos', 'id']),
        nome: indicePorRotulo(rotulos, ['nome', 'equipamento', 'evento', 'empresa', 'material']),
        categoria: indicePorRotulo(rotulos, ['categoria']),
        quantidade: indicePorRotulo(rotulos, ['quantidade', 'qtd', 'qtd equip', 'estoque']),
        status: indicePorRotulo(rotulos, ['status', 'situacao']),
        cargo: indicePorRotulo(rotulos, ['cargo']),
        email: indicePorRotulo(rotulos, ['email', 'e mail']),
        telefone: indicePorRotulo(rotulos, ['telefone']),
        data: indicePorRotulo(rotulos, ['data do evento', 'data saida', 'data envio', 'data hora', 'data', 'saida', 'retorno']),
        local: indicePorRotulo(rotulos, ['local']),
        usuario: indicePorRotulo(rotulos, ['usuario', 'responsavel']),
        acao: indicePorRotulo(rotulos, ['acao', 'acoes']),
        problema: indicePorRotulo(rotulos, ['problema', 'detalhes'])
      };
  
      let tituloIndice = idx.nome >= 0 ? idx.nome : 0;
      let statusIndice = idx.status >= 0 ? idx.status : -1;
      let metaIndices = [];
  
      if (tabelaLogs) {
        tituloIndice = idx.acao >= 0 ? idx.acao : 2;
        statusIndice = -1;
        metaIndices = [idx.data, idx.usuario];
      } else if (tabelaEventos) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 1;
        statusIndice = -1;
        metaIndices = [idx.data, idx.local, idx.quantidade];
      } else if (tabelaFuncionarios) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 0;
        statusIndice = idx.status >= 0 ? idx.status : idx.cargo;
        metaIndices = [idx.email, idx.telefone, idx.cargo];
      } else if (tabelaLocacoes) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 0;
        statusIndice = idx.status;
        metaIndices = [idx.data, idx.quantidade];
      } else if (tabelaManutencao) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 1;
        statusIndice = idx.status;
        metaIndices = [idx.codigo, idx.problema, idx.data];
      } else if (tabelaDetalheEvento) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 1;
        statusIndice = idx.status;
        metaIndices = [idx.codigo, idx.categoria, idx.quantidade, idx.usuario];
      } else if (tabelaEquipamentos) {
        tituloIndice = idx.nome >= 0 ? idx.nome : 1;
        statusIndice = idx.status;
        metaIndices = [idx.codigo, idx.categoria, idx.quantidade];
      } else {
        statusIndice = idx.status >= 0 ? idx.status : -1;
        metaIndices = [idx.codigo, idx.categoria, idx.data, idx.local, idx.quantidade, idx.email];
      }
  
      const tituloCelula = celulas[tituloIndice] || celulas[0];
      const statusCelula = statusIndice >= 0 && statusIndice !== tituloIndice ? celulas[statusIndice] : null;
      const meta = metaIndices
        .filter((indice, pos, lista) => indice >= 0 && indice !== tituloIndice && indice !== statusIndice && lista.indexOf(indice) === pos)
        .map((indice) => textoCurto(textoCelula(celulas[indice]), 34))
        .filter(Boolean)
        .slice(0, 2);
      const codigoTexto = idx.codigo >= 0 ? primeiroCodigo(textoCelula(celulas[idx.codigo])) : '';
      const categoriaTexto = idx.categoria >= 0 ? textoCelula(celulas[idx.categoria]) : '';
      let imagem = '';
      if ((tabelaEquipamentos || tabelaDetalheEvento || tabelaManutencao) && codigoTexto) {
        const equipamento = getEquipamento(codigoTexto);
        if (equipamento) imagem = equipamento.imagem || imagemEquipamento(equipamento) || '';
      }
  
      const titulo = textoCurto(textoCelula(tituloCelula), 54) || 'Registro';
      if ((tabelaEquipamentos || tabelaDetalheEvento || tabelaManutencao) && !imagem) {
        imagem = imagemEquipamento({ nome: titulo, categoria: categoriaTexto });
      }
      return {
        titulo,
        meta,
        statusHtml: htmlStatusResumo(statusCelula),
        imagem
      };
    };
  
    const garantirGaveta = () => {
      let backdrop = document.querySelector('.mobile-row-detail-backdrop');
      let sheet = document.querySelector('.mobile-row-detail-sheet');
      if (backdrop && sheet) return { backdrop, sheet };
  
      backdrop = document.createElement('div');
      backdrop.className = 'mobile-row-detail-backdrop';
      sheet = document.createElement('aside');
      sheet.className = 'mobile-row-detail-sheet';
      sheet.innerHTML = `
        <div class="mobile-row-detail-handle"></div>
        <div class="mobile-row-detail-head">
          <div class="mobile-row-detail-title-wrap">
            <strong class="mobile-row-detail-title">Detalhes</strong>
            <span class="mobile-row-detail-subtitle"></span>
          </div>
          <button class="mobile-row-detail-close" type="button" aria-label="Fechar detalhes">&times;</button>
        </div>
        <div class="mobile-row-detail-status"></div>
        <div class="mobile-row-detail-list"></div>
      `;
  
      const fechar = () => {
        backdrop.classList.remove('is-open');
        sheet.classList.remove('is-open');
        document.body.classList.remove('mobile-row-detail-open');
      };
      backdrop.addEventListener('click', fechar);
      sheet.querySelector('.mobile-row-detail-close')?.addEventListener('click', fechar);
      document.body.append(backdrop, sheet);
      return { backdrop, sheet };
    };
  
    const abrirDetalhesLinha = (linha, resumo, celulas, rotulos) => {
      const { backdrop, sheet } = garantirGaveta();
      const titulo = sheet.querySelector('.mobile-row-detail-title');
      const subtitulo = sheet.querySelector('.mobile-row-detail-subtitle');
      const status = sheet.querySelector('.mobile-row-detail-status');
      const lista = sheet.querySelector('.mobile-row-detail-list');
  
      if (titulo) titulo.textContent = resumo.titulo || 'Detalhes';
      if (subtitulo) subtitulo.textContent = resumo.meta.join(' | ');
      if (status) status.innerHTML = resumo.statusHtml || '';
      if (lista) {
        lista.innerHTML = '';
        celulas.forEach((celula, index) => {
          const rotulo = rotulos[index] || `Campo ${index + 1}`;
          const conteudoTexto = textoCelula(celula);
          if (!conteudoTexto && !celula.children.length) return;
  
          const item = document.createElement('div');
          item.className = 'mobile-row-detail-item';
          const label = document.createElement('span');
          label.className = 'mobile-row-detail-label';
          label.textContent = rotulo;
          const valor = document.createElement('div');
          valor.className = 'mobile-row-detail-value';
          Array.from(celula.childNodes).forEach((node) => valor.appendChild(node.cloneNode(true)));
          if (!valor.textContent.trim() && !valor.children.length) valor.textContent = '-';
          item.append(label, valor);
          lista.appendChild(item);
        });
      }
  
      backdrop.classList.add('is-open');
      sheet.classList.add('is-open');
      document.body.classList.add('mobile-row-detail-open');
    };
  
    const aplicarResumo = () => {
      if (!document.body.classList.contains('mobile-shell-ready')) return;
  
      document.querySelectorAll('.table-wrap tbody tr, .mobile-card-table tbody tr, .maintenance-table tbody tr').forEach((linha) => {
        if (linha.closest('.modal, .modal-content, .modal-overlay, .mobile-row-detail-sheet')) return;
        if (linha.classList.contains('category-row')) return;
  
        const celulas = Array.from(linha.children).filter((filho) => filho.tagName === 'TD');
        if (celulas.length < 3 || celulas.some((celula) => Number(celula.getAttribute('colspan') || 1) > 1)) return;
  
        const tabela = linha.closest('table');
        if (!tabela) return;
  
        const rotulos = rotulosTabela(tabela, celulas);
        const hash = celulas.map((celula) => textoCelula(celula)).join('|');
        linha.classList.remove('is-expanded');
        celulas.forEach((celula) => celula.classList.add('mobile-row-hidden-cell'));
        if (linha.dataset.mobileSummaryHash === hash && linha.querySelector('.mobile-row-summary')) return;
  
        linha.dataset.mobileSummaryHash = hash;
        linha.classList.add('mobile-summary-row');
        linha.querySelector('.mobile-row-summary')?.remove();
        linha.querySelector('.mobile-row-toggle')?.remove();
  
        const resumo = resumoParaLinha(linha, celulas, rotulos);
        const temImagem = Boolean(resumo.imagem);
        const summary = document.createElement('div');
        summary.className = `mobile-row-summary ${temImagem ? 'has-thumb' : ''}`;
        summary.innerHTML = `
          <div class="mobile-row-summary-main">
            ${temImagem ? `<span class="mobile-row-thumb"><img src="${textoInterfaceSeguro(resumo.imagem)}" alt="" onerror="this.onerror=null;this.src='assets/equipamentos/equipamento.svg';"></span>` : ''}
            <div class="mobile-row-summary-copy">
              <strong>${textoInterfaceSeguro(resumo.titulo)}</strong>
              ${resumo.meta.length ? `<span>${resumo.meta.map(textoInterfaceSeguro).join(' | ')}</span>` : ''}
            </div>
          </div>
          ${resumo.statusHtml ? `<div class="mobile-row-summary-status">${resumo.statusHtml}</div>` : ''}
        `;
  
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'mobile-row-toggle';
        botao.setAttribute('aria-label', 'Ver detalhes');
        botao.innerHTML = '<span aria-hidden="true">&#8942;</span>';
        botao.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          abrirDetalhesLinha(linha, resumo, celulas, rotulos);
        });
  
        linha.prepend(summary);
        linha.appendChild(botao);
      });
      document.body.classList.add('mobile-summary-ready');
    };
  
    if (!document.body.dataset.mobileSummaryObserver) {
      document.body.dataset.mobileSummaryObserver = 'true';
      let agendado = false;
      const agendar = () => {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(() => {
          agendado = false;
          aplicarResumo();
        });
      };
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true });
      }
      window.addEventListener('resize', agendar);
    }
  
    aplicarResumo();
  }

  function configurarTema() {
    if (!document.querySelector(".theme-toggle")) {
      const sidebarFooter = document.querySelector(".sidebar-footer");
      if (!sidebarFooter) {
        return;
      }

      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "theme-toggle";
      sidebarFooter.prepend(botao);
    }

    atualizarBotoesTema();
    document.querySelectorAll(".theme-toggle").forEach((botao) => {
      botao.onclick = () => {
        aplicarTema(document.documentElement.dataset.theme === "light" ? "escuro" : "claro");
      };
    });
  }

  function solicitacoesPendentesAdmin() {
    const usuario = sessaoAtiva();
    if (!usuario || usuario.cargo !== "Administrador") return [];
    return solicitacoesFuncionarioEmpresa();
  }

  function configurarNotificacoesAdmin() {
    const pendentes = solicitacoesPendentesAdmin();
    const total = pendentes.length;

    document.querySelectorAll(".notification-badge, .nav-notification-badge").forEach((badge) => badge.remove());

    const navFuncionarios = [...document.querySelectorAll(".nav-item")]
      .find((item) => (item.getAttribute("href") || "").includes("02-cadastro-funcionario.html"));

    if (navFuncionarios && total > 0) {
      const badge = document.createElement("span");
      badge.className = "nav-notification-badge";
      badge.textContent = String(total);
      badge.title = total === 1 ? "1 solicitação pendente" : `${total} solicitações pendentes`;
      navFuncionarios.appendChild(badge);
    }

    document.querySelectorAll(".bell").forEach((sino) => {
      if (total > 0) {
        const badge = document.createElement("span");
        badge.className = "notification-badge";
        badge.textContent = String(total);
        sino.appendChild(badge);
        sino.title = total === 1 ? "1 funcion\u00e1rio aguardando aprova\u00e7\u00e3o" : total + " funcion\u00e1rios aguardando aprova\u00e7\u00e3o";

        sino.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.location.href = "02-cadastro-funcionario.html";
        }, true);
      } else {
        sino.title = "Nenhuma solicita\u00e7\u00e3o pendente";
      }
    });
  }

  function tipoMensagem(tipo) {
    if (["success", "error", "warning", "info"].includes(tipo)) return tipo;
    return "info";
  }

  function textoInterfaceSeguro(texto) {
    return String(texto || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function mensagem(texto, tipo = "info", opcoes = {}) {
    const zonaId = "systemToastZone";
    let zona = document.getElementById(zonaId);
    if (!zona) {
      zona = document.createElement("div");
      zona.id = zonaId;
      zona.className = "system-toast-zone";
      document.body.appendChild(zona);
    }

    const toast = document.createElement("div");
    toast.className = `system-toast system-toast-${tipoMensagem(tipo)}`;
    toast.innerHTML = `
      <div class="system-toast-mark"></div>
      <div class="system-toast-text">${textoInterfaceSeguro(texto)}</div>
      <button class="system-toast-close" type="button" aria-label="Fechar aviso">×</button>
    `;

    const fechar = () => {
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 180);
    };

    toast.querySelector(".system-toast-close").addEventListener("click", fechar);
    zona.appendChild(toast);
    setTimeout(fechar, opcoes.tempo || 3600);
    return toast;
  }

  function confirmar(texto, aoConfirmar, opcoes = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "system-confirm-overlay";
      overlay.innerHTML = `
        <div class="system-confirm">
          <div class="system-confirm-title">${textoInterfaceSeguro(opcoes.titulo || "Confirmar ação")}</div>
          <div class="system-confirm-text">${textoInterfaceSeguro(texto)}</div>
          <div class="system-confirm-actions">
            <button class="btn btn-ghost" type="button" data-action="cancelar">${textoInterfaceSeguro(opcoes.cancelar || "Cancelar")}</button>
            <button class="btn ${opcoes.perigo ? "btn-danger" : "btn-primary"}" type="button" data-action="confirmar">${textoInterfaceSeguro(opcoes.confirmar || "Confirmar")}</button>
          </div>
        </div>
      `;

      const fechar = (valor) => {
        overlay.remove();
        resolve(valor);
      };

      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.dataset.action === "cancelar") fechar(false);
        if (event.target.dataset.action === "confirmar") {
          fechar(true);
          if (typeof aoConfirmar === "function") aoConfirmar();
        }
      });

      document.body.appendChild(overlay);
      overlay.querySelector("[data-action='confirmar']").focus();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    configurarTema();
    configurarCabecalhoUsuarioGlobal();
    const atualizarMobileResponsivo = () => {
      configurarMobileShell();
      configurarMobileCardsResumidos();
    };
    atualizarMobileResponsivo();
    let mobileResizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(mobileResizeTimer);
      mobileResizeTimer = setTimeout(atualizarMobileResponsivo, 120);
    });
    configurarNotificacoesAdmin();
    configurarLogout();
    iniciarSincronizacaoBackend();
  });


  return {
    dados, salvar, log, normalizar, badge, statusInfo, dataBR, mensagem, imagemEquipamento,
    getEquipamento, salvarEquipamento, salvarEquipamentosEmLote, removerEquipamento, getMaterialConsumo, salvarMaterialConsumo, removerMaterialConsumo, enviarManutencao, finalizarManutencao,
    salvarEvento, editarEvento, atualizarStatusEvento, excluirEventoFinalizado, finalizarEvento, salvarLocacao, salvarFuncionario, atualizarCargoFuncionario, excluirFuncionario, aprovarSolicitacaoFuncionario, recusarSolicitacaoFuncionario,
    empresas, empresaAtual, salvarEmpresaAtual, codigoEmpresa: codigoAcessoEmpresa, usuarioAtual, sessaoAtiva, autenticar, cadastrarEmpresa, cadastrarFuncionarioPorCodigo, solicitacoesFuncionarioEmpresa, atualizarUsuarioAtual, buscarEmpresa, confirmar, atualizarLogosTema, aplicarTema, categoriasEstoque, salvarCategoriasEstoque, categoriaEstoqueCanonica
  };
})();













