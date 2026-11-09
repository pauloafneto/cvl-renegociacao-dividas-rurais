/**
 * Ponto de integração da IA do CRM CVL.
 *
 * Troque o provedor aqui (OpenAI, outro modelo, API própria).
 * A chave NUNCA vai no código — vem de:
 *   1) setting `ai_api_key` (painel Configurações), ou
 *   2) variável de ambiente CVL_AI_API_KEY / OPENAI_API_KEY
 *
 * Interface estável para quem for continuar o projeto:
 *   getAiConfig(db) → { configured, provider, model, baseUrl, hasKey }
 *   suggestLeadReply({ db, lead, mensagemLead, notes }) → { texto, fonte, modelo }
 */

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
// Mesma família do ImprimeMais (teste); o amigo troca depois na Configuração / env
const FORGE_DEFAULT_MODEL = "gemini-flash-lite-latest";

function readKey(db) {
  const fromDb = String(db.getSetting("ai_api_key")?.value || "").trim();
  if (fromDb) return fromDb;
  // Teste ImprimeMais: reaproveita a forge (sem hardcode no código)
  return String(
    process.env.CVL_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.BUILT_IN_FORGE_API_KEY ||
      ""
  ).trim();
}

function readProvider(db) {
  return String(db.getSetting("ai_provider")?.value || "openai").trim() || "openai";
}

function usingForgeEnv() {
  return Boolean(String(process.env.BUILT_IN_FORGE_API_KEY || "").trim());
}

function readModel(db) {
  const fromDb = String(db.getSetting("ai_model")?.value || "").trim();
  if (fromDb) return fromDb;
  if (process.env.CVL_AI_MODEL) return process.env.CVL_AI_MODEL;
  if (usingForgeEnv()) return FORGE_DEFAULT_MODEL;
  return DEFAULT_MODEL;
}

function readBaseUrl(db) {
  const fromDb = String(db.getSetting("ai_base_url")?.value || "").trim();
  if (fromDb) return fromDb;
  if (process.env.CVL_AI_BASE_URL) return process.env.CVL_AI_BASE_URL;
  // Forge do ImprimeMais já vem com base OpenAI-compatível
  if (process.env.BUILT_IN_FORGE_API_URL) {
    return String(process.env.BUILT_IN_FORGE_API_URL).replace(/\/$/, "");
  }
  return DEFAULT_BASE;
}

export function getAiConfig(db) {
  const key = readKey(db);
  return {
    configured: Boolean(key),
    hasKey: Boolean(key),
    provider: readProvider(db),
    model: readModel(db),
    baseUrl: readBaseUrl(db),
    // Nunca devolver a chave
  };
}

function leadContextBlock(lead) {
  return [
    `Nome: ${lead.nome || "—"}`,
    `Telefone: ${lead.telefone || "—"}`,
    `Status no funil: ${lead.status || "—"}`,
    `Tipo da dívida: ${lead.tipo_divida || "—"}`,
    `Faixa: ${lead.faixa_divida || "—"}`,
    `Situação: ${lead.situacao_divida || "—"}`,
    `Porte: ${lead.porte || "—"}`,
    `Cultura: ${lead.cultura || "—"}`,
    `Área (ha): ${lead.area_ha || "—"}`,
    `Local: ${lead.local_producao || "—"}`,
  ].join("\n");
}

const SYSTEM_PROMPT = `Você é assistente do escritório Cavalcante & Valduga, canal de dívidas rurais.
Fale em português do Brasil, linguagem simples de quem entende o campo — sem juridiquês.
Objetivo: ajudar na triagem/qualificação do lead (entender dívida, urgência, próximos documentos).
Não prometa desconto, resultado, aprovação bancária nem vitória em processo.
Não invente lei nem número de processo. Se faltar dado, peça com clareza.
Respostas curtas (4 a 8 linhas), diretas, tom de conversa.`;

/** Resposta local quando ainda não há chave — não inventa API. */
function fallbackRuralReply(lead, mensagemLead) {
  const tipo = lead.tipo_divida || "dívida rural";
  const situacao = lead.situacao_divida || "situação informada";
  const pergunta = String(mensagemLead || "").trim();
  const base = [
    `Pelo que está na ficha — ${tipo}, ${situacao} — o próximo passo costuma ser organizar contratos, prazos e garantias antes de qualquer papo com o banco.`,
    "A consulta aprofunda o caso com documento na mão. Aqui só triamos e orientamos o caminho, sem prometer resultado.",
  ];
  if (pergunta) {
    base.unshift(`Sobre o que você perguntou (“${pergunta.slice(0, 160)}”): vamos tratar com calma na triagem.`);
  }
  return base.join("\n\n");
}

