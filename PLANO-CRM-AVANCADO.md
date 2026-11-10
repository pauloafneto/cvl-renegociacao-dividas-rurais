# Plano — CRM CVL avançado (reaproveitar ImprimeMais)

**Decisão:** evoluir o CRM atual do CVL (HTML + Express + SQLite), sem misturar com `app.imprimemais.com.br` e sem copiar o ERP inteiro.

## O que entra (da inteligência do ImprimeMais)

| Recurso | Como no CVL |
|---|---|
| Kanban por etapas | Já existe — refinar (prioridade, tags, lead crítico) |
| Lista + painel + ficha | 1 clique = painel; 2 cliques = ficha ampliada |
| Painel lateral moldável | Alça para arrastar a largura |
| Busca + filtros densos | Toolbar numa linha |
| Lead parado | Atrasado (2+ dias) e crítico (7+ dias) |
| Prioridade | Alta / média / baixa |
| Tags | Catálogo simples + no card/ficha |
| Tarefas de follow-up | Pendentes na ficha |
| Layout organizado | Seções claras (contato, dívida, docs, IA, anotações) |

## O que fica de fora (específico ImprimeMais)

- Proposta de locação / impressora / parque
- Contrato D4Sign / PrintWayy / OS / financeiro ERP
- Conversão lead → cliente Base
- Multi-empresa / permissões complexas do ERP
- React/tRPC do app principal (CVL continua leve e separado)

## Fases

### Fase 1 (feita — 2026-11-10)
Kanban + lista, painel moldável, ficha, busca, prioridade, tags, tarefas, atrasado/crítico.

### Fase 2 (depois)
Histórico de estágio na ficha, export CSV, multi-usuário do escritório, lembretes por e-mail/WhatsApp.

### Fase 3 (só se o amigo pedir)
Portal do lead, assinatura digital da consulta, integração WhatsApp oficial.
