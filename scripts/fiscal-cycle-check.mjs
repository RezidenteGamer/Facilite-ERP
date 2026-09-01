/**
 * Prova de que o contrato `FiscalProvider` se sustenta — emitir → consultar →
 * cancelar → consultar de novo — sem construir nenhum dos módulos que vão
 * consumi-lo (Notas Emitidas, NFC-e, Devolução).
 *
 * Rode com:  node scripts/fiscal-cycle-check.mjs
 *
 * ## Por que passa pelo Vite em vez de rodar direto no Node
 *
 * O Node 24 executa TypeScript direto, mas o resolvedor ESM dele exige extensão
 * explícita nos imports (`./types.ts`), e o projeto inteiro importa sem extensão.
 * Carregar os módulos pelo `ssrLoadModule` do Vite resolve exatamente como o app
 * resolve — então o que este script exercita é **o mesmo grafo de módulos que o
 * navegador carrega**, e não uma cópia adaptada. De quebra, `import.meta.env`
 * fica populado a partir do `.env.local`, que é como o ponto único de
 * configuração (`VITE_FISCAL_PROVIDER`) e o cliente Supabase leem config.
 *
 * ## Por que o mapeamento venda → payload mora aqui, e não em `src/`
 *
 * Montar o payload a partir de uma venda de verdade é responsabilidade do módulo
 * Notas Emitidas (etapa 8), com os valores de imposto que o módulo Tributações
 * (etapa 7) calcula. Nenhum dos dois existe. O mapeamento abaixo é deliberadamente
 * um mapeamento **de teste**: serve para provar que os dados que já estão no banco
 * cabem no payload modelado, e para mostrar exatamente quais campos fiscais ainda
 * faltam. Ele não deve virar código de produção — quando a etapa 8 chegar, o
 * mapeamento nasce lá, tipado, e este script continua sendo só o teste do ciclo.
 */

import { createServer } from "vite";

import { requireTestAccount } from "./testAccount.mjs";

const TEST_ACCOUNT = requireTestAccount();

/* ---------------------------------------------------------------- asserções */

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok, detail });
  const mark = ok ? "  ok  " : " FALHA";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------- mapeamento de teste */

/**
 * `contacts.indicador_ie` é texto livre no cadastro ("Não Contribuinte"), mas o
 * payload quer o código da SEFAZ (1, 2 ou 9). Achado real desta etapa — ver
 * AGENTS.md.
 */
function mapIndicadorIe(texto) {
  const t = (texto ?? "").toLowerCase();
  if (t.includes("não contribuinte") || t.includes("nao contribuinte")) return 9;
  if (t.includes("isento")) return 2;
  if (t.includes("contribuinte")) return 1;
  return 9;
}

/** `branches.regime_tributario` guarda o código CRT como texto. */
function mapRegimeTributario(texto) {
  const n = Number.parseInt(texto ?? "", 10);
  return Number.isFinite(n) ? n : undefined;
}

function isCnpj(documento) {
  return (documento ?? "").replace(/\D/g, "").length === 14;
}

/**
 * @param sale linha de `sales` com `branch`, `contact` e `items` (com `product`)
 * @param fillGaps quando `true`, preenche com marcadores os campos fiscais que o
 *   banco ainda não tem — para o ciclo feliz rodar antes de Tributações existir.
 */
