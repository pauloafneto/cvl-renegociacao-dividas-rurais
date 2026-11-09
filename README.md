# CVL — Renegociação de dívidas rurais + painel de leads

Landing de triagem + CRM (leads, documentos, contrato PDF, prévia, resumo de conversão, assistente de IA).

## Site (landing)

Arquivos estáticos na raiz (`index.html`, `styles.css`, `app.js`).

## Painel CRM

Servidor Node (`server/`) com:

- Login (senha hasheada com bcrypt)
- SQLite (`data/cvl.sqlite`, via sql.js) — persiste em disco na pasta `data/`
- Lista de leads + status + anotações
- Upload de documentos + download no painel
- Valor da consulta editável (`/admin/configuracoes.html`), padrão R$ 497
- Follow-up (2+ dias sem retorno)
- Contrato por template PDF (`templates/contrato-consulta.json`)
- Prévia de diagnóstico (`templates/previa-diagnostico.json`)
- Resumo de conversão no topo do painel
- Assistente de IA (chave **vazia** até colar — ver `HANDOFF.md`)

### Usuário inicial (trocar depois)

| Campo | Valor |
|---|---|
| Usuário | `admin` |
| Senha | `admin123` |

### Como rodar no computador

```bash
cd sites/cavalcanteevalduga/renegociacao-dividas-rurais
npm install
npm start
```

- Landing: http://localhost:8787/
- Painel: http://localhost:8787/admin/
- Login: http://localhost:8787/admin/login.html

Porta: variável `PORT` (padrão `8787`). Em produção a Hostinger define `PORT` sozinha — o app já respeita isso.

---

## Publicar na Hostinger Nuvem Startups (caminho principal)

Plano certo na conta do Paulo: **Hospedagem em Nuvem para Startups** (já tem Node — é onde roda `app.imprimemais.com.br`).

**Não use** o site `app.imprimemais.com.br` para esta demo.  
**Não use** o plano **Negócios** (só PHP/HTML).  
**Não use** GitHub Pages para o CRM (Pages é estático; o painel precisa do servidor Node).

### 1) Criar um site Node novo (subdomínio)

1. No hPanel abra **Sites**.
2. No bloco **Hospedagem em Nuvem para Startups**, clique **+ Criar site**.
3. Escolha criar um **aplicativo web / Node.js** (não PHP).
4. Domínio: use um **subdomínio novo**, por exemplo:
   - `cvl-crm.imprimemais.com.br`, ou
   - `cvl.cavalcanteevalduga.com.br`  
   (o que o Paulo preferir e tiver DNS liberado).
5. Confirme a criação e espere o site aparecer na lista — **separado** do `app.imprimemais.com.br`.

### 2) Enviar o código deste projeto

Envie **só** a pasta `renegociacao-dividas-rurais/` (raiz do app = esta pasta).

Opções comuns no hPanel Node:

- **Git:** apontar o repositório e a pasta/raiz deste projeto; branch estável.
- **Upload / File Manager:** subir os arquivos para a raiz do site novo.

Garanta que na raiz do site existam: `package.json`, `server/`, `admin/`, `index.html`, `templates/`, `ecosystem.config.cjs`, `.env.example`.

### 3) Configurar o Node no hPanel

No painel do **site novo** (não no ImprimeMais):

| Campo | Valor sugerido |
|---|---|
| Versão do Node | **22** |
| Comando de build | `npm install --omit=dev` |
| Comando de start | `npm start` |
| Entrada (se pedir arquivo) | `server/index.js` |

Variáveis de ambiente (hPanel → Node.js / Environment):

```
NODE_ENV=production
CVL_SESSION_SECRET=cole-uma-frase-longa-aleatoria
CVL_AI_API_KEY=
```

- Deixe `CVL_AI_API_KEY` **vazio** (o amigo cola depois no painel Configurações).
- Não precisa fixar `PORT` — a Hostinger injeta a porta; o app usa `process.env.PORT`.
- Opcional: `CVL_DATA_DIR` só se quiser o SQLite fora da pasta do app.

Salve e **dispare o build / restart** do aplicativo Node.

### 4) Conferir se subiu

1. Abra `https://SEU-SUBDOMINIO/api/health` → deve mostrar `{"ok":true,"service":"cvl-crm"}`.
2. Site: `https://SEU-SUBDOMINIO/`
3. Painel: `https://SEU-SUBDOMINIO/admin/`
4. Login: `admin` / `admin123` (trocar depois)
5. Configurações (consulta + chave IA vazia): `/admin/configuracoes.html`

Se o hPanel oferecer SSL no subdomínio, ative (Let's Encrypt).

### Persistência SQLite (`data/`)

- Banco, uploads e PDFs ficam em `data/` dentro do site.
- **Não apague** `data/` ao republicar código.
- Backup: baixe `data/cvl.sqlite` pelo File Manager de tempos em tempos.

### Chave de IA (vazia)

- Em Configurações o campo da chave **começa vazio**.
- Ou variável `CVL_AI_API_KEY=` vazia até ter chave.
- Sem chave: rascunho local. Detalhes: `HANDOFF.md`.

### Atualizar depois

1. Suba só os arquivos de código (preserve `data/`).
2. Rode de novo o build (`npm install --omit=dev`) e **Restart** no hPanel Node.

### PM2

No Nuvem Startups o **start do hPanel** (`npm start`) já mantém o processo.  
`ecosystem.config.cjs` (PM2) fica como opção se no futuro usar VPS/SSH — ver alternativa abaixo.

---

## Alternativa: Hostinger VPS + nginx + PM2

Só se o Paulo tiver **VPS** de verdade (menu VPS no hPanel, com IP e SSH) — **não** é a tela “Sites” da Nuvem.

1. Enviar a pasta para o VPS (ex.: `/var/www/cvl-crm`).
2. No SSH:

```bash
cd /var/www/cvl-crm
cp .env.example .env   # CVL_SESSION_SECRET preenchido; CVL_AI_API_KEY vazio
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

3. Proxy nginx: exemplo em `deploy/nginx-cvl-crm.conf.example` + SSL.
4. Mesmos cuidados com `data/` e chave de IA vazia.

---

## Como editar textos (sem código)

- Contrato: `templates/contrato-consulta.json` + `templates/COMO-EDITAR.md`
- Prévia: `templates/previa-diagnostico.json` + `templates/COMO-EDITAR-PREVIA.md`
- Handoff para o amigo (IA): `HANDOFF.md`

## Status do funil

`novo` → `triagem` → `atendimento` → `proposta` → `fechado`  
(também: `perdido`)
