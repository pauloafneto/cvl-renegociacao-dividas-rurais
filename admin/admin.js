(() => {
  const STATUS_LABEL = {
    novo: "Novo",
    triagem: "Triagem",
    atendimento: "Atendimento",
    proposta: "Proposta",
    fechado: "Fechado",
    perdido: "Perdido",
  };
  const PRIORITY_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" };
  const KANBAN_STATUSES = ["novo", "triagem", "atendimento", "proposta", "fechado", "perdido"];
  const PANEL_W_KEY = "cvl-crm-panel-w";
  const PANEL_W_DEFAULT = 360;

  let selectedId = null;
  let currentLead = null;
  let currentTags = [];
  let catalogTags = [];
  let onlyAtrasados = false;
  let onlyCriticos = false;
  let viewMode = localStorage.getItem("cvl-crm-view") || "kanban";
  let searchQ = "";
  let filterStatus = "";
  let filterPriority = "";
  let searchTimer = null;
  let lastAiReply = "";
  let allLeadsCache = [];

  const els = {
    userLabel: document.getElementById("user-label"),
    logout: document.getElementById("btn-logout"),
    board: document.getElementById("kanban-board"),
    listPane: document.getElementById("list-pane"),
    listBody: document.getElementById("list-body"),
    empty: document.getElementById("leads-empty"),
    detailEmpty: document.getElementById("detail-empty"),
    detail: document.getElementById("detail"),
    workspace: document.getElementById("workspace"),
    panelResize: document.getElementById("panel-resize"),
    detailCard: document.getElementById("detail-card"),
    nome: document.getElementById("d-nome"),
    fone: document.getElementById("d-fone"),
    email: document.getElementById("d-email"),
    status: document.getElementById("d-status"),
    prioridade: document.getElementById("d-prioridade"),
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
    btnCriticos: document.getElementById("btn-criticos"),
    btnTodos: document.getElementById("btn-todos"),
    atrasadosCount: document.getElementById("atrasados-count"),
    criticosCount: document.getElementById("criticos-count"),
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
    searchQ: document.getElementById("search-q"),
    filterStatus: document.getElementById("filter-status"),
    filterPriority: document.getElementById("filter-priority"),
    viewKanban: document.getElementById("view-kanban"),
    viewLista: document.getElementById("view-lista"),
    statusSelect: document.getElementById("d-status-select"),
    prioSelect: document.getElementById("d-prio-select"),
    tagsBox: document.getElementById("tags-box"),
    tasksList: document.getElementById("tasks-list"),
    taskTitle: document.getElementById("task-title"),
    btnTask: document.getElementById("btn-task"),
    btnOpenFicha: document.getElementById("btn-open-ficha"),
    fichaDialog: document.getElementById("ficha-dialog"),
    fichaTitle: document.getElementById("ficha-title"),
    fichaBody: document.getElementById("ficha-body"),
    btnFichaClose: document.getElementById("btn-ficha-close"),
  };

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

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
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

  function prioBadgeClass(prio) {
    if (prio === "alta") return "badge badge--prio badge--prio-alta";
    if (prio === "baixa") return "badge badge--prio badge--prio-baixa";
    return "badge badge--prio";
  }

  function retornoLabel(lead) {
    if (lead.status === "fechado" || lead.status === "perdido") return "Encerrado";
    if (lead.critico) {
      const d = lead.dias_sem_retorno;
      return `<span class="badge badge--critico">Crítico · ${d} dia${d === 1 ? "" : "s"}</span>`;
    }
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
    for (const tag of lead.tags || []) {
      tags.push(
        `<span class="kanban-card__tag" style="background:${escapeHtml(tag.color)};color:#fff;border-color:transparent">${escapeHtml(shortText(tag.name, 18))}</span>`
      );
    }
    if (lead.faixa_divida) {
      tags.push(`<span class="kanban-card__tag kanban-card__tag--money">${escapeHtml(shortText(lead.faixa_divida, 28))}</span>`);
    }
    if (lead.tipo_divida) {
      tags.push(`<span class="kanban-card__tag">${escapeHtml(shortText(lead.tipo_divida, 22))}</span>`);
    }
    return tags.length ? `<div class="kanban-card__row">${tags.join("")}</div>` : "";
  }

  function cardSecondary(lead) {
    const bits = [];
    if (lead.local_producao) bits.push(shortText(lead.local_producao, 28));
    if (lead.cultura) bits.push(shortText(lead.cultura, 22));
    if (lead.porte) bits.push(shortText(lead.porte, 18));
    if (lead.tarefas_abertas > 0) bits.push(`${lead.tarefas_abertas} tarefa${lead.tarefas_abertas === 1 ? "" : "s"}`);
    return bits.length
      ? `<span class="kanban-card__meta">${escapeHtml(bits.join(" · "))}</span>`
      : "";
  }

  function applyPanelWidth(width) {
    const w = Math.min(560, Math.max(280, Number(width) || PANEL_W_DEFAULT));
    els.workspace.style.setProperty("--panel-w", `${w}px`);
    return w;
  }

  function initPanelResize() {
    const saved = Number(localStorage.getItem(PANEL_W_KEY));
    applyPanelWidth(saved || PANEL_W_DEFAULT);
    let dragging = false;
    let startX = 0;
    let startW = PANEL_W_DEFAULT;

    els.panelResize.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX;
      startW = Number(getComputedStyle(els.workspace).getPropertyValue("--panel-w").replace("px", "")) || PANEL_W_DEFAULT;
      els.panelResize.classList.add("is-dragging");
      els.panelResize.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    els.panelResize.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const delta = startX - e.clientX;
      applyPanelWidth(startW + delta);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      els.panelResize.classList.remove("is-dragging");
      const w = Number(getComputedStyle(els.workspace).getPropertyValue("--panel-w").replace("px", ""));
      localStorage.setItem(PANEL_W_KEY, String(Math.round(w)));
      try { els.panelResize.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    els.panelResize.addEventListener("pointerup", endDrag);
    els.panelResize.addEventListener("pointercancel", endDrag);
    els.panelResize.addEventListener("dblclick", () => {
      applyPanelWidth(PANEL_W_DEFAULT);
      localStorage.setItem(PANEL_W_KEY, String(PANEL_W_DEFAULT));
    });
  }

  function setView(mode) {
    viewMode = mode === "lista" ? "lista" : "kanban";
    localStorage.setItem("cvl-crm-view", viewMode);
    els.viewKanban.classList.toggle("is-active", viewMode === "kanban");
    els.viewLista.classList.toggle("is-active", viewMode === "lista");
    els.board.hidden = viewMode !== "kanban";
    els.listPane.hidden = viewMode !== "lista";
    renderBoardOrList(allLeadsCache);
  }

  function fillStatusFilter() {
    els.filterStatus.innerHTML = `<option value="">Todos os estágios</option>`;
    for (const status of KANBAN_STATUSES) {
      const opt = document.createElement("option");
      opt.value = status;
      opt.textContent = STATUS_LABEL[status];
      els.filterStatus.appendChild(opt);
    }
    els.statusSelect.innerHTML = "";
    for (const status of KANBAN_STATUSES) {
      const opt = document.createElement("option");
      opt.value = status;
      opt.textContent = STATUS_LABEL[status];
      els.statusSelect.appendChild(opt);
    }
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

  async function loadTagCatalog() {
    const data = await api("/api/tags");
    catalogTags = data.tags || [];
  }

  function highlightSelected() {
    if (els.board) {
      els.board.querySelectorAll(".kanban-card").forEach((card) => {
        card.classList.toggle("is-active", Number(card.dataset.id) === selectedId);
      });
    }
    if (els.listBody) {
      els.listBody.querySelectorAll("tr").forEach((row) => {
        row.classList.toggle("is-active", Number(row.dataset.id) === selectedId);
      });
    }
  }

  async function moveLeadToStatus(leadId, status) {
    await api(`/api/leads/${leadId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    await loadLeads();
    if (selectedId === leadId) await openLead(leadId, { keepFicha: true });
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

  function bindLeadOpen(el, leadId) {
    let clickTimer = null;
    el.addEventListener("click", (e) => {
      if (e.detail > 1) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        openLead(leadId).catch((err) => alert(err.message));
      }, 180);
    });
    el.addEventListener("dblclick", (e) => {
      e.preventDefault();
      clearTimeout(clickTimer);
      openLead(leadId, { openFicha: true }).catch((err) => alert(err.message));
    });
  }

  function renderKanban(leads) {
    els.board.innerHTML = "";
    const byStatus = Object.fromEntries(KANBAN_STATUSES.map((s) => [s, []]));
    for (const lead of leads) {
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
        const prio = lead.prioridade || "media";
        const card = document.createElement("article");
        card.className =
          "kanban-card" +
          (lead.critico ? " is-critico" : lead.atrasado ? " is-atrasado" : "");
        card.draggable = true;
        card.dataset.id = String(lead.id);
        card.dataset.status = lead.status;
        card.innerHTML = `
          <div class="kanban-card__top">
            <p class="kanban-card__name">${escapeHtml(lead.nome || "Sem nome")}</p>
            <span class="prio-dot prio-dot--${escapeHtml(prio)}" title="Prioridade ${escapeHtml(PRIORITY_LABEL[prio] || prio)}"></span>
          </div>
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
        bindLeadOpen(card, lead.id);
        body.appendChild(card);
      }
      els.board.appendChild(col);
    }
  }

  function renderList(leads) {
    els.listBody.innerHTML = "";
    for (const lead of leads) {
      const prio = lead.prioridade || "media";
      const tr = document.createElement("tr");
      tr.dataset.id = String(lead.id);
      const tagHtml = (lead.tags || [])
        .map(
          (t) =>
            `<span class="kanban-card__tag" style="background:${escapeHtml(t.color)};color:#fff;border-color:transparent">${escapeHtml(t.name)}</span>`
        )
        .join("");
      tr.innerHTML = `
        <td>
          <div class="list-table__name">${escapeHtml(lead.nome || "Sem nome")}</div>
          ${tagHtml ? `<div class="list-table__tags">${tagHtml}</div>` : ""}
        </td>
        <td>${escapeHtml(lead.telefone || "—")}</td>
        <td><span class="${badgeClass(lead.status)}">${escapeHtml(STATUS_LABEL[lead.status] || lead.status)}</span></td>
        <td><span class="${prioBadgeClass(prio)}">${escapeHtml(PRIORITY_LABEL[prio] || prio)}</span></td>
        <td>${escapeHtml(shortText([lead.faixa_divida, lead.tipo_divida].filter(Boolean).join(" · "), 48) || "—")}</td>
        <td>${retornoLabel(lead)}</td>
        <td>${lead.tarefas_abertas || 0}</td>
      `;
      bindLeadOpen(tr, lead.id);
      els.listBody.appendChild(tr);
    }
  }

  function renderBoardOrList(leads) {
    if (!leads.length) {
      els.empty.hidden = false;
      els.board.innerHTML = "";
      els.listBody.innerHTML = "";
      return;
    }
    els.empty.hidden = true;
    if (viewMode === "lista") renderList(leads);
    else renderKanban(leads);
    highlightSelected();
  }

  async function loadLeads() {
    const params = new URLSearchParams();
    if (onlyCriticos) params.set("criticos", "1");
    else if (onlyAtrasados) params.set("atrasados", "1");
    if (filterStatus) params.set("status", filterStatus);
    if (filterPriority) params.set("prioridade", filterPriority);
    if (searchQ) params.set("q", searchQ);
    const qs = params.toString() ? `?${params}` : "";
    const data = await api(`/api/leads${qs}`);
    allLeadsCache = data.leads || [];
    els.atrasadosCount.textContent = String(data.atrasados_count ?? 0);
    els.criticosCount.textContent = String(data.criticos_count ?? 0);
    els.btnAtrasados.hidden = onlyAtrasados || onlyCriticos;
    els.btnCriticos.hidden = onlyAtrasados || onlyCriticos;
    els.btnTodos.hidden = !(onlyAtrasados || onlyCriticos);
    renderBoardOrList(allLeadsCache);
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

  function renderTags(selected) {
    const selectedIds = new Set((selected || []).map((t) => t.id));
    els.tagsBox.innerHTML = "";
    for (const tag of catalogTags) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-chip" + (selectedIds.has(tag.id) ? " is-on" : "");
      btn.textContent = tag.name;
      if (selectedIds.has(tag.id)) {
        btn.style.background = tag.color;
        btn.style.borderColor = "transparent";
      }
      btn.addEventListener("click", async () => {
        if (!selectedId) return;
        const next = new Set(selectedIds);
        if (next.has(tag.id)) next.delete(tag.id);
        else next.add(tag.id);
        try {
          const data = await api(`/api/leads/${selectedId}/tags`, {
            method: "PUT",
            body: JSON.stringify({ tag_ids: [...next] }),
          });
          currentTags = data.tags || [];
          renderTags(currentTags);
          await loadLeads();
        } catch (e) {
          alert(e.message);
        }
      });
      els.tagsBox.appendChild(btn);
    }
  }

  function renderTasks(tasks) {
    els.tasksList.innerHTML = "";
    if (!tasks?.length) {
      els.tasksList.innerHTML = `<p class="empty" style="padding:.2rem 0">Nenhuma tarefa.</p>`;
      return;
    }
    for (const task of tasks) {
      const row = document.createElement("div");
      row.className = "task-row" + (task.done ? " is-done" : "");
      row.innerHTML = `
        <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Concluir tarefa" />
        <span class="task-row__title">${escapeHtml(task.titulo)}</span>
        <button type="button" title="Excluir">×</button>
      `;
      const check = row.querySelector("input");
      const del = row.querySelector("button");
      check.addEventListener("change", async () => {
        try {
          await api(`/api/leads/${selectedId}/tasks/${task.id}/done`, {
            method: "POST",
            body: JSON.stringify({ done: check.checked }),
          });
          await openLead(selectedId, { keepFicha: true });
          await loadLeads();
        } catch (e) {
          alert(e.message);
        }
      });
      del.addEventListener("click", async () => {
        try {
          await api(`/api/leads/${selectedId}/tasks/${task.id}`, { method: "DELETE" });
          await openLead(selectedId, { keepFicha: true });
          await loadLeads();
        } catch (e) {
          alert(e.message);
        }
      });
      els.tasksList.appendChild(row);
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

  function openFichaDialog(lead) {
    els.fichaTitle.textContent = lead.nome || "Ficha do lead";
    els.fichaBody.innerHTML = `
      <div class="detail__chips" style="margin-bottom:.75rem">
        <span class="${badgeClass(lead.status)}">${escapeHtml(STATUS_LABEL[lead.status] || lead.status)}</span>
        <span class="${prioBadgeClass(lead.prioridade || "media")}">${escapeHtml(PRIORITY_LABEL[lead.prioridade || "media"])}</span>
      </div>
      <dl class="facts">
        <div><dt>WhatsApp</dt><dd>${escapeHtml(lead.telefone || "—")}</dd></div>
        <div><dt>E-mail</dt><dd>${escapeHtml(lead.email || "—")}</dd></div>
        <div><dt>Faixa</dt><dd>${escapeHtml(lead.faixa_divida || "—")}</dd></div>
        <div><dt>Tipo</dt><dd>${escapeHtml(lead.tipo_divida || "—")}</dd></div>
        <div><dt>Situação</dt><dd>${escapeHtml(lead.situacao_divida || "—")}</dd></div>
        <div><dt>Local</dt><dd>${escapeHtml(lead.local_producao || "—")}</dd></div>
        <div><dt>Cultura</dt><dd>${escapeHtml(lead.cultura || "—")}</dd></div>
        <div><dt>Porte</dt><dd>${escapeHtml(lead.porte || "—")}</dd></div>
        <div><dt>Entrada</dt><dd>${escapeHtml(formatDate(lead.data_entrada))}</dd></div>
        <div><dt>Última interação</dt><dd>${escapeHtml(formatDate(lead.ultima_interacao))}</dd></div>
      </dl>
      <p class="contract-hint" style="margin-top:1rem">Use o painel ao lado para avançar estágio, tags, tarefas, contrato e anotações.</p>
    `;
    if (typeof els.fichaDialog.showModal === "function") els.fichaDialog.showModal();
    else els.fichaDialog.setAttribute("open", "open");
  }

  async function openLead(id, { openFicha = false, keepFicha = false } = {}) {
    selectedId = id;
    const data = await api(`/api/leads/${id}`);
    currentLead = data.lead;
    currentTags = data.tags || data.lead.tags || [];
    els.detailEmpty.hidden = true;
    els.detail.hidden = false;
    els.btnOpenFicha.hidden = false;
    els.nome.textContent = data.lead.nome;
    els.fone.textContent = data.lead.telefone || "—";
    els.email.textContent = data.lead.email || "—";
    els.dFaixa.textContent = data.lead.faixa_divida || "—";
    els.dTipo.textContent = data.lead.tipo_divida || "—";
    els.dSituacao.textContent = data.lead.situacao_divida || "—";
    els.dLocal.textContent = data.lead.local_producao || "—";
    els.dCultura.textContent = data.lead.cultura || "—";
    els.dPorte.textContent = data.lead.porte || "—";
    els.status.textContent = STATUS_LABEL[data.lead.status] || data.lead.status;
    els.status.className = badgeClass(data.lead.status);
    const prio = data.lead.prioridade || "media";
    els.prioridade.textContent = PRIORITY_LABEL[prio] || prio;
    els.prioridade.className = prioBadgeClass(prio);
    els.statusSelect.value = data.lead.status;
    els.prioSelect.value = prio;
    els.entrada.textContent = formatDate(data.lead.data_entrada);
    els.interacao.textContent = formatDate(data.lead.ultima_interacao);
    if (data.lead.critico || data.lead.atrasado) {
      els.atrasoWrap.hidden = false;
      const d = data.lead.dias_sem_retorno;
      els.atraso.textContent = data.lead.critico
        ? `Crítico · sem retorno há ${d} dia${d === 1 ? "" : "s"}`
        : `Sem retorno há ${d} dia${d === 1 ? "" : "s"}`;
      els.atraso.className = data.lead.critico ? "badge badge--critico" : "badge badge--atrasado";
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
    renderTags(currentTags);
    renderTasks(data.tasks || []);
    renderContracts(data.contracts || [], data.lead.id);
    renderDocs(data.documents || [], data.lead.id);
    renderNotes(data.notes);
    highlightSelected();
    if (openFicha) openFichaDialog(data.lead);
    else if (!keepFicha && els.fichaDialog.open) {
      // mantém ficha se já aberta e só atualizou dados
    }
  }

  els.btnOpenFicha.addEventListener("click", () => {
    if (currentLead) openFichaDialog(currentLead);
  });
  els.btnFichaClose.addEventListener("click", () => {
    if (typeof els.fichaDialog.close === "function") els.fichaDialog.close();
    else els.fichaDialog.removeAttribute("open");
  });

  els.viewKanban.addEventListener("click", () => setView("kanban"));
  els.viewLista.addEventListener("click", () => setView("lista"));

  els.searchQ.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQ = els.searchQ.value.trim();
      loadLeads().catch((e) => alert(e.message));
    }, 250);
  });

  els.filterStatus.addEventListener("change", () => {
    filterStatus = els.filterStatus.value;
    loadLeads().catch((e) => alert(e.message));
  });
  els.filterPriority.addEventListener("change", () => {
    filterPriority = els.filterPriority.value;
    loadLeads().catch((e) => alert(e.message));
  });

  els.statusSelect.addEventListener("change", async () => {
    if (!selectedId) return;
    try {
      await moveLeadToStatus(selectedId, els.statusSelect.value);
    } catch (e) {
      alert(e.message);
    }
  });

  els.prioSelect.addEventListener("change", async () => {
    if (!selectedId) return;
    try {
      await api(`/api/leads/${selectedId}/priority`, {
        method: "POST",
        body: JSON.stringify({ prioridade: els.prioSelect.value }),
      });
      await openLead(selectedId, { keepFicha: true });
      await loadLeads();
    } catch (e) {
      alert(e.message);
    }
  });

  els.btnTask.addEventListener("click", async () => {
    if (!selectedId) return;
    const titulo = els.taskTitle.value.trim();
    if (titulo.length < 2) {
      alert("Escreva a tarefa.");
      return;
    }
    try {
      await api(`/api/leads/${selectedId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ titulo }),
      });
      els.taskTitle.value = "";
      await openLead(selectedId, { keepFicha: true });
      await loadLeads();
    } catch (e) {
      alert(e.message);
    }
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
    onlyCriticos = false;
    loadLeads().catch((e) => alert(e.message));
  });
  els.btnCriticos.addEventListener("click", () => {
    onlyCriticos = true;
    onlyAtrasados = false;
    loadLeads().catch((e) => alert(e.message));
  });
  els.btnTodos.addEventListener("click", () => {
    onlyAtrasados = false;
    onlyCriticos = false;
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
      await loadStats();
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
      await loadStats();
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
    fillStatusFilter();
    initPanelResize();
    setView(viewMode);
    await ensureAuth();
    await loadTagCatalog();
    await Promise.all([loadStats(), loadLeads()]);
  })().catch((e) => {
    console.error(e);
    location.href = "./login.html";
  });
})();