function buildPayloadFromSale(sale, fillGaps) {
  const branch = sale.branch;
  const contact = sale.contact;
  const documento = (contact?.document ?? "").replace(/\D/g, "");

  const items = sale.items.map((item, index) => {
    const product = item.product;
    return {
      numero_item: index + 1,
      codigo_produto: product.code,
      descricao: product.description,
      cfop: item.cfop ?? (fillGaps ? "5102" : ""),
      codigo_ncm: product.ncm ?? (fillGaps ? "19059090" : ""),
      codigo_cest: product.cest ?? undefined,
      quantidade_comercial: Number(item.quantity),
      valor_unitario_comercial: Number(item.unit_price),
      valor_bruto: Number(item.total_amount),
      unidade_comercial: product.unidade_comercial ?? (fillGaps ? "UN" : undefined),
      unidade_tributavel: product.unidade_tributavel ?? undefined,
      valor_desconto: Number(item.discount_amount) || undefined,
      inclui_no_total: 1,
      icms_origem: product.origem_mercadoria ?? (fillGaps ? "0" : ""),
      icms_situacao_tributaria:
        product.cst_icms ?? product.csosn ?? (fillGaps ? "00" : ""),
      pis_situacao_tributaria: product.cst_pis ?? undefined,
      cofins_situacao_tributaria: product.cst_cofins ?? undefined,
      ipi_situacao_tributaria: product.cst_ipi ?? undefined,
      // Valores de imposto (icms_valor, pis_valor, ...) ficam de fora de
      // propósito: quem os calcula é Tributações (etapa 7).
    };
  });

  return {
    natureza_operacao: "Venda de mercadoria",
    data_emissao: new Date(`${sale.issue_date}T12:00:00-03:00`).toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    local_destino: 1,

    cnpj_emitente: branch.cnpj,
    nome_emitente: branch.name,
    inscricao_estadual_emitente: branch.inscricao_estadual ?? undefined,
    regime_tributario_emitente: mapRegimeTributario(branch.regime_tributario),
    uf_emitente: fillGaps ? "SP" : undefined,

    nome_destinatario: contact?.name ?? undefined,
    cnpj_destinatario: contact && isCnpj(documento) ? documento : undefined,
    cpf_destinatario: contact && !isCnpj(documento) && documento ? documento : undefined,
    inscricao_estadual_destinatario: contact?.inscricao_estadual ?? undefined,
    indicador_inscricao_estadual_destinatario: contact
      ? mapIndicadorIe(contact.indicador_ie)
      : undefined,

    valor_produtos: Number(sale.subtotal_amount),
    valor_total: Number(sale.total_amount),
    valor_desconto: Number(sale.discount_amount) || undefined,
    valor_frete: Number(sale.freight_amount) || undefined,
    modalidade_frete: 9,

    items,
    informacoes_adicionais_contribuinte: `Venda ${sale.code} — documento simulado, sem valor fiscal.`,
  };
}

/* --------------------------------------------------------------------- run */

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

let exitCode = 0;

