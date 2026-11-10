import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
// Em VPS: pode apontar para pasta persistente (ex.: /var/lib/cvl-crm)
const dataDir = process.env.CVL_DATA_DIR
  ? path.resolve(process.env.CVL_DATA_DIR)
  : path.join(rootDir, "data");
const dbPath = path.join(dataDir, "cvl.sqlite");

export const STATUSES = ["novo", "triagem", "atendimento", "proposta", "fechado", "perdido"];
export const PRIORITIES = ["alta", "media", "baixa"];

export const STATUS_LABELS = {
  novo: "Novo",
  triagem: "Triagem",
  atendimento: "Atendimento",
  proposta: "Proposta",
  fechado: "Fechado",
  perdido: "Perdido",
};

export const PRIORITY_LABELS = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

function rowsFrom(stmt) {
  const cols = stmt.getColumnNames();
  const out = [];
  while (stmt.step()) {
    const values = stmt.get();
    const row = {};
    cols.forEach((col, i) => {
      row[col] = values[i];
    });
    out.push(row);
  }
  stmt.free();
  return out;
}

function oneFrom(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = rowsFrom(stmt);
  return rows[0] || null;
}

function allFrom(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  return rowsFrom(stmt);
}

function run(db, sql, params = []) {
  db.run(sql, params);
}

