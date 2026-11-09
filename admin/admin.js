(() => {
  const STATUS_LABEL = {
    novo: "Novo",
    triagem: "Triagem",
    atendimento: "Atendimento",
    proposta: "Proposta",
    fechado: "Fechado",
    perdido: "Perdido",
  };

  const KANBAN_STATUSES = ["novo", "triagem", "atendimento", "proposta", "fechado", "perdido"];

  let selectedId = null;
  let currentLead = null;
  let onlyAtrasados = false;

  const els = {
    userLabel: document.getElementById("user-label"),
    logout: document.getElementById("btn-logout"),
    board: document.getElementById("kanban-board"),
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
    dFaixa: document.getElementById("d-faixa"),
    dTipo: document.getElementById("d-tipo"),
    dSituacao: document.getElementById("d-situacao"),
    dLocal: document.getElementById("d-local"),
    dCultura: document.getElementById("d-cultura"),
    dPorte: document.getElementById("d-porte"),
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
    if (lead.status === "fechado" || lead.status === "perdido") return "Encerrado";
    if (lead.atrasado) {
      const d = lead.dias_sem_retorno;
      return `<span class="badge badge--atrasado">Sem retorno há ${d} dia${d === 1 ? "" : "s"}</span>`;
    }
    if (lead.dias_sem_retorno === 0) return "Retorno: hoje";
    if (lead.dias_sem_retorno === 1) return "Retorno: 1 dia";
    return `Retorno: ${lead.dias_sem_retorno} dias`;
  }

  function shortText(value, max = 42) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function cardTags(lead) {
    const tags = [];
    if (lead.faixa_divida) {
      tags.push(`<span class="kanban-card__tag kanban-card__tag--money">${escapeHtml(shortText(lead.faixa_divida, 36))}</span>`);
    }
    if (lead.tipo_divida) {
      tags.push(`<span class="kanban-card__tag">${escapeHtml(shortText(lead.tipo_divida, 28))}</span>`);
    }
    if (lead.situacao_divida) {
      tags.push(`<span class="kanban-card__tag">${escapeHtml(shortText(lead.situacao_divida, 28))}</span>`);
    }
    return tags.length ? `<div class="kanban-card__row">${tags.join("")}</div>` : "";
  }

  function cardSecondary(lead) {
    const bits = [];
    if (lead.local_producao) bits.push(shortText(lead.local_producao, 28));
    if (lead.cultura) bits.push(shortText(lead.cultura, 22));
    if (lead.porte) bits.push(shortText(lead.porte, 18));
    return bits.length
      ? `<span class="kanban-card__meta">${escapeHtml(bits.join(" · "))}</span>`
      : "";
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
    if (els.stStages) {
      els.stStages.innerHTML = "";
      const stages = data.tempo_medio_por_estagio_dias || {};
      const entries = Object.entries(stages);
      els.stStages.hidden = entries.length === 0;
      for (const [status, days] of entries) {
        const pill = document.createElement("span");
        pill.className = "stats__pill";
        pill.innerHTML = `${escapeHtml(STATUS_LABEL[status] || status)} <span>${
          days == null ? "—" : `${days} d`
        }</span>`;
        els.stStages.appendChild(pill);
      }
    }
  }

  function highlightSelectedCard() {
    if (!els.board) return;
    els.board.querySelectorAll(".kanban-card").forEach((card) => {
      card.classList.toggle("is-active", Number(card.dataset.id) === selectedId);
    });
  }

  async function moveLeadToStatus(leadId, status) {
    await api(`/api/leads/${leadId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await loadLeads();
    if (selectedId === leadId) await openLead(leadId);
    await loadStats();
  }

  function bindColumnDrop(colEl, status) {
    colEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      colEl.classList.add("is-drop");
    });
    colEl.addEventListener("dragleave", () => colEl.classList.remove("is-drop"));
    colEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      colEl.classList.remove("is-drop");
      const leadId = Number(e.dataTransfer.getData("text/lead-id"));
      const from = e.dataTransfer.getData("text/lead-status");
      if (!leadId || from === status) return;
      try {
        await moveLeadToStatus(leadId, status);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async function loadLeads() {
    const params = new URLSearchParams();
    if (onlyAtrasados) params.set("atrasados", "1");
    const qs = params.toString() ? `?${params}` : "";
    const data = await api(`/api/leads${qs}`);
    els.atrasadosCount.textContent = String(data.atrasados_count ?? 0);
    els.btnAtrasados.hidden = onlyAtrasados;
    els.btnTodos.hidden = !onlyAtrasados;

    if (!els.board) return;
    els.board.innerHTML = "";
    if (!data.leads.length) {
      els.empty.hidden = false;
      return;
    }
    els.empty.hidden = true;

    const byStatus = Object.fromEntries(KANBAN_STATUSES.map((s) => [s, []]));
    for (const lead of data.leads) {
      if (byStatus[lead.status]) byStatus[lead.status].push(lead);
      else byStatus.novo.push(lead);
    }

    for (const status of KANBAN_STATUSES) {
      const col = document.createElement("div");
      col.className = `kanban-col kanban-col--${status}`;
      col.dataset.status = status;
      const list = byStatus[status] || [];
      col.innerHTML = `
        <div class="kanban-col__head">
          <span>${escapeHtml(STATUS_LABEL[status])}</span>
          <strong>${list.length}</strong>
        </div>
        <div class="kanban-col__body" data-drop="${status}"></div>
      `;
      const body = col.querySelector(".kanban-col__body");
      bindColumnDrop(body, status);
      for (const lead of list) {
        const card = document.createElement("article");
        card.className = "kanban-card" + (lead.atrasado ? " is-atrasado" : "");
        card.draggable = true;
        card.dataset.id = String(lead.id);
        card.dataset.status = lead.status;
        card.innerHTML = `
          <p class="kanban-card__name">${escapeHtml(lead.nome || "Sem nome")}</p>
          <span class="kanban-card__phone">${escapeHtml(lead.telefone || "Sem WhatsApp")}</span>
          ${cardTags(lead)}
          ${cardSecondary(lead)}
          <span class="kanban-card__meta">${retornoLabel(lead)}</span>
        `;
        card.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/lead-id", String(lead.id));
          e.dataTransfer.setData("text/lead-status", lead.status);
          card.classList.add("is-dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
        card.addEventListener("click", () => openLead(lead.id));
        body.appendChild(card);
      }
      els.board.appendChild(col);
    }
    highlightSelectedCard();
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
    if (els.dFaixa) els.dFaixa.textContent = data.lead.faixa_divida || "—";
    if (els.dTipo) els.dTipo.textContent = data.lead.tipo_divida || "—";
    if (els.dSituacao) els.dSituacao.textContent = data.lead.situacao_divida || "—";
    if (els.dLocal) els.dLocal.textContent = data.lead.local_producao || "—";
    if (els.dCultura) els.dCultura.textContent = data.lead.cultura || "—";
    if (els.dPorte) els.dPorte.textContent = data.lead.porte || "—";
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
    highlightSelectedCard();
  }

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
