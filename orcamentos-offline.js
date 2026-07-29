(function () {
  "use strict";

  const TIPO_ARQUIVO = "stocksync-orcamento-offline";
  const VERSAO_ARQUIVO = 1;
  const categorias = ["Som", "Ilumina\u00e7\u00e3o", "Painel de LED", "Cabos", "Energia", "Estrutura", "Consumo", "V\u00eddeo", "Transporte", "M\u00e3o de obra", "Servi\u00e7os", "Outros"];
  const unidades = ["un.", "unidade", "dia", "servi\u00e7o", "servico", "metro", "hora", "pacote", "rolo", "frasco"];
  const origensItem = ["Estoque", "Terceiros"];
  const LOGO_AREA_PDF = Object.freeze({ largura: 190, altura: 70 });
  const LOGO_AJUSTE_PADRAO = Object.freeze({ zoom: 100, offsetX: 0, offsetY: 0 });
  const LOGO_AJUSTE_LIMITES = Object.freeze({
    zoom: [50, 600],
    offsetX: [-260, 260],
    offsetY: [-260, 260]
  });
  let sequenciaSessao = 1;
  let arquivoHandleAtual = null;
  let nomeArquivoAtual = "";
  let alteracoesPendentes = false;
  let logoEmpresaDataUrl = "";
  let logoAjusteAtual = { ...LOGO_AJUSTE_PADRAO };
  let itens = [];
  let equipeServicos = [];
  let empresasStorageCache = null;
  let dadosEmpresaStorageCache = null;
  let hidratacaoContextoPromise = null;

  const $ = (seletor) => document.querySelector(seletor);
  const $$ = (seletor) => Array.from(document.querySelectorAll(seletor));

  const campos = {
    empresaNome: $("#empresaNome"),
    empresaDocumento: $("#empresaDocumento"),
    empresaTelefone: $("#empresaTelefone"),
    empresaEmail: $("#empresaEmail"),
    empresaEndereco: $("#empresaEndereco"),
    orcNumero: $("#orcNumero"),
    orcEmissao: $("#orcEmissao"),
    condValidade: $("#condValidade"),
    condVencimento: $("#condVencimento"),
    clienteNome: $("#clienteNome"),
    clienteDocumento: $("#clienteDocumento"),
    clienteTelefone: $("#clienteTelefone"),
    clienteEmail: $("#clienteEmail"),
    clienteEndereco: $("#clienteEndereco"),
    eventoNome: $("#eventoNome"),
    eventoDataInicio: $("#eventoDataInicio"),
    eventoDataFim: $("#eventoDataFim"),
    eventoHorarioInicio: $("#eventoHorarioInicio"),
    eventoHorarioFim: $("#eventoHorarioFim"),
    eventoCidadeUf: $("#eventoCidadeUf"),
    eventoLocal: $("#eventoLocal"),
    pdfModoValores: $("#pdfModoValores"),
    logoZoom: $("#logoZoom"),
    valorFrete: $("#valorFrete"),
    valorMontagem: $("#valorMontagem"),
    valorDesmontagem: $("#valorDesmontagem"),
    valorTaxas: $("#valorTaxas"),
    descontoTipo: $("#descontoTipo"),
    descontoGeral: $("#descontoGeral"),
    condPagamento: $("#condPagamento"),
    condEntrada: $("#condEntrada"),
    condPrazoMontagem: $("#condPrazoMontagem"),
    condPrazoDesmontagem: $("#condPrazoDesmontagem"),
    condObservacoes: $("#condObservacoes"),
    condTermos: $("#condTermos")
  };

  function hojeISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function somarDias(dias) {
    const data = new Date();
    data.setDate(data.getDate() + dias);
    return data.toISOString().slice(0, 10);
  }

  function numeroSugerido() {
    const ano = new Date().getFullYear();
    return `${ano}-${String(sequenciaSessao).padStart(4, "0")}`;
  }

  function numero(valor) {
    const n = Number(String(valor ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  function limitarNumero(valor, min, max, fallback) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizarLogoAjuste(ajuste = {}) {
    const zoomLegado = ajuste.zoom ?? (ajuste.largura ? (Number(ajuste.largura) / LOGO_AREA_PDF.largura) * 100 : LOGO_AJUSTE_PADRAO.zoom);
    return {
      zoom: limitarNumero(zoomLegado, LOGO_AJUSTE_LIMITES.zoom[0], LOGO_AJUSTE_LIMITES.zoom[1], LOGO_AJUSTE_PADRAO.zoom),
      offsetX: limitarNumero(ajuste.offsetX, LOGO_AJUSTE_LIMITES.offsetX[0], LOGO_AJUSTE_LIMITES.offsetX[1], LOGO_AJUSTE_PADRAO.offsetX),
      offsetY: limitarNumero(ajuste.offsetY, LOGO_AJUSTE_LIMITES.offsetY[0], LOGO_AJUSTE_LIMITES.offsetY[1], LOGO_AJUSTE_PADRAO.offsetY)
    };
  }

  function aplicarAjusteInicialLogo(dataUrl) {
    if (!dataUrl || typeof Image === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const proporcaoLogo = img.width / Math.max(1, img.height);
        const proporcaoMoldura = LOGO_AREA_PDF.largura / LOGO_AREA_PDF.altura;
        const precisaPreencherHorizontal = proporcaoLogo < proporcaoMoldura;
        const zoomPreenchimento = precisaPreencherHorizontal ? Math.ceil((proporcaoMoldura / proporcaoLogo) * 100) : 100;
        logoAjusteAtual = normalizarLogoAjuste({
          zoom: Math.max(LOGO_AJUSTE_PADRAO.zoom, zoomPreenchimento),
          offsetX: 0,
          offsetY: 0
        });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  function dinheiro(valor) {
    return numero(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function dataBR(valor) {
    if (!valor) return "";
    const partes = String(valor).slice(0, 10).split("-");
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(valor);
  }

  function textoSeguro(valor) {
    return String(valor ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function mensagem(texto, tipo = "success") {
    if (window.GE?.mensagem) GE.mensagem(texto, tipo);
  }

  async function confirmar(texto) {
    if (window.GE?.confirmar) return GE.confirmar(texto);
    return Promise.resolve(window.confirm(texto));
  }

  function primeiroValorTexto(...valores) {
    for (const valor of valores) {
      const texto = String(valor || "").trim();
      if (texto) return texto;
    }
    return "";
  }

  function lerLocalJSON(chave, fallback = null) {
    try {
      if (typeof localStorage === "undefined") return fallback;
      const valor = localStorage.getItem(chave);
      return valor ? JSON.parse(valor) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function sessaoContexto() {
    return window.GE?.sessaoAtiva?.()
      || window.GE?.usuarioAtual?.()
      || lerLocalJSON("usuarioLogado", null)
      || lerLocalJSON("usuario", null)
      || {};
  }

  function empresaAtualIdContexto() {
    const sessao = sessaoContexto();
    const empresaGE = window.GE?.empresaAtual?.() || {};
    const localId = typeof localStorage !== "undefined" ? localStorage.getItem("empresaAtualId") : "";
    return primeiroValorTexto(sessao.empresaId, empresaGE.id, localId);
  }

  function chaveDadosEmpresaAtual() {
    const id = empresaAtualIdContexto();
    return id ? `ge_dados_${id}` : "";
  }

  function listaEmpresasContexto() {
    const listas = [
      Array.isArray(empresasStorageCache) ? empresasStorageCache : [],
      window.GE?.empresas?.() || [],
      lerLocalJSON("ge_empresas", [])
    ];
    const mapa = new Map();
    listas.flat().forEach((empresa) => {
      if (!empresa || typeof empresa !== "object") return;
      const id = primeiroValorTexto(empresa.id, empresa.codigo, empresa.nome);
      if (!id) return;
      mapa.set(id, { ...(mapa.get(id) || {}), ...empresa });
    });
    return Array.from(mapa.values());
  }

  function dadosEmpresaContexto() {
    const chave = chaveDadosEmpresaAtual();
    const candidatos = [
      dadosEmpresaStorageCache,
      chave ? lerLocalJSON(chave, null) : null,
      window.GE?.dados?.()
    ].filter((item) => item && typeof item === "object");
    return candidatos.find((item) => Array.isArray(item.equipamentos) || Array.isArray(item.materiaisConsumo)) || {};
  }

  async function lerStorageAPI(chave) {
    if (!chave || typeof fetch !== "function" || !location.protocol.startsWith("http")) return null;
    try {
      const resposta = await fetch(`/api/storage/${encodeURIComponent(chave)}`, {
        headers: {
          Accept: "application/json",
          "X-StockSync-Client": "stocksync-web"
        },
        cache: "no-store"
      });
      if (!resposta.ok) return null;
      const payload = await resposta.json();
      return payload?.exists ? payload.value : null;
    } catch (_) {
      return null;
    }
  }

  function atualizarSugestaoAtiva() {
    const ativo = document.activeElement;
    if (ativo?.dataset?.field === "descricao") {
      renderSugestoesEstoque(ativo.closest("tr"), ativo.value);
    }
  }

  function atualizarContextoOrcamento() {
    atualizarSugestoes();
    aplicarDadosEmpresaConfiguracoes({ sobrescrever: false });
    atualizarSugestaoAtiva();
  }

  async function hidratarContextoStockSync() {
    if (hidratacaoContextoPromise) return hidratacaoContextoPromise;
    hidratacaoContextoPromise = (async () => {
      const [empresasRemotas, dadosRemotos] = await Promise.all([
        lerStorageAPI("ge_empresas"),
        lerStorageAPI(chaveDadosEmpresaAtual())
      ]);
      if (Array.isArray(empresasRemotas)) empresasStorageCache = empresasRemotas;
      if (dadosRemotos && typeof dadosRemotos === "object") dadosEmpresaStorageCache = dadosRemotos;
      atualizarContextoOrcamento();
    })().finally(() => {
      hidratacaoContextoPromise = null;
    });
    return hidratacaoContextoPromise;
  }

  function dadosEmpresaConfiguracoes() {
    const empresaId = empresaAtualIdContexto();
    const empresa = window.GE?.empresaAtual?.()
      || listaEmpresasContexto().find((item) => item.id === empresaId)
      || {};
    const sessao = sessaoContexto();
    return {
      nome: primeiroValorTexto(empresa.nome, sessao.empresaNome),
      documento: primeiroValorTexto(empresa.cnpj, empresa.documento, empresa.cpfCnpj),
      telefone: primeiroValorTexto(empresa.telefone, empresa.celular),
      email: primeiroValorTexto(empresa.email, empresa.emailComercial),
      endereco: primeiroValorTexto(empresa.endereco, empresa.enderecoCompleto),
      logo: ""
    };
  }

  function empresaPadrao() {
    return dadosEmpresaConfiguracoes();
  }

  function normalizarEmpresaDocumento(empresa = {}) {
    const padrao = empresaPadrao();
    return {
      nome: primeiroValorTexto(empresa.nome, padrao.nome),
      documento: primeiroValorTexto(empresa.documento, empresa.cnpj, empresa.cpfCnpj, padrao.documento),
      telefone: primeiroValorTexto(empresa.telefone, padrao.telefone),
      email: primeiroValorTexto(empresa.email, padrao.email),
      endereco: primeiroValorTexto(empresa.endereco, padrao.endereco),
      logo: primeiroValorTexto(empresa.logo, padrao.logo)
    };
  }

  function normalizarOrigemItem(origem) {
    return normalizarBusca(origem) === "terceiros" ? "Terceiros" : "Estoque";
  }

  function novoItem(origem = "Estoque") {
    const origemNormalizada = normalizarOrigemItem(origem);
    return {
      id: `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      origem: origemNormalizada,
      categoria: origemNormalizada === "Terceiros" ? "Outros" : "Som",
      descricao: "",
      quantidade: 1,
      unidade: "un.",
      diarias: 1,
      valorUnitario: 0,
      desconto: 0,
      observacoes: ""
    };
  }

  function novoServicoEquipe() {
    return {
      id: `EQP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      descricao: "",
      quantidade: 1,
      diarias: 1,
      valorDiaria: 0,
      observacoes: ""
    };
  }

  function novoDocumento() {
    return {
      tipo: TIPO_ARQUIVO,
      versao: VERSAO_ARQUIVO,
      numero: numeroSugerido(),
      emissao: hojeISO(),
      empresa: empresaPadrao(),
      cliente: { nome: "", documento: "", telefone: "", email: "", endereco: "" },
      evento: { nome: "", data: "", dataInicio: "", dataFim: "", horario: "", horarioInicio: "", horarioFim: "", local: "", cidadeUf: "" },
      pdf: { modoValores: "detalhado", logo: { ...LOGO_AJUSTE_PADRAO } },
      itens: [novoItem()],
      equipeServicos: [],
      adicionais: {
        frete: 0,
        montagem: 0,
        desmontagem: 0,
        taxas: 0,
        descontoTipo: "valor",
        descontoGeral: 0
      },
      condicoes: {
        pagamento: "50% entrada / 50% ate 3 dias antes do evento",
        entrada: "",
        vencimento: "",
        validade: somarDias(15),
        prazoMontagem: "A combinar",
        prazoDesmontagem: "A combinar",
        observacoes: "Proposta valida conforme data acima.\nAlteracoes depois da aprovacao podem gerar custos adicionais.\nEquipamentos sujeitos a disponibilidade.",
        termos: "A reserva da data ocorre mediante confirmacao e pagamento da entrada combinada."
      }
    };
  }

  function normalizarItem(item = {}) {
    const origem = normalizarOrigemItem(item.origem);
    return {
      id: item.id || `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      origem,
      categoria: item.categoria || (origem === "Terceiros" ? "Outros" : "Som"),
      descricao: item.descricao || item.nome || "",
      quantidade: Math.max(0, numero(item.quantidade || 1)),
      unidade: item.unidade || "un.",
      diarias: Math.max(1, numero(item.diarias || 1)),
      valorUnitario: Math.max(0, numero(item.valorUnitario)),
      desconto: Math.max(0, numero(item.desconto)),
      observacoes: item.observacoes || ""
    };
  }

  function normalizarServicoEquipe(servico = {}) {
    return {
      id: servico.id || `EQP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      descricao: servico.descricao || servico.nome || "",
      quantidade: Math.max(0, numero(servico.quantidade || 1)),
      diarias: Math.max(1, numero(servico.diarias || 1)),
      valorDiaria: servico.valorDiaria ?? servico.valorUnitario ?? 0,
      observacoes: servico.observacoes || ""
    };
  }

  function normalizarDocumento(documento = {}) {
    const base = novoDocumento();
    const equipeDoDocumento = Array.isArray(documento.equipeServicos) ? documento.equipeServicos.map(normalizarServicoEquipe) : [];
    if (!equipeDoDocumento.length && numero(documento.adicionais?.servicos) > 0) {
      equipeDoDocumento.push({
        ...novoServicoEquipe(),
        descricao: "Equipe / servicos",
        valorDiaria: documento.adicionais.servicos
      });
    }
    const eventoOriginal = documento.evento || {};
    const normalizado = {
      ...base,
      ...documento,
      empresa: normalizarEmpresaDocumento(documento.empresa || {}),
      cliente: { ...base.cliente, ...(documento.cliente || {}) },
      evento: {
        ...base.evento,
        ...eventoOriginal,
        dataInicio: eventoOriginal.dataInicio || eventoOriginal.data || "",
        dataFim: eventoOriginal.dataFim || "",
        horarioInicio: eventoOriginal.horarioInicio || eventoOriginal.horario || "",
        horarioFim: eventoOriginal.horarioFim || ""
      },
      pdf: { ...base.pdf, ...(documento.pdf || {}) },
      adicionais: { ...base.adicionais, ...(documento.adicionais || {}) },
      condicoes: { ...base.condicoes, ...(documento.condicoes || {}) },
      itens: Array.isArray(documento.itens) ? documento.itens.map(normalizarItem) : [novoItem()],
      equipeServicos: equipeDoDocumento
    };
    delete normalizado.adicionais.servicos;
    normalizado.pdf.logo = normalizarLogoAjuste(normalizado.pdf.logo || documento.logoAjuste || {});
    if (!normalizado.itens.length) normalizado.itens = [novoItem()];
    return normalizado;
  }

  function setValor(campo, valor) {
    if (campo) campo.value = valor ?? "";
  }

  function aplicarDadosEmpresaConfiguracoes({ sobrescrever = false } = {}) {
    const empresa = empresaPadrao();
    const mapa = [
      [campos.empresaNome, empresa.nome],
      [campos.empresaDocumento, empresa.documento],
      [campos.empresaTelefone, empresa.telefone],
      [campos.empresaEmail, empresa.email],
      [campos.empresaEndereco, empresa.endereco]
    ];
    let alterou = false;
    mapa.forEach(([campo, valor]) => {
      const texto = String(valor || "").trim();
      if (!campo || !texto) return;
      if (sobrescrever || !String(campo.value || "").trim()) {
        if (campo.value !== texto) {
          campo.value = texto;
          alterou = true;
        }
      }
    });
    return alterou;
  }

  function preencherCampos(documento, sujo = false) {
    const doc = normalizarDocumento(documento);
    logoEmpresaDataUrl = doc.empresa.logo || "";
    logoAjusteAtual = normalizarLogoAjuste(doc.pdf?.logo);
    itens = doc.itens;
    equipeServicos = doc.equipeServicos;

    setValor(campos.empresaNome, doc.empresa.nome);
    setValor(campos.empresaDocumento, doc.empresa.documento);
    setValor(campos.empresaTelefone, doc.empresa.telefone);
    setValor(campos.empresaEmail, doc.empresa.email);
    setValor(campos.empresaEndereco, doc.empresa.endereco);
    setValor(campos.orcNumero, doc.numero);
    setValor(campos.orcEmissao, doc.emissao);
    setValor(campos.condValidade, doc.condicoes.validade);
    setValor(campos.condVencimento, doc.condicoes.vencimento);
    setValor(campos.clienteNome, doc.cliente.nome);
    setValor(campos.clienteDocumento, doc.cliente.documento);
    setValor(campos.clienteTelefone, doc.cliente.telefone);
    setValor(campos.clienteEmail, doc.cliente.email);
    setValor(campos.clienteEndereco, doc.cliente.endereco);
    setValor(campos.eventoNome, doc.evento.nome);
    setValor(campos.eventoDataInicio, doc.evento.dataInicio || doc.evento.data);
    setValor(campos.eventoDataFim, doc.evento.dataFim);
    setValor(campos.eventoHorarioInicio, doc.evento.horarioInicio || doc.evento.horario);
    setValor(campos.eventoHorarioFim, doc.evento.horarioFim);
    setValor(campos.eventoCidadeUf, doc.evento.cidadeUf);
    setValor(campos.eventoLocal, doc.evento.local);
    setValor(campos.pdfModoValores, doc.pdf?.modoValores || "detalhado");
    setValor(campos.valorFrete, doc.adicionais.frete);
    setValor(campos.valorMontagem, doc.adicionais.montagem);
    setValor(campos.valorDesmontagem, doc.adicionais.desmontagem);
    setValor(campos.valorTaxas, doc.adicionais.taxas);
    setValor(campos.descontoTipo, doc.adicionais.descontoTipo);
    setValor(campos.descontoGeral, doc.adicionais.descontoGeral);
    setValor(campos.condPagamento, doc.condicoes.pagamento);
    setValor(campos.condEntrada, doc.condicoes.entrada);
    setValor(campos.condPrazoMontagem, doc.condicoes.prazoMontagem);
    setValor(campos.condPrazoDesmontagem, doc.condicoes.prazoDesmontagem);
    setValor(campos.condObservacoes, doc.condicoes.observacoes);
    setValor(campos.condTermos, doc.condicoes.termos);

    sincronizarCamposLogoAjuste();
    renderLogo();
    renderItens();
    renderEquipeServicos();
    aplicarDadosEmpresaConfiguracoes({ sobrescrever: false });
    alteracoesPendentes = sujo;
    atualizarIndicador();
  }

  function coletarDocumento() {
    sincronizarItensDaTabela();
    sincronizarEquipeServicosDaTabela();
    return {
      tipo: TIPO_ARQUIVO,
      versao: VERSAO_ARQUIVO,
      numero: campos.orcNumero.value.trim() || numeroSugerido(),
      emissao: campos.orcEmissao.value || hojeISO(),
      empresa: {
        nome: campos.empresaNome.value.trim(),
        documento: campos.empresaDocumento.value.trim(),
        telefone: campos.empresaTelefone.value.trim(),
        email: campos.empresaEmail.value.trim(),
        endereco: campos.empresaEndereco.value.trim(),
        logo: logoEmpresaDataUrl || ""
      },
      cliente: {
        nome: campos.clienteNome.value.trim(),
        documento: campos.clienteDocumento.value.trim(),
        telefone: campos.clienteTelefone.value.trim(),
        email: campos.clienteEmail.value.trim(),
        endereco: campos.clienteEndereco.value.trim()
      },
      evento: {
        nome: campos.eventoNome.value.trim(),
        data: campos.eventoDataInicio.value,
        dataInicio: campos.eventoDataInicio.value,
        dataFim: campos.eventoDataFim.value,
        horario: campos.eventoHorarioInicio.value,
        horarioInicio: campos.eventoHorarioInicio.value,
        horarioFim: campos.eventoHorarioFim.value,
        local: campos.eventoLocal.value.trim(),
        cidadeUf: campos.eventoCidadeUf.value.trim()
      },
      pdf: {
        modoValores: campos.pdfModoValores.value || "detalhado",
        logo: normalizarLogoAjuste(logoAjusteAtual)
      },
      itens: itens.map(normalizarItem),
      equipeServicos: equipeServicos.map(normalizarServicoEquipe).filter((servico) => servico.descricao || numero(servico.valorDiaria)),
      adicionais: {
        frete: numero(campos.valorFrete.value),
        montagem: numero(campos.valorMontagem.value),
        desmontagem: numero(campos.valorDesmontagem.value),
        taxas: numero(campos.valorTaxas.value),
        descontoTipo: campos.descontoTipo.value,
        descontoGeral: numero(campos.descontoGeral.value)
      },
      condicoes: {
        pagamento: campos.condPagamento.value.trim(),
        entrada: campos.condEntrada.value.trim(),
        vencimento: campos.condVencimento.value,
        validade: campos.condValidade.value,
        prazoMontagem: campos.condPrazoMontagem.value.trim(),
        prazoDesmontagem: campos.condPrazoDesmontagem.value.trim(),
        observacoes: campos.condObservacoes.value.trim(),
        termos: campos.condTermos.value.trim()
      }
    };
  }

  function calcularItem(item) {
    const bruto = numero(item.quantidade) * Math.max(1, numero(item.diarias)) * numero(item.valorUnitario);
    const desconto = Math.min(bruto, numero(item.desconto));
    return {
      bruto,
      desconto,
      total: Math.max(0, bruto - desconto)
    };
  }

  function calcularServicoEquipe(servico) {
    const total = numero(servico.quantidade) * Math.max(1, numero(servico.diarias)) * numero(servico.valorDiaria);
    return { total: Math.max(0, total) };
  }

  function calcularTotais(documento = coletarDocumento()) {
    const itensCalculados = documento.itens.map(calcularItem);
    const equipeCalculada = (documento.equipeServicos || []).map(calcularServicoEquipe);
    const subtotalItens = itensCalculados.reduce((soma, item) => soma + item.bruto, 0);
    const subtotalEquipe = equipeCalculada.reduce((soma, servico) => soma + servico.total, 0);
    const descontosItens = itensCalculados.reduce((soma, item) => soma + item.desconto, 0);
    const adicionais = numero(documento.adicionais.frete) + numero(documento.adicionais.montagem) + numero(documento.adicionais.desmontagem) + numero(documento.adicionais.taxas);
    const baseDesconto = Math.max(0, subtotalItens + subtotalEquipe + adicionais - descontosItens);
    const descontoGeral = documento.adicionais.descontoTipo === "percentual"
      ? baseDesconto * (Math.min(100, numero(documento.adicionais.descontoGeral)) / 100)
      : Math.min(baseDesconto, numero(documento.adicionais.descontoGeral));
    const totalDescontos = descontosItens + descontoGeral;
    const totalGeral = Math.max(0, subtotalItens + subtotalEquipe + adicionais - totalDescontos);
    return { subtotalItens, subtotalEquipe, adicionais, descontosItens, descontoGeral, totalDescontos, totalGeral, itensCalculados, equipeCalculada };
  }

  function valorCampoItem(campo, valor) {
    if (["quantidade", "diarias"].includes(campo)) return numero(valor);
    return valor;
  }

  function valorCampoEquipe(campo, valor) {
    if (["quantidade", "diarias"].includes(campo)) return numero(valor);
    return valor;
  }

  function sincronizarItensDaTabela() {
    const corpo = $("#itensTabela");
    if (!corpo || !document.body.contains(corpo)) return;
    corpo.querySelectorAll("tr[data-index]").forEach((linha) => {
      const index = Number(linha.dataset.index);
      if (!itens[index]) return;
      linha.querySelectorAll("[data-field]").forEach((campoEl) => {
        const campo = campoEl.dataset.field;
        if (!campo) return;
        itens[index][campo] = valorCampoItem(campo, campoEl.value);
      });
    });
  }

  function sincronizarEquipeServicosDaTabela() {
    const corpo = $("#equipeTabela");
    if (!corpo || !document.body.contains(corpo)) return;
    corpo.querySelectorAll("tr[data-index]").forEach((linha) => {
      const index = Number(linha.dataset.index);
      if (!equipeServicos[index]) return;
      linha.querySelectorAll("[data-field]").forEach((campoEl) => {
        const campo = campoEl.dataset.field;
        if (!campo) return;
        equipeServicos[index][campo] = valorCampoEquipe(campo, campoEl.value);
      });
    });
  }

  function atualizarResumo() {
    const totais = calcularTotais();
    $("#subtotalItens").textContent = dinheiro(totais.subtotalItens);
    $("#totalEquipeServicos").textContent = dinheiro(totais.subtotalEquipe);
    $("#totalAdicionais").textContent = dinheiro(totais.adicionais);
    $("#totalDescontos").textContent = dinheiro(totais.totalDescontos);
    $("#totalGeral").textContent = dinheiro(totais.totalGeral);
  }

  function marcarSujo() {
    alteracoesPendentes = true;
    atualizarIndicador();
  }

  function atualizarIndicador() {
    $("#nomeArquivoAtual").textContent = nomeArquivoAtual || "Arquivo nao salvo";
    const estado = $("#estadoAlteracoes");
    estado.textContent = alteracoesPendentes ? "Alteracoes nao salvas" : "Sem alteracoes";
    estado.classList.toggle("is-dirty", alteracoesPendentes);
  }

  function sincronizarCamposLogoAjuste() {
    logoAjusteAtual = normalizarLogoAjuste(logoAjusteAtual);
    if (campos.logoZoom && String(campos.logoZoom.value) !== String(logoAjusteAtual.zoom)) {
      campos.logoZoom.value = logoAjusteAtual.zoom;
    }
    const resumo = $("#logoAjusteResumo");
    if (resumo) {
      resumo.textContent = `Zoom ${Math.round(logoAjusteAtual.zoom)}% \u00b7 X ${Math.round(logoAjusteAtual.offsetX)} \u00b7 Y ${Math.round(logoAjusteAtual.offsetY)}`;
    }
  }

  function aplicarTransformacaoLogoCrop() {
    const frame = $("#logoCropFrame");
    const imagemCrop = $("#logoCropImage");
    if (!frame || !imagemCrop) return;
    const frameW = frame.clientWidth || 318;
    const frameH = frame.clientHeight || 135;
    const xPreview = (logoAjusteAtual.offsetX / LOGO_AREA_PDF.largura) * frameW;
    const yPreview = (logoAjusteAtual.offsetY / LOGO_AREA_PDF.altura) * frameH;
    imagemCrop.style.setProperty("--logo-crop-x", `${xPreview.toFixed(1)}px`);
    imagemCrop.style.setProperty("--logo-crop-y", `${yPreview.toFixed(1)}px`);
    imagemCrop.style.setProperty("--logo-crop-zoom", String(logoAjusteAtual.zoom / 100));
  }

  function renderLogo() {
    const preview = $("#logoPreview");
    logoAjusteAtual = normalizarLogoAjuste(logoAjusteAtual);
    if (preview) {
      preview.innerHTML = logoEmpresaDataUrl
      ? `<img src="${textoSeguro(logoEmpresaDataUrl)}" alt="Logo da empresa">`
      : "Logo";
    }
    const frame = $("#logoCropFrame");
    const imagemCrop = $("#logoCropImage");
    if (frame) frame.classList.toggle("has-logo", Boolean(logoEmpresaDataUrl));
    if (imagemCrop) {
      if (logoEmpresaDataUrl) {
        imagemCrop.src = logoEmpresaDataUrl;
        imagemCrop.style.display = "block";
      } else {
        imagemCrop.removeAttribute("src");
        imagemCrop.style.display = "none";
      }
    }
    sincronizarCamposLogoAjuste();
    aplicarTransformacaoLogoCrop();
  }

  function opcoes(lista, selecionado) {
    const selecionadoTexto = String(selecionado || "").trim();
    const valores = [...lista];
    if (selecionadoTexto && !valores.some((item) => item === selecionadoTexto)) valores.push(selecionadoTexto);
    return valores.map((item) => `<option value="${textoSeguro(item)}" ${item === selecionadoTexto ? "selected" : ""}>${textoSeguro(item)}</option>`).join("");
  }

  function normalizarBusca(valor) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function nomeBaseEstoque(nome) {
    return String(nome || "").replace(/\s+(?:0[1-9]|[1-9][0-9]?)$/g, "").replace(/\s+/g, " ").trim();
  }

  function categoriaOrcamento(categoria, fallback = "Outros") {
    const texto = String(categoria || "").trim();
    if (!texto) return fallback;
    const chave = normalizarBusca(texto);
    return categorias.find((item) => normalizarBusca(item) === chave) || texto;
  }

  function unidadeOrcamento(unidade, fallback = "un.") {
    const texto = String(unidade || "").trim();
    if (!texto) return fallback;
    const chave = normalizarBusca(texto);
    if (["un", "und", "unid"].includes(chave)) return "un.";
    return unidades.find((item) => normalizarBusca(item) === chave) || texto;
  }

  function catalogoEstoque() {
    const mapa = new Map();
    try {
      const db = dadosEmpresaContexto();

      (db.equipamentos || []).forEach((eq) => {
        const nome = nomeBaseEstoque(eq?.nome);
        if (!nome) return;
        const categoria = categoriaOrcamento(eq.categoria);
        const chave = `equipamento|${normalizarBusca(categoria)}|${normalizarBusca(nome)}`;
        const atual = mapa.get(chave) || {
          chave,
          tipo: "equipamento",
          nome,
          categoria,
          unidade: "un.",
          valorUnitario: 0,
          quantidade: 0,
          codigos: []
        };
        atual.quantidade += 1;
        const valorEq = numero(eq.valorUnitario ?? eq.valor ?? 0);
        if (!atual.valorUnitario && valorEq > 0) atual.valorUnitario = valorEq;
        if (eq.codigo) atual.codigos.push(String(eq.codigo).trim().toUpperCase());
        mapa.set(chave, atual);
      });

      (db.materiaisConsumo || []).forEach((item) => {
        const nome = String(item?.nome || "").trim();
        if (!nome) return;
        const categoria = categoriaOrcamento(item.categoria || "Consumo", "Consumo");
        const chave = `consumo|${normalizarBusca(categoria)}|${normalizarBusca(nome)}`;
        mapa.set(chave, {
          chave,
          tipo: "consumo",
          nome,
          categoria,
          unidade: unidadeOrcamento(item.unidade, "unidade"),
          valorUnitario: Math.max(0, numero(item.valorUnitario ?? item.valor ?? 0)),
          quantidade: Math.max(0, numero(item.quantidade)),
          codigos: item.codigo ? [String(item.codigo).trim().toUpperCase()] : []
        });
      });
    } catch (_) {
      return [];
    }

    return Array.from(mapa.values()).sort((a, b) => {
      const cat = String(a.categoria).localeCompare(String(b.categoria), "pt-BR");
      return cat || String(a.nome).localeCompare(String(b.nome), "pt-BR");
    });
  }

  function buscarEstoque(termo, limite = 8) {
    const busca = normalizarBusca(termo);
    if (busca.length < 2) return [];
    return catalogoEstoque()
      .filter((item) => {
        const texto = normalizarBusca([item.nome, item.categoria, item.tipo, ...(item.codigos || [])].join(" "));
        return texto.includes(busca);
      })
      .slice(0, limite);
  }

  function aplicarItemEstoque(index, item) {
    if (!itens[index] || !item) return false;
    itens[index] = {
      ...itens[index],
      origem: "Estoque",
      categoria: categoriaOrcamento(item.categoria),
      descricao: item.nome,
      unidade: unidadeOrcamento(item.unidade, item.tipo === "consumo" ? "unidade" : "un."),
      quantidade: Math.max(1, numero(itens[index].quantidade) || 1),
      valorUnitario: numero(item.valorUnitario) > 0 ? numero(item.valorUnitario) : itens[index].valorUnitario
    };
    return true;
  }

  function aplicarItemEstoquePorTexto(index, texto) {
    const busca = normalizarBusca(texto);
    if (!busca) return false;
    const item = catalogoEstoque().find((opcao) => {
      const codigos = (opcao.codigos || []).map(normalizarBusca);
      return normalizarBusca(opcao.nome) === busca || codigos.includes(busca);
    });
    return aplicarItemEstoque(index, item);
  }

  function renderItens() {
    const corpo = $("#itensTabela");
    const grupos = [
      { titulo: "Itens do estoque", origem: "Estoque" },
      { titulo: "Itens de terceiros", origem: "Terceiros" }
    ].map((grupo) => ({
      ...grupo,
      indices: itens
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => normalizarOrigemItem(item.origem) === grupo.origem)
    })).filter((grupo) => grupo.indices.length);

    const cabecalhoEstoque = $("#itensEstoqueCabecalho");
    if (cabecalhoEstoque) {
      cabecalhoEstoque.hidden = !grupos.some((grupo) => grupo.origem === "Estoque");
    }

    corpo.innerHTML = grupos.map((grupo) => `
      ${grupo.origem === "Terceiros" ? `<tr class="origin-row"><td colspan="11">${grupo.titulo}</td></tr>` : ""}
      ${grupo.indices.map(({ item, index }) => {
      const total = calcularItem(item).total;
      return `
        <tr data-index="${index}">
          <td>${String(index + 1).padStart(2, "0")}</td>
          <td data-label="Categoria"><select data-field="categoria">${opcoes(categorias, item.categoria)}</select></td>
          <td data-label="Descricao" class="stock-search-cell">
            <div class="stock-search-wrap">
              <input data-field="descricao" autocomplete="off" value="${textoSeguro(item.descricao)}" placeholder="Digite ou busque no estoque">
              <div class="stock-suggestions" hidden></div>
            </div>
          </td>
          <td data-label="Qtd." class="item-quantity-cell"><input class="number-cell" data-field="quantidade" type="number" min="0" step="1" value="${textoSeguro(item.quantidade)}"></td>
          <td data-label="Un." class="item-unit-cell"><select data-field="unidade">${opcoes(unidades, item.unidade)}</select></td>
          <td data-label="Diarias"><input class="number-cell" data-field="diarias" type="number" min="1" step="1" value="${textoSeguro(item.diarias)}"></td>
          <td data-label="Valor unit."><input class="money-cell" data-field="valorUnitario" type="text" inputmode="decimal" value="${textoSeguro(item.valorUnitario)}"></td>
          <td data-label="Desc."><input class="money-cell" data-field="desconto" type="text" inputmode="decimal" value="${textoSeguro(item.desconto)}"></td>
          <td data-label="Total" class="item-total">${dinheiro(total)}</td>
          <td data-label="Obs."><input data-field="observacoes" value="${textoSeguro(item.observacoes)}" placeholder="Opcional"></td>
          <td data-label="Acoes">
            <div class="item-actions">
              <button class="item-action" type="button" data-action="subir" title="Mover para cima">↑</button>
              <button class="item-action" type="button" data-action="descer" title="Mover para baixo">↓</button>
              <button class="item-action" type="button" data-action="duplicar" title="Duplicar item">⧉</button>
              <button class="item-action danger" type="button" data-action="remover" title="Remover item">×</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
    `).join("");
    atualizarResumo();
  }

  function renderEquipeServicos() {
    const corpo = $("#equipeTabela");
    if (!corpo) return;
    if (!equipeServicos.length) {
      corpo.innerHTML = `
        <tr class="empty-row">
          <td colspan="8">Nenhum servi&ccedil;o de equipe adicionado.</td>
        </tr>`;
      atualizarResumo();
      return;
    }

    corpo.innerHTML = equipeServicos.map((servico, index) => {
      const total = calcularServicoEquipe(servico).total;
      return `
        <tr data-index="${index}">
          <td>${String(index + 1).padStart(2, "0")}</td>
          <td data-label="Servi&ccedil;o / cargo"><input data-field="descricao" value="${textoSeguro(servico.descricao)}" placeholder="Ex: T&eacute;cnico de som"></td>
          <td data-label="Pessoas"><input class="number-cell" data-field="quantidade" type="number" min="0" step="1" value="${textoSeguro(servico.quantidade)}"></td>
          <td data-label="Di&aacute;rias"><input class="number-cell" data-field="diarias" type="number" min="1" step="1" value="${textoSeguro(servico.diarias)}"></td>
          <td data-label="Valor di&aacute;ria"><input class="money-cell" data-field="valorDiaria" type="text" inputmode="decimal" value="${textoSeguro(servico.valorDiaria)}"></td>
          <td data-label="Total" class="team-total">${dinheiro(total)}</td>
          <td data-label="Obs."><input data-field="observacoes" value="${textoSeguro(servico.observacoes)}" placeholder="Opcional"></td>
          <td data-label="A&ccedil;&otilde;es">
            <div class="item-actions">
              <button class="item-action" type="button" data-team-action="subir" title="Mover para cima">&#8593;</button>
              <button class="item-action" type="button" data-team-action="descer" title="Mover para baixo">&#8595;</button>
              <button class="item-action" type="button" data-team-action="duplicar" title="Duplicar servi&ccedil;o">&#10761;</button>
              <button class="item-action danger" type="button" data-team-action="remover" title="Remover servi&ccedil;o">&times;</button>
            </div>
          </td>
        </tr>`;
    }).join("");
    atualizarResumo();
  }

  function atualizarSugestoes() {
    const lista = $("#sugestoesDescricoes");
    const opcoesEstoque = catalogoEstoque().slice(0, 400);
    lista.innerHTML = opcoesEstoque.map((item) => {
      const valor = numero(item.valorUnitario) > 0 ? ` - ${dinheiro(item.valorUnitario)}` : "";
      const label = `${item.categoria} - ${item.quantidade || 0} ${item.tipo === "consumo" ? item.unidade : "un."}${valor}`;
      return `<option value="${textoSeguro(item.nome)}" label="${textoSeguro(label)}"></option>`;
    }).join("");
  }

  function fecharSugestoesEstoque() {
    $$(".stock-suggestions").forEach((caixa) => {
      caixa.hidden = true;
      caixa.innerHTML = "";
      caixa.removeAttribute("style");
    });
  }

  function posicionarSugestoesEstoque(linha, caixa) {
    const input = linha?.querySelector('input[data-field="descricao"]');
    if (!input || !caixa) return;
    const rect = input.getBoundingClientRect();
    caixa.style.left = `${Math.round(rect.left)}px`;
    caixa.style.top = `${Math.round(rect.bottom + 6)}px`;
    caixa.style.width = `${Math.max(260, Math.round(rect.width))}px`;
  }

  function renderSugestoesEstoque(linha, termo) {
    const caixa = linha?.querySelector(".stock-suggestions");
    if (!caixa) return;
    const resultados = buscarEstoque(termo);
    if (!resultados.length) {
      caixa.hidden = true;
      caixa.innerHTML = "";
      if (normalizarBusca(termo).length >= 2 && !catalogoEstoque().length) {
        hidratarContextoStockSync();
      }
      return;
    }
    fecharSugestoesEstoque();
    caixa.innerHTML = resultados.map((item) => {
      const detalhe = item.tipo === "consumo"
        ? `${item.categoria} - ${item.quantidade || 0} ${item.unidade || "unidade"} em estoque`
        : `${item.categoria} - ${item.quantidade || 0} unidade${item.quantidade === 1 ? "" : "s"} cadastrada${item.quantidade === 1 ? "" : "s"}`;
      const detalheValor = numero(item.valorUnitario) > 0 ? ` - ${dinheiro(item.valorUnitario)}` : "";
      return `
        <button class="stock-suggestion" type="button" data-stock-key="${textoSeguro(encodeURIComponent(item.chave))}">
          <span>
            <strong>${textoSeguro(item.nome)}</strong>
            <small>${textoSeguro(detalhe + detalheValor)}</small>
          </span>
          <em>${item.tipo === "consumo" ? "Consumo" : "Estoque"}</em>
        </button>`;
    }).join("");
    posicionarSugestoesEstoque(linha, caixa);
    caixa.hidden = false;
  }

  function tratarSelecaoSugestaoEstoque(evento) {
    const sugestao = evento.target.closest(".stock-suggestion");
    if (!sugestao) return false;

    evento.preventDefault();
    evento.stopPropagation();
    if (typeof evento.stopImmediatePropagation === "function") evento.stopImmediatePropagation();

    const linhaSugestao = sugestao.closest("tr");
    const indexSugestao = Number(linhaSugestao?.dataset.index);
    const chave = decodeURIComponent(sugestao.dataset.stockKey || "");
    const itemEstoque = catalogoEstoque().find((item) => item.chave === chave);
    const inputDescricao = linhaSugestao?.querySelector('input[data-field="descricao"]');
    if (inputDescricao && itemEstoque?.nome) inputDescricao.value = itemEstoque.nome;

    if (aplicarItemEstoque(indexSugestao, itemEstoque)) {
      fecharSugestoesEstoque();
      renderItens();
      marcarSujo();
    }
    return true;
  }

  function tratarScrollSugestoes(evento) {
    const alvo = evento.target;
    if (alvo && typeof alvo.closest === "function" && alvo.closest(".stock-suggestions")) return;
    fecharSugestoesEstoque();
  }

  async function novoOrcamento() {
    if (alteracoesPendentes) {
      const ok = await confirmar("Criar novo orcamento? As alteracoes nao salvas serao perdidas.");
      if (!ok) return;
    }
    sequenciaSessao += 1;
    arquivoHandleAtual = null;
    nomeArquivoAtual = "";
    preencherCampos(novoDocumento(), false);
    mensagem("Novo orcamento pronto para edicao.", "success");
  }

  function nomeArquivoJson(documento) {
    const numeroLimpo = String(documento.numero || numeroSugerido()).replace(/[^\w-]+/g, "-");
    return `Orcamento_${numeroLimpo}.json`;
  }

  function baixarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function salvarArquivo(comoNovo = false) {
    const documento = coletarDocumento();
    const payload = {
      tipo: TIPO_ARQUIVO,
      versao: VERSAO_ARQUIVO,
      salvoEm: new Date().toISOString(),
      orcamento: documento
    };
    const conteudo = JSON.stringify(payload, null, 2);
    const blob = new Blob([conteudo], { type: "application/json;charset=utf-8" });

    try {
      if (window.showSaveFilePicker) {
        if (!arquivoHandleAtual || comoNovo) {
          arquivoHandleAtual = await window.showSaveFilePicker({
            suggestedName: nomeArquivoJson(documento),
            types: [{ description: "Orcamento StockSync", accept: { "application/json": [".json"] } }]
          });
        }
        const gravavel = await arquivoHandleAtual.createWritable();
        await gravavel.write(blob);
        await gravavel.close();
        nomeArquivoAtual = arquivoHandleAtual.name || nomeArquivoJson(documento);
      } else {
        baixarBlob(blob, nomeArquivoJson(documento));
        nomeArquivoAtual = nomeArquivoJson(documento);
      }
      alteracoesPendentes = false;
      atualizarIndicador();
      mensagem("Orcamento salvo no dispositivo.", "success");
    } catch (erro) {
      if (erro?.name === "AbortError") return;
      mensagem("Nao foi possivel salvar o arquivo.", "error");
      console.error("Erro ao salvar orcamento offline:", erro);
    }
  }

  async function abrirArquivo() {
    if (alteracoesPendentes) {
      const ok = await confirmar("Abrir outro arquivo? As alteracoes nao salvas serao perdidas.");
      if (!ok) return;
    }

    try {
      if (window.showOpenFilePicker) {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "Orcamento StockSync", accept: { "application/json": [".json"] } }]
        });
        const arquivo = await handle.getFile();
        await importarArquivo(arquivo, handle);
      } else {
        $("#abrirArquivoFallback").value = "";
        $("#abrirArquivoFallback").click();
      }
    } catch (erro) {
      if (erro?.name === "AbortError") return;
      mensagem("Nao foi possivel abrir o arquivo.", "error");
    }
  }

  async function importarArquivo(arquivo, handle = null) {
    try {
      const texto = await arquivo.text();
      const payload = JSON.parse(texto);
      if (payload?.tipo !== TIPO_ARQUIVO || !payload?.orcamento) {
        throw new Error("Arquivo invalido");
      }
      const documento = normalizarDocumento(payload.orcamento);
      arquivoHandleAtual = handle;
      nomeArquivoAtual = arquivo.name || handle?.name || nomeArquivoJson(documento);
      preencherCampos(documento, false);
      mensagem("Orcamento aberto com sucesso.", "success");
    } catch (_) {
      mensagem("Arquivo invalido. Selecione um JSON de orcamento gerado pelo StockSync.", "error");
    }
  }

  function validarMinimo(documento) {
    if (!documento.numero.trim()) return "Informe o numero do orcamento.";
    if (!documento.empresa.nome.trim()) return "Informe o nome da empresa.";
    if (!documento.cliente.nome.trim() && !documento.cliente.documento.trim()) return "Informe ao menos o nome ou documento do cliente.";
    if (!documento.itens.some((item) => item.descricao.trim())) return "Adicione pelo menos um item com descricao.";
    return "";
  }

  async function exportarPdf() {
    const documento = coletarDocumento();
    const erro = validarMinimo(documento);
    if (erro) {
      mensagem(erro, "warning");
      return;
    }
    try {
      const blob = await criarPdfArquivo(documento);
      baixarBlob(blob, `orcamento-${String(documento.numero || "sem-numero").replace(/[^\w-]+/g, "-")}.pdf`);
      mensagem("PDF gerado para download.", "success");
    } catch (erroPdf) {
      mensagem("Nao foi possivel gerar o PDF.", "error");
      console.error("Erro ao gerar PDF:", erroPdf);
    }
  }

  function configurarEventos() {
    $("#novoOrcamento").addEventListener("click", novoOrcamento);
    $("#abrirOrcamento").addEventListener("click", abrirArquivo);
    $("#salvarOrcamento").addEventListener("click", () => salvarArquivo(false));
    $("#salvarComoOrcamento").addEventListener("click", () => salvarArquivo(true));
    $("#exportarPdf").addEventListener("click", exportarPdf);
    $("#adicionarItem").addEventListener("click", () => {
      sincronizarItensDaTabela();
      sincronizarEquipeServicosDaTabela();
      itens.push(novoItem());
      renderItens();
      marcarSujo();
    });
    $("#adicionarItemTerceiro")?.addEventListener("click", () => {
      sincronizarItensDaTabela();
      sincronizarEquipeServicosDaTabela();
      itens.push(novoItem("Terceiros"));
      renderItens();
      marcarSujo();
    });
    $("#adicionarEquipeServico").addEventListener("click", () => {
      sincronizarItensDaTabela();
      sincronizarEquipeServicosDaTabela();
      equipeServicos.push(novoServicoEquipe());
      renderEquipeServicos();
      marcarSujo();
    });
    $("#abrirArquivoFallback").addEventListener("change", (evento) => {
      const arquivo = evento.target.files?.[0];
      if (arquivo) importarArquivo(arquivo);
    });
    $("#empresaLogo").addEventListener("change", (evento) => {
      const arquivo = evento.target.files?.[0];
      if (!arquivo) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(arquivo.type)) {
        mensagem("Selecione uma imagem PNG, JPG ou WebP.", "warning");
        return;
      }
      const leitor = new FileReader();
      leitor.onload = async () => {
        logoEmpresaDataUrl = String(leitor.result || "");
        await aplicarAjusteInicialLogo(logoEmpresaDataUrl);
        renderLogo();
        marcarSujo();
      };
      leitor.readAsDataURL(arquivo);
    });
    $("#removerLogo").addEventListener("click", () => {
      logoEmpresaDataUrl = "";
      $("#empresaLogo").value = "";
      renderLogo();
      marcarSujo();
    });
    campos.logoZoom?.addEventListener("input", () => {
      logoAjusteAtual = normalizarLogoAjuste({ ...logoAjusteAtual, zoom: campos.logoZoom.value });
      renderLogo();
      marcarSujo();
    });
    $("#centralizarLogoAjuste")?.addEventListener("click", () => {
      logoAjusteAtual = normalizarLogoAjuste({ ...logoAjusteAtual, offsetX: 0, offsetY: 0 });
      renderLogo();
      marcarSujo();
    });
    $("#resetarLogoAjuste")?.addEventListener("click", () => {
      logoAjusteAtual = { ...LOGO_AJUSTE_PADRAO };
      renderLogo();
      marcarSujo();
    });
    const logoCropFrame = $("#logoCropFrame");
    let arrasteLogo = null;
    logoCropFrame?.addEventListener("pointerdown", (evento) => {
      if (!logoEmpresaDataUrl) return;
      arrasteLogo = {
        inicioX: evento.clientX,
        inicioY: evento.clientY,
        offsetX: logoAjusteAtual.offsetX,
        offsetY: logoAjusteAtual.offsetY
      };
      logoCropFrame.classList.add("is-dragging");
      logoCropFrame.setPointerCapture?.(evento.pointerId);
      evento.preventDefault();
    });
    logoCropFrame?.addEventListener("pointermove", (evento) => {
      if (!arrasteLogo) return;
      const frameW = logoCropFrame.clientWidth || 318;
      const frameH = logoCropFrame.clientHeight || 135;
      const deltaX = (evento.clientX - arrasteLogo.inicioX) * (LOGO_AREA_PDF.largura / frameW);
      const deltaY = (evento.clientY - arrasteLogo.inicioY) * (LOGO_AREA_PDF.altura / frameH);
      logoAjusteAtual = normalizarLogoAjuste({
        ...logoAjusteAtual,
        offsetX: arrasteLogo.offsetX + deltaX,
        offsetY: arrasteLogo.offsetY + deltaY
      });
      sincronizarCamposLogoAjuste();
      aplicarTransformacaoLogoCrop();
      marcarSujo();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((tipo) => {
      logoCropFrame?.addEventListener(tipo, () => {
        arrasteLogo = null;
        logoCropFrame.classList.remove("is-dragging");
      });
    });
    logoCropFrame?.addEventListener("wheel", (evento) => {
      if (!logoEmpresaDataUrl) return;
      evento.preventDefault();
      const passo = evento.deltaY > 0 ? -12 : 12;
      logoAjusteAtual = normalizarLogoAjuste({ ...logoAjusteAtual, zoom: logoAjusteAtual.zoom + passo });
      renderLogo();
      marcarSujo();
    }, { passive: false });

    $(".budget-offline-page").addEventListener("input", (evento) => {
      if (evento.target.closest("#itensTabela")) return;
      if (evento.target.closest("#equipeTabela")) return;
      atualizarResumo();
      marcarSujo();
    });
    $(".budget-offline-page").addEventListener("change", (evento) => {
      if (evento.target.closest("#itensTabela")) return;
      if (evento.target.closest("#equipeTabela")) return;
      atualizarResumo();
      marcarSujo();
    });

    $("#itensTabela").addEventListener("input", atualizarItemPelaTabela);
    $("#itensTabela").addEventListener("change", atualizarItemPelaTabela);
    $("#itensTabela").addEventListener("focusin", (evento) => {
      if (evento.target?.dataset?.field !== "descricao") return;
      renderSugestoesEstoque(evento.target.closest("tr"), evento.target.value);
    });
    $("#itensTabela").addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") fecharSugestoesEstoque();
    });
    $("#itensTabela").addEventListener("pointerdown", tratarSelecaoSugestaoEstoque);
    $("#itensTabela").addEventListener("click", tratarAcaoItem);
    document.addEventListener("click", (evento) => {
      if (!evento.target.closest("#itensTabela")) fecharSugestoesEstoque();
    });
    $("#equipeTabela").addEventListener("input", atualizarEquipePelaTabela);
    $("#equipeTabela").addEventListener("change", atualizarEquipePelaTabela);
    $("#equipeTabela").addEventListener("click", tratarAcaoEquipe);
    window.addEventListener("scroll", tratarScrollSugestoes, true);
    window.addEventListener("resize", fecharSugestoesEstoque);

    window.addEventListener("beforeunload", (evento) => {
      if (!alteracoesPendentes) return;
      evento.preventDefault();
      evento.returnValue = "";
    });

    document.addEventListener("keydown", (evento) => {
      if (!evento.ctrlKey) return;
      const tecla = evento.key.toLowerCase();
      if (tecla === "n") {
        evento.preventDefault();
        novoOrcamento();
      } else if (tecla === "o") {
        evento.preventDefault();
        abrirArquivo();
      } else if (tecla === "s" && evento.shiftKey) {
        evento.preventDefault();
        salvarArquivo(true);
      } else if (tecla === "s") {
        evento.preventDefault();
        salvarArquivo(false);
      } else if (tecla === "p") {
        evento.preventDefault();
        exportarPdf();
      }
    });

    window.addEventListener("stocksync:sincronizado", () => {
      atualizarContextoOrcamento();
      hidratarContextoStockSync();
    });

    window.addEventListener("focus", () => {
      atualizarContextoOrcamento();
      hidratarContextoStockSync();
    });
  }

  function atualizarItemPelaTabela(evento) {
    if (!document.body.contains(evento.target)) return;
    const campo = evento.target.dataset.field;
    const linha = evento.target.closest("tr");
    if (!campo || !linha) return;
    const index = Number(linha.dataset.index);
    if (!itens[index]) return;
    const valor = valorCampoItem(campo, evento.target.value);
    itens[index][campo] = valor;
    if (campo === "descricao") {
      if (evento.type === "change" && aplicarItemEstoquePorTexto(index, evento.target.value)) {
        renderItens();
        marcarSujo();
        return;
      }
      renderSugestoesEstoque(linha, evento.target.value);
    }
    const totalCell = linha.querySelector(".item-total");
    if (totalCell) totalCell.textContent = dinheiro(calcularItem(itens[index]).total);
    atualizarResumo();
    marcarSujo();
  }

  function atualizarEquipePelaTabela(evento) {
    if (!document.body.contains(evento.target)) return;
    const campo = evento.target.dataset.field;
    const linha = evento.target.closest("tr");
    if (!campo || !linha) return;
    const index = Number(linha.dataset.index);
    if (!equipeServicos[index]) return;
    equipeServicos[index][campo] = valorCampoEquipe(campo, evento.target.value);

    const totalCell = linha.querySelector(".team-total");
    if (totalCell) totalCell.textContent = dinheiro(calcularServicoEquipe(equipeServicos[index]).total);
    atualizarResumo();
    marcarSujo();
  }

  async function tratarAcaoItem(evento) {
    if (tratarSelecaoSugestaoEstoque(evento)) return;

    const botao = evento.target.closest("button[data-action]");
    if (!botao) return;
    sincronizarItensDaTabela();
    const linha = botao.closest("tr");
    const index = Number(linha?.dataset.index);
    const acao = botao.dataset.action;
    if (!itens[index]) return;

    if (acao === "remover") {
      if (itens.length === 1) itens = [novoItem()];
      else itens.splice(index, 1);
    } else if (acao === "duplicar") {
      itens.splice(index + 1, 0, { ...itens[index], id: `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    } else if (acao === "subir" && index > 0) {
      [itens[index - 1], itens[index]] = [itens[index], itens[index - 1]];
    } else if (acao === "descer" && index < itens.length - 1) {
      [itens[index + 1], itens[index]] = [itens[index], itens[index + 1]];
    }
    renderItens();
    marcarSujo();
  }

  async function tratarAcaoEquipe(evento) {
    const botao = evento.target.closest("button[data-team-action]");
    if (!botao) return;
    sincronizarItensDaTabela();
    sincronizarEquipeServicosDaTabela();
    const linha = botao.closest("tr");
    const index = Number(linha?.dataset.index);
    const acao = botao.dataset.teamAction;
    if (!equipeServicos[index]) return;

    if (acao === "remover") {
      equipeServicos.splice(index, 1);
    } else if (acao === "duplicar") {
      equipeServicos.splice(index + 1, 0, { ...equipeServicos[index], id: `EQP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    } else if (acao === "subir" && index > 0) {
      [equipeServicos[index - 1], equipeServicos[index]] = [equipeServicos[index], equipeServicos[index - 1]];
    } else if (acao === "descer" && index < equipeServicos.length - 1) {
      [equipeServicos[index + 1], equipeServicos[index]] = [equipeServicos[index], equipeServicos[index + 1]];
    }
    renderEquipeServicos();
    marcarSujo();
  }

  function iniciar() {
    if (window.GE?.usuarioAtual && window.GE.usuarioAtual().cargo !== "Administrador") {
      mensagem("Apenas administradores podem acessar orcamentos.", "warning");
      setTimeout(() => { window.location.href = "03-dashboard.html"; }, 700);
      return;
    }
    atualizarSugestoes();
    configurarEventos();
    preencherCampos(novoDocumento(), false);
    hidratarContextoStockSync();
    setTimeout(() => hidratarContextoStockSync(), 1400);
    setTimeout(() => atualizarContextoOrcamento(), 2600);
  }

  document.addEventListener("DOMContentLoaded", iniciar);

  function textoPdf(valor) {
    return String(valor ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/[^\x20-\x7E]/g, (char) => {
        const codigo = char.charCodeAt(0);
        if (codigo <= 255) return `\\${codigo.toString(8).padStart(3, "0")}`;
        return "";
      });
  }

  function medidasLogoCropEditor() {
    const frame = $("#logoCropFrame");
    const imagemCrop = $("#logoCropImage");
    if (!frame || !imagemCrop || !imagemCrop.src) return null;
    const frameRect = frame.getBoundingClientRect();
    const imgRect = imagemCrop.getBoundingClientRect();
    if (!frameRect.width || !frameRect.height || !imgRect.width || !imgRect.height) return null;
    return {
      x: (imgRect.left - frameRect.left) / frameRect.width,
      y: (imgRect.top - frameRect.top) / frameRect.height,
      largura: imgRect.width / frameRect.width,
      altura: imgRect.height / frameRect.height
    };
  }

  function prepararLogoPdf(dataUrl, ajuste = LOGO_AJUSTE_PADRAO, medidasEditor = null) {
    if (!dataUrl || typeof Image === "undefined") return Promise.resolve(null);
    const ajusteLogo = normalizarLogoAjuste(ajuste);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvasScale = 5;
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(LOGO_AREA_PDF.largura * canvasScale);
          canvas.height = Math.round(LOGO_AREA_PDF.altura * canvasScale);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#08080c";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          if (medidasEditor) {
            ctx.drawImage(
              img,
              medidasEditor.x * canvas.width,
              medidasEditor.y * canvas.height,
              medidasEditor.largura * canvas.width,
              medidasEditor.altura * canvas.height
            );
          } else {
            const escalaBase = Math.min(canvas.width / img.width, canvas.height / img.height);
            const escala = escalaBase * (ajusteLogo.zoom / 100);
            const largura = img.width * escala;
            const altura = img.height * escala;
            const x = ((canvas.width - largura) / 2) + (ajusteLogo.offsetX * canvasScale);
            const y = ((canvas.height - altura) / 2) + (ajusteLogo.offsetY * canvasScale);
            ctx.drawImage(img, x, y, largura, altura);
          }
          const jpg = canvas.toDataURL("image/jpeg", 0.94);
          resolve({
            data: atob(jpg.split(",")[1]),
            width: canvas.width,
            height: canvas.height
          });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  function wrapTexto(valor, limite = 42, maxLinhas = 4) {
    const palavras = String(valor || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    if (!palavras.length) return [""];
    const linhas = [];
    palavras.forEach((palavra) => {
      const atual = linhas[linhas.length - 1] || "";
      if (!atual || `${atual} ${palavra}`.length > limite) linhas.push(palavra);
      else linhas[linhas.length - 1] = `${atual} ${palavra}`;
    });
    return linhas.slice(0, maxLinhas);
  }

  async function criarPdfArquivo(documentoBruto) {
    const documento = normalizarDocumento(documentoBruto);
    const totais = calcularTotais(documento);
    const ajusteLogoPdf = normalizarLogoAjuste(documento.pdf?.logo);
    const logo = await prepararLogoPdf(documento.empresa.logo, ajusteLogoPdf, medidasLogoCropEditor());
    const pageW = 595.28;
    const pageH = 841.89;
    const paginas = [];
    const n = (valor) => Number(valor).toFixed(2);
    const y = (top) => (pageH - top).toFixed(2);

    function cor(comandos, hex, stroke = true) {
      const limpo = hex.replace("#", "");
      const r = parseInt(limpo.slice(0, 2), 16) / 255;
      const g = parseInt(limpo.slice(2, 4), 16) / 255;
      const b = parseInt(limpo.slice(4, 6), 16) / 255;
      comandos.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${stroke ? `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG` : ""}`);
    }

    function rect(comandos, x, top, w, h, fill, stroke = "", lineW = 0.7) {
      if (fill) {
        cor(comandos, fill, false);
        comandos.push(`${n(x)} ${y(top + h)} ${n(w)} ${n(h)} re f`);
      }
      if (stroke) {
        cor(comandos, stroke, true);
        comandos.push(`${lineW} w ${n(x)} ${y(top + h)} ${n(w)} ${n(h)} re S`);
      }
    }

    function linha(comandos, x1, top1, x2, top2, stroke = "#d1d5db", lineW = 0.5) {
      cor(comandos, stroke, true);
      comandos.push(`${lineW} w ${n(x1)} ${y(top1)} m ${n(x2)} ${y(top2)} l S`);
    }

    function larguraTexto(valor, tamanho = 10, negrito = false) {
      return String(valor || "").length * tamanho * (negrito ? 0.58 : 0.52);
    }

    function texto(comandos, x, top, valor, tamanho = 10, negrito = false, opcoes = {}) {
      const conteudo = String(valor || "");
      let px = x;
      if (opcoes.align === "center") px = x - (larguraTexto(conteudo, tamanho, negrito) / 2);
      if (opcoes.align === "right") px = x - larguraTexto(conteudo, tamanho, negrito);
      comandos.push(`BT /${negrito ? "F2" : "F1"} ${tamanho} Tf ${n(px)} ${y(top)} Td (${textoPdf(conteudo)}) Tj ET`);
    }

    function textoAuto(comandos, x, top, valor, tamanho = 9, maxW = 130, negrito = false, opcoes = {}) {
      let fonte = tamanho;
      while (fonte > 6.2 && larguraTexto(valor, fonte, negrito) > maxW) fonte -= 0.35;
      texto(comandos, x, top, valor, fonte, negrito, opcoes);
    }

    function textoWrap(comandos, x, top, valor, limite, tamanho = 8.5, maxLinhas = 3, gap = 11) {
      wrapTexto(valor, limite, maxLinhas).forEach((linhaTexto, idx) => texto(comandos, x, top + (idx * gap), linhaTexto, tamanho));
    }

    function imagem(comandos, x, top, maxW, maxH) {
      if (!logo) return false;
      const escala = Math.min(maxW / logo.width, maxH / logo.height);
      const w = logo.width * escala;
      const h = logo.height * escala;
      const px = x + ((maxW - w) / 2);
      const py = pageH - top - ((maxH + h) / 2);
      comandos.push(`q ${n(w)} 0 0 ${n(h)} ${n(px)} ${n(py)} cm /I1 Do Q`);
      return true;
    }

    function novaPagina(opcoes = {}) {
      const comandos = [];
      paginas.push(comandos);
      if (opcoes.cabecalho !== false) desenharCabecalho(comandos);
      desenharRodape(comandos);
      return comandos;
    }

    function desenharCabecalho(comandos) {
      rect(comandos, 0, 0, pageW, 98, "#08080c");
      if (logo) {
        imagem(comandos, 18, 14, LOGO_AREA_PDF.largura, LOGO_AREA_PDF.altura);
      } else {
        cor(comandos, "#ffffff", false);
        textoAuto(comandos, 28, 40, documento.empresa.nome || "Empresa", 13, 176, true);
        textoAuto(comandos, 28, 60, documento.empresa.telefone || documento.empresa.email || "", 8.8, 176);
      }
      cor(comandos, "#8b5cf6", false);
      texto(comandos, 292, 58, "OR\u00c7AMENTO", 22, true, { align: "center" });
      rect(comandos, 438, 22, 129, 54, "#111827", "#8b5cf6", 0.6);
      cor(comandos, "#ffffff", false);
      textoAuto(comandos, 502, 42, `No ${documento.numero || ""}`, 10.5, 104, true, { align: "center" });
      textoAuto(comandos, 502, 61, `Emiss\u00e3o: ${dataBR(documento.emissao)}`, 8.2, 112, false, { align: "center" });
    }

    function desenharRodape(comandos) {
      const top = 808;
      linha(comandos, 28, top, 567, top, "#d1d5db", 0.45);
      cor(comandos, "#111827", false);
      textoAuto(comandos, 28, top + 14, documento.empresa.nome || "", 8.2, 252, true);
      const contato = [documento.empresa.documento, documento.empresa.telefone, documento.empresa.email].filter(Boolean).join(" | ");
      textoAuto(comandos, 28, top + 28, contato, 7.3, 252);
      textoAuto(comandos, 567, top + 20, documento.empresa.endereco || "", 7.3, 255, false, { align: "right" });
    }

    function campo(comandos, label, valor, x, top, labelW, valueW) {
      cor(comandos, "#111827", false);
      const gap = 6;
      const valorX = x + larguraTexto(label, 8.2, true) + gap;
      texto(comandos, x, top, label, 8.2, true);
      textoAuto(comandos, valorX, top, valor || "-", 8.2, Math.max(45, labelW + valueW - (valorX - x)));
    }

    function periodoData(evento) {
      const inicio = dataBR(evento.dataInicio || evento.data);
      const fim = dataBR(evento.dataFim);
      if (inicio && fim && inicio !== fim) return `${inicio} - ${fim}`;
      return inicio || fim || "-";
    }

    function periodoHorario(evento) {
      const inicio = evento.horarioInicio || evento.horario || "";
      const fim = evento.horarioFim || "";
      if (inicio && fim && inicio !== fim) return `${inicio} - ${fim}`;
      return inicio || fim || "-";
    }

    function desenharDadosIniciais(comandos) {
      rect(comandos, 28, 114, 539, 112, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, 134, "DADOS DO CLIENTE", 10.5, true);
      campo(comandos, "Cliente:", documento.cliente.nome, 46, 156, 46, 192);
      campo(comandos, "CPF/CNPJ:", documento.cliente.documento, 46, 173, 58, 176);
      campo(comandos, "Telefone:", documento.cliente.telefone, 46, 190, 55, 174);
      campo(comandos, "E-mail:", documento.cliente.email, 46, 207, 42, 194);
      campo(comandos, "Evento:", documento.evento.nome, 312, 156, 47, 178);
      campo(comandos, "Data:", periodoData(documento.evento), 312, 173, 35, 150);
      campo(comandos, "Hor\u00e1rio:", periodoHorario(documento.evento), 312, 190, 50, 150);
      campo(comandos, "Local:", documento.evento.local || documento.evento.cidadeUf, 312, 207, 38, 188);

      rect(comandos, 28, 238, 539, 94, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, 260, "CONDI\u00c7\u00d5ES COMERCIAIS", 10.5, true);
      campo(comandos, "Pagamento:", documento.condicoes.pagamento, 46, 284, 66, 190);
      campo(comandos, "Entrada:", documento.condicoes.entrada, 46, 302, 50, 170);
      campo(comandos, "Montagem:", documento.condicoes.prazoMontagem, 46, 320, 60, 170);
      campo(comandos, "Validade:", dataBR(documento.condicoes.validade), 312, 284, 55, 112);
      campo(comandos, "Vencimento:", dataBR(documento.condicoes.vencimento), 312, 302, 72, 112);
      campo(comandos, "Desmontagem:", documento.condicoes.prazoDesmontagem, 312, 320, 82, 104);
    }

    function agruparItensOrcamento(lista) {
      const mapa = new Map();
      lista.forEach((item) => {
        const categoria = String(item.categoria || "Outros").trim() || "Outros";
        if (!mapa.has(categoria)) mapa.set(categoria, []);
        mapa.get(categoria).push(item);
      });
      return Array.from(mapa.entries()).map(([categoria, grupoItens]) => ({
        categoria,
        itens: grupoItens,
        subtotal: grupoItens.reduce((total, item) => total + calcularItem(item).total, 0),
        quantidade: grupoItens.reduce((total, item) => total + numero(item.quantidade), 0)
      }));
    }

    function tituloOrigemOrcamento(origem) {
      return normalizarOrigemItem(origem) === "Terceiros" ? "ITENS DE TERCEIROS" : "";
    }

    function agruparItensPorOrigem(lista) {
      return origensItem
        .map((origem) => ({
          origem,
          titulo: tituloOrigemOrcamento(origem),
          itens: lista.filter((item) => normalizarOrigemItem(item.origem) === origem)
        }))
        .filter((grupo) => grupo.itens.length)
        .map((grupo) => ({
          ...grupo,
          grupos: agruparItensOrcamento(grupo.itens)
        }));
    }

    function montarLinhasTabelaOrcamento(lista, modoValores) {
      const secoes = agruparItensPorOrigem(lista);
      const linhas = [];
      if (modoValores === "agrupado") {
        let numeroGrupo = 1;
        secoes.forEach((secao) => {
          if (secao.origem === "Terceiros") linhas.push({ tipo: "origem", titulo: secao.titulo });
          secao.grupos.forEach((grupo) => {
            linhas.push({
              tipo: "grupo-resumo",
              numero: numeroGrupo,
              categoria: grupo.categoria,
              itens: grupo.itens.map((item) => ({
                descricao: item.descricao || "-",
                quantidade: item.quantidade || 0,
                unidade: item.unidade || "un."
              })),
              tipos: grupo.itens.length,
              quantidade: grupo.quantidade,
              total: grupo.subtotal
            });
            numeroGrupo += 1;
          });
        });
        return linhas;
      }
      let numeroItem = 1;
      secoes.forEach((secao) => {
        if (secao.origem === "Terceiros") linhas.push({ tipo: "origem", titulo: secao.titulo });
        secao.grupos.forEach((grupo) => {
          linhas.push({ tipo: "grupo", categoria: grupo.categoria, total: grupo.subtotal });
          grupo.itens.forEach((item) => {
            linhas.push({ tipo: "item", numero: numeroItem, item });
            numeroItem += 1;
          });
        });
      });
      return linhas;
    }

    function desenharCabecalhoTabela(comandos, top, modoValores) {
      const x = 28;
      const w = 539;
      const headerH = 21;
      rect(comandos, x, top, w, headerH, "#32158a");
      cor(comandos, "#ffffff", false);
      if (modoValores === "agrupado") {
        texto(comandos, 43, top + 14, "ITEM", 7.2, true, { align: "center" });
        texto(comandos, 95, top + 14, "GRUPO", 7.2, true, { align: "center" });
        texto(comandos, 250, top + 14, "ITENS INCLUSOS", 7.2, true, { align: "center" });
        texto(comandos, 404, top + 14, "QTD.", 7.2, true, { align: "center" });
        texto(comandos, 530, top + 14, "TOTAL DO GRUPO", 7.2, true, { align: "right" });
      } else {
        texto(comandos, 43, top + 14, "ITEM", 7.2, true, { align: "center" });
        texto(comandos, 86, top + 14, "CAT.", 7.2, true, { align: "center" });
        texto(comandos, 204, top + 14, "DESCRI\u00c7\u00c3O", 7.2, true, { align: "center" });
        texto(comandos, 333, top + 14, "QTD.", 7.2, true, { align: "center" });
        texto(comandos, 385, top + 14, "DI\u00c1RIAS", 7.2, true, { align: "center" });
        texto(comandos, 454, top + 14, "UNIT.", 7.2, true, { align: "center" });
        texto(comandos, 530, top + 14, "TOTAL", 7.2, true, { align: "right" });
      }
      return top + headerH;
    }

    function alturaLinhaTabela(row, modoValores) {
      if (row.tipo === "origem") return 18;
      if (row.tipo === "grupo") return 17;
      if (modoValores === "agrupado") {
        const linhas = (row.itens || []).reduce((total, item) => total + wrapTexto(`${item.descricao} (${item.quantidade} ${item.unidade})`, 54, 2).length, 0);
        return Math.max(30, 11 + (Math.max(1, linhas) * 9));
      }
      return Math.max(18, 10 + (wrapTexto(row.item?.descricao, 40, 2).length * 9));
    }

    function desenharLinhaTabela(comandos, row, top, h, modoValores, zebra) {
      const x = 28;
      const w = 539;
      const fill = row.tipo === "origem" ? "#111827" : (row.tipo === "grupo" ? "#eee9ff" : (zebra ? "#f3f4f6" : "#ffffff"));
      rect(comandos, x, top, w, h, fill);
      linha(comandos, x, top + h, x + w, top + h, "#d1d5db", 0.28);
      if (row.tipo === "origem") {
        cor(comandos, "#ffffff", false);
        textoAuto(comandos, 36, top + 12, row.titulo, 8, 360, true);
        return;
      }
      if (row.tipo === "grupo") {
        cor(comandos, "#32158a", false);
        textoAuto(comandos, 36, top + 12, row.categoria, 8.2, 330, true);
        textoAuto(comandos, 557, top + 12, `Sub-total: ${dinheiro(row.total)}`, 8.2, 188, true, { align: "right" });
        return;
      }

      if (modoValores === "agrupado") {
        cor(comandos, "#32158a", false);
        texto(comandos, 43, top + 13, String(row.numero).padStart(2, "0"), 7.7, true, { align: "center" });
        cor(comandos, "#111827", false);
        textoAuto(comandos, 95, top + 13, row.categoria, 7.8, 82, true, { align: "center" });
        let linhaAtual = 0;
        (row.itens || [{ descricao: `${row.tipos || 0} itens`, quantidade: row.quantidade || 0, unidade: "un." }]).forEach((item) => {
          wrapTexto(`${item.descricao} (${item.quantidade} ${item.unidade})`, 54, 2).forEach((linhaTexto) => {
            texto(comandos, 152, top + 13 + (linhaAtual * 9), linhaTexto, 7.1);
            linhaAtual += 1;
          });
        });
        texto(comandos, 404, top + 13, `${row.quantidade || 0}`, 7.7, false, { align: "center" });
        textoAuto(comandos, 557, top + 13, dinheiro(row.total), 7.8, 110, true, { align: "right" });
        return;
      }

      const item = row.item;
      const calc = calcularItem(item);
      const linhasDescricao = wrapTexto(item.descricao || "-", 40, 2);
      cor(comandos, "#32158a", false);
      texto(comandos, 43, top + 13, String(row.numero).padStart(2, "0"), 7.7, true, { align: "center" });
      cor(comandos, "#111827", false);
      textoAuto(comandos, 86, top + 13, item.categoria, 7.1, 54, false, { align: "center" });
      linhasDescricao.forEach((linhaTexto, idx) => texto(comandos, 122, top + 13 + (idx * 9), linhaTexto, 7.3));
      textoAuto(comandos, 333, top + 13, `${item.quantidade || 0} ${item.unidade || "un."}`, 7.2, 58, false, { align: "center" });
      texto(comandos, 385, top + 13, String(item.diarias || 1), 7.5, false, { align: "center" });
      textoAuto(comandos, 454, top + 13, dinheiro(item.valorUnitario), 7.1, 64, false, { align: "center" });
      textoAuto(comandos, 557, top + 13, dinheiro(calc.total), 7.2, 82, false, { align: "right" });
    }

    function desenharTabelaOrcamento(comandosInicial, linhas, modoValores, topInicial) {
      let comandosAtual = comandosInicial;
      let top = desenharCabecalhoTabela(comandosAtual, topInicial, modoValores);
      const limiteConteudo = 802;
      linhas.forEach((row, idx) => {
        const h = alturaLinhaTabela(row, modoValores);
        if (top + h > limiteConteudo) {
          comandosAtual = novaPagina();
          top = desenharCabecalhoTabela(comandosAtual, 118, modoValores);
        }
        desenharLinhaTabela(comandosAtual, row, top, h, modoValores, idx % 2 === 0);
        top += h;
      });
      return { comandos: comandosAtual, top };
    }

    function desenharResumoFinal(comandosInicial, topInicial) {
      let comandosAtual = comandosInicial;
      let top = topInicial + 18;
      const limiteConteudo = 802;
      const garantirEspaco = (altura) => {
        if (top + altura > limiteConteudo) {
          comandosAtual = novaPagina();
          top = 118;
        }
      };

      garantirEspaco(126);
      rect(comandosAtual, 28, top, 254, 116, "#ffffff", "#8b5cf6");
      cor(comandosAtual, "#32158a", false);
      texto(comandosAtual, 44, top + 20, "RESUMO FINANCEIRO", 9.4, true);
      campo(comandosAtual, "Itens:", dinheiro(totais.subtotalItens), 44, top + 42, 36, 88);
      campo(comandosAtual, "Equipe:", dinheiro(totais.subtotalEquipe), 154, top + 42, 46, 82);
      campo(comandosAtual, "Adic.:", dinheiro(totais.adicionais), 44, top + 61, 40, 88);
      campo(comandosAtual, "Desc.:", dinheiro(totais.totalDescontos), 154, top + 61, 42, 82);

      rect(comandosAtual, 302, top, 265, 116, "#ffffff", "#8b5cf6");
      cor(comandosAtual, "#32158a", false);
      texto(comandosAtual, 318, top + 20, "CONDI\u00c7\u00d5ES DE PAGAMENTO", 9.4, true);
      campo(comandosAtual, "Forma:", documento.condicoes.pagamento, 318, top + 42, 42, 174);
      campo(comandosAtual, "Entrada:", documento.condicoes.entrada, 318, top + 60, 50, 174);
      campo(comandosAtual, "Validade:", dataBR(documento.condicoes.validade), 318, top + 78, 55, 78);
      campo(comandosAtual, "Vencimento:", dataBR(documento.condicoes.vencimento), 440, top + 78, 72, 54);
      campo(comandosAtual, "Montagem:", documento.condicoes.prazoMontagem, 318, top + 96, 60, 70);
      campo(comandosAtual, "Desmontagem:", documento.condicoes.prazoDesmontagem, 440, top + 96, 82, 52);

      top += 132;
      const linhasObs = wrapTexto(documento.condicoes.observacoes, 68, 6);
      const hObs = Math.max(78, 30 + (linhasObs.length * 10));
      garantirEspaco(hObs + 10);
      rect(comandosAtual, 28, top, 318, hObs, "#ffffff", "#8b5cf6");
      cor(comandosAtual, "#32158a", false);
      texto(comandosAtual, 44, top + 18, "OBSERVA\u00c7\u00d5ES", 9.4, true);
      cor(comandosAtual, "#111827", false);
      linhasObs.forEach((linhaTexto, idx) => texto(comandosAtual, 44, top + 38 + (idx * 10), linhaTexto, 7.0));

      rect(comandosAtual, 360, top, 207, hObs, "#111827", "#111827");
      cor(comandosAtual, "#ffffff", false);
      texto(comandosAtual, 464, top + 28, "TOTAL GERAL", 10.5, true, { align: "center" });
      textoAuto(comandosAtual, 464, top + Math.min(62, hObs - 18), dinheiro(totais.totalGeral), 18, 184, true, { align: "center" });

      top += hObs + 16;
      const linhasTermos = wrapTexto(documento.condicoes.termos, 116, 11);
      const hTermos = Math.max(48, 28 + (linhasTermos.length * 10));
      garantirEspaco(hTermos);
      rect(comandosAtual, 28, top, 539, hTermos, "#ffffff", "#8b5cf6");
      cor(comandosAtual, "#32158a", false);
      texto(comandosAtual, 44, top + 18, "CONDI\u00c7\u00d5ES GERAIS", 9.4, true);
      cor(comandosAtual, "#111827", false);
      linhasTermos.forEach((linhaTexto, idx) => texto(comandosAtual, 44, top + 38 + (idx * 10), linhaTexto, 7.2));

      top += hTermos + 16;
      garantirEspaco(112);
      rect(comandosAtual, 28, top, 539, 104, "#ffffff", "#111827", 0.55);
      linha(comandosAtual, 297, top, 297, top + 104, "#111827", 0.55);
      linha(comandosAtual, 70, top + 42, 254, top + 42, "#111827", 0.7);
      textoAuto(comandosAtual, 162, top + 62, documento.empresa.nome || "Empresa", 8.5, 205, true, { align: "center" });
      if (documento.empresa.documento) textoAuto(comandosAtual, 162, top + 76, `CNPJ/CPF: ${documento.empresa.documento}`, 7.5, 205, false, { align: "center" });
      cor(comandosAtual, "#32158a", false);
      texto(comandosAtual, 325, top + 22, "ACEITE DO CLIENTE:", 8.8, true);
      cor(comandosAtual, "#111827", false);
      texto(comandosAtual, 325, top + 45, "Nome:", 7.8);
      linha(comandosAtual, 362, top + 45, 540, top + 45, "#111827", 0.5);
      texto(comandosAtual, 325, top + 67, "CPF:", 7.8);
      linha(comandosAtual, 354, top + 67, 540, top + 67, "#111827", 0.5);
      texto(comandosAtual, 325, top + 89, "Assinatura:", 7.8);
      linha(comandosAtual, 392, top + 89, 540, top + 89, "#111827", 0.5);

      return { comandos: comandosAtual, top: top + 104 };
    }

    const itensPdf = documento.itens.map(normalizarItem).filter((item) => item.descricao || item.valorUnitario || item.quantidade);
    const equipePdf = (documento.equipeServicos || [])
      .map(normalizarServicoEquipe)
      .filter((servico) => servico.descricao || numero(servico.valorDiaria))
      .map((servico) => ({
        ...novoItem(),
        categoria: "Equipe",
        descricao: servico.descricao,
        quantidade: servico.quantidade,
        unidade: "pessoa",
        diarias: servico.diarias,
        valorUnitario: servico.valorDiaria,
        desconto: 0,
        observacoes: servico.observacoes
      }));
    const adicionaisPdf = [
      ["Frete", documento.adicionais.frete],
      ["Montagem", documento.adicionais.montagem],
      ["Desmontagem", documento.adicionais.desmontagem],
      ["Taxas extras", documento.adicionais.taxas]
    ]
      .filter(([, valor]) => numero(valor) > 0)
      .map(([descricao, valor]) => ({
        ...novoItem(),
        categoria: "Adicional",
        descricao,
        quantidade: 1,
        unidade: "servico",
        diarias: 1,
        valorUnitario: valor,
        desconto: 0,
        observacoes: ""
      }));
    let restante = [...itensPdf, ...equipePdf, ...adicionaisPdf];
    if (!restante.length) restante = [novoItem()];
    let comandos = novaPagina({ cabecalho: true });
    desenharDadosIniciais(comandos);
    const modoValores = documento.pdf?.modoValores === "agrupado" ? "agrupado" : "detalhado";
    const linhasTabela = montarLinhasTabelaOrcamento(restante, modoValores);
    const tabela = desenharTabelaOrcamento(comandos, linhasTabela, modoValores, 350);
    comandos = tabela.comandos;
    desenharResumoFinal(comandos, tabela.top);

    const objetos = [];
    const add = (obj) => {
      objetos.push(obj);
      return objetos.length;
    };
    const catalogId = add("");
    const pagesId = add("");
    const font1Id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const font2Id = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageId = logo ? add(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>\nstream\n${logo.data}\nendstream`) : 0;
    const pageIds = [];

    paginas.forEach((conteudo) => {
      const stream = conteudo.join("\n");
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const recursosImagem = imageId ? `/XObject << /I1 ${imageId} 0 R >>` : "";
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> ${recursosImagem} >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });

    objetos[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objetos[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objetos.forEach((obj, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    pdf += `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }

  window.StockSyncOrcamentoOffline = {
    coletarDocumento,
    calcularTotais,
    criarPdfArquivo
  };
})();
