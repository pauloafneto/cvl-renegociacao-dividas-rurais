# Como editar o contrato (sem mexer no código)

## Arquivos

| Arquivo | O que muda |
|---|---|
| `templates/contrato-consulta.json` | Título, introdução, cláusulas e fechamento do contrato |
| `templates/escritorio.json` | Razão social, CNPJ, endereços, e-mail, foro |

Reinicie o servidor (`pnpm start` / `npm start`) depois de salvar, para recarregar o template.

## Placeholders disponíveis

Use no texto como `{{nome_do_campo}}`:

### Cliente / lead
- `{{cliente_nome}}`
- `{{cliente_cpf}}`
- `{{cliente_telefone}}`
- `{{cliente_email}}`
- `{{cliente_endereco}}`
- `{{tipo_divida}}`
- `{{faixa_divida}}`
- `{{situacao_divida}}`
- `{{porte}}`
- `{{cultura}}`
- `{{area_ha}}`
- `{{local_producao}}`

### Valores e datas
- `{{consulta_valor}}` (número)
- `{{consulta_valor_formatado}}` (ex.: R$ 497)
- `{{consulta_valor_extenso}}`
- `{{prazo_dias}}`
- `{{data_contrato}}`

### Escritório (vindos de `escritorio.json`)
- `{{escritorio_razao_social}}`
- `{{escritorio_cnpj}}`
- `{{escritorio_endereco_palmas}}`
- `{{escritorio_endereco_porto}}`
- `{{escritorio_email}}`
- `{{foro}}`
- `{{cidade_assinatura}}`

## Boas práticas

1. Não prometa resultado (desconto, aprovação bancária etc.).
2. Deixe claro o abatimento da consulta se houver contrato posterior.
3. Mantenha CNPJ e dados do escritório atualizados em `escritorio.json`.
4. Após editar, gere um PDF de teste no painel (ficha do lead → Gerar contrato).
