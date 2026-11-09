(() => {
  const WA_PHONE = "556330287105";
  const TOTAL = 4;

  const labels = {
    faixa: {
      "ate-200k": "Até R$ 200 mil",
      "200k-1m": "R$ 200 mil a 1 milhão",
      "1m-4m": "R$ 1 a 4 milhões",
      "acima-4m": "Acima de R$ 4 milhões",
    },
    tipo: {
      custeio: "Custeio",
      investimento: "Investimento",
      cpr: "CPR",
      comercializacao: "Comercialização",
      misto: "Mais de um / não sei",
    },
    atraso: {
      atrasado: "Já estou atrasado",
      "em-dia-apertado": "Em dia, mas o caixa apertou",
      cobranca: "Recebi cobrança / ameaça de execução",
    },
    porte: {
      pronaf: "Pronaf",
      pronamp: "Pronamp",
      demais: "Demais produtores",
      "nao-sei": "Não sei dizer",
    },
    produtor: {
      sim: "Produtor rural",
      cooperativa: "Cooperativa de produção",
      nao: "Não / outra atividade",
    },
  };

  function captureAttribution() {
    const params = new URLSearchParams(window.location.search);
    const keys = ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    const saved = {};
    keys.forEach((key) => {
      const value = params.get(key);
      if (value) {
        saved[key] = value;
        try { sessionStorage.setItem(`cvl_${key}`, value); } catch (_) {}
      } else {
        try {
          const prior = sessionStorage.getItem(`cvl_${key}`);
          if (prior) saved[key] = prior;
        } catch (_) {}
      }
    });
    return saved;
  }

  const attribution = captureAttribution();

  function appendAttribution(url) {
    const u = new URL(url);
    Object.entries(attribution).forEach(([k, v]) => {
      if (v && !u.searchParams.has(k)) u.searchParams.set(k, v);
    });
    return u.toString();
  }

  function track(eventName, payload = {}) {
    if (typeof gtag === "function") gtag("event", eventName, payload);
  }

  function buildMessage(data, source) {
    const lines = [
      "Olá, vim pela página de renegociação de dívidas rurais.",
      `Origem no site: ${source === "chat" ? "assistente WhatsApp" : "formulário de triagem"}`,
      "",
      `Nome: ${data.nome}`,
      `WhatsApp: ${data.telefone}`,
      `Perfil: ${labels.produtor[data.produtor] || data.produtor}`,
      `Faixa da dívida: ${labels.faixa[data.faixa] || data.faixa}`,
      `Tipo: ${labels.tipo[data.tipo] || data.tipo}`,
      `Situação: ${labels.atraso[data.atraso] || data.atraso}`,
      `Enquadramento: ${labels.porte[data.porte] || data.porte}`,
      `Cultura/atividade: ${data.cultura}`,
      `Área (ha): ${data.area}`,
      `Local: ${data.local}`,
    ];
    if (attribution.utm_campaign || attribution.gclid) {
      lines.push("");
      lines.push(
        `Campanha: ${[attribution.utm_source, attribution.utm_medium, attribution.utm_campaign, attribution.gclid ? "gclid" : ""].filter(Boolean).join(" / ")}`
      );
    }
    return lines.join("\n");
  }

  async function saveLeadToCrm(data, source) {
    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          nome: data.nome,
          telefone: data.telefone,
          produtor: data.produtor,
          faixa: data.faixa,
          tipo: data.tipo,
          atraso: data.atraso,
          porte: data.porte,
          cultura: data.cultura,
          area: data.area,
          local: data.local,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("CRM lead:", json.error || res.status);
        return null;
      }
      track("crm_lead_saved", { source, lead_id: json.lead?.id, created: json.created });
      return json.lead || null;
    } catch (e) {
      console.warn("CRM lead falhou (WhatsApp segue):", e);
      return null;
    }
  }

  async function submitLead(data, source) {
    track("generate_lead", {
      event_category: "renegociacao_dividas_rurais",
      lead_source: source,
      value: 1,
      currency: "BRL",
    });
    // Grava no CRM primeiro; se falhar, ainda abre o WhatsApp
    await saveLeadToCrm(data, source);
    track("whatsapp_click", { source });
    const url = `https://api.whatsapp.com/send?phone=${WA_PHONE}&text=${encodeURIComponent(buildMessage(data, source))}`;
    window.open(appendAttribution(url), "_blank", "noopener");
  }

  /* Form */
  const form = document.getElementById("intake-form");
  const disqualified = document.getElementById("intake-disqualified");
  const stepLabel = document.getElementById("step-label");
  const progressBar = document.getElementById("progress-bar");
  const errorEl = document.getElementById("form-error");
  const btnBack = document.getElementById("btn-back");
  const btnNext = document.getElementById("btn-next");
  const btnSubmit = document.getElementById("btn-submit");
  const formNav = document.getElementById("form-nav");
  const previaBox = document.getElementById("previa-box");
  const previaTitulo = document.getElementById("previa-titulo");
  const previaSub = document.getElementById("previa-sub");
  const previaBody = document.getElementById("previa-body");
  const previaAviso = document.getElementById("previa-aviso");
  const btnPreviaContinue = document.getElementById("btn-previa-continue");
  const steps = [...form.querySelectorAll(".step")];
  let step = 0;
  let showingPrevia = false;
  let previaCache = null;
  let consultaValorFormatado = "R$ 497";

  function fillPlaceholders(text, vars) {
    return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
      const v = vars[key];
      return v === undefined || v === null || v === "" ? "—" : String(v);
    });
  }

  async function loadConsultaLabel() {
    try {
      const res = await fetch("/api/public/settings");
      if (!res.ok) return;
      const data = await res.json();
      if (data.consulta_valor_formatado) consultaValorFormatado = data.consulta_valor_formatado;
    } catch (_) {}
  }

  async function loadPreviaTemplate() {
    if (previaCache) return previaCache;
    const res = await fetch("./templates/previa-diagnostico.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Não foi possível carregar a prévia.");
    previaCache = await res.json();
    return previaCache;
  }

  async function buildPreviaLocal({ tipo, faixa, atraso }) {
    await loadConsultaLabel();
    const tpl = await loadPreviaTemplate();
    const vars = {
      tipo_label: labels.tipo[tipo] || tipo,
      faixa_label: labels.faixa[faixa] || faixa,
      situacao_label: labels.atraso[atraso] || atraso,
      consulta_valor_formatado: consultaValorFormatado,
    };
    const paragrafos = [
      fillPlaceholders(tpl.abertura, vars),
      fillPlaceholders((tpl.por_tipo && tpl.por_tipo[tipo]) || "", vars),
      fillPlaceholders((tpl.por_situacao && tpl.por_situacao[atraso]) || "", vars),
      fillPlaceholders((tpl.por_faixa && tpl.por_faixa[faixa]) || "", vars),
      fillPlaceholders(tpl.ponte, vars),
    ].filter((p) => p && p.trim() && p !== "—");
    return {
      titulo: tpl.titulo,
      subtitulo: tpl.subtitulo,
      aviso: tpl.aviso,
      cta: tpl.cta || "Continuar a triagem",
      paragrafos,
    };
  }

  async function showPreviaPanel() {
    showingPrevia = true;
    showError("");
    steps.forEach((el) => {
      el.hidden = true;
      el.classList.remove("is-active");
    });
    if (formNav) formNav.hidden = false;
    btnBack.hidden = false;
    btnNext.hidden = true;
    btnSubmit.hidden = true;
    stepLabel.textContent = "Prévia do caso";
    progressBar.style.width = "40%";
    previaBox.hidden = false;
    previaBody.innerHTML = "<p>Montando sua prévia…</p>";
    try {
      const previa = await buildPreviaLocal({
        tipo: radioValue("tipo"),
        faixa: radioValue("faixa"),
        atraso: radioValue("atraso"),
      });
      previaTitulo.textContent = previa.titulo;
      previaSub.textContent = previa.subtitulo || "";
      previaAviso.textContent = previa.aviso || "";
      btnPreviaContinue.textContent = previa.cta;
      previaBody.innerHTML = previa.paragrafos.map((p) => `<p>${p}</p>`).join("");
      track("previa_diagnostico_view", { source: "form" });
    } catch (e) {
      previaBody.innerHTML = `<p>Não foi possível montar a prévia agora. Você pode continuar a triagem.</p>`;
    }
  }

  function hidePreviaPanel() {
    showingPrevia = false;
    previaBox.hidden = true;
  }

  function showError(msg) {
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function radioValue(name) {
    const el = form.querySelector(`input[name="${name}"]:checked`);
    return el ? el.value : "";
  }

  function validateStep(index) {
    showError("");
    if (index === 0) return radioValue("produtor") ? "" : "Escolha uma opção.";
    if (index === 1) {
      if (!radioValue("faixa") || !radioValue("tipo") || !radioValue("atraso")) {
        return "Preencha faixa, tipo e situação.";
      }
      return "";
    }
    if (index === 2) {
      if (!radioValue("porte")) return "Informe o enquadramento.";
      if (form.cultura.value.trim().length < 2) return "Informe a cultura ou atividade.";
      if (!form.area.value.trim()) return "Informe a área.";
      if (form.local.value.trim().length < 3) return "Informe UF e município.";
      return "";
    }
    if (index === 3) {
      if (form.nome.value.trim().length < 2) return "Informe seu nome.";
      if (form.telefone.value.replace(/\D/g, "").length < 10) return "WhatsApp com DDD inválido.";
      if (!form.lgpd.checked) return "Marque o consentimento.";
      return "";
    }
    return "";
  }

  function renderForm() {
    hidePreviaPanel();
    steps.forEach((el, i) => {
      el.hidden = i !== step;
      el.classList.toggle("is-active", i === step);
    });
    stepLabel.textContent = `Passo ${step + 1} de ${TOTAL}`;
    progressBar.style.width = `${((step + 1) / TOTAL) * 100}%`;
    btnBack.hidden = step === 0;
    btnNext.hidden = step === TOTAL - 1;
    btnSubmit.hidden = step !== TOTAL - 1;
  }

  btnNext.addEventListener("click", async () => {
    const err = validateStep(step);
    if (err) return showError(err);
    if (step === 0 && radioValue("produtor") === "nao") {
      form.hidden = true;
      disqualified.hidden = false;
      track("lead_disqualified", { reason: "not_rural_producer", source: "form" });
      return;
    }
    // Após dados básicos da dívida → prévia resumida
    if (step === 1) {
      await showPreviaPanel();
      return;
    }
    step += 1;
    renderForm();
  });

  btnBack.addEventListener("click", () => {
    showError("");
    if (showingPrevia) {
      hidePreviaPanel();
      step = 1;
      renderForm();
      return;
    }
    step = Math.max(0, step - 1);
    renderForm();
  });

  if (btnPreviaContinue) {
    btnPreviaContinue.addEventListener("click", () => {
      hidePreviaPanel();
      step = 2;
      renderForm();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = validateStep(3);
    if (err) return showError(err);
    if (btnSubmit) btnSubmit.disabled = true;
    try {
      await submitLead(
        {
          produtor: radioValue("produtor"),
          faixa: radioValue("faixa"),
          tipo: radioValue("tipo"),
          atraso: radioValue("atraso"),
          porte: radioValue("porte"),
          cultura: form.cultura.value.trim(),
          area: form.area.value.trim(),
          local: form.local.value.trim(),
          nome: form.nome.value.trim(),
          telefone: form.telefone.value.trim(),
        },
        "form"
      );
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  document.querySelectorAll('a[href*="api.whatsapp.com"]').forEach((anchor) => {
    anchor.href = appendAttribution(anchor.href);
  });

  renderForm();

  /* Chat */
  const launcher = document.getElementById("wa-launcher");
  const panel = document.getElementById("wa-panel");
  const closeBtn = document.getElementById("wa-close");
  const bodyEl = document.getElementById("wa-body");
  const chatForm = document.getElementById("wa-form");
  const chatInput = document.getElementById("wa-input");
  const chatSend = document.getElementById("wa-send");
  const openHero = document.getElementById("open-chat-hero");

  const chatSteps = [
    {
      key: "produtor",
      prompt: "Olá! Triagem da CVL para dívidas rurais.\n\nVocê é produtor rural?",
      options: [
        { value: "sim", label: "Sim, sou produtor rural" },
        { value: "cooperativa", label: "Cooperativa de produção" },
        { value: "nao", label: "Não / outra atividade" },
      ],
    },
    {
      key: "faixa",
      prompt: "Qual a faixa aproximada da dívida?",
      options: [
        { value: "ate-200k", label: "Até R$ 200 mil" },
        { value: "200k-1m", label: "R$ 200 mil a 1 milhão" },
        { value: "1m-4m", label: "R$ 1 a 4 milhões" },
        { value: "acima-4m", label: "Acima de R$ 4 milhões" },
      ],
    },
    {
      key: "tipo",
      prompt: "Tipo principal da dívida?",
      options: [
        { value: "custeio", label: "Custeio" },
        { value: "investimento", label: "Investimento" },
        { value: "cpr", label: "CPR" },
        { value: "comercializacao", label: "Comercialização" },
        { value: "misto", label: "Mais de um / não sei" },
      ],
    },
    {
      key: "atraso",
      prompt: "Como está a situação de pagamento?",
      options: [
        { value: "atrasado", label: "Já estou atrasado" },
        { value: "em-dia-apertado", label: "Em dia, mas o caixa apertou" },
        { value: "cobranca", label: "Cobrança / ameaça de execução" },
      ],
    },
    {
      key: "porte",
      prompt: "Enquadramento?",
      options: [
        { value: "pronaf", label: "Pronaf" },
        { value: "pronamp", label: "Pronamp" },
        { value: "demais", label: "Demais produtores" },
        { value: "nao-sei", label: "Não sei dizer" },
      ],
    },
    { key: "cultura", prompt: "Cultura ou atividade principal?", freeText: true, min: 2 },
    { key: "area", prompt: "Área aproximada (hectares)?", freeText: true, min: 1 },
    { key: "local", prompt: "UF e município? (ex.: TO — Palmas)", freeText: true, min: 3, placeholder: "TO — " },
    { key: "nome", prompt: "Seu nome?", freeText: true, min: 2 },
    { key: "telefone", prompt: "WhatsApp com DDD?", freeText: true, phone: true },
  ];

  let chatIndex = 0;
  let chatData = {};
  let chatStarted = false;
  let awaiting = null;

  function openChat() {
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    if (!chatStarted) {
      chatStarted = true;
      addHint("Mesmas perguntas do formulário");
      askCurrent();
    }
    setTimeout(() => chatInput.focus(), 40);
  }

  function closeChat() {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
  }

  function addMsg(text, who) {
    const div = document.createElement("div");
    div.className = `wa-msg wa-msg--${who}`;
    div.textContent = text;
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function addHint(text) {
    const div = document.createElement("div");
    div.className = "wa-hint";
    div.textContent = text;
    bodyEl.appendChild(div);
  }

  function clearQuick() {
    bodyEl.querySelectorAll(".wa-quick").forEach((el) => el.remove());
  }

  function setInputMode(cfg) {
    const free = Boolean(cfg && cfg.freeText);
    chatInput.disabled = !free;
    chatSend.disabled = !free;
    chatInput.placeholder = free ? cfg.placeholder || "Digite sua resposta…" : "Escolha uma opção acima";
    if (free && cfg.placeholder && !chatInput.value) chatInput.value = cfg.placeholder;
  }

  function askCurrent() {
    clearQuick();
    const cfg = chatSteps[chatIndex];
    if (!cfg) return finishChat();
    awaiting = cfg;
    addMsg(cfg.prompt, "bot");
    setInputMode(cfg);
    if (cfg.options) {
      const wrap = document.createElement("div");
      wrap.className = "wa-quick";
      cfg.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = opt.label;
        btn.addEventListener("click", () => answerChat(opt.value, opt.label));
        wrap.appendChild(btn);
      });
      bodyEl.appendChild(wrap);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    } else {
      chatInput.focus();
    }
  }

  function answerChat(value, displayLabel) {
    const cfg = awaiting;
    if (!cfg) return;

    if (cfg.phone) {
      if (String(value).replace(/\D/g, "").length < 10) {
        addMsg("Informe um WhatsApp válido com DDD.", "bot");
        return;
      }
    } else if (cfg.freeText && String(value).trim().length < (cfg.min || 1)) {
      addMsg("Pode detalhar um pouco mais?", "bot");
      return;
    }

    clearQuick();
    addMsg(displayLabel || value, "user");
    chatData[cfg.key] = String(value).trim();
    chatInput.value = "";

    if (cfg.key === "produtor" && value === "nao") {
      addMsg("Este canal é para dívida rural. Posso abrir o WhatsApp do escritório para outra área.", "bot");
      const wrap = document.createElement("div");
      wrap.className = "wa-quick";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Falar no WhatsApp";
      btn.addEventListener("click", () => {
        window.open(
          appendAttribution(
            `https://api.whatsapp.com/send?phone=${WA_PHONE}&text=${encodeURIComponent(
              "Olá, vim pela página de dívidas rurais, mas meu caso é de outra área."
            )}`
          ),
          "_blank",
          "noopener"
        );
      });
      wrap.appendChild(btn);
      bodyEl.appendChild(wrap);
      awaiting = null;
      setInputMode(null);
      return;
    }

    // Após dados básicos da dívida → prévia resumida no chat
    if (cfg.key === "atraso") {
      awaiting = null;
      setInputMode(null);
      addMsg("Montando uma prévia rápida do seu caso…", "bot");
      buildPreviaLocal({
        tipo: chatData.tipo,
        faixa: chatData.faixa,
        atraso: chatData.atraso,
      })
        .then((previa) => {
          addMsg(previa.titulo, "bot");
          previa.paragrafos.forEach((p) => addMsg(p, "bot"));
          if (previa.aviso) addHint(previa.aviso);
          track("previa_diagnostico_view", { source: "chat" });
          chatIndex += 1;
          setTimeout(askCurrent, 400);
        })
        .catch(() => {
          chatIndex += 1;
          setTimeout(askCurrent, 250);
        });
      return;
    }

    chatIndex += 1;
    if (chatIndex >= chatSteps.length) finishChat();
    else setTimeout(askCurrent, 250);
  }

  function finishChat() {
    awaiting = null;
    setInputMode(null);
    addMsg("Pronto. Toque abaixo para enviar o resumo ao escritório (mesmo funil do formulário).", "bot");
    const wrap = document.createElement("div");
    wrap.className = "wa-quick";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Enviar para o escritório";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await submitLead(
          {
            produtor: chatData.produtor,
            faixa: chatData.faixa,
            tipo: chatData.tipo,
            atraso: chatData.atraso,
            porte: chatData.porte,
            cultura: chatData.cultura,
            area: chatData.area,
            local: chatData.local,
            nome: chatData.nome,
            telefone: chatData.telefone,
          },
          "chat"
        );
      } finally {
        btn.disabled = false;
      }
    });
    wrap.appendChild(btn);
    bodyEl.appendChild(wrap);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  launcher.addEventListener("click", () => (panel.hidden ? openChat() : closeChat()));
  closeBtn.addEventListener("click", closeChat);
  if (openHero) openHero.addEventListener("click", openChat);

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!awaiting || !awaiting.freeText) return;
    const text = chatInput.value.trim();
    if (!text) return;
    answerChat(text, text);
  });
})();