try {
  const { getFiscalProvider } = await server.ssrLoadModule("/src/lib/fiscal/provider.ts");
  const { isValidAccessKey } = await server.ssrLoadModule("/src/lib/fiscal/accessKey.ts");
  const { supabase } = await server.ssrLoadModule("/src/lib/supabaseClient.ts");

  if (!supabase) throw new Error("Supabase não configurado — confira o .env.local.");

  /* ---- 1. dado real do banco de teste ---- */

  const auth = await supabase.auth.signInWithPassword(TEST_ACCOUNT);
  if (auth.error) throw auth.error;
  check("Login com a conta de testes", true, TEST_ACCOUNT.email);

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select(
      "*, branch:branches(*), contact:contacts(*), items:sale_items(*, product:products(*))",
    )
    .eq("status", "confirmed")
    .not("contact_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (salesError) throw salesError;

  const sale = sales?.[0];
  if (!sale) throw new Error("Nenhuma venda confirmada com cliente no banco de teste.");
  check(
    "Venda real carregada do banco",
    sale.items.length > 0,
    `venda ${sale.code}, ${sale.items.length} item(ns), total R$ ${sale.total_amount}`,
  );

  const provider = getFiscalProvider();
  check("Provedor ativo resolvido pelo ponto único de configuração", provider.id === "simulado", `id="${provider.id}"`);

  /* ---- 2. caminho de recusa: payload com os buracos que o banco ainda tem ---- */

  const refRecusa = `check-recusa-${sale.id}`;
  const recusado = await provider.emit({
    ref: refRecusa,
    model: "nfe",
    payload: buildPayloadFromSale(sale, false),
  });
  check(
    "emit() recusa payload incompleto sem lançar exceção",
    recusado.status === "erro_autorizacao" && recusado.chave === null,
    `status=${recusado.status}`,
  );
  console.log(`         motivo: ${recusado.mensagemSefaz}`);

  /* ---- 3. ciclo feliz: emitir ---- */

  const ref = `check-${sale.id}`;
  const payload = buildPayloadFromSale(sale, true);
  const emitido = await provider.emit({ ref, model: "nfe", payload });

  check("emit() autoriza", emitido.status === "autorizado", `status=${emitido.status}`);
  check(
    "emit() devolve chave de 44 dígitos com DV válido",
    emitido.chave !== null && isValidAccessKey(emitido.chave),
    emitido.chave ?? "sem chave",
  );
  check(
    "Chave carrega o CNPJ da filial nas posições 7-20",
    emitido.chave?.slice(6, 20) === sale.branch.cnpj.replace(/\D/g, ""),
    `${emitido.chave?.slice(6, 20)} = ${sale.branch.cnpj}`,
  );
  check("emit() devolve protocolo", Boolean(emitido.protocolo), emitido.protocolo ?? "");
  check(
    "emit() devolve XML gerado localmente",
    emitido.xml?.content?.includes(`<chNFe>${emitido.chave}</chNFe>`) === true,
    `${emitido.xml?.content?.length ?? 0} caracteres, contentType=${emitido.xml?.contentType}`,
  );
  check(
    "emit() devolve DANFE para exibir/baixar",
    emitido.pdf?.content?.includes(emitido.chave?.slice(0, 4) ?? "###") === true,
    `${emitido.pdf?.content?.length ?? 0} caracteres, contentType=${emitido.pdf?.contentType}`,
  );
  check(
    "XML traz os itens da venda real",
    payload.items.every((item) => emitido.xml?.content?.includes(item.descricao)),
    payload.items.map((i) => i.descricao).join(", "),
  );

  /* ---- 4. consultar ---- */

  const consultado = await provider.query(ref);
  check(
    "query() devolve a nota autorizada",
    consultado.status === "autorizado" && consultado.chave === emitido.chave,
    `status=${consultado.status}`,
  );

  const inexistente = await provider.query("ref-que-nunca-existiu");
  check(
    "query() de ref inexistente devolve nao_encontrado",
    inexistente.status === "nao_encontrado",
    `status=${inexistente.status}`,
  );

  /* ---- 5. cancelar ---- */

  const semJustificativa = await provider.cancel({ ref, justificativa: "erro" });
  check(
    "cancel() recusa justificativa com menos de 15 caracteres",
    semJustificativa.status === "erro_cancelamento",
    semJustificativa.mensagemSefaz ?? "",
  );

  const cancelarInexistente = await provider.cancel({
    ref: "ref-que-nunca-existiu",
    justificativa: "Cancelamento de documento que nunca foi emitido",
  });
  check(
    "cancel() de ref inexistente devolve nao_encontrado",
    cancelarInexistente.status === "nao_encontrado",
    `status=${cancelarInexistente.status}`,
  );

  const justificativa = "Teste do ciclo de emissao fiscal simulada";
  const cancelado = await provider.cancel({ ref, justificativa });
  check("cancel() cancela a nota autorizada", cancelado.status === "cancelado", `status=${cancelado.status}`);
  check(
    "cancel() devolve XML do evento de cancelamento",
    cancelado.xmlCancelamento?.content?.includes("<tpEvento>110111</tpEvento>") === true,
    `${cancelado.xmlCancelamento?.content?.length ?? 0} caracteres`,
  );
  check(
    "XML de cancelamento carrega a justificativa",
    cancelado.xmlCancelamento?.content?.includes(justificativa) === true,
    justificativa,
  );

  const recancelar = await provider.cancel({ ref, justificativa });
  check(
    "cancel() em nota já cancelada devolve erro_cancelamento",
    recancelar.status === "erro_cancelamento" && recancelar.statusSefaz === "573",
    recancelar.mensagemSefaz ?? "",
  );

  /* ---- 6. consultar de novo ---- */

  const depois = await provider.query(ref);
  check(
    "query() depois do cancelamento devolve cancelado",
    depois.status === "cancelado",
    `status=${depois.status}`,
  );
  check(
    "Nota cancelada preserva chave, protocolo e XML original",
    depois.chave === emitido.chave && depois.protocolo === emitido.protocolo && depois.xml !== null,
    `chave=${depois.chave}`,
  );
  check(
    "Nota cancelada carrega o XML do evento",
    depois.xmlCancelamento !== null,
    depois.xmlCancelamento?.contentType ?? "",
  );

  /* ---- 7. idempotência ---- */

  const reemitido = await provider.emit({ ref, model: "nfe", payload });
  check(
    "emit() com ref repetida não emite segunda nota",
    reemitido.chave === emitido.chave && reemitido.status === "cancelado",
    "devolveu o documento existente",
  );

  await supabase.auth.signOut();
} catch (error) {
  exitCode = 1;
  console.error("\nErro no teste do ciclo:", error);
} finally {
  await server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} verificações passaram.` +
    (failed.length ? ` Falhas: ${failed.map((f) => f.label).join("; ")}` : ""),
);
process.exit(failed.length > 0 ? 1 : exitCode);
