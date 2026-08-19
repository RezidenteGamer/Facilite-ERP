/**
 * Prova de que a emissão de NFC-e do PDV (etapa 8.5) funciona ponta a ponta
 * contra dados reais: cliente opcional, CFOP/CST/alíquota por item reaproveitados
 * de `resolveTaxRule`/grupos tributários, série independente da NF-e, falha não
 * bloqueia a venda, e Notas Emitidas lista os dois modelos juntos.
 *
 * Rode com:  node scripts/nfce-emission-check.mjs
 *
 * Mesmo padrão de `scripts/fiscal-cycle-check.mjs` (passa pelo `ssrLoadModule`
 * do Vite para exercitar o mesmo grafo de módulos que o navegador carrega, com
 * `import.meta.env` populado a partir do `.env.local`) — escrito porque a
 * verificação no navegador desta etapa não pôde ser feita nesta sessão (o
 * Browser pane não conseguiu alcançar o servidor de dev neste ambiente; ver
 * AGENTS.md). Abre e fecha uma sessão de caixa de teste; cria três vendas reais
 * (com rollback lógico nenhum — ficam no banco como qualquer venda de teste
 * anterior já documentada no AGENTS.md).
 */

import { createServer } from "vite";

const TEST_ACCOUNT = { email: "claude.testes@facilite.com", password: "claude2026" };

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  console.log(`[${ok ? "  ok  " : " FALHA"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "warn" });
let exitCode = 0;
let sessionId = null;

try {
  const { supabase } = await server.ssrLoadModule("/src/lib/supabaseClient.ts");
  const { isValidAccessKey } = await server.ssrLoadModule("/src/lib/fiscal/accessKey.ts");
  const { resetFiscalProvider } = await server.ssrLoadModule("/src/lib/fiscal/provider.ts");
  const { emitFiscalDocumentForSale } = await server.ssrLoadModule("/src/features/pos/fiscalDocument.ts");
  const { fetchSaleForInvoice, fetchInvoiceSales } = await server.ssrLoadModule(
    "/src/lib/repositories/fiscalDocumentsRepository.ts",
  );
  const { fetchTaxRules } = await server.ssrLoadModule("/src/lib/repositories/taxRulesRepository.ts");
  const { buildNfcePayloadFromSale, buildNfePayloadFromSale } = await server.ssrLoadModule(
    "/src/features/sales/invoiceMapping.ts",
  );
  const { createPosSale } = await server.ssrLoadModule("/src/lib/repositories/posRepository.ts");
  const { openCashSession, closeCashSession } = await server.ssrLoadModule(
    "/src/lib/repositories/cashControlRepository.ts",
  );
  const { getFiscalProvider } = await server.ssrLoadModule("/src/lib/fiscal/provider.ts");

  if (!supabase) throw new Error("Supabase não configurado — confira o .env.local.");
  resetFiscalProvider(); // provedor limpo, sem estado de execuções anteriores deste processo

  const auth = await supabase.auth.signInWithPassword(TEST_ACCOUNT);
  if (auth.error) throw auth.error;
  check("Login com a conta de testes", true, TEST_ACCOUNT.email);
  const sellerId = auth.data.user.id;

  const { data: branch } = await supabase
    .from("branches")
    .select("id, cnpj, uf")
    .eq("code", "001")
    .single();
  const branchId = branch.id;

  const { data: register } = await supabase
    .from("cash_registers")
    .select("id")
    .eq("branch_id", branchId)
    .limit(1)
    .single();

  const { data: doritos } = await supabase.from("products").select("id, sale_price").eq("code", "001").single();
  const { data: arroz } = await supabase.from("products").select("id, sale_price").eq("code", "002").single();
  const { data: cafe } = await supabase.from("products").select("id, sale_price").eq("code", "003").single();
  const { data: bruno } = await supabase.from("contacts").select("id, name, document, uf").eq("name", "Bruno venzo debacco").single();

  await openCashSession({ registerId: register.id, openingAmount: 100 });
  const { data: openSession } = await supabase
    .from("cash_sessions")
    .select("id")
    .eq("branch_id", branchId)
    .eq("status", "aberto")
    .single();
  sessionId = openSession.id;
  check("Sessão de caixa de teste aberta", Boolean(sessionId), sessionId);

  /* ---- 1. venda do PDV sem cliente, produto com grupo tributário ---- */

  const saleA = await createPosSale({
    branchId,
    contactId: null,
    sellerId,
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: doritos.id, quantity: 1, unitPrice: doritos.sale_price }],
    payments: [{ method: "dinheiro", amount: doritos.sale_price }],
  });
  check("Venda A criada sem cliente (PDV)", Boolean(saleA?.id), `venda ${saleA.code}`);

  const outcomeA = await emitFiscalDocumentForSale(saleA.id, branchId);
  check("emitFiscalDocumentForSale autoriza NFC-e sem cliente identificado", outcomeA.ok, JSON.stringify(outcomeA));

  const { data: docA } = await supabase.from("fiscal_documents").select("*").eq("sale_id", saleA.id).single();
  check("Documento gravado é NFC-e (model=nfce)", docA?.model === "nfce", `model=${docA?.model}`);
  check("Chave de 44 dígitos com DV válido", isValidAccessKey(docA?.chave ?? ""), docA?.chave ?? "sem chave");
  check("QR Code presente (só existe em NFC-e)", typeof docA?.qr_code_url === "string" && docA.qr_code_url.includes("qrcode?p="), docA?.qr_code_url ?? "null");
  check("Numeração NFC-e começa em 1 (série independente da NF-e, provedor recém-resetado)", docA?.numero === "1", `numero=${docA?.numero}`);

  const { data: saleAItems } = await supabase.from("sale_items").select("cfop").eq("sale_id", saleA.id);
  check("CFOP gravado nos itens da venda", saleAItems?.every((i) => i.cfop === "5102"), saleAItems?.map((i) => i.cfop).join(","));

  /* ---- 2. venda do PDV com cliente identificado (LookupModal) ---- */

  const saleB = await createPosSale({
    branchId,
    contactId: bruno.id,
    sellerId,
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: arroz.id, quantity: 1, unitPrice: arroz.sale_price }],
    payments: [{ method: "pix", amount: arroz.sale_price }],
  });
  check("Venda B criada com cliente identificado", Boolean(saleB?.id), `venda ${saleB.code}, cliente ${bruno.name}`);

  // Inspeciona o payload antes de persistir, pra confirmar que os dados do
  // destinatário aparecem quando o cliente foi identificado.
  const [saleBForInvoice, rules] = await Promise.all([fetchSaleForInvoice(saleB.id), fetchTaxRules()]);
  const nfcePayloadB = buildNfcePayloadFromSale(saleBForInvoice, rules);
  check(
    "Payload de NFC-e com cliente traz nome/CPF do destinatário",
    nfcePayloadB.ok && nfcePayloadB.payload.nome_destinatario === bruno.name && nfcePayloadB.payload.cpf_destinatario === bruno.document,
    nfcePayloadB.ok ? `nome=${nfcePayloadB.payload.nome_destinatario}, cpf=${nfcePayloadB.payload.cpf_destinatario}` : JSON.stringify(nfcePayloadB.errors),
  );
  check(
    "consumidor_final=1 e presenca_comprador=1 mesmo com cliente identificado",
    nfcePayloadB.ok && nfcePayloadB.payload.consumidor_final === 1 && nfcePayloadB.payload.presenca_comprador === 1,
  );
  check(
    "formas_pagamento presente (obrigatório na NFC-e) com o PIX da venda",
    nfcePayloadB.ok && nfcePayloadB.payload.formas_pagamento?.[0]?.forma_pagamento === "17",
    nfcePayloadB.ok ? JSON.stringify(nfcePayloadB.payload.formas_pagamento) : "",
  );

  const outcomeB = await emitFiscalDocumentForSale(saleB.id, branchId);
  check("emitFiscalDocumentForSale autoriza NFC-e com cliente identificado", outcomeB.ok, JSON.stringify(outcomeB));

  const { data: docB } = await supabase.from("fiscal_documents").select("*").eq("sale_id", saleB.id).eq("model", "nfce").single();
  check("Segunda NFC-e incrementa a numeração (2)", docB?.numero === "2", `numero=${docB?.numero}`);

  /* ---- 3. venda com produto sem grupo tributário: não bloqueia, não grava nota ---- */

  const saleC = await createPosSale({
    branchId,
    contactId: null,
    sellerId,
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ productId: cafe.id, quantity: 1, unitPrice: cafe.sale_price }],
    payments: [{ method: "dinheiro", amount: cafe.sale_price }],
  });
  check("Venda C confirmada mesmo com produto sem grupo tributário (venda não trava)", Boolean(saleC?.id), `venda ${saleC.code}`);

  const outcomeC = await emitFiscalDocumentForSale(saleC.id, branchId);
  check(
    "Emissão da NFC-e falha citando o item, sem lançar exceção",
    !outcomeC.ok && outcomeC.errors.some((e) => e.includes("grupo tributário")),
    JSON.stringify(outcomeC),
  );

  const { data: docC } = await supabase.from("fiscal_documents").select("id").eq("sale_id", saleC.id);
  check("Nenhuma linha gravada em fiscal_documents para a venda recusada", (docC?.length ?? 0) === 0, `linhas=${docC?.length}`);

  /* ---- 4. NF-e comum logo depois: numeração não afetada pela NFC-e ---- */

  const nfePayloadB = buildNfePayloadFromSale(saleBForInvoice, rules);
  check("Payload de NF-e para a mesma venda B monta com sucesso (cliente já identificado)", nfePayloadB.ok, nfePayloadB.ok ? "" : JSON.stringify(nfePayloadB.errors));

  const provider = getFiscalProvider();
  const nfeRef = `venda-${saleB.id}-nfe-check`;
  const nfeDoc = nfePayloadB.ok ? await provider.emit({ ref: nfeRef, model: "nfe", payload: nfePayloadB.payload }) : null;
  check("NF-e autorizada para a mesma venda que já tinha NFC-e", nfeDoc?.status === "autorizado", `status=${nfeDoc?.status}`);
  check(
    "Numeração da NF-e começa na própria série (1), não continua a da NFC-e (que já ia em 2)",
    nfeDoc?.numero === "1",
    `nfe numero=${nfeDoc?.numero} — nfce da mesma venda estava em ${docB?.numero}`,
  );

  /* ---- 5. Notas Emitidas: os dois modelos juntos, sem esconder nenhum ---- */

  const invoiceRows = await fetchInvoiceSales(branchId);
  const rowA = invoiceRows.find((r) => r.saleId === saleA.id);
  const rowC = invoiceRows.find((r) => r.saleId === saleC.id);
  check("Notas Emitidas lista a venda A com o documento NFC-e (não escondido)", rowA?.document?.model === "nfce", JSON.stringify(rowA?.document?.model));
  check("Notas Emitidas lista a venda C sem documento (emissão falhou)", rowC?.document === null, JSON.stringify(rowC?.document));

  await closeCashSession({ sessionId, countedAmount: 100 + Number(doritos.sale_price) + Number(cafe.sale_price) });
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
