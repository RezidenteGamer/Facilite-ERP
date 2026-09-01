# scripts/

Verificações ad-hoc, rodadas à mão com `node scripts/<nome>.mjs`. Não são
testes — **testes ficam em `tests/`, rodam com `npm test` e falham o build.**

| Script | O que faz |
|---|---|
| `fiscal-cycle-check.mjs` | Ciclo emitir → consultar → cancelar → consultar do `FiscalProvider` |
| `nfce-emission-check.mjs` | NFC-e do PDV ponta a ponta |
| `wizard-invoice-check.mjs` | Prova que "Gerar Nota Fiscal" do wizard emite de verdade |
| `import-module-icons.mjs` | Build helper — importa os ícones dos módulos |
| `optimize-images.mjs` | Build helper — otimiza imagens |

## Antes de rodar

Os três primeiros autenticam com a conta de teste, lida de `.env.local` via
`testAccount.mjs` (`FACILITE_TEST_EMAIL` / `FACILITE_TEST_PASSWORD`). Até
28/08/2026 essas credenciais estavam em texto claro e versionadas dentro dos
próprios scripts — **a senha que estava exposta deve ser trocada.**

## Aviso: eles escrevem no banco real

`nfce-emission-check.mjs` e `wizard-invoice-check.mjs` criam vendas de verdade
e abrem/fecham sessão de caixa, sem rollback. O que eles deixam para trás fica
no banco como qualquer outra venda. Migrá-los para `tests/`, com fixture
descartável, é trabalho pendente.

`tax-rule-resolution-check.mjs` foi aposentado em 29/08/2026: era o único que
não falava com o banco, e virou `tests/unit/taxRules.test.ts` — mesmas
asserções, agora rodando em `npm test`.
