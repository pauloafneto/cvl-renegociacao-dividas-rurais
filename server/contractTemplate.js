import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(__dirname, "..", "templates");

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
  "dezoito", "dezenove",
];
const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta",
  "oitenta", "noventa",
];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

function tresDigitosExtenso(n) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  if (n < 20) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  const c = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${CENTENAS[c]} e ${tresDigitosExtenso(r)}` : CENTENAS[c];
}

export function valorPorExtenso(valor) {
  const n = Math.round(Number(valor) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) return "valor inválido";
  const inteiro = Math.floor(n);
  const centavos = Math.round((n - inteiro) * 100);
  let texto;
  if (inteiro === 0) texto = "zero reais";
  else if (inteiro === 1) texto = "um real";
  else if (inteiro < 1000) texto = `${tresDigitosExtenso(inteiro)} reais`;
  else if (inteiro < 1000000) {
    const mil = Math.floor(inteiro / 1000);
    const resto = inteiro % 1000;
    const milTxt = mil === 1 ? "mil" : `${tresDigitosExtenso(mil)} mil`;
    texto = resto
      ? `${milTxt} e ${tresDigitosExtenso(resto)} reais`
      : `${milTxt} reais`;
  } else {
    texto = `${inteiro} reais`;
  }
  if (centavos === 1) texto += " e um centavo";
  else if (centavos > 1) texto += ` e ${tresDigitosExtenso(centavos)} centavos`;
  return texto;
}

export function formatBrl(value) {
  return Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function fillTemplate(text, vars) {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") return "—";
    return String(v);
  });
}

export function loadEscritorio() {
  const file = path.join(templatesDir, "escritorio.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadContratoTemplate(templateId = "contrato-consulta") {
  const file = path.join(templatesDir, `${templateId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Template não encontrado: ${templateId}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function buildContractVars({ lead, overrides = {}, consultaValor, prazoDias = 10 }) {
  const escritorio = loadEscritorio();
  const merged = {
    nome: lead.nome,
    telefone: lead.telefone,
    email: lead.email,
    cpf: lead.cpf || "",
    endereco: lead.endereco || "",
    tipo_divida: lead.tipo_divida || "",
    faixa_divida: lead.faixa_divida || "",
    situacao_divida: lead.situacao_divida || "",
    porte: lead.porte || "",
    cultura: lead.cultura || "",
    area_ha: lead.area_ha || "",
    local_producao: lead.local_producao || "",
    ...overrides,
  };

  const valor = Number(consultaValor);
  const data = new Date();
  const dataContrato = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return {
    cliente_nome: merged.nome || "—",
    cliente_cpf: merged.cpf || "—",
    cliente_telefone: merged.telefone || "—",
    cliente_email: merged.email || "não informado",
    cliente_endereco: merged.endereco || "a informar",
    tipo_divida: merged.tipo_divida || "a confirmar",
    faixa_divida: merged.faixa_divida || "a confirmar",
    situacao_divida: merged.situacao_divida || "a confirmar",
    porte: merged.porte || "a confirmar",
    cultura: merged.cultura || "a confirmar",
    area_ha: merged.area_ha || "—",
    local_producao: merged.local_producao || "TO",
    consulta_valor: valor,
    consulta_valor_formatado: formatBrl(valor),
    consulta_valor_extenso: valorPorExtenso(valor),
    prazo_dias: prazoDias,
    data_contrato: dataContrato,
    escritorio_razao_social: escritorio.razao_social,
    escritorio_cnpj: escritorio.cnpj,
    escritorio_endereco_palmas: escritorio.endereco_palmas,
    escritorio_endereco_porto: escritorio.endereco_porto,
    escritorio_email: escritorio.email,
    foro: escritorio.foro,
    cidade_assinatura: escritorio.cidade_assinatura,
  };
}

export function renderContractDocument(template, vars) {
  return {
    titulo: fillTemplate(template.titulo, vars),
    introducao: fillTemplate(template.introducao, vars),
    clausulas: (template.clausulas || []).map((c) => ({
      numero: c.numero,
      titulo: fillTemplate(c.titulo, vars),
      texto: fillTemplate(c.texto, vars),
    })),
    fechamento: fillTemplate(template.fechamento, vars),
    local_data: fillTemplate(template.local_data, vars),
    vars,
    template_id: template.id,
    template_versao: template.versao,
  };
}

export { templatesDir };
