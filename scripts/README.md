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

## Aviso: os três primeiros estão quebrados desde A1 (01/09/2026)

A tarefa A1 tirou a emissão fiscal do navegador: quem monta a nota, fala com o
`FiscalProvider` e grava em `fiscal_documents` passou a ser a Edge Function
`fiscal-emit` (`supabase/functions/fiscal-emit/`). Os três scripts carregam
módulos do front pelo `ssrLoadModule` do Vite e chamam a lógica local que **não
existe mais lá**:

| Script | O que sumiu de baixo dele |
|---|---|
| `fiscal-cycle-check.mjs` | Nada foi removido, mas ele exercita o `FiscalProvider` local — que já não é o caminho de emissão do produto. O ciclo emitir → consultar → cancelar virou `tests/unit/fiscalProvider.test.ts`, sem banco e rodando em `npm test`. |
| `nfce-emission-check.mjs` | `fetchSaleForInvoice`, `buildNfcePayloadFromSale`, `buildNfePayloadFromSale` e `taxRulesRepository.ts` — a leitura e o mapeamento mudaram para a Edge Function; `invoiceMapping.ts` mudou para `supabase/functions/_shared/fiscal/`. |
| `wizard-invoice-check.mjs` | `emitInvoiceForSale` ainda existe e continua sendo o que o wizard chama — mas agora é um `fetch` para a Edge Function. O script só passa a valer se a função estiver **implantada** e o `.env.local` apontar para o projeto onde ela está. |

Consertá-los não é reescrevê-los no mesmo formato: o que eles provavam
(mapeamento + emissão) agora acontece do lado do servidor, então a forma
honesta de exercitar isso é chamar a Edge Function implantada com a conta de
teste, ou portar as asserções que não dependem de banco para `tests/`. Nenhuma
das duas foi feita — está anotado como pendência no AGENTS.md.
