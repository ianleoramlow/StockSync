const GE = (() => {
  const LEGACY_KEY = "ge_dados";
  const EMPRESAS_KEY = "ge_empresas";
  const EMPRESA_ATUAL_KEY = "empresaAtualId";
  const USUARIO_KEY = "usuario";
  const SESSAO_KEY = "usuarioLogado";
  const TEMA_KEY = "stocksyncTema";
  const SOLICITACOES_KEY = "ge_solicitacoes_funcionarios";
  const BACKEND_MISSING = Symbol("backend_missing");
  const backendCache = new Map();
  let backendDisponivel = null;

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
      if (corpo !== null) xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(corpo !== null ? JSON.stringify(corpo) : null);

      if (xhr.status < 200 || xhr.status >= 300) return null;
      return xhr.responseText ? JSON.parse(xhr.responseText) : {};
    } catch (error) {
      backendDisponivel = false;
      return null;
    }
  }

  function backendAtivo() {
    if (backendDisponivel !== null) return backendDisponivel;
    const resposta = requisicaoBackend("GET", "/api/health");
    backendDisponivel = Boolean(resposta?.ok);
    return backendDisponivel;
  }

  function lerBackend(chave) {
    if (!chaveCompartilhada(chave) || !backendAtivo()) return BACKEND_MISSING;
    if (backendCache.has(chave)) return backendCache.get(chave);

    const resposta = requisicaoBackend("GET", `/api/storage/${encodeURIComponent(chave)}`);
    if (!resposta?.exists) return BACKEND_MISSING;

    backendCache.set(chave, resposta.value);
    return resposta.value;
  }

  function salvarBackend(chave, valor) {
    if (!chaveCompartilhada(chave) || !backendAtivo()) return;
    backendCache.set(chave, valor);
    requisicaoBackend("PUT", `/api/storage/${encodeURIComponent(chave)}`, { value: valor });
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
    eventos: [
      { id: "EVT123", nome: "Show de Verão 2024", data: "2024-01-20", local: "Arena Anhembi", equipamentos: ["EQP002"], responsavel: "João Silva" }
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
      { codigo: "SOM001", nome: "Mesa de Som Behringer X32", categoria: "Som", status: "disponivel", descricao: "Mesa digital de 32 canais para eventos de medio e grande porte" },
      { codigo: "SOM002", nome: "Mesa de Som Yamaha MG16XU", categoria: "Som", status: "disponivel", descricao: "Mesa analogica de 16 canais com efeitos integrados" },
      { codigo: "SOM003", nome: "Caixa Ativa JBL PRX 715", categoria: "Som", status: "disponivel", descricao: "Caixa ativa de 15 polegadas para PA" },
      { codigo: "SOM004", nome: "Caixa Ativa JBL PRX 715 02", categoria: "Som", status: "disponivel", descricao: "Caixa ativa de 15 polegadas para PA" },
      { codigo: "SOM005", nome: "Subwoofer JBL PRX 818XLFW", categoria: "Som", status: "disponivel", descricao: "Subwoofer ativo de 18 polegadas" },
      { codigo: "SOM006", nome: "Subwoofer JBL PRX 818XLFW 02", categoria: "Som", status: "disponivel", descricao: "Subwoofer ativo de 18 polegadas" },
      { codigo: "SOM007", nome: "Retorno de Palco Attack VRM 1230A", categoria: "Som", status: "disponivel", descricao: "Monitor ativo para retorno de palco" },
      { codigo: "SOM008", nome: "Retorno de Palco Attack VRM 1230A 02", categoria: "Som", status: "disponivel", descricao: "Monitor ativo para retorno de palco" },
      { codigo: "LED001", nome: "Processadora NovaStar VX4S", categoria: "Painel de LED", status: "disponivel", descricao: "Processadora de video para painel de LED" },
      { codigo: "LED002", nome: "Sender Box NovaStar MCTRL300", categoria: "Painel de LED", status: "disponivel", descricao: "Controladora para envio de sinal de LED" },
      { codigo: "LUZ001", nome: "Mesa DMX Avolites Titan Mobile", categoria: "Iluminacao", status: "disponivel", descricao: "Controladora DMX para iluminacao profissional" },
      { codigo: "LUZ002", nome: "Maquina de Fumaca 1500W", categoria: "Iluminacao", status: "disponivel", descricao: "Maquina de fumaca para efeitos de palco" },
      { codigo: "EST001", nome: "Totem Box Truss Q30 2m", categoria: "Estrutura", status: "disponivel", descricao: "Totem de trelica Q30 para suporte de luz" },
      { codigo: "EST002", nome: "Totem Box Truss Q30 2m 02", categoria: "Estrutura", status: "disponivel", descricao: "Totem de trelica Q30 para suporte de luz" },
      { codigo: "ENE001", nome: "Main Power 12 Canais", categoria: "Energia", status: "disponivel", descricao: "Distribuidor de energia para palco" },
      { codigo: "ENE002", nome: "Nobreak SMS 3200VA", categoria: "Energia", status: "disponivel", descricao: "Nobreak para mesa de som, processadoras e computadores" }
    ];

    const grupos = [
      { prefixo: "MIC", total: 8, nome: "Microfone Shure SM58", categoria: "Som", descricao: "Microfone dinamico vocal com fio" },
      { prefixo: "MICF", total: 4, nome: "Microfone Sem Fio Kadosh K-502M", categoria: "Som", descricao: "Microfone sem fio duplo UHF" },
      { prefixo: "XLR", total: 20, nome: "Cabo XLR 10m", categoria: "Cabos", descricao: "Cabo balanceado XLR para microfones e sinal de audio" },
      { prefixo: "P10", total: 12, nome: "Cabo P10 5m", categoria: "Cabos", descricao: "Cabo P10 para instrumentos e conexoes de audio" },
      { prefixo: "HDMI", total: 8, nome: "Cabo HDMI 15m", categoria: "Cabos", descricao: "Cabo HDMI para video e painel de LED" },
      { prefixo: "ENER", total: 16, nome: "Extensao de Energia 20m", categoria: "Energia", descricao: "Extensao eletrica para distribuicao no evento" },
      { prefixo: "LED", total: 24, nome: "Placa Painel de LED P3.91", categoria: "Painel de LED", descricao: "Modulo de painel de LED indoor/outdoor P3.91" },
      { prefixo: "MOV", total: 8, nome: "Moving Head Beam 230", categoria: "Iluminacao", descricao: "Moving head beam para efeitos de palco" },
      { prefixo: "PAR", total: 16, nome: "Par LED RGBW 18x12W", categoria: "Iluminacao", descricao: "Refletor PAR LED RGBW para palco e decoracao" },
      { prefixo: "STB", total: 4, nome: "Strobo LED 1500W", categoria: "Iluminacao", descricao: "Strobo LED para efeitos de impacto" }
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
    const valorBackend = lerBackend(chave);
    if (valorBackend !== BACKEND_MISSING) return valorBackend || fallback;

    try {
      const valorLocal = JSON.parse(localStorage.getItem(chave) || "null");
      if (valorLocal && chaveCompartilhada(chave)) salvarBackend(chave, valorLocal);
      return valorLocal || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function salvarJSON(chave, valor) {
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
      equipamentos: estoqueInicialEquipamentos(),
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
    const trocas = [
      ["DisponÃ­vel", "Disponível"],
      ["ManutenÃ§Ã£o", "Manutenção"],
      ["IluminaÃ§Ã£o", "Iluminação"],
      ["VerÃ£o", "Verão"],
      ["JoÃ£o", "João"],
      ["LocaÃ§Ã£o", "Locação"],
      ["ProduÃ§Ãµes", "Produções"],
      ["UsuÃ¡rio", "Usuário"],
      ["TÃ©cnico", "Técnico"],
      ["Ã¡udio", "áudio"],
      ["cÃ¡psula", "cápsula"],
      ["dinÃ¢mico", "dinâmico"],
      ["descriÃ§Ã£o", "descricao"],
      ['"usuÃ¡rio"', '"usuario"'],
      ['"descriÃ§Ã£o"', '"descricao"']
    ];
    let texto = JSON.stringify(db || {});
    trocas.forEach(([errado, certo]) => {
      texto = texto.replaceAll(errado, certo);
    });
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
    if (!db.estoqueInicialCriado && db.equipamentos.length === 0) {
      db.equipamentos = estoqueInicialEquipamentos();
      db.logs.unshift({
        data: hojeCurto(),
        usuario: "StockSync",
        acao: "Carregou Estoque Inicial",
        tipo: "badge-green",
        detalhes: `${db.equipamentos.length} equipamentos de exemplo`
      });
    }
    if (!db.estoqueGeralCriado) {
      const codigosAtuais = new Set(db.equipamentos.map((eq) => eq.codigo));
      const novosEquipamentos = estoqueInicialEquipamentos().filter((eq) => !codigosAtuais.has(eq.codigo));
      db.equipamentos.push(...novosEquipamentos);
      if (novosEquipamentos.length) {
        db.logs.unshift({
          data: hojeCurto(),
          usuario: "StockSync",
          acao: "Atualizou Estoque Inicial",
          tipo: "badge-green",
          detalhes: `${novosEquipamentos.length} equipamentos adicionados`
        });
      }
      db.estoqueGeralCriado = true;
    }
    if (!db.estoqueInicialCriado && db.equipamentos.length > 0) {
      db.estoqueInicialCriado = true;
    }
    aplicarImagensEquipamentos(db);
    salvarJSON(chaveEmpresa(id), db);
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

  function salvarEquipamento(equipamento) {
    const db = dados();
    const codigo = equipamento.codigo.trim().toUpperCase();
    const existente = db.equipamentos.findIndex((eq) => eq.codigo === codigo);
    const registroBase = { ...equipamento, codigo, status: equipamento.status || "disponivel" };
    const registro = {
      ...registroBase,
      imagem: equipamento.imagem || db.equipamentos[existente]?.imagem || imagemEquipamento(registroBase)
    };

    if (existente >= 0) {
      db.equipamentos[existente] = { ...db.equipamentos[existente], ...registro };
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Equipamento", tipo: "badge-purple", detalhes: `${codigo} - ${registro.nome}` });
    } else {
      db.equipamentos.push(registro);
      db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Cadastrou Equipamento", tipo: "badge-green", detalhes: `${codigo} - ${registro.nome}` });
    }

    salvar(db);
  }

  function salvarEquipamentosEmLote(equipamento, quantidade) {
    const total = Math.max(1, Number(quantidade) || 1);
    const db = dados();
    const codigoBase = equipamento.codigo.trim().toUpperCase();
    const match = codigoBase.match(/^(.*?)(\d+)$/);
    const criados = [];

    for (let i = 0; i < total; i++) {
      const codigo = match
        ? `${match[1]}${String(Number(match[2]) + i).padStart(match[2].length, "0")}`
        : total === 1 ? codigoBase : `${codigoBase}-${String(i + 1).padStart(2, "0")}`;

      if (db.equipamentos.some((eq) => eq.codigo === codigo)) continue;

      db.equipamentos.push({
        ...equipamento,
        codigo,
        nome: total > 1 ? `${equipamento.nome} ${String(i + 1).padStart(2, "0")}` : equipamento.nome,
        status: equipamento.status || "disponivel",
        imagem: equipamento.imagem || imagemEquipamento(equipamento)
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

    if (!eq || !manutencao) return false;

    eq.status = "disponivel";
    manutencao.status = "Finalizada";
    manutencao.finalizadaEm = new Date().toISOString().slice(0, 10);
    manutencao.observacaoFinal = observacao;

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
    let id = idBase;
    let contador = 2;

    while (db.eventos.some((item) => item.id === id)) {
      id = `${idBase}-${contador}`;
      contador += 1;
    }

    const registro = { ...evento, id, equipamentos, equipamentosExternos, responsavel: usuarioAtual().nome };
    db.eventos.unshift(registro);
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
    const antigos = db.eventos[indice].equipamentos || [];
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
      equipamentos,
      equipamentosExternos,
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

    db.logs.unshift({ data: hojeCurto(), usuario: usuarioAtual().nome, acao: "Editou Evento", tipo: "badge-purple", detalhes: `${id} - ${registro.nome}` });
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

    db.logs.unshift({
      data: hojeCurto(),
      usuario: usuarioAtual().nome,
      acao: "Atualizou Status do Evento",
      tipo: statusInfo[status].classe,
      detalhes: `${evento.id} - ${statusInfo[status].texto} (${codigosNormalizados.length} item(ns))`
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
      detalhes: `${evento.id} - ${evento.nome}`
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
      badge.title = `${total} solicitação(ões) pendente(s)`;
      navFuncionarios.appendChild(badge);
    }

    const sino = document.querySelector(".bell");
    if (!sino) return;

    if (total > 0) {
      const badge = document.createElement("span");
      badge.className = "notification-badge";
      badge.textContent = String(total);
      sino.appendChild(badge);
      sino.title = `${total} funcionário(s) aguardando aprovação`;

      sino.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.location.href = "02-cadastro-funcionario.html";
      }, true);
    } else {
      sino.title = "Nenhuma solicitação pendente";
    }
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
    configurarNotificacoesAdmin();
    configurarLogout();
  });

  return {
    dados, salvar, log, normalizar, badge, statusInfo, dataBR, mensagem, imagemEquipamento,
    getEquipamento, salvarEquipamento, salvarEquipamentosEmLote, removerEquipamento, enviarManutencao, finalizarManutencao,
    salvarEvento, editarEvento, atualizarStatusEvento, finalizarEvento, salvarLocacao, salvarFuncionario, atualizarCargoFuncionario, aprovarSolicitacaoFuncionario, recusarSolicitacaoFuncionario,
    empresas, empresaAtual, codigoEmpresa: codigoAcessoEmpresa, usuarioAtual, sessaoAtiva, autenticar, cadastrarEmpresa, cadastrarFuncionarioPorCodigo, solicitacoesFuncionarioEmpresa, atualizarUsuarioAtual, buscarEmpresa, confirmar, atualizarLogosTema
  };
})();
