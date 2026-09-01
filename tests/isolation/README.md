# Bateria de isolamento entre filiais (C1)

Autentica como um usuário da filial A e tenta ler e escrever na filial B,
tabela por tabela. **Qualquer sucesso reprova o build.**

Roda contra o Supabase real de propósito — o que está sendo testado é a policy
do banco, não uma imitação dela. Revisão manual de RLS não escala e não
sobrevive a um deploy apressado.

## Preparo (uma vez)

Hoje o projeto tem **uma filial só**, então a bateria ainda não tem o que
comparar. Para ligá-la:

1. **Criar uma segunda filial.** Ainda não há tela para isso (é a tarefa D1);
   por enquanto é `insert` em `branches` via SQL.
2. **Criar duas contas** em `/usuarios-operadores`, com um papel que tenha
   `can_view`/`can_create`/`can_edit`/`can_delete` em Produtos. Nenhuma das
   duas pode ter as flags globais (`can_manage_branches` em especial — quem
   gerencia filiais enxerga todas por definição, e a bateria não provaria nada).
3. **Vincular cada conta a exatamente uma filial** em `user_branches` — sem
   nenhuma filial em comum. A bateria recusa rodar se as duas caírem na mesma.
4. **Cadastrar ao menos um produto em cada filial** (os testes de `update` e
   `delete` precisam de uma linha real de cada lado).
5. Preencher em `.env.local`:

```
FACILITE_ISOLATION_A_EMAIL=...
FACILITE_ISOLATION_A_PASSWORD=...
FACILITE_ISOLATION_B_EMAIL=...
FACILITE_ISOLATION_B_PASSWORD=...
```

Enquanto isso não estiver feito, `npm test` falha aqui com a mensagem dizendo
o que falta — de propósito. Uma bateria de segurança que se auto-desliga
quando não está configurada é pior que não ter bateria: ela dá um verde falso.

## O que ela cobre hoje

- **Leitura**: as 12 tabelas com `branch_id` (`products`, `sales`,
  `sale_orders`, `sale_returns`, `purchases`, `conditionals`,
  `financial_entries`, `fiscal_documents`, `cash_registers`, `cash_sessions`,
  `stock_adjustments`, `module_records`).
- **Escrita**: criar na filial do outro, mover a própria linha para a filial do
  outro (o `WITH CHECK` do RLS), e apagar linha do outro.
- **RPC**: `adjust_stock_batch` apontando para a filial do outro, e
  `has_branch_access` respondendo `false`.
- **Escalação de papel**: trocar o próprio `role_id` (trigger
  `prevent_role_escalation`).

## O que falta (as próximas tarefas escrevem)

- **Teto de desconto** (C3) — venda com desconto acima do permitido pelo papel.
- **Preço vindo do banco** (C3) — `unit_price` forjado no payload de
  `create_sale` tem de ser ignorado.
- **Concorrência** (C4) — duas `create_sale` simultâneas do último item em
  estoque: só uma pode passar. A trava (`select ... for update`) já existe nas
  seis funções que escrevem em `products.stock`; falta o teste que impede a
  regressão.
