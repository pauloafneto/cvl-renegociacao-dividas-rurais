/**
 * QA operador: CRM CVL (login → kanban → lista → painel → tags → tarefa → ficha)
 */
import puppeteer from "puppeteer";
import { mkdirSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CVL_URL || "http://127.0.0.1:8787";
const OUT = process.env.ARTIFACTS_DIR || path.join(__dirname, "..", "data", "qa-artifacts");

const results = [];
function note(name, ok, detail) {
  results.push({ name, ok, detail: String(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}: ${detail}`);
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/admin/login.html`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.type("#username, input[name=username], input[type=text]", "admin", { delay: 10 });
    await page.type("#password, input[name=password], input[type=password]", "admin123", { delay: 10 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => null),
      page.click("button[type=submit]"),
    ]);
    await new Promise((r) => setTimeout(r, 800));
    note("login", page.url().includes("/admin") && !page.url().includes("login"), page.url());

    await page.goto(`${BASE}/admin/`, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("#kanban-board", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));

    const toolbar = await page.evaluate(() => ({
      kanban: !!document.getElementById("view-kanban"),
      lista: !!document.getElementById("view-lista"),
      search: !!document.getElementById("search-q"),
      criticos: !!document.getElementById("btn-criticos"),
      resize: !!document.getElementById("panel-resize"),
    }));
    note("toolbar", toolbar.kanban && toolbar.lista && toolbar.search && toolbar.criticos && toolbar.resize, JSON.stringify(toolbar));

    const cards = await page.$$(".kanban-card");
    note("kanban-cards", cards.length > 0, `cards=${cards.length}`);

    if (cards[0]) {
      await cards[0].click();
      await new Promise((r) => setTimeout(r, 500));
      const panelOpen = await page.evaluate(() => !document.getElementById("detail").hidden);
      note("painel-1-clique", panelOpen, panelOpen ? "ficha lateral aberta" : "painel vazio");

      const hasSections = await page.evaluate(() => {
        const text = document.getElementById("detail")?.innerText || "";
        return {
          contato: /Contato/i.test(text),
          divida: /Dívida rural/i.test(text),
          tags: /Tags/i.test(text),
          tarefas: /Tarefas/i.test(text),
        };
      });
      note(
        "secoes-painel",
        hasSections.contato && hasSections.divida && hasSections.tags && hasSections.tarefas,
        JSON.stringify(hasSections)
      );

      // Tag click
      const tagged = await page.evaluate(async () => {
        const chip = document.querySelector("#tags-box .tag-chip");
        if (!chip) return { ok: false, reason: "sem tag" };
        chip.click();
        await new Promise((r) => setTimeout(r, 400));
        return { ok: !!document.querySelector("#tags-box .tag-chip.is-on"), name: chip.textContent };
      });
      note("tag-toggle", tagged.ok, JSON.stringify(tagged));

      // Task
      await page.type("#task-title", "Retornar produtor amanhã", { delay: 5 });
      await page.click("#btn-task");
      await new Promise((r) => setTimeout(r, 500));
      const taskOk = await page.evaluate(() =>
        [...document.querySelectorAll(".task-row__title")].some((el) =>
          /Retornar produtor/i.test(el.textContent || "")
        )
      );
      note("tarefa", taskOk, taskOk ? "tarefa na lista" : "tarefa não apareceu");

      // Lista view
      await page.click("#view-lista");
      await new Promise((r) => setTimeout(r, 400));
      const listVisible = await page.evaluate(() => {
        const pane = document.getElementById("list-pane");
        return pane && !pane.hidden && document.querySelectorAll("#list-body tr").length > 0;
      });
      note("modo-lista", listVisible, listVisible ? "grade ok" : "lista vazia");

      // Ficha dialog
      await page.click("#btn-open-ficha");
      await new Promise((r) => setTimeout(r, 300));
      const fichaOpen = await page.evaluate(() => document.getElementById("ficha-dialog")?.open === true);
      note("ficha-dialog", fichaOpen, fichaOpen ? "dialog aberto" : "dialog fechado");
      if (fichaOpen) {
        await page.click("#btn-ficha-close");
      }
    }

    // Criticos filter button text
    const criticos = await page.evaluate(() => document.getElementById("criticos-count")?.textContent);
    note("contagem-criticos", criticos != null, `criticos=${criticos}`);

    await page.screenshot({ path: path.join(OUT, "cvl-crm-qa.png"), fullPage: true });
    note("screenshot", true, path.join(OUT, "cvl-crm-qa.png"));
  } catch (e) {
    note("fatal", false, e.message);
    try {
      await page.screenshot({ path: path.join(OUT, "cvl-crm-qa-error.png"), fullPage: true });
    } catch (_) {}
  } finally {
    await browser.close();
    writeFileSync(path.join(OUT, "cvl-crm-qa.json"), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nResumo: ${results.length - failed}/${results.length} ok`);
    process.exit(failed ? 1 : 0);
  }
}

main();
