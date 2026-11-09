import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fillTemplate, formatBrl } from "./contractTemplate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, "..", "templates", "previa-diagnostico.json");

const LABELS = {
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
    misto: "Mais de um tipo",
  },
  atraso: {
    atrasado: "Já estou atrasado",
    "em-dia-apertado": "Em dia, mas o caixa apertou",
    cobranca: "Cobrança / ameaça de execução",
  },
};

export function loadPreviaTemplate() {
  return JSON.parse(fs.readFileSync(templatePath, "utf8"));
}

export function buildPrevia({ tipo, faixa, atraso, consultaValor = 497 }) {
  const tpl = loadPreviaTemplate();
  const vars = {
    tipo_label: LABELS.tipo[tipo] || tipo || "sua dívida",
    faixa_label: LABELS.faixa[faixa] || faixa || "informada",
    situacao_label: LABELS.atraso[atraso] || atraso || "informada",
    consulta_valor_formatado: formatBrl(consultaValor),
  };

  const blocos = [
    fillTemplate(tpl.abertura, vars),
    fillTemplate(tpl.por_tipo?.[tipo] || "", vars),
    fillTemplate(tpl.por_situacao?.[atraso] || "", vars),
    fillTemplate(tpl.por_faixa?.[faixa] || "", vars),
    fillTemplate(tpl.ponte, vars),
  ].filter((t) => t && t.trim() && t !== "—");

  return {
    titulo: tpl.titulo,
    subtitulo: tpl.subtitulo,
    aviso: tpl.aviso,
    cta: tpl.cta || "Continuar a triagem",
    paragrafos: blocos,
    texto: blocos.join("\n\n"),
    vars,
    template_id: tpl.id,
    template_versao: tpl.versao,
  };
}