/**
 * Chama a API compatível com OpenAI Chat Completions.
 * Troque este bloco se o amigo usar outro provedor.
 */
async function callOpenAiCompatible({ apiKey, baseUrl, model, messages }) {
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Falha na API de IA (HTTP ${res.status}).`;
    throw new Error(msg);
  }
  const texto = data?.choices?.[0]?.message?.content;
  if (!texto || !String(texto).trim()) {
    throw new Error("A IA devolveu resposta vazia.");
  }
  return { texto: String(texto).trim(), modelo: model };
}

export async function suggestLeadReply({ db, lead, mensagemLead = "", notes = [] }) {
  const apiKey = readKey(db);
  const model = readModel(db);
  const baseUrl = readBaseUrl(db);
  const provider = readProvider(db);

  if (!apiKey) {
    return {
      texto: fallbackRuralReply(lead, mensagemLead),
      fonte: "local_sem_chave",
      modelo: null,
      provider,
      aviso:
        "Nenhuma chave de IA configurada. Resposta local de apoio. Cole a chave em Configurações ou na variável CVL_AI_API_KEY.",
    };
  }

  const notesText = (notes || [])
    .slice(0, 8)
    .map((n) => `- ${n.texto}`)
    .join("\n");

  const userParts = [
    "Dados do lead:",
    leadContextBlock(lead),
    notesText ? `\nAnotações recentes:\n${notesText}` : "",
    mensagemLead
      ? `\nMensagem / dúvida do lead:\n${String(mensagemLead).trim()}`
      : "\nGere uma mensagem curta de retorno para o lead (WhatsApp), em tom de produtor, avançando a triagem.",
  ];

  // Provedor padrão: OpenAI-compatible. Outro amigo pode trocar só esta ramificação.
  if (provider === "openai" || provider === "openai-compatible" || !provider) {
    const result = await callOpenAiCompatible({
      apiKey,
      baseUrl,
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts.filter(Boolean).join("\n") },
      ],
    });
    return {
      texto: result.texto,
      fonte: "api",
      modelo: result.modelo,
      provider,
    };
  }

  throw new Error(
    `Provedor de IA "${provider}" ainda não implementado. Veja HANDOFF.md e ajuste server/aiAssist.js.`
  );
}

const CHAT_SYSTEM = `Você é o assistente do escritório Cavalcante & Valduga (dívidas rurais no Tocantins).
Converse em português simples, tom de quem entende o campo — sem juridiquês.
Objetivos: tirar dúvida, qualificar (tipo/faixa/situação da dívida), orientar próximo passo e convidar à consulta presencial/remota.
Regras:
- Não prometa desconto, acordo, aprovação bancária ou resultado.
- Não invente lei, jurisprudência nem números de processo.
- Se faltar dado, pergunte uma coisa de cada vez.
- Respostas curtas (até ~6 linhas).
- Quando fizer sentido, diga que a consulta aprofunda o caso com documento na mão.`;

/**
 * Conversa livre com o lead (site / assistente).
 * history: [{ role: 'user'|'assistant'|'system', content }]
 */
export async function chatWithLead({ db, lead = null, history = [], message }) {
  const apiKey = readKey(db);
  const model = readModel(db);
  const baseUrl = readBaseUrl(db);
  const provider = readProvider(db);
  const userMsg = String(message || "").trim();
  if (!userMsg) throw new Error("Digite uma mensagem.");

  if (!apiKey) {
    return {
      texto: fallbackRuralReply(lead || {}, userMsg),
      fonte: "local_sem_chave",
      modelo: null,
      provider,
      aviso: "IA sem chave — resposta local. Configure BUILT_IN_FORGE_* ou CVL_AI_API_KEY.",
    };
  }

  const context = lead
    ? `\nDados já conhecidos do lead:\n${leadContextBlock(lead)}`
    : "\nAinda sem ficha completa do lead — conduza a conversa e peça nome/WhatsApp se for avançar.";

  const messages = [
    { role: "system", content: CHAT_SYSTEM + context },
    ...history
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-16)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) })),
    { role: "user", content: userMsg.slice(0, 2000) },
  ];

  if (provider === "openai" || provider === "openai-compatible" || !provider) {
    const result = await callOpenAiCompatible({ apiKey, baseUrl, model, messages });
    return { texto: result.texto, fonte: "api", modelo: result.modelo, provider };
  }

  throw new Error(`Provedor de IA "${provider}" ainda não implementado.`);
}
