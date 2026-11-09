(() => {
  const STATUS_LABEL = {
    novo: "Novo",
    triagem: "Triagem",
    atendimento: "Atendimento",
    proposta: "Proposta",
    fechado: "Fechado",
    perdido: "Perdido",
  };

  let selectedId = null;
  let currentLead = null;
  let onlyAtrasados = false;

  const els = {
    userLabel: document.getElementById("user-label"),
    logout: document.getElementById("btn-logout"),
    filter: document.getElementById("filter-status"),
    body: document.getElementById("leads-body"),
    empty: document.getElementById("leads-empty"),
    detailEmpty: document.getElementById("detail-empty"),
    detail: document.getElementById("detail"),
    nome: document.getElementById("d-nome"),
    fone: document.getElementById("d-fone"),
    email: document.getElementById("d-email"),
    status: document.getElementById("d-status"),
    entrada: document.getElementById("d-entrada"),
    interacao: document.getElementById("d-interacao"),
    atrasoWrap: document.getElementById("d-atraso-wrap"),
    atraso: document.getElementById("d-atraso"),
    advance: document.getElementById("btn-advance"),
    lost: document.getElementById("btn-lost"),
    noteText: document.getElementById("note-text"),
    noteBtn: document.getElementById("btn-note"),
    notesList: document.getElementById("notes-list"),
    docsList: document.getElementById("docs-list"),
    contractsList: document.getElementById("contracts-list"),
    btnAtrasados: document.getElementById("btn-atrasados"),
    btnTodos: document.getElementById("btn-todos"),
    atrasadosCount: document.getElementById("atrasados-count"),
    btnContractToggle: document.getElementById("btn-contract-toggle"),
    contractBox: document.getElementById("contract-box"),
    btnContractGenerate: document.getElementById("btn-contract-generate"),
    contractError: document.getElementById("contract-error"),
    cCpf: document.getElementById("c-cpf"),
    cEndereco: document.getElementById("c-endereco"),
    cTipo: document.getElementById("c-tipo"),
    cFaixa: document.getElementById("c-faixa"),
    cSituacao: document.getElementById("c-situacao"),
    cPorte: document.getElementById("c-porte"),
    cCultura: document.getElementById("c-cultura"),
    cArea: document.getElementById("c-area"),
    cLocal: document.getElementById("c-local"),
    stTotal: document.getElementById("st-total"),
    stFechados: document.getElementById("st-fechados"),
    stPerdidos: document.getElementById("st-perdidos"),
    stTaxa: document.getElementById("st-taxa"),
    stMedia: document.getElementById("st-media"),
    stStages: document.getElementById("st-stages"),
    aiPrompt: document.getElementById("ai-prompt"),
    aiReply: document.getElementById("ai-reply"),
    aiError: document.getElementById("ai-error"),
    aiAviso: document.getElementById("ai-aviso"),
    btnAi: document.getElementById("btn-ai"),
    btnAiNote: document.getElementById("btn-ai-note"),
  };

  let lastAiReply = "";

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    if (res.status === 401) {
      location.href = "./login.html";
      throw new Error("Não autenticado");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erro na requisição");
    return data;
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function badgeClass(status) {
    if (status === "perdido") return "badge badge--perdido";
    if (status === "fechado") return "badge badge--fechado";
    return "badge";
  }

  function retornoLabel(lead) {
    if (lead.status === "fechado" || lead.status === "perdido") return "—";
    if (lead.atrasado) {
      const d = lead.dias_sem_retorno;
      return `<span class="badge badge--atrasado">Sem retorno há ${d} dia${d === 1 ? "" : "s"}</span>`;
    }
    if (lead.dias_sem_retorno === 0) return "Hoje";
    if (lead.dias_sem_retorno === 1) return "1 dia";
    return `${lead.dias_sem_retorno} dias`;
  }

  async function ensureAuth() {
    const me = await fetch("/api/me", { credentials: "same-origin" }).then((r) => r.json());
    if (!me.authenticated) {
      location.href = "./login.html";
      return null;
    }
    els.userLabel.textContent = me.user.username;
    return me.user;
  }

  async function loadStats() {
    const data = await api("/api/stats/conversao");
    els.stTotal.textContent = String(data.total_entraram ?? 0);
    els.stFechados.textContent = String(data.fechados ?? 0);
    els.stPerdidos.textContent = String(data.perdidos ?? 0);
    els.stTaxa.textContent = `${data.taxa_fechamento ?? 0}%`;
    els.stMedia.textContent =
      data.tempo_medio_ate_fechar_dias == null
        ? "—"
        : `${data.tempo_medio_ate_fechar_dias} d`;
    els.stStages.innerHTML = "";
    const stages = data.tempo_medio_por_estagio_dias || {};
    for (const [status, days] of Object.entries(stages)) {
      const pill = document.createElement("span");
      pill.className = "stats__pill";
      pill.innerHTML = `${escapeHtml(STATUS_LABEL[status] || status)} <span>${
        days == null ? "—" : `${days} d`
      }</span>`;
      els.stStages.appendChild(pill);
    }
  }

  async function loadLeads() {
    const status = els.filter.value;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (onlyAtrasados) params.set("atrasados", "1");
    const qs = params.toString() ? `?${params}` : "";
    const data = await api(`/api/leads${qs}`);
    els.atrasadosCount.textContent = String(data.atrasados_count ?? 0);
    els.btnAtrasados.hidden = onlyAtrasados;
    els.btnTodos.hidden = !onlyAtrasados;
    els.body.innerHTML = "";
    if (!data.leads.length) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;
    for (const lead of data.leads) {
      const tr = document.createElement("tr");
      tr.dataset.id = String(lead.id);
      if (selectedId === lead.id) tr.classList.add("is-active");
      if (lead.atrasado) tr.classList.add("is-atrasado");
      tr.innerHTML = `
        <td><strong>${escapeHtml(lead.nome)}</strong></td>
        <td>${escapeHtml(lead.telefone || "—")}</td>
        <td><span class="${badgeClass(lead.status)}">${STATUS_LABEL[lead.status] || lead.status}</span></td>
        <td>${retornoLabel(lead)}</td>
      `;
      tr.addEventListener("click", () => openLead(lead.id));
      els.body.appendChild(tr);
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderNotes(notes) {
    els.notesList.innerHTML = "";
    if (!notes.length) {
      els.notesList.innerHTML = `<p class="empty" style="padding:.4rem 0">Sem anotações ainda.</p>`;
      return;
    }
    for (const note of notes) {
      const div = document.createElement("div");
      div.className = "note";
      div.innerHTML = `<time>${escapeHtml(formatDate(note.created_at))}</time><p>${escapeHtml(note.texto)}</p>`;
      els.notesList.appendChild(div);
    }
  }

  function renderDocs(docs, leadId) {
    els.docsList.innerHTML = "";
    if (!docs?.length) {
      els.docsList.innerHTML = `<p class="empty" style="padding:.4rem 0">Nenhum documento enviado.</p>`;
      return;
    }
    for (const doc of docs) {
      const row = document.createElement("div");
      row.className = "doc-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(doc.nome_original)}</strong>
          <span>${escapeHtml(doc.tamanho_legivel || "")} · ${escapeHtml(formatDate(doc.data))}</span>
        </div>
        <a class="btn btn--ghost btn--sm" href="/api/leads/${leadId}/documents/${doc.id}/download">Baixar</a>
      `;
      els.docsList.appendChild(row);
    }
  }

  function renderContracts(contracts, leadId) {
    els.contractsList.innerHTML = "";
    if (!contracts?.length) {
      els.contractsList.innerHTML = `<p class="empty" style="padding:.4rem 0">Nenhum contrato gerado.</p>`;
      return;
    }
    for (const c of contracts) {
      const row = document.createElement("div");
      row.className = "doc-row";
      row.innerHTML = `
        <div>
          <strong>Contrato ${escapeHtml(c.template_id)} v${escapeHtml(c.template_versao || "—")}</strong>
          <span>${escapeHtml(formatDate(c.created_at))}</span>
        </div>
        <a class="btn btn--ghost btn--sm" href="/api/leads/${leadId}/contracts/${c.id}/download">Baixar PDF</a>
      `;
      els.contractsList.appendChild(row);
    }
  }

  function fillContractForm(lead) {
    els.cCpf.value = lead.cpf || "";
    els.cEndereco.value = lead.endereco || "";
    els.cTipo.value = lead.tipo_divida || "";
    els.cFaixa.value = lead.faixa_divida || "";
    els.cSituacao.value = lead.situacao_divida || "";
    els.cPorte.value = lead.porte || "";
    els.cCultura.value = lead.cultura || "";
    els.cArea.value = lead.area_ha || "";
    els.cLocal.value = lead.local_producao || "";
  }

  async function openLead(id) {
    selectedId = id;
    const data = await api(`/api/leads/${id}`);
    currentLead = data.lead;
    els.detailEmpty.hidden = true;
    els.detail.hidden = false;
    els.nome.textContent = data.lead.nome;
    els.fone.textContent = data.lead.telefone || "—";
    els.email.textContent = data.lead.email || "—";
    els.status.textContent = STATUS_LABEL[data.lead.status] || data.lead.status;
    els.status.className = badgeClass(data.lead.status);
    els.entrada.textContent = formatDate(data.lead.data_entrada);
    els.interacao.textContent = formatDate(data.lead.ultima_interacao);
    if (data.lead.atrasado) {
      els.atrasoWrap.hidden = false;
      const d = data.lead.dias_sem_retorno;
      els.atraso.textContent = `Sem retorno há ${d} dia${d === 1 ? "" : "s"}`;
    } else {
      els.atrasoWrap.hidden = true;
    }
    els.advance.disabled = !data.next;
    els.advance.textContent = data.next
      ? `Avançar para ${STATUS_LABEL[data.next]}`
      : "Estágio final";
    els.lost.disabled = data.lead.status === "perdido" || data.lead.status === "fechado";
    fillContractForm(data.lead);
    els.contractError.hidden = true;
    els.aiError.hidden = true;
    els.aiAviso.hidden = true;
    els.aiReply.hidden = true;
    els.btnAiNote.hidden = true;
    lastAiReply = "";
    renderContracts(data.contracts || [], data.lead.id);
    renderDocs(data.documents || [], data.lead.id);
    renderNotes(data.notes);
    [...els.body.querySelectorAll("tr")].forEach((tr) => {
      tr.classList.toggle("is-active", Number(tr.dataset.id) === id);
    });
  }

  els.filter.addEventListener("change", () => {
    loadLeads().catch((e) => alert(e.message));
  });

  els.btnContractToggle.addEventListener("click", () => {
    els.contractBox.hidden = !els.contractBox.hidden;
  });

  els.btnContractGenerate.addEventListener("click", async () => {
    if (!selectedId) return;
    els.contractError.hidden = true;
    els.btnContractGenerate.disabled = true;
    try {
      const payload = {
        cpf: els.cCpf.value.trim(),
        endereco: els.cEndereco.value.trim(),
        tipo_divida: els.cTipo.value.trim(),
        faixa_divida: els.cFaixa.value.trim(),
        situacao_divida: els.cSituacao.value.trim(),
        porte: els.cPorte.value.trim(),
        cultura: els.cCultura.value.trim(),
        area_ha: els.cArea.value.trim(),
        local_producao: els.cLocal.value.trim(),
      };
      const data = await api(`/api/leads/${selectedId}/contract`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await openLead(selectedId);
      await loadLeads();
      window.open(data.download_url, "_blank", "noopener");
    } catch (e) {
      els.contractError.hidden = false;
      els.contractError.textContent = e.message;
    } finally {
      els.btnContractGenerate.disabled = false;
    }
  });

  els.btnAtrasados.addEventListener("click", () => {
    onlyAtrasados = true;
    loadLeads().catch((e) => alert(e.message));
  });

  els.btnTodos.addEventListener("click", () => {
    onlyAtrasados = false;
    loadLeads().catch((e) => alert(e.message));
  });

  els.logout.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    location.href = "./login.html";
  });

  els.advance.addEventListener("click", async () => {
    if (!selectedId) return;
    try {
      await api(`/api/leads/${selectedId}/advance`, { method: "POST", body: "{}" });
      await loadLeads();
      await openLead(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

  els.lost.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!confirm("Marcar este lead como perdido?")) return;
    try {
      await api(`/api/leads/${selectedId}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "perdido" }),
      });
      await loadLeads();
      await openLead(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

  els.noteBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    const texto = els.noteText.value.trim();
    if (texto.length < 2) {
      alert("Escreva uma anotação.");
      return;
    }
    try {
      await api(`/api/leads/${selectedId}/notes`, {
        method: "POST",
        body: JSON.stringify({ texto }),
      });
      els.noteText.value = "";
      await loadLeads();
      await openLead(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

  els.btnAi.addEventListener("click", async () => {
    if (!selectedId) return;
    els.aiError.hidden = true;
    els.aiAviso.hidden = true;
    els.btnAi.disabled = true;
    try {
      const data = await api(`/api/leads/${selectedId}/ai-reply`, {
        method: "POST",
        body: JSON.stringify({ mensagem: els.aiPrompt.value.trim() }),
      });
      lastAiReply = data.reply || "";
      els.aiReply.hidden = false;
      els.aiReply.value = lastAiReply;
      els.btnAiNote.hidden = !lastAiReply;
      if (data.aviso) {
        els.aiAviso.hidden = false;
        els.aiAviso.textContent = data.aviso;
      }
    } catch (e) {
      els.aiError.hidden = false;
      els.aiError.textContent = e.message;
    } finally {
      els.btnAi.disabled = false;
    }
  });

  els.btnAiNote.addEventListener("click", async () => {
    if (!selectedId || !lastAiReply) return;
    try {
      await api(`/api/leads/${selectedId}/notes`, {
        method: "POST",
        body: JSON.stringify({ texto: `[IA] ${lastAiReply}` }),
      });
      els.btnAiNote.hidden = true;
      await loadLeads();
      await openLead(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

  (async () => {
    await ensureAuth();
    await Promise.all([loadStats(), loadLeads()]);
  })().catch((e) => {
    console.error(e);
    location.href = "./login.html";
  });
})();
