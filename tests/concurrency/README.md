# Bateria de concorrência na baixa de estoque (C4)

Cria (ou reaproveita) um produto de teste com estoque em exatamente 1 e
dispara duas `create_sale` simultâneas comprando 1 unidade cada. **Só uma
pode passar** — a outra tem de ser recusada com "Estoque insuficiente", e o
estoque final tem de ser exatamente 0 (nunca -1).

Roda contra o Supabase real de propósito, como `tests/isolation` — o que está
sendo testado é a trava do banco (`select ... for update` antes de calcular o
saldo), não uma simulação dela. A trava já existia nas seis funções que
escrevem em `products.stock` (auditoria direta no catálogo do Postgres, ver
AGENTS.md); esta bateria é o que impede a regressão.

## Preparo

Usa a conta de teste (a mesma de `scripts/`, não a bateria de isolamento).
Preencher em `.env.local`:

```
FACILITE_TEST_EMAIL=...
FACILITE_TEST_PASSWORD=...
```

A conta precisa ter, na filial em que está vinculada (`user_branches`),
permissão de `view`/`create`/`edit` em Produtos e de `create` em Realizar
venda. Sem essas variáveis, ou sem essas permissões, `npm test` falha aqui
com a mensagem dizendo o que falta — de propósito, mesmo motivo do resto de
`tests/`: uma bateria que se auto-desliga quando não está configurada dá um
verde falso.

## Rastro que ela deixa no banco (e por que não dá para evitar)

- **A venda vencedora é uma venda de verdade.** `create_sale` grava
  `sales`/`sale_items`/`sale_payments` e lança um `financial_entries` de
  `a_receber` — sem rollback, sem flag de "é teste". Desde a tarefa C3
  (29/08/2026) existe o gatilho `financial_entries_before_delete`, que recusa
  `DELETE` em qualquer lançamento com `origin_kind` diferente de `'manual'`:
  não dá mais para limpar esse lançamento depois. É o mesmo trade-off que
  `scripts/README.md` já documenta para `nfce-emission-check.mjs` e
  `wizard-invoice-check.mjs`.
- **O produto de teste também não é apagável depois da primeira execução.**
  `sale_items.product_id` referencia `products(id)` sem `ON DELETE CASCADE`
  nem `SET NULL` — sem cláusula, o Postgres cai no padrão `NO ACTION`, que
  bloqueia o delete do mesmo jeito que `RESTRICT` — uma vez que a venda vencedora grava
  um `sale_items` apontando para ele, apagar o produto vira uma violação de
  chave estrangeira. A bateria tenta apagá-lo no `afterAll` mesmo assim (é
  best-effort, e cobre um produto que por algum motivo não tenha sido usado
  em nenhuma venda), mas a partir da primeira execução bem-sucedida esse
  delete sempre falha silenciosamente, e o produto fica no banco de
  propósito.
- **Por isso "criar ou reaproveitar"**: a bateria procura, na filial da conta
  de teste, um produto com descrição começando em `TESTE-CONCORRENCIA-` antes
  de criar um novo. Da segunda execução em diante ela reaproveita o mesmo
  produto (resetando o estoque para 1 a cada rodada) em vez de acumular um
  produto novo por execução.

## O que ela NÃO cobre

Só `create_sale`. As outras cinco funções que travam a mesma linha
(`create_pos_sale`, `create_purchase`, `create_sale_return`,
`create_conditional`, `adjust_stock_batch`) foram confirmadas na mesma
auditoria de catálogo, mas não têm bateria de concorrência própria — replicar
o mesmo teste para as outras cinco é trabalho pendente.

## Risco aceito: duas execuções ao mesmo tempo

O projeto roda várias sessões de Claude Code em paralelo contra o mesmo
Supabase (ver AGENTS.md). Se duas execuções desta bateria caírem juntas, as
duas resetam o mesmo produto reaproveitado para estoque 1 e disparam duas
`create_sale` cada — quatro compradores concorrentes do "último item", não
dois — e o resultado por processo pode não bater com "exatamente uma passa".
Isso não indica que a trava quebrou, só que a bateria não foi pensada para
rodar em paralelo consigo mesma, mesma limitação que `tests/isolation` já
aceita para as próprias fixtures. Não vale a pena resolver com lock
distribuído só para o teste — se aparecer flakiness, rodar de novo sozinho.
