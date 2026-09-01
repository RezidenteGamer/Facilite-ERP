/**
 * Prova de que o wizard de Realizar Venda ("Gerar Nota Fiscal") agora emite
 * NF-e de verdade em vez de só mudar o texto da tela de sucesso — o bug
 * corrigido nesta sessão (ver AGENTS.md). Exercita exatamente o que
 * `useSaleDraft.confirmSale({ emitirNota: true })` chama por baixo
 * (`emitInvoiceForSale`, o núcleo extraído de `useInvoicesData.ts`), sem
 * passar pelo hook React (não roda em Node) — mesmo padrão de
 * `scripts/nfce-emission-check.mjs`.
 *
 * Rode com:  node scripts/wizard-invoice-check.mjs
 */

import { createServer } from "vite";

import { requireTestAccount } from "./testAccount.mjs";

const TEST_ACCOUNT = requireTestAccount();

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`[${ok ? "  ok  " : " FALHA"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
let exitCode = 0;

try {
  const { supabase } = await server.ssrLoadModule("/src/lib/supabaseClient.ts");
  const { resetFiscalProvider } = await server.ssrLoadModule("/src/lib/fiscal/provider.ts");
  const { emitInvoiceForSale, fetchInvoiceSales } = await server.ssrLoadModule(
    "/src/lib/repositories/fiscalDocumentsRepository.ts",
  );
  const { createSale } = await server.ssrLoadModule("/src/lib/repositories/salesRepository.ts");

  if (!supabase) throw new Error("Supabase não configurado — confira o .env.local.");
  resetFiscalProvider();

  const auth = await supabase.auth.signInWithPassword(TEST_ACCOUNT);
  if (auth.error) throw auth.error;
  check("Login com a conta de testes", true, TEST_ACCOUNT.email);
  const sellerId = auth.data.user.id;

  const { data: branch } = await supabase.from("branches").select("id, cnpj, uf").eq("code", "001").single();
  const branchId = branch.id;

  const { data: doritos } = await supabase.from("products").select("id, sale_price").eq("code", "001").single();
  const { data: cafe } = await supabase.from("products").select("id, sale_price").eq("code", "003").single();
  const { data: bruno } = await supabase
    .from("contacts")
    .select("id, name, document, uf")
    .eq("name", "Bruno venzo debacco")
    .single();

  /* ---- 1. "Gerar Nota Fiscal": produto com NCM + grupo tributário ---- */

  const saleOk = await createSale({
    branchId,
    contactId: bruno.id,
    sellerId,
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: doritos.id, quantity: 1, unitPrice: doritos.sale_price }],
    payments: [{ method: "pix", amount: doritos.sale_price }],
  });
  check("Venda criada (equivalente a confirmSale antes da emissão)", Boolean(saleOk?.id), `venda ${saleOk.code}`);

  const outcomeOk = await emitInvoiceForSale(branchId, saleOk.id);
  check(
    "emitInvoiceForSale autoriza a NF-e (o que 'Gerar Nota Fiscal' agora dispara de verdade)",
    outcomeOk.ok,
    JSON.stringify(outcomeOk),
  );

  const { data: docOk } = await supabase.from("fiscal_documents").select("*").eq("sale_id", saleOk.id).single();
  check("fiscal_documents ganhou uma linha real para a venda (era o bug: ficava vazio)", docOk?.model === "nfe" && docOk?.status === "autorizado", `model=${docOk?.model}, status=${docOk?.status}`);

  /* ---- 2. "Gerar Nota Fiscal": produto sem grupo tributário — venda não pode travar ---- */

  const saleFail = await createSale({
    branchId,
    contactId: bruno.id,
    sellerId,
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: cafe.id, quantity: 1, unitPrice: cafe.sale_price }],
    payments: [{ method: "dinheiro", amount: cafe.sale_price }],
  });
  check(
    "Venda confirmada mesmo com produto sem grupo tributário (venda nunca falha por causa da nota)",
    Boolean(saleFail?.id),
    `venda ${saleFail.code}`,
  );

  const outcomeFail = await emitInvoiceForSale(branchId, saleFail.id);
  check(
    "emitInvoiceForSale falha citando o item, sem lançar exceção (vira aviso, não erro de venda)",
    !outcomeFail.ok && outcomeFail.errors.some((e) => e.includes("grupo tributário")),
    JSON.stringify(outcomeFail),
  );

  const { data: docFail } = await supabase.from("fiscal_documents").select("id").eq("sale_id", saleFail.id);
  check("Nenhuma linha gravada em fiscal_documents para a venda com emissão recusada", (docFail?.length ?? 0) === 0, `linhas=${docFail?.length}`);

  /* ---- 3. Notas Emitidas reflete exatamente o mesmo estado, sem divergir da tela de venda ---- */

  const invoiceRows = await fetchInvoiceSales(branchId);
  const rowOk = invoiceRows.find((r) => r.saleId === saleOk.id);
  const rowFail = invoiceRows.find((r) => r.saleId === saleFail.id);
  check("Notas Emitidas mostra a venda A como Autorizado", rowOk?.document?.status === "autorizado", JSON.stringify(rowOk?.document?.status));
  check("Notas Emitidas mostra a venda B como Sem nota", rowFail?.document === null, JSON.stringify(rowFail?.document));

  /* ---- 4. Reemissão da mesma venda é idempotente (mesmo ref, upsert por ref) ---- */

  const outcomeRetry = await emitInvoiceForSale(branchId, saleOk.id);
  check("Reemissão da mesma venda continua autorizando (idempotente)", outcomeRetry.ok, JSON.stringify(outcomeRetry));
  const { data: docsAfterRetry } = await supabase.from("fiscal_documents").select("id").eq("sale_id", saleOk.id);
  check("fiscal_documents continua com 1 linha só para a venda (sem duplicar)", (docsAfterRetry?.length ?? 0) === 1, `linhas=${docsAfterRetry?.length}`);

  await supabase.auth.signOut();
} catch (error) {
  exitCode = 1;
  console.error("\nErro no teste:", error);
} finally {
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} verificações passaram.` +
    (failed.length ? ` Falhas: ${failed.map((f) => f.label).join("; ")}` : ""),
);
process.exit(failed.length > 0 ? 1 : exitCode);
