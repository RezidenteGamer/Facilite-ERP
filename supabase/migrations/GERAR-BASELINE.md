# Baseline — status

**Gerado em 29/08/2026.** `00000000000000_baseline.sql` (schema completo — tabelas,
enums, ~52 funções, RLS, triggers, views) e `00000000000001_catalogos_referencia.sql`
(dados de UFs, CFOPs, tipos de cliente, regimes tributários e unidades de
medida) já estão neste diretório. O resto deste arquivo documenta como foram
gerados, para o dia em que precisar regenerar.

## Como foram gerados

O schema completo, com `supabase` CLI (versão instalada não aceita `--table`,
só `--data-only`/`--schema`/`--exclude`):

```bash
npx.cmd supabase db dump --db-url "<connection-string>" -f supabase/migrations/00000000000000_baseline.sql
```

Os dados de referência **não** vieram do `supabase db dump` — o CLI desta
versão não tem como filtrar por tabela individual, só por schema inteiro ou
por exclusão. Como as tabelas de referência (ufs, cfop_codes, tipos_cliente,
regimes_tributarios, units_of_measure — 646 linhas no total) são pequenas,
foram lidas direto do catálogo via MCP e viraram `INSERT ... ON CONFLICT DO
NOTHING` com os mesmos `id` (uuid) de produção, para o arquivo ser reaplicável
sem duplicar linha.

`ncm_codes` (10.514 linhas) ficou de fora de propósito — ver o comentário no
topo de `00000000000001_catalogos_referencia.sql`.

> A connection string contém a senha do banco. Não a cole em commit, issue,
> chat nem arquivo versionado — use só na linha de comando de um terminal que
> você feche em seguida, e considere trocar a senha depois de usá-la fora do
> normal (ex.: se ela apareceu em algum lugar por engano).

## O que já foi verificado direto no banco (antes do baseline existir)

A auditoria da tarefa C4 leu as funções pelo catálogo (`pg_get_functiondef`) e
confirmou:

- **Todas** as funções que escrevem em `products.stock` — `create_sale`,
  `create_conditional`, `create_purchase`, `create_sale_return`,
  `adjust_stock_batch`, `register_conditional_return` — fazem
  `select ... from products where id = ... for update` antes de calcular o
  saldo resultante. A trava contra venda concorrente do último item existe.
  (`create_sale_order` não trava porque não mexe em estoque — pedido não
  reserva, decisão de 17/08/2026.)
- **Nenhuma** função lê `products.sale_price`. As sete que montam item de
  documento — `create_sale`, `create_sale_order`, `update_sale_order`,
  `create_conditional`, `create_sale_return`, `convert_sale_order_to_sale`,
  `convert_conditional_to_sale` — gravam o `unit_price` que veio no payload.
  É a tarefa C3.
