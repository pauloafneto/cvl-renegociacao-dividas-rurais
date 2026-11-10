export const FOLLOWUP_DAYS = 2;
/** Sem retorno há 7+ dias = crítico (padrão ImprimeMais “deal rotting”). */
export const CRITICAL_DAYS = 7;

export function parseLeadDate(value) {
  if (!value) return null;
  const raw = String(value);
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysSince(value, now = new Date()) {
  const d = parseLeadDate(value);
  if (!d) return 0;
  const ms = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function enrichLead(lead, now = new Date()) {
  const base = lead.ultima_interacao || lead.data_entrada;
  const dias = daysSince(base, now);
  const closed = lead.status === "fechado" || lead.status === "perdido";
  const atrasado = !closed && dias >= FOLLOWUP_DAYS;
  const critico = !closed && dias >= CRITICAL_DAYS;
  return {
    ...lead,
    ultima_interacao: base,
    dias_sem_retorno: dias,
    atrasado,
    critico,
    prioridade: lead.prioridade || "media",
  };
}

export function startFollowupJob(db, { intervalMs = 60 * 60 * 1000 } = {}) {
  const runCheck = () => {
    const overdue = db.listOverdueLeads(FOLLOWUP_DAYS);
    const stamp = new Date().toISOString();
    db.setSetting("followup_last_check", stamp);
    db.setSetting("followup_last_count", String(overdue.length));
    console.log(
      `[follow-up] ${stamp} · ${overdue.length} lead(s) sem retorno há ${FOLLOWUP_DAYS}+ dias`
    );
    return overdue;
  };

  // Roda na subida e depois de hora em hora
  runCheck();
  const timer = setInterval(runCheck, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return { runCheck, timer };
}
