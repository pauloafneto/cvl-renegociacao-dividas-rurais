import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { ensureDb, STATUSES, rootDir } from "./db.js";
import { uploadMiddleware, UPLOAD_DIR, MAX_FILE_BYTES, formatBytes } from "./uploads.js";
import { enrichLead, startFollowupJob, FOLLOWUP_DAYS } from "./followup.js";
import {
  loadContratoTemplate,
  buildContractVars,
  renderContractDocument,
} from "./contractTemplate.js";
import { saveContractPdf, CONTRACTS_DIR } from "./contractPdf.js";
import { buildPrevia } from "./previaDiagnostico.js";
import { getAiConfig, suggestLeadReply, chatWithLead } from "./aiAssist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const SESSION_SECRET = process.env.CVL_SESSION_SECRET || "cvl-dev-secret-trocar-depois";

function nextStatus(current) {
  const flow = ["novo", "triagem", "atendimento", "proposta", "fechado"];
  const idx = flow.indexOf(current);
  if (idx < 0 || idx >= flow.length - 1) return null;
  return flow[idx + 1];
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function main() {
  const db = await ensureDb();
  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  // Atrás de nginx / proxy da Hostinger VPS
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "1mb" }));
  app.use(
    session({
      name: "cvl.sid",
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 12,
      },
    })
  );

  // Bloqueia acesso público à pasta de dados/uploads
  app.use((req, res, next) => {
    if (req.path === "/data" || req.path.startsWith("/data/")) {
      return res.status(404).json({ error: "Não encontrado." });
    }
    next();
  });

  function requireAuth(req, res, next) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Não autenticado." });
    }
    next();
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "cvl-crm" });
  });

  function formatBrl(value) {
    return Number(value).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  app.get("/api/public/settings", (_req, res) => {
    const consultaValor = db.getConsultaValor();
    res.json({
      consulta_valor: consultaValor,
      consulta_valor_formatado: formatBrl(consultaValor),
      consulta_abatimento:
        "Se fechar contrato com o escritório, o valor da consulta é abatido — não fica como cobrança extra.",
    });
  });

  app.get("/api/public/previa", (req, res) => {
    try {
      const previa = buildPrevia({
        tipo: String(req.query.tipo || ""),
        faixa: String(req.query.faixa || ""),
        atraso: String(req.query.atraso || ""),
        consultaValor: db.getConsultaValor(),
      });
      res.json(previa);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Não foi possível montar a prévia." });
    }
  });

  app.get("/api/settings", requireAuth, (_req, res) => {
    const consultaValor = db.getConsultaValor();
    res.json({
      consulta_valor: consultaValor,
      consulta_valor_formatado: formatBrl(consultaValor),
    });
  });

  app.put("/api/settings/consulta-valor", requireAuth, (req, res) => {
    const raw = req.body?.consulta_valor;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 1000000) {
      return res.status(400).json({ error: "Informe um valor válido em reais." });
    }
    // Guarda com até 2 casas
    const value = Math.round(n * 100) / 100;
    db.setSetting("consulta_valor", String(value));
    res.json({
      ok: true,
      consulta_valor: value,
      consulta_valor_formatado: formatBrl(value),
    });
  });

  app.get("/api/settings/ai", requireAuth, (_req, res) => {
    const cfg = getAiConfig(db);
    res.json({
      ...cfg,
      // Campo da chave fica sempre vazio no formulário — nunca ecoar segredo
      api_key: "",
      api_key_salva: cfg.hasKey,
    });
  });

  app.put("/api/settings/ai", requireAuth, (req, res) => {
    const provider = String(req.body?.provider || "openai").trim() || "openai";
    const model = String(req.body?.model || "").trim();
    const baseUrl = String(req.body?.base_url || "").trim();
    const apiKey = String(req.body?.api_key ?? "");
    const clearKey = req.body?.clear_key === true;

    db.setSetting("ai_provider", provider);
    if (model) db.setSetting("ai_model", model);
    if (baseUrl) db.setSetting("ai_base_url", baseUrl);

    // Só grava chave se o usuário colou algo novo; vazio = não sobrescreve
    if (clearKey) {
      db.setSetting("ai_api_key", "");
    } else if (apiKey.trim()) {
      db.setSetting("ai_api_key", apiKey.trim());
    }

    const cfg = getAiConfig(db);
    res.json({
      ok: true,
      ...cfg,
      api_key: "",
      api_key_salva: cfg.hasKey,
    });
  });

  app.get("/api/stats/conversao", requireAuth, (_req, res) => {
    res.json(db.getConversionSummary());
  });

  app.get("/api/public/ai/status", (_req, res) => {
    const cfg = getAiConfig(db);
    res.json({ configured: cfg.configured, provider: cfg.provider });
  });

  app.post("/api/public/ai/chat", async (req, res) => {
    try {
      let sessionId = String(req.body?.session_id || "").trim();
      if (!sessionId || sessionId.length > 80) {
        sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      }
      const message = String(req.body?.message || "").trim();
      if (message.length < 1) {
        return res.status(400).json({ error: "Digite uma mensagem." });
      }
      if (message.length > 2000) {
        return res.status(400).json({ error: "Mensagem muito longa." });
      }

      const telefone = normalizePhone(req.body?.telefone);
      let lead = null;
      if (req.body?.lead_id) {
        lead = db.getLead(Number(req.body.lead_id));
      } else if (telefone.length >= 10) {
        lead = db.findLeadByTelefone(telefone);
      }

      db.addChatMessage({
        sessionId,
        leadId: lead?.id || null,
        role: "user",
        content: message,
      });

      const history = db.listChatBySession(sessionId).map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "user",
        content: m.content,
      }));
      // histórico já inclui a msg atual; chatWithLead adiciona de novo — passar sem a última user
      const historyForModel = history.slice(0, -1);

      const result = await chatWithLead({
        db,
        lead,
        history: historyForModel,
        message,
      });

      db.addChatMessage({
        sessionId,
        leadId: lead?.id || null,
        role: "assistant",
        content: result.texto,
      });

      if (lead?.id) {
        db.bindChatSessionToLead(sessionId, lead.id);
      }

      res.json({
        ok: true,
        session_id: sessionId,
        reply: result.texto,
        fonte: result.fonte,
        modelo: result.modelo,
        aviso: result.aviso || null,
        lead_id: lead?.id || null,
        configured: getAiConfig(db).configured,
      });
    } catch (e) {
      console.error(e);
      res.status(502).json({ error: e.message || "Falha na conversa com a IA." });
    }
  });

  app.post("/api/leads/:id/ai-reply", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: "Lead não encontrado." });
    const mensagemLead = String(req.body?.mensagem || "").slice(0, 2000);
    const saveNote = req.body?.salvar_nota === true;
    try {
      const notes = db.listNotes(id);
      const result = await suggestLeadReply({
        db,
        lead,
        mensagemLead,
        notes,
      });
      let note = null;
      if (saveNote && result.texto) {
        note = db.addNote(id, `[IA] ${result.texto}`);
      }
      res.json({
        ok: true,
        reply: result.texto,
        fonte: result.fonte,
        modelo: result.modelo,
        provider: result.provider,
        aviso: result.aviso || null,
        note,
      });
    } catch (e) {
      console.error(e);
      res.status(502).json({
        error: e.message || "Não foi possível gerar a resposta da IA.",
      });
    }
  });

  app.get("/api/me", (req, res) => {
    if (!req.session?.userId) return res.json({ authenticated: false });
    const user = db.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user });
  });

  app.post("/api/login", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Informe usuário e senha." });
    }
    const user = db.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("cvl.sid");
      res.json({ ok: true });
    });
  });

  app.get("/api/leads", requireAuth, (req, res) => {
    const status = String(req.query.status || "").trim();
    const onlyAtrasados =
      req.query.atrasados === "1" ||
      req.query.atrasados === "true" ||
      req.query.filtro === "atrasados";
    let leads = db.listLeads(status).map((l) => enrichLead(l));
    if (onlyAtrasados) leads = leads.filter((l) => l.atrasado);
    res.json({
      leads,
      statuses: STATUSES,
      followup_days: FOLLOWUP_DAYS,
      atrasados_count: db.listOverdueLeads(FOLLOWUP_DAYS).length,
    });
  });

  app.get("/api/followups", requireAuth, (_req, res) => {
    const leads = db.listOverdueLeads(FOLLOWUP_DAYS).map((l) => enrichLead(l));
    res.json({
      followup_days: FOLLOWUP_DAYS,
      count: leads.length,
      leads,
      last_check: db.getSetting("followup_last_check")?.value || null,
    });
  });

  app.get("/api/leads/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const raw = db.getLead(id);
    if (!raw) return res.status(404).json({ error: "Lead não encontrado." });
    const lead = enrichLead(raw);
    const notes = db.listNotes(id);
    const documents = db.listDocuments(id).map((doc) => ({
      id: doc.id,
      nome_original: doc.nome_original,
      tipo: doc.tipo,
      tamanho: doc.tamanho,
      tamanho_legivel: formatBytes(doc.tamanho),
      data: doc.data,
    }));
    const contracts = db.listContracts(id);
    const chat = db.listChatByLead(id);
    res.json({
      lead,
      notes,
      documents,
      contracts,
      chat,
      next: nextStatus(lead.status),
      consulta_valor: db.getConsultaValor(),
    });
  });

  app.post("/api/leads/:id/advance", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: "Lead não encontrado." });
    const nxt = nextStatus(lead.status);
    if (!nxt) {
      return res.status(400).json({ error: "Este lead já está no estágio final do funil." });
    }
    const updated = db.setLeadStatus(id, nxt);
    db.addNote(id, `Status avançado: ${lead.status} → ${nxt}`);
    res.json({ lead: updated, next: nextStatus(updated.status) });
  });

  app.post("/api/leads/:id/status", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "").trim();
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status inválido." });
    }
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: "Lead não encontrado." });
    if (lead.status === status) {
      return res.json({ lead, next: nextStatus(lead.status) });
    }
    const updated = db.setLeadStatus(id, status);
    db.addNote(id, `Status alterado: ${lead.status} → ${status}`);
    res.json({ lead: updated, next: nextStatus(updated.status) });
  });

  app.post("/api/leads/:id/notes", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const texto = String(req.body?.texto || "").trim();
    if (texto.length < 2) {
      return res.status(400).json({ error: "Anotação muito curta." });
    }
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: "Lead não encontrado." });
    const note = db.addNote(id, texto);
    res.status(201).json({ note });
  });

  app.get("/api/leads/:id/documents/:docId/download", requireAuth, (req, res) => {
    const leadId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const doc = db.getDocument(docId);
    if (!doc || doc.lead_id !== leadId) {
      return res.status(404).json({ error: "Documento não encontrado." });
    }
    const filePath = path.join(UPLOAD_DIR, doc.nome_salvo);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Arquivo não encontrado no disco." });
    }
    res.download(filePath, doc.nome_original);
  });

  app.post("/api/leads/:id/contract", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const lead = db.getLead(id);
    if (!lead) return res.status(404).json({ error: "Lead não encontrado." });

    const body = req.body || {};
    const profile = {
      cpf: body.cpf,
      endereco: body.endereco,
      tipo_divida: body.tipo_divida,
      faixa_divida: body.faixa_divida,
      situacao_divida: body.situacao_divida,
      porte: body.porte,
      cultura: body.cultura,
      area_ha: body.area_ha,
      local_producao: body.local_producao,
      email: body.email,
      nome: body.nome,
      telefone: body.telefone,
    };
    const cleaned = Object.fromEntries(
      Object.entries(profile).filter(([, v]) => v !== undefined)
    );
    const updatedLead = Object.keys(cleaned).length
      ? db.updateLeadProfile(id, cleaned)
      : lead;

    if (!String(updatedLead.cpf || "").replace(/\D/g, "").length) {
      return res.status(400).json({ error: "Informe o CPF do cliente para gerar o contrato." });
    }

    try {
      const template = loadContratoTemplate("contrato-consulta");
      const vars = buildContractVars({
        lead: updatedLead,
        consultaValor: db.getConsultaValor(),
        prazoDias: Number(body.prazo_dias) > 0 ? Number(body.prazo_dias) : 10,
      });
      const document = renderContractDocument(template, vars);
      const saved = await saveContractPdf(document, id);
      const contract = db.addContract({
        leadId: id,
        templateId: template.id,
        templateVersao: template.versao || "",
        dadosJson: JSON.stringify(vars),
        nomeSalvo: saved.nomeSalvo,
      });
      db.addNote(id, `Contrato gerado (PDF): ${saved.nomeSalvo}`);
      res.status(201).json({
        ok: true,
        contract,
        download_url: `/api/leads/${id}/contracts/${contract.id}/download`,
        lead: enrichLead(updatedLead),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || "Falha ao gerar contrato." });
    }
  });

  app.get("/api/leads/:id/contracts/:contractId/download", requireAuth, (req, res) => {
    const leadId = Number(req.params.id);
    const contractId = Number(req.params.contractId);
    const contract = db.getContract(contractId);
    if (!contract || contract.lead_id !== leadId) {
      return res.status(404).json({ error: "Contrato não encontrado." });
    }
    const filePath = path.join(CONTRACTS_DIR, contract.nome_salvo);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Arquivo PDF não encontrado." });
    }
    const downloadName = `contrato-consulta-lead-${leadId}.pdf`;
    res.download(filePath, downloadName);
  });

  // Lead da triagem pública (formulário / chat) → grava no CRM e o site ainda abre WhatsApp
  app.post("/api/public/leads", (req, res) => {
    try {
      const nome = String(req.body?.nome || "").trim();
      const telefone = normalizePhone(req.body?.telefone);
      const source = String(req.body?.source || "form").trim() || "form";
      const produtor = String(req.body?.produtor || "").trim();
      const faixa = String(req.body?.faixa || "").trim();
      const tipo = String(req.body?.tipo || "").trim();
      const atraso = String(req.body?.atraso || "").trim();
      const porte = String(req.body?.porte || "").trim();
      const cultura = String(req.body?.cultura || "").trim();
      const area = String(req.body?.area || "").trim();
      const local = String(req.body?.local || "").trim();

      if (nome.length < 2) {
        return res.status(400).json({ error: "Informe seu nome." });
      }
      if (telefone.length < 10) {
        return res.status(400).json({ error: "WhatsApp com DDD inválido." });
      }
      if (produtor === "nao") {
        return res.status(400).json({ error: "Canal focado em dívida rural." });
      }

      const obsLines = [
        `Origem: triagem do site (${source === "chat" ? "chat" : "formulário"}).`,
        produtor ? `Perfil: ${produtor}` : "",
        faixa ? `Faixa: ${faixa}` : "",
        tipo ? `Tipo: ${tipo}` : "",
        atraso ? `Situação: ${atraso}` : "",
      ].filter(Boolean);

      let lead = db.findLeadByTelefone(telefone);
      let created = false;
      if (!lead) {
        lead = db.createLead({
          nome,
          telefone,
          email: "",
          status: "novo",
          observacoes: obsLines.join(" "),
        });
        created = true;
      } else {
        // Atualiza ficha se já existia (mesmo WhatsApp)
        lead = db.updateLeadProfile(lead.id, {
          nome,
          telefone,
        });
        if (lead.status === "perdido") {
          // não reabre automaticamente
        } else if (lead.status === "fechado") {
          // mantém fechado
        } else if (!lead.observacoes || !String(lead.observacoes).includes("triagem do site")) {
          db.addNote(lead.id, `Nova triagem pelo site (${source}).`);
        }
      }

      lead = db.updateLeadProfile(lead.id, {
        tipo_divida: tipo,
        faixa_divida: faixa,
        situacao_divida: atraso,
        porte,
        cultura,
        area_ha: area,
        local_producao: local,
      });

      if (created) {
        db.addNote(
          lead.id,
          `Lead entrou pela triagem do site (${source}). WhatsApp aberto com o resumo.`
        );
      }

      res.status(created ? 201 : 200).json({
        ok: true,
        created,
        lead: { id: lead.id, nome: lead.nome, status: lead.status },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Não foi possível gravar o lead." });
    }
  });

  // Upload público — após interesse real (nome + WhatsApp + arquivos)
  app.post("/api/public/documents", (req, res) => {
    uploadMiddleware(req, res, (err) => {
      if (err) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? `Arquivo acima de ${formatBytes(MAX_FILE_BYTES)}.`
            : err.message || "Falha no upload.";
        return res.status(400).json({ error: msg });
      }

      try {
        const nome = String(req.body?.nome || "").trim();
        const telefone = normalizePhone(req.body?.telefone);
        const email = String(req.body?.email || "").trim();
        const files = req.files || [];

        if (nome.length < 2) {
          return res.status(400).json({ error: "Informe seu nome." });
        }
        if (telefone.length < 10) {
          return res.status(400).json({ error: "WhatsApp com DDD inválido." });
        }
        if (!files.length) {
          return res.status(400).json({ error: "Envie ao menos um documento." });
        }

        let lead = db.findLeadByTelefone(telefone);
        if (!lead) {
          lead = db.createLead({
            nome,
            telefone,
            email,
            status: "triagem",
            observacoes: "Lead criou envio de documentos pelo site.",
          });
        } else if (lead.status === "novo") {
          lead = db.setLeadStatus(lead.id, "triagem");
        }

        const saved = [];
        for (const file of files) {
          const doc = db.addDocument({
            leadId: lead.id,
            nomeOriginal: file.originalname,
            nomeSalvo: file.filename,
            tipo: file.mimetype,
            tamanho: file.size,
          });
          saved.push({
            id: doc.id,
            nome_original: doc.nome_original,
            tamanho_legivel: formatBytes(doc.tamanho),
          });
        }

        db.addNote(
          lead.id,
          `Documentos enviados pelo site (${saved.length}): ${saved
            .map((d) => d.nome_original)
            .join(", ")}`
        );

        res.status(201).json({
          ok: true,
          lead: { id: lead.id, nome: lead.nome, status: lead.status },
          documents: saved,
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao gravar documentos." });
      }
    });
  });

  app.use("/admin", express.static(path.join(rootDir, "admin")));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(rootDir, "index.html"));
  });

  const publicFiles = [
    "index.html",
    "styles.css",
    "app.js",
    "enviar-documentos.html",
    "netlify.toml",
    "README.md",
  ];
  for (const file of publicFiles) {
    app.get(`/${file}`, (_req, res) => {
      res.sendFile(path.join(rootDir, file));
    });
  }
  app.use("/brand", express.static(path.join(rootDir, "brand")));
  app.use("/images", express.static(path.join(rootDir, "images")));
  // Templates editáveis (contrato e prévia) — só JSON públicos
  app.use(
    "/templates",
    express.static(path.join(rootDir, "templates"), {
      index: false,
      extensions: ["json", "md"],
      setHeaders(res) {
        res.setHeader("Cache-Control", "no-store");
      },
    })
  );

  // Impede listagem / leitura direta de pastas privadas
  app.use("/node_modules", (_req, res) => res.status(404).end());
  app.use("/server", (_req, res) => res.status(404).end());
  app.use("/data", (_req, res) => res.status(404).end());
  app.use("/uploads", (_req, res) => res.status(404).end());
  app.use("/contracts", (_req, res) => res.status(404).end());

  app.get("/admin", (_req, res) => {
    res.redirect("/admin/index.html");
  });

  startFollowupJob(db, { intervalMs: 60 * 60 * 1000 });

  // 0.0.0.0: acessível no VPS; nginx faz o proxy HTTPS
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CVL CRM em http://0.0.0.0:${PORT}`);
    console.log(`Painel: http://localhost:${PORT}/admin/`);
    console.log(`Documentos: http://localhost:${PORT}/enviar-documentos.html`);
    console.log(`Follow-up: alerta a cada hora se lead ≥ ${FOLLOWUP_DAYS} dias sem retorno`);
    console.log(`Login inicial: admin / admin123 (trocar depois)`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
