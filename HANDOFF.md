# Handoff — CRM CVL (dívidas rurais)

Projeto para o amigo continuar: landing + painel de leads + prévia + contrato PDF + assistente de IA.

## Estrutura

```
renegociacao-dividas-rurais/
  index.html, styles.css, app.js   → site / funil
  admin/                           → painel (login, leads, stats, IA)
  server/                          → Express (API + SQLite sql.js)
  templates/                       → textos editáveis (contrato, prévia, escritório)
  data/                            → SQLite, uploads, PDFs (persistente no disco do site)
  ecosystem.config.cjs             → PM2 (alternativa VPS); na Nuvem use npm start do hPanel
```

## Onde está a IA

Arquivo único: `server/aiAssist.js`

- Lê a chave de `settings.ai_api_key` (painel) **ou** `CVL_AI_API_KEY` / `OPENAI_API_KEY`
- Campo no painel **sempre vazio** ao abrir — cole a chave só quando tiver
- Sem chave: rascunho local (não chama API)
- Trocar de provedor: editar `suggestLeadReply` / `callOpenAiCompatible` nesse arquivo

Rotas:

- `GET /api/settings/ai` / `PUT /api/settings/ai` — config (chave não é ecoada)
- `POST /api/leads/:id/ai-reply` — sugerir resposta na ficha do lead

## O que configurar

1. `CVL_SESSION_SECRET` no `.env` (produção)
2. Chave de IA: vazia até o amigo colar (Configurações ou `.env`)
3. Login inicial: `admin` / `admin123` — trocar depois
4. Opcional: `CVL_DATA_DIR` se quiser SQLite fora da pasta do app

## Publicação

Ver README → seção **Publicar na Hostinger Nuvem Startups**.
Não usar o site `app.imprimemais.com.br` — criar site Node novo em subdomínio.
