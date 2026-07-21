(function () {
  "use strict";

  const TIPO_ARQUIVO = "stocksync-orcamento-offline";
  const VERSAO_ARQUIVO = 1;
  const categorias = ["Som", "Ilumina\u00e7\u00e3o", "Painel de LED", "Cabos", "Energia", "Estrutura", "Consumo", "V\u00eddeo", "Transporte", "M\u00e3o de obra", "Servi\u00e7os", "Outros"];
  const unidades = ["un.", "unidade", "dia", "servi\u00e7o", "servico", "metro", "hora", "pacote", "rolo", "frasco"];
  let sequenciaSessao = 1;
  let arquivoHandleAtual = null;
  let nomeArquivoAtual = "";
  let alteracoesPendentes = false;
  let logoEmpresaDataUrl = "";
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
    eventoData: $("#eventoData"),
    eventoHorario: $("#eventoHorario"),
    eventoCidadeUf: $("#eventoCidadeUf"),
    eventoLocal: $("#eventoLocal"),
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

  function novoItem() {
    return {
      id: `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      categoria: "Som",
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
      evento: { nome: "", data: "", horario: "", local: "", cidadeUf: "" },
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
    return {
      id: item.id || `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      categoria: item.categoria || "Som",
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
    const normalizado = {
      ...base,
      ...documento,
      empresa: normalizarEmpresaDocumento(documento.empresa || {}),
      cliente: { ...base.cliente, ...(documento.cliente || {}) },
      evento: { ...base.evento, ...(documento.evento || {}) },
      adicionais: { ...base.adicionais, ...(documento.adicionais || {}) },
      condicoes: { ...base.condicoes, ...(documento.condicoes || {}) },
      itens: Array.isArray(documento.itens) ? documento.itens.map(normalizarItem) : [novoItem()],
      equipeServicos: equipeDoDocumento
    };
    delete normalizado.adicionais.servicos;
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
    setValor(campos.eventoData, doc.evento.data);
    setValor(campos.eventoHorario, doc.evento.horario);
    setValor(campos.eventoCidadeUf, doc.evento.cidadeUf);
    setValor(campos.eventoLocal, doc.evento.local);
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
        data: campos.eventoData.value,
        horario: campos.eventoHorario.value,
        local: campos.eventoLocal.value.trim(),
        cidadeUf: campos.eventoCidadeUf.value.trim()
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

  function renderLogo() {
    const preview = $("#logoPreview");
    preview.innerHTML = logoEmpresaDataUrl
      ? `<img src="${textoSeguro(logoEmpresaDataUrl)}" alt="Logo da empresa">`
      : "Logo";
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
          quantidade: 0,
          codigos: []
        };
        atual.quantidade += 1;
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
      categoria: categoriaOrcamento(item.categoria),
      descricao: item.nome,
      unidade: unidadeOrcamento(item.unidade, item.tipo === "consumo" ? "unidade" : "un."),
      quantidade: Math.max(1, numero(itens[index].quantidade) || 1)
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
    corpo.innerHTML = itens.map((item, index) => {
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
          <td data-label="Qtd."><input class="number-cell" data-field="quantidade" type="number" min="0" step="1" value="${textoSeguro(item.quantidade)}"></td>
          <td data-label="Un."><select data-field="unidade">${opcoes(unidades, item.unidade)}</select></td>
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
    }).join("");
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
      const label = `${item.categoria} - ${item.quantidade || 0} ${item.tipo === "consumo" ? item.unidade : "un."}`;
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
      return `
        <button class="stock-suggestion" type="button" data-stock-key="${textoSeguro(encodeURIComponent(item.chave))}">
          <span>
            <strong>${textoSeguro(item.nome)}</strong>
            <small>${textoSeguro(detalhe)}</small>
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
      leitor.onload = () => {
        logoEmpresaDataUrl = String(leitor.result || "");
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

  function prepararLogoPdf(dataUrl) {
    if (!dataUrl || typeof Image === "undefined") return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 520;
          const maxH = 240;
          const escala = Math.min(maxW / img.width, maxH / img.height, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * escala));
          canvas.height = Math.max(1, Math.round(img.height * escala));
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#08080c";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const jpg = canvas.toDataURL("image/jpeg", 0.88);
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
    const logo = await prepararLogoPdf(documento.empresa.logo);
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
      const py = pageH - top - h;
      comandos.push(`q ${n(w)} 0 0 ${n(h)} ${n(px)} ${n(py)} cm /I1 Do Q`);
      return true;
    }

    function novaPagina() {
      const comandos = [];
      paginas.push(comandos);
      desenharCabecalho(comandos, paginas.length);
      return comandos;
    }

    function desenharCabecalho(comandos, pagina) {
      rect(comandos, 0, 0, pageW, 94, "#08080c");
      if (logo) {
        imagem(comandos, 28, 28, 118, 46);
      } else {
        cor(comandos, "#ffffff", false);
        textoAuto(comandos, 28, 40, documento.empresa.nome || "Empresa", 13, 176, true);
        textoAuto(comandos, 28, 60, documento.empresa.telefone || documento.empresa.email || "", 8.8, 176);
      }
      cor(comandos, "#8b5cf6", false);
      texto(comandos, 286, 58, "OR\u00c7AMENTO", 24, true, { align: "center" });
      rect(comandos, 438, 22, 129, 54, "#111827", "#8b5cf6", 0.6);
      cor(comandos, "#ffffff", false);
      textoAuto(comandos, 502, 42, `No ${documento.numero || ""}`, 10.5, 104, true, { align: "center" });
      textoAuto(comandos, 502, 61, `Emissao: ${dataBR(documento.emissao)}`, 8.2, 112, false, { align: "center" });
      if (pagina > 1) texto(comandos, 550, 82, `Pag. ${pagina}`, 7.5, false, { align: "right" });
    }

    function campo(comandos, label, valor, x, top, labelW, valueW) {
      cor(comandos, "#111827", false);
      const gap = 3;
      const valorX = x + larguraTexto(label, 8.2, true) + gap;
      texto(comandos, x, top, label, 8.2, true);
      textoAuto(comandos, valorX, top, valor || "-", 8.2, Math.max(45, labelW + valueW - (valorX - x)));
    }

    function desenharDadosIniciais(comandos) {
      rect(comandos, 28, 112, 539, 118, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, 134, "DADOS DO CLIENTE", 10.5, true);
      campo(comandos, "Cliente:", documento.cliente.nome, 46, 157, 46, 185);
      campo(comandos, "CPF/CNPJ:", documento.cliente.documento, 46, 174, 58, 172);
      campo(comandos, "Telefone:", documento.cliente.telefone, 46, 191, 55, 170);
      campo(comandos, "E-mail:", documento.cliente.email, 46, 208, 42, 190);
      campo(comandos, "Evento:", documento.evento.nome, 318, 157, 47, 168);
      campo(comandos, "Data:", dataBR(documento.evento.data), 318, 174, 35, 92);
      campo(comandos, "Horario:", documento.evento.horario, 318, 191, 47, 92);
      campo(comandos, "Local:", documento.evento.local || documento.evento.cidadeUf, 318, 208, 38, 180);

      rect(comandos, 28, 244, 539, 76, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, 266, "CONDI\u00c7\u00d5ES COMERCIAIS", 10.5, true);
      campo(comandos, "Pagamento:", documento.condicoes.pagamento, 46, 290, 66, 190);
      campo(comandos, "Entrada:", documento.condicoes.entrada, 46, 307, 50, 170);
      campo(comandos, "Validade:", dataBR(documento.condicoes.validade), 318, 290, 55, 110);
      campo(comandos, "Vencimento:", dataBR(documento.condicoes.vencimento), 318, 307, 72, 110);
    }

    function desenharTabela(comandos, linhas, offset, top) {
      const x = 28;
      const w = 539;
      const headerH = 24;
      const rowH = 18;
      const col = [x, 58, 118, 310, 358, 420, 492, x + w];
      rect(comandos, x, top, w, headerH + (linhas.length * rowH), "#ffffff", "#8b5cf6");
      rect(comandos, x, top, w, headerH, "#32158a");
      cor(comandos, "#ffffff", false);
      texto(comandos, 43, top + 16, "ITEM", 7.6, true, { align: "center" });
      texto(comandos, 88, top + 16, "CAT.", 7.6, true, { align: "center" });
      texto(comandos, 214, top + 16, "DESCRI\u00c7\u00c3O", 7.6, true, { align: "center" });
      texto(comandos, 334, top + 16, "QTD", 7.6, true, { align: "center" });
      texto(comandos, 389, top + 16, "DIARIAS", 7.6, true, { align: "center" });
      texto(comandos, 456, top + 16, "UNIT.", 7.6, true, { align: "center" });
      texto(comandos, 530, top + 16, "TOTAL", 7.6, true, { align: "center" });
      col.slice(1, -1).forEach((px) => linha(comandos, px, top, px, top + headerH + (linhas.length * rowH), "#c7b7ff", 0.3));

      linhas.forEach((item, idx) => {
        const yRow = top + headerH + (idx * rowH);
        const calc = calcularItem(item);
        linha(comandos, x, yRow, x + w, yRow, "#d1d5db", 0.28);
        cor(comandos, "#32158a", false);
        texto(comandos, 43, yRow + 12, String(offset + idx + 1).padStart(2, "0"), 7.8, true, { align: "center" });
        cor(comandos, "#111827", false);
        textoAuto(comandos, 88, yRow + 12, item.categoria, 7.4, 52, false, { align: "center" });
        textoAuto(comandos, 214, yRow + 12, item.descricao || "-", 7.7, 180, false, { align: "center" });
        texto(comandos, 334, yRow + 12, String(item.quantidade || 0), 7.8, false, { align: "center" });
        texto(comandos, 389, yRow + 12, String(item.diarias || 1), 7.8, false, { align: "center" });
        texto(comandos, 456, yRow + 12, dinheiro(item.valorUnitario), 7.4, false, { align: "center" });
        texto(comandos, 552, yRow + 12, dinheiro(calc.total), 7.4, false, { align: "right" });
      });
      return top + headerH + (linhas.length * rowH);
    }

    function desenharResumo(comandos, top) {
      rect(comandos, 28, top, 318, 70, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, top + 22, "OBSERVA\u00c7\u00d5ES", 10, true);
      textoWrap(comandos, 48, top + 42, documento.condicoes.observacoes, 64, 7.8, 3, 11);

      rect(comandos, 360, top, 207, 70, "#32158a", "#32158a");
      cor(comandos, "#ffffff", false);
      texto(comandos, 464, top + 26, "TOTAL GERAL", 10.5, true, { align: "center" });
      texto(comandos, 464, top + 56, dinheiro(totais.totalGeral), 20, true, { align: "center" });

      const topDetalhes = top + 86;
      rect(comandos, 28, topDetalhes, 539, 66, "#ffffff", "#8b5cf6");
      cor(comandos, "#32158a", false);
      texto(comandos, 46, topDetalhes + 20, "RESUMO FINANCEIRO", 9.4, true);
      cor(comandos, "#111827", false);
      campo(comandos, "Itens:", dinheiro(totais.subtotalItens), 46, topDetalhes + 42, 36, 78);
      campo(comandos, "Equipe:", dinheiro(totais.subtotalEquipe), 166, topDetalhes + 42, 46, 78);
      campo(comandos, "Adic.:", dinheiro(totais.adicionais), 304, topDetalhes + 42, 40, 78);
      campo(comandos, "Desc.:", dinheiro(totais.totalDescontos), 430, topDetalhes + 42, 42, 78);
      textoWrap(comandos, 46, topDetalhes + 61, documento.condicoes.termos, 106, 7.2, 1, 10);

      const topAssinatura = topDetalhes + 82;
      rect(comandos, 28, topAssinatura, 539, 108, "#ffffff", "#111827", 0.55);
      linha(comandos, 297, topAssinatura, 297, topAssinatura + 108, "#111827", 0.55);
      linha(comandos, 70, topAssinatura + 45, 254, topAssinatura + 45, "#111827", 0.7);
      textoAuto(comandos, 162, topAssinatura + 64, documento.empresa.nome || "Empresa", 8.5, 205, true, { align: "center" });
      if (documento.empresa.documento) textoAuto(comandos, 162, topAssinatura + 78, `CNPJ/CPF: ${documento.empresa.documento}`, 7.5, 205, false, { align: "center" });
      cor(comandos, "#32158a", false);
      texto(comandos, 325, topAssinatura + 24, "ACEITE DO CLIENTE:", 8.8, true);
      cor(comandos, "#111827", false);
      texto(comandos, 325, topAssinatura + 47, "Nome:", 7.8);
      linha(comandos, 362, topAssinatura + 47, 540, topAssinatura + 47, "#111827", 0.5);
      texto(comandos, 325, topAssinatura + 69, "CPF:", 7.8);
      linha(comandos, 354, topAssinatura + 69, 540, topAssinatura + 69, "#111827", 0.5);
      texto(comandos, 325, topAssinatura + 91, "Assinatura:", 7.8);
      linha(comandos, 392, topAssinatura + 91, 540, topAssinatura + 91, "#111827", 0.5);

      cor(comandos, "#111827", false);
      const rodape = [documento.empresa.telefone, documento.empresa.email, documento.empresa.endereco].filter(Boolean).join(" | ");
      textoAuto(comandos, pageW / 2, 820, rodape, 7.2, 520, false, { align: "center" });
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
    let offset = 0;
    let comandos = novaPagina();
    desenharDadosIniciais(comandos);
    let maxLinhas = 8;
    let parte = restante.slice(offset, offset + maxLinhas);
    let finalTabela = desenharTabela(comandos, parte, offset, 338);
    offset += parte.length;

    while (offset < restante.length) {
      comandos = novaPagina();
      maxLinhas = 25;
      parte = restante.slice(offset, offset + maxLinhas);
      finalTabela = desenharTabela(comandos, parte, offset, 124);
      offset += parte.length;
    }

    if (finalTabela + 320 > 826) {
      comandos = novaPagina();
      desenharResumo(comandos, 126);
    } else {
      desenharResumo(comandos, finalTabela + 22);
    }

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