function persist(db) {
  const data = db.export();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export async function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'novo',
      data_entrada TEXT NOT NULL DEFAULT (datetime('now')),
      observacoes TEXT NOT NULL DEFAULT '',
      CHECK (status IN ('novo','triagem','atendimento','proposta','fechado','perdido'))
    );

    CREATE TABLE IF NOT EXISTS lead_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      texto TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lead_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      nome_original TEXT NOT NULL,
      nome_salvo TEXT NOT NULL UNIQUE,
      tipo TEXT NOT NULL,
      tamanho INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      template_versao TEXT NOT NULL DEFAULT '',
      dados_json TEXT NOT NULL,
      nome_salvo TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lead_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      lead_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#b38b3c',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lead_tags (
      lead_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (lead_id, tag_id),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lead_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      titulo TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      due_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );
  `);

  // Migração: última interação para follow-up
  const leadCols = allFrom(db, "PRAGMA table_info(leads)").map((c) => c.name);
  if (!leadCols.includes("ultima_interacao")) {
    run(db, "ALTER TABLE leads ADD COLUMN ultima_interacao TEXT");
    run(
      db,
      `UPDATE leads
       SET ultima_interacao = COALESCE(NULLIF(data_entrada, ''), datetime('now'))
       WHERE ultima_interacao IS NULL OR ultima_interacao = ''`
    );
  }

  const extraLeadCols = [
    "cpf",
    "endereco",
    "tipo_divida",
    "faixa_divida",
    "situacao_divida",
    "porte",
    "cultura",
    "area_ha",
    "local_producao",
    "prioridade",
  ];
  for (const col of extraLeadCols) {
    if (!leadCols.includes(col)) {
      const def = col === "prioridade" ? "'media'" : "''";
      run(db, `ALTER TABLE leads ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${def}`);
    }
  }

  // Tags padrão do funil advocacia (dívida rural)
  const tagCount = oneFrom(db, "SELECT COUNT(*) AS c FROM tags").c;
  if (tagCount === 0) {
    const seedTags = [
      ["Pronaf", "#2f6b3a"],
      ["Pronamp", "#1f4e79"],
      ["CPR", "#b38b3c"],
      ["Custeio", "#8a5a00"],
      ["Urgente", "#a11b1b"],
      ["WhatsApp", "#0b6b3a"],
      ["Google Ads", "#5b4bb7"],
    ];
    for (const [name, color] of seedTags) {
      run(db, "INSERT INTO tags (name, color) VALUES (?, ?)", [name, color]);
    }
  }

  const consulta = oneFrom(db, "SELECT value FROM settings WHERE key = ?", [
    "consulta_valor",
  ]);
  if (!consulta) {
    run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", [
      "consulta_valor",
      "497",
    ]);
  }

  const userCount = oneFrom(db, "SELECT COUNT(*) AS c FROM users").c;
  if (userCount === 0) {
    // Usuário inicial fixo — trocar depois (ver README).
    const passwordHash = bcrypt.hashSync("admin123", 10);
    run(db, "INSERT INTO users (username, password_hash) VALUES (?, ?)", [
      "admin",
      passwordHash,
    ]);
  }

  const leadCount = oneFrom(db, "SELECT COUNT(*) AS c FROM leads").c;
  if (leadCount === 0) {
    const now = Date.now();
    const seed = [
      ["João Silva", "63999990001", "joao@exemplo.com", "novo", new Date(now).toISOString(), "Lead de teste — Pronaf, soja", new Date(now).toISOString()],
      ["Maria Souza", "63999990002", "", "triagem", new Date(now - 86400000).toISOString(), "Já atrasada em CPR", new Date(now - 3 * 86400000).toISOString()],
      ["Pedro Alves", "63988880003", "pedro@fazenda.com", "atendimento", new Date(now - 2 * 86400000).toISOString(), "", new Date(now - 5 * 86400000).toISOString()],
    ];
    for (const row of seed) {
      run(
        db,
        `INSERT INTO leads (nome, telefone, email, status, data_entrada, observacoes, ultima_interacao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row
      );
    }
    run(db, "INSERT INTO lead_notes (lead_id, texto) VALUES (?, ?)", [
      1,
      "Primeiro contato via página de triagem.",
    ]);
  } else {
    // Garante backfill em bases antigas
    run(
      db,
      `UPDATE leads
       SET ultima_interacao = COALESCE(NULLIF(ultima_interacao, ''), data_entrada, datetime('now'))
       WHERE ultima_interacao IS NULL OR ultima_interacao = ''`
    );
  }

  // Histórico de status: backfill leve se a tabela estiver vazia
  const eventCount = oneFrom(db, "SELECT COUNT(*) AS c FROM lead_status_events").c;
  if (eventCount === 0) {
    const allLeads = allFrom(
      db,
      "SELECT id, status, data_entrada FROM leads ORDER BY id ASC"
    );
    for (const lead of allLeads) {
      run(
        db,
        `INSERT INTO lead_status_events (lead_id, from_status, to_status, created_at)
         VALUES (?, NULL, ?, ?)`,
        [lead.id, lead.status || "novo", lead.data_entrada || new Date().toISOString()]
      );
      const notes = allFrom(
        db,
        `SELECT texto, created_at FROM lead_notes
         WHERE lead_id = ? AND (texto LIKE 'Status avançado:%' OR texto LIKE 'Status alterado:%')
         ORDER BY datetime(created_at) ASC, id ASC`,
        [lead.id]
      );
      for (const note of notes) {
        const m = String(note.texto).match(/Status (?:avançado|alterado):\s*(\w+)\s*→\s*(\w+)/i);
        if (!m) continue;
        run(
          db,
          `INSERT INTO lead_status_events (lead_id, from_status, to_status, created_at)
           VALUES (?, ?, ?, ?)`,
          [lead.id, m[1], m[2], note.created_at]
        );
      }
    }
  }

  persist(db);

  const LEAD_FIELDS =
    "id, nome, telefone, email, status, data_entrada, observacoes, ultima_interacao, cpf, endereco, tipo_divida, faixa_divida, situacao_divida, porte, cultura, area_ha, local_producao, prioridade";

  function parseWhen(value) {
    if (!value) return null;
    const s = String(value);
    const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.max(0, (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  }

  function avg(nums) {
    if (!nums.length) return null;
    return nums.reduce((s, n) => s + n, 0) / nums.length;
  }

  const api = {
    recordStatusEvent(leadId, fromStatus, toStatus, at = new Date().toISOString()) {
      run(
        db,
        `INSERT INTO lead_status_events (lead_id, from_status, to_status, created_at)
         VALUES (?, ?, ?, ?)`,
        [leadId, fromStatus || null, toStatus, at]
      );
      persist(db);
    },
    listStatusEvents(leadId) {
      return allFrom(
        db,
        `SELECT id, lead_id, from_status, to_status, created_at
         FROM lead_status_events
         WHERE lead_id = ? ORDER BY datetime(created_at) ASC, id ASC`,
        [leadId]
      );
    },
    getConversionSummary() {
      const leads = allFrom(db, `SELECT ${LEAD_FIELDS} FROM leads`);
      const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      for (const lead of leads) {
        if (byStatus[lead.status] !== undefined) byStatus[lead.status] += 1;
      }
      const total = leads.length;
      const fechados = byStatus.fechado || 0;
      const perdidos = byStatus.perdido || 0;
      const ativos = total - fechados - perdidos;
      const taxaFechamento = total > 0 ? fechados / total : 0;
      const taxaPerda = total > 0 ? perdidos / total : 0;

      const closedDurations = [];
      for (const lead of leads) {
        if (lead.status !== "fechado") continue;
        const start = parseWhen(lead.data_entrada);
        const end = parseWhen(lead.ultima_interacao) || start;
        const d = daysBetween(start, end);
        if (d !== null) closedDurations.push(d);
      }

      // Tempo médio em cada estágio (entre eventos consecutivos)
      const stageDays = Object.fromEntries(STATUSES.map((s) => [s, []]));
      const leadIds = [...new Set(leads.map((l) => l.id))];
      for (const leadId of leadIds) {
        const events = this.listStatusEvents(leadId);
        for (let i = 0; i < events.length; i += 1) {
          const cur = events[i];
          const next = events[i + 1];
          const start = parseWhen(cur.created_at);
          const end = next ? parseWhen(next.created_at) : new Date();
          const days = daysBetween(start, end);
          if (days === null) continue;
          const stage = cur.to_status;
          if (stageDays[stage]) stageDays[stage].push(days);
        }
      }

      const tempoMedioPorEstagio = {};
      for (const status of STATUSES) {
        const a = avg(stageDays[status]);
        tempoMedioPorEstagio[status] =
          a === null ? null : Math.round(a * 10) / 10;
      }

      const tempoMedioAteFechar = avg(closedDurations);
      return {
        total_entraram: total,
        por_status: byStatus,
        ativos,
        fechados,
        perdidos,
        taxa_fechamento: Math.round(taxaFechamento * 1000) / 10,
        taxa_perda: Math.round(taxaPerda * 1000) / 10,
        tempo_medio_ate_fechar_dias:
          tempoMedioAteFechar === null
            ? null
            : Math.round(tempoMedioAteFechar * 10) / 10,
        tempo_medio_por_estagio_dias: tempoMedioPorEstagio,
      };
    },
    getUserByUsername(username) {
      return oneFrom(db, "SELECT * FROM users WHERE username = ?", [username]);
    },
    getUserById(id) {
      return oneFrom(db, "SELECT id, username FROM users WHERE id = ?", [id]);
    },
    touchLead(id, at = new Date().toISOString()) {
      run(db, "UPDATE leads SET ultima_interacao = ? WHERE id = ?", [at, id]);
      persist(db);
    },
    listLeads(status, { q = "" } = {}) {
      let leads;
      if (status && STATUSES.includes(status)) {
        leads = allFrom(
          db,
          `SELECT ${LEAD_FIELDS}
           FROM leads WHERE status = ? ORDER BY datetime(COALESCE(ultima_interacao, data_entrada)) ASC`,
          [status]
        );
      } else {
        leads = allFrom(
          db,
          `SELECT ${LEAD_FIELDS}
           FROM leads ORDER BY datetime(COALESCE(ultima_interacao, data_entrada)) ASC`
        );
      }
      const query = String(q || "").trim().toLowerCase();
      if (!query) return leads;
      const digits = query.replace(/\D/g, "");
      return leads.filter((lead) => {
        const hay = [
          lead.nome,
          lead.email,
          lead.telefone,
          lead.tipo_divida,
          lead.faixa_divida,
          lead.situacao_divida,
          lead.local_producao,
          lead.cultura,
          lead.porte,
          lead.observacoes,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (hay.includes(query)) return true;
        if (digits.length >= 4) {
          const phone = String(lead.telefone || "").replace(/\D/g, "");
          if (phone.includes(digits)) return true;
        }
        return false;
      });
    },
    listOverdueLeads(days = 2) {
      // Exclui fechado/perdido; compara em JS para ISO e datetime SQLite
      return this.listLeads().filter((lead) => {
        if (lead.status === "fechado" || lead.status === "perdido") return false;
        const base = lead.ultima_interacao || lead.data_entrada;
        const d = new Date(String(base).includes("T") ? base : String(base).replace(" ", "T") + "Z");
        if (Number.isNaN(d.getTime())) return false;
        const dias = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
        return dias >= days;
      });
    },
    getLead(id) {
      return oneFrom(
        db,
        `SELECT ${LEAD_FIELDS}
         FROM leads WHERE id = ?`,
        [id]
      );
    },
    setLeadPriority(id, prioridade) {
      if (!PRIORITIES.includes(prioridade)) return this.getLead(id);
      run(db, "UPDATE leads SET prioridade = ?, ultima_interacao = ? WHERE id = ?", [
        prioridade,
        new Date().toISOString(),
        id,
      ]);
      persist(db);
      return this.getLead(id);
    },
    listTags() {
      return allFrom(
        db,
        `SELECT id, name, color, created_at FROM tags ORDER BY name COLLATE NOCASE ASC`
      );
    },
    createTag(name, color = "#b38b3c") {
      const cleaned = String(name || "").trim();
      if (cleaned.length < 2) return null;
      const existing = oneFrom(db, "SELECT id, name, color, created_at FROM tags WHERE lower(name) = lower(?)", [
        cleaned,
      ]);
      if (existing) return existing;
      run(db, "INSERT INTO tags (name, color) VALUES (?, ?)", [cleaned, color || "#b38b3c"]);
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      persist(db);
      return oneFrom(db, "SELECT id, name, color, created_at FROM tags WHERE id = ?", [row.id]);
    },
    listLeadTags(leadId) {
      return allFrom(
        db,
        `SELECT t.id, t.name, t.color
         FROM tags t
         INNER JOIN lead_tags lt ON lt.tag_id = t.id
         WHERE lt.lead_id = ?
         ORDER BY t.name COLLATE NOCASE ASC`,
        [leadId]
      );
    },
    setLeadTags(leadId, tagIds) {
      const ids = [...new Set((tagIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
      run(db, "DELETE FROM lead_tags WHERE lead_id = ?", [leadId]);
      for (const tagId of ids) {
        const tag = oneFrom(db, "SELECT id FROM tags WHERE id = ?", [tagId]);
        if (!tag) continue;
        run(db, "INSERT INTO lead_tags (lead_id, tag_id) VALUES (?, ?)", [leadId, tagId]);
      }
      this.touchLead(leadId);
      return this.listLeadTags(leadId);
    },
    tagsByLeadIds(leadIds) {
      const map = Object.fromEntries((leadIds || []).map((id) => [id, []]));
      if (!leadIds?.length) return map;
      const placeholders = leadIds.map(() => "?").join(",");
      const rows = allFrom(
        db,
        `SELECT lt.lead_id, t.id, t.name, t.color
         FROM lead_tags lt
         INNER JOIN tags t ON t.id = lt.tag_id
         WHERE lt.lead_id IN (${placeholders})
         ORDER BY t.name COLLATE NOCASE ASC`,
        leadIds
      );
      for (const row of rows) {
        if (!map[row.lead_id]) map[row.lead_id] = [];
        map[row.lead_id].push({ id: row.id, name: row.name, color: row.color });
      }
      return map;
    },
    listTasks(leadId) {
      return allFrom(
        db,
        `SELECT id, lead_id, titulo, done, due_at, created_at, completed_at
         FROM lead_tasks
         WHERE lead_id = ?
         ORDER BY done ASC, datetime(COALESCE(due_at, created_at)) ASC, id ASC`,
        [leadId]
      );
    },
    addTask(leadId, titulo, dueAt = null) {
      const text = String(titulo || "").trim();
      if (text.length < 2) return null;
      run(
        db,
        `INSERT INTO lead_tasks (lead_id, titulo, due_at) VALUES (?, ?, ?)`,
        [leadId, text, dueAt || null]
      );
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      this.touchLead(leadId);
      return oneFrom(
        db,
        `SELECT id, lead_id, titulo, done, due_at, created_at, completed_at
         FROM lead_tasks WHERE id = ?`,
        [row.id]
      );
    },
    setTaskDone(taskId, done) {
      const task = oneFrom(
        db,
        `SELECT id, lead_id, titulo, done, due_at, created_at, completed_at
         FROM lead_tasks WHERE id = ?`,
        [taskId]
      );
      if (!task) return null;
      const isDone = done ? 1 : 0;
      const completedAt = isDone ? new Date().toISOString() : null;
      run(db, "UPDATE lead_tasks SET done = ?, completed_at = ? WHERE id = ?", [
        isDone,
        completedAt,
        taskId,
      ]);
      this.touchLead(task.lead_id);
      return oneFrom(
        db,
        `SELECT id, lead_id, titulo, done, due_at, created_at, completed_at
         FROM lead_tasks WHERE id = ?`,
        [taskId]
      );
    },
    deleteTask(taskId) {
      const task = oneFrom(db, "SELECT id, lead_id FROM lead_tasks WHERE id = ?", [taskId]);
      if (!task) return false;
      run(db, "DELETE FROM lead_tasks WHERE id = ?", [taskId]);
      persist(db);
      return true;
    },
    countOpenTasks(leadId) {
      const row = oneFrom(
        db,
        "SELECT COUNT(*) AS c FROM lead_tasks WHERE lead_id = ? AND done = 0",
        [leadId]
      );
      return row?.c || 0;
    },
    listNotes(leadId) {
      return allFrom(
        db,
        `SELECT id, texto, created_at FROM lead_notes
         WHERE lead_id = ? ORDER BY datetime(created_at) DESC, id DESC`,
        [leadId]
      );
    },
    setLeadStatus(id, status) {
      const current = this.getLead(id);
      const from = current?.status || null;
      const now = new Date().toISOString();
      run(db, "UPDATE leads SET status = ?, ultima_interacao = ? WHERE id = ?", [
        status,
        now,
        id,
      ]);
      if (from !== status) {
        run(
          db,
          `INSERT INTO lead_status_events (lead_id, from_status, to_status, created_at)
           VALUES (?, ?, ?, ?)`,
          [id, from, status, now]
        );
      }
      persist(db);
      return this.getLead(id);
    },
    addNote(leadId, texto) {
      run(db, "INSERT INTO lead_notes (lead_id, texto) VALUES (?, ?)", [leadId, texto]);
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      this.touchLead(leadId);
      return oneFrom(
        db,
        "SELECT id, texto, created_at FROM lead_notes WHERE id = ?",
        [row.id]
      );
    },
    findLeadByTelefone(telefone) {
      const digits = String(telefone || "").replace(/\D/g, "");
      if (!digits) return null;
      return oneFrom(
        db,
        `SELECT ${LEAD_FIELDS}
         FROM leads
         WHERE replace(replace(replace(replace(telefone,' ',''),'-',''),'(',''),')','') LIKE ?
         ORDER BY id DESC LIMIT 1`,
        [`%${digits.slice(-8)}`]
      );
    },
    createLead({ nome, telefone, email = "", status = "triagem", observacoes = "" }) {
      const now = new Date().toISOString();
      run(
        db,
        `INSERT INTO leads (nome, telefone, email, status, data_entrada, observacoes, ultima_interacao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nome, telefone, email, status, now, observacoes, now]
      );
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      run(
        db,
        `INSERT INTO lead_status_events (lead_id, from_status, to_status, created_at)
         VALUES (?, NULL, ?, ?)`,
        [row.id, status, now]
      );
      persist(db);
      return this.getLead(row.id);
    },
    addDocument({ leadId, nomeOriginal, nomeSalvo, tipo, tamanho }) {
      run(
        db,
        `INSERT INTO lead_documents (lead_id, nome_original, nome_salvo, tipo, tamanho)
         VALUES (?, ?, ?, ?, ?)`,
        [leadId, nomeOriginal, nomeSalvo, tipo, tamanho]
      );
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      this.touchLead(leadId);
      return oneFrom(
        db,
        `SELECT id, lead_id, nome_original, nome_salvo, tipo, tamanho, data
         FROM lead_documents WHERE id = ?`,
        [row.id]
      );
    },
    listDocuments(leadId) {
      return allFrom(
        db,
        `SELECT id, lead_id, nome_original, nome_salvo, tipo, tamanho, data
         FROM lead_documents
         WHERE lead_id = ? ORDER BY datetime(data) DESC, id DESC`,
        [leadId]
      );
    },
    getDocument(id) {
      return oneFrom(
        db,
        `SELECT id, lead_id, nome_original, nome_salvo, tipo, tamanho, data
         FROM lead_documents WHERE id = ?`,
        [id]
      );
    },
    getSetting(key) {
      const row = oneFrom(db, "SELECT key, value, updated_at FROM settings WHERE key = ?", [key]);
      return row || null;
    },
    setSetting(key, value) {
      const existing = this.getSetting(key);
      if (existing) {
        run(
          db,
          "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
          [String(value), key]
        );
      } else {
        run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
      }
      persist(db);
      return this.getSetting(key);
    },
    getConsultaValor() {
      const row = this.getSetting("consulta_valor");
      const n = Number(row?.value);
      return Number.isFinite(n) && n >= 0 ? n : 497;
    },
    updateLeadProfile(id, fields) {
      const allowed = [
        "nome",
        "telefone",
        "email",
        "cpf",
        "endereco",
        "tipo_divida",
        "faixa_divida",
        "situacao_divida",
        "porte",
        "cultura",
        "area_ha",
        "local_producao",
        "prioridade",
      ];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (fields[key] === undefined) continue;
        let value = String(fields[key] ?? "");
        if (key === "prioridade") {
          if (!PRIORITIES.includes(value)) value = "media";
        }
        sets.push(`${key} = ?`);
        params.push(value);
      }
      if (!sets.length) return this.getLead(id);
      sets.push("ultima_interacao = ?");
      params.push(new Date().toISOString());
      params.push(id);
      run(db, `UPDATE leads SET ${sets.join(", ")} WHERE id = ?`, params);
      persist(db);
      return this.getLead(id);
    },
    addContract({ leadId, templateId, templateVersao, dadosJson, nomeSalvo }) {
      run(
        db,
        `INSERT INTO contracts (lead_id, template_id, template_versao, dados_json, nome_salvo)
         VALUES (?, ?, ?, ?, ?)`,
        [leadId, templateId, templateVersao, dadosJson, nomeSalvo]
      );
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      this.touchLead(leadId);
      return this.getContract(row.id);
    },
    listContracts(leadId) {
      return allFrom(
        db,
        `SELECT id, lead_id, template_id, template_versao, nome_salvo, created_at
         FROM contracts WHERE lead_id = ? ORDER BY datetime(created_at) DESC, id DESC`,
        [leadId]
      );
    },
    getContract(id) {
      return oneFrom(
        db,
        `SELECT id, lead_id, template_id, template_versao, dados_json, nome_salvo, created_at
         FROM contracts WHERE id = ?`,
        [id]
      );
    },
    addChatMessage({ sessionId, leadId = null, role, content }) {
      run(
        db,
        `INSERT INTO chat_messages (session_id, lead_id, role, content)
         VALUES (?, ?, ?, ?)`,
        [sessionId, leadId || null, role, content]
      );
      const row = oneFrom(db, "SELECT last_insert_rowid() AS id");
      if (leadId) this.touchLead(leadId);
      else persist(db);
      return oneFrom(
        db,
        `SELECT id, session_id, lead_id, role, content, created_at
         FROM chat_messages WHERE id = ?`,
        [row.id]
      );
    },
    listChatBySession(sessionId, limit = 40) {
      return allFrom(
        db,
        `SELECT id, session_id, lead_id, role, content, created_at
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY datetime(created_at) ASC, id ASC
         LIMIT ?`,
        [sessionId, limit]
      );
    },
    listChatByLead(leadId, limit = 80) {
      return allFrom(
        db,
        `SELECT id, session_id, lead_id, role, content, created_at
         FROM chat_messages
         WHERE lead_id = ?
         ORDER BY datetime(created_at) ASC, id ASC
         LIMIT ?`,
        [leadId, limit]
      );
    },
    bindChatSessionToLead(sessionId, leadId) {
      run(db, "UPDATE chat_messages SET lead_id = ? WHERE session_id = ? AND lead_id IS NULL", [
        leadId,
        sessionId,
      ]);
      persist(db);
    },
  };

  return api;
}

export { dbPath, dataDir, rootDir };
