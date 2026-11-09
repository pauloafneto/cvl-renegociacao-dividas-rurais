# Como editar a prévia de diagnóstico

Arquivo: `templates/previa-diagnostico.json`

## O que cada campo faz

| Campo | Uso |
|---|---|
| `titulo` / `subtitulo` | Cabeçalho da caixinha na triagem |
| `aviso` | Rodapé legal (sem promessa de resultado) |
| `abertura` | Frase inicial com os dados do lead |
| `por_tipo` | Parágrafo conforme tipo (custeio, CPR…) |
| `por_situacao` | Parágrafo conforme atraso/cobrança |
| `por_faixa` | Toque conforme valor da dívida |
| `ponte` | Convite à consulta (usa `{{consulta_valor_formatado}}`) |
| `cta` | Texto do botão para seguir a triagem |

## Placeholders

- `{{tipo_label}}` `{{faixa_label}}` `{{situacao_label}}`
- `{{consulta_valor_formatado}}`

## Depois de editar

1. Salve o JSON.
2. Se o servidor CRM estiver no ar, reinicie (`npm start`).
3. Abra a landing, faça a triagem até “Sobre a dívida” e confira a prévia.
