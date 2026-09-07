import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * A5 — teste de concorrência na emissão fiscal (07/09/2026).
 *
 * Dispara **duas emissões simultâneas da mesma venda** contra a Edge Function
 * `fiscal-emit` e afirma que só uma nota é emitida.
 *
 * ## O que ela prova
 *
 * Até A5, `handleEmit` lia `fiscal_documents` pela `ref`, montava o payload,
 * chamava o provedor e só então gravava. Entre a leitura e a escrita há
 * trabalho assíncrono de verdade — três consultas de cadastro, a leitura da
 * venda e a chamada ao provedor —, então duas requisições para a mesma venda
 * passavam as duas pela leitura antes de qualquer uma escrever, e as duas
 * emitiam. O estrago tinha duas metades:
 *
 * - o provedor simulado é construído **por requisição** (`createProvider`), e o
 *   `Map` que faz a idempotência dentro de `emit()` nasce vazio nas duas: saem
 *   duas notas com chaves de acesso diferentes (isso está provado sem rede em
 *   `tests/unit/fiscalEmitReservation.test.ts`);
 * - `persistEmission` grava com `upsert(..., { onConflict: "ref" })`, que
 *   **sobrescreve** em vez de falhar: a segunda escrita apagava a chave da
 *   primeira. Se a primeira já estivesse autorizada de verdade, a nota existe
 *   para a SEFAZ e a chave sumia do nosso lado.
 *
 * A correção é a reserva atômica de `reserveEmission` (ver
 * `supabase/functions/fiscal-emit/reservation.ts`). Esta bateria é o que impede
 * a regressão — e o que reprova a versão anterior.
 *
 * ## Roda contra o Supabase real, e contra a função **implantada**
 *
 * Mesmo espírito de `stockConcurrency.test.ts` (C4) e de `tests/isolation`: o
 * que está sendo testado é o comportamento do banco sob concorrência, não uma
 * simulação dele. A diferença importante em relação a C4 é que aqui o código
 * sob teste **não é o do repositório** — é a versão de `fiscal-emit` que está
 * implantada no projeto Supabase. Contra uma implantação anterior a A5 esta
 * bateria falha, e essa falha é exatamente a prova da corrida.
 *
 * Ver `tests/concurrency/README.md` para o preparo e para o rastro que ela
 * deixa no banco.
 */

const PRODUCT_MARKER = "TESTE-CONCORRENCIA-FISCAL-";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `A bateria de concorrência da emissão fiscal precisa de ${name} em .env.local.\n` +
        "Ver tests/concurrency/README.md para o preparo.",
    );
  }
  return value;
}

type EmitResponse = {
  status: number;
  body: {
    ok?: boolean;
    errors?: string[];
    chave?: string | null;
    status?: string;
    error?: string;
    message?: string;
  };
};

let client: SupabaseClient;
let supabaseUrl: string;
let accessToken: string;
let branchId: string;
let sellerId: string;
let productId: string;
let salePrice: number;

beforeAll(async () => {
  supabaseUrl = requireEnv("VITE_SUPABASE_URL");
  const anonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const email = requireEnv("FACILITE_TEST_EMAIL");
  const password = requireEnv("FACILITE_TEST_PASSWORD");

  client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError || !auth.session) {
    throw new Error(
      `Não consegui autenticar a conta de teste (${email}): ${authError?.message ?? "sem sessão"}`,
    );
  }
  sellerId = auth.session.user.id;
  // O mesmo header que `src/lib/repositories/fiscalEmitApi.ts` manda: o JWT da
  // sessão, não a service_role. A função valida permissão pelo chamador.
  accessToken = auth.session.access_token;

  const { data: links, error: linksError } = await client
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", sellerId)
    .limit(1);
  if (linksError) {
    throw new Error(`Não consegui ler as filiais da conta de teste: ${linksError.message}`);
  }
  if (!links || links.length === 0) {
    throw new Error(
      `A conta de teste (${email}) precisa estar vinculada a ao menos uma filial (\`user_branches\`).`,
    );
  }
  branchId = links[0].branch_id as string;

  const { data: existing, error: findError } = await client
    .from("products")
    .select("id, sale_price")
    .eq("branch_id", branchId)
    .ilike("description", `${PRODUCT_MARKER}%`)
    .limit(1)
    .maybeSingle();
  if (findError) {
    throw new Error(`Não consegui procurar o produto de teste da emissão: ${findError.message}`);
  }

  if (existing) {
    productId = existing.id as string;
    salePrice = Math.round(Number(existing.sale_price) * 100) / 100;
  } else {
    // O grupo tributário é o que resolve CST/CSOSN e alíquota do item — sem ele
    // o mapeamento não monta um item válido e a nota sai recusada. `tax_groups`
    // não tem `branch_id` (é catálogo global do sistema), então pega o primeiro
    // que existir; se não existir nenhum, o teste falha adiante com a mensagem
    // do que falta configurar, que é mais útil que falhar aqui.
    const { data: grupo } = await client.from("tax_groups").select("id").limit(1).maybeSingle();

    const { data: created, error: createError } = await client
      .from("products")
      .insert({
        branch_id: branchId,
        code: `TESTE-CONC-FISCAL-${Date.now()}`,
        description: `${PRODUCT_MARKER}${Date.now()}`,
        sale_price: 10,
        ncm: "19059090",
        tax_group_id: grupo?.id ?? null,
      })
      .select("id, sale_price")
      .single();
    if (createError || !created) {
      throw new Error(
        `Não consegui criar o produto de teste da emissão: ${createError?.message ?? "sem retorno"}`,
      );
    }
    productId = created.id as string;
    salePrice = Math.round(Number(created.sale_price) * 100) / 100;
  }

  // Estoque folgado: esta bateria não testa estoque (isso é C4), e uma venda
  // recusada por saldo não chegaria à emissão.
  const { data: reset, error: stockError } = await client
    .from("products")
    .update({ stock: 100 })
    .eq("id", productId)
    .select("stock")
    .single();
  if (stockError || !reset) {
    throw new Error(
      `Não consegui repor o estoque do produto de teste: ${stockError?.message ?? "update não afetou nenhuma linha"}`,
    );
  }
});

/** Uma venda nova por execução — a `ref` da emissão é derivada do id dela. */
async function criarVenda(): Promise<string> {
  const { data, error } = await client.rpc("create_sale", {
    payload: {
      branch_id: branchId,
      seller_id: sellerId,
      items: [{ product_id: productId, quantity: 1, unit_price: salePrice, discount_amount: 0 }],
      payments: [{ method: "dinheiro", amount: salePrice, installments: 1 }],
    },
  });
  if (error || !data?.id) {
    throw new Error(`Não consegui criar a venda de teste: ${error?.message ?? "sem id no retorno"}`);
  }
  return data.id as string;
}

async function emitir(saleId: string): Promise<EmitResponse> {
  const response = await fetch(`${supabaseUrl}/functions/v1/fiscal-emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: "emit", branchId, saleId, model: "nfe" }),
  });
  return { status: response.status, body: (await response.json()) as EmitResponse["body"] };
}

describe("emissão fiscal atômica por venda (A5)", () => {
  it("duas emissões simultâneas da mesma venda: só uma nota é emitida", async () => {
    const saleId = await criarVenda();

    const respostas = await Promise.all([emitir(saleId), emitir(saleId)]);

    // Falha de transporte, JWT ou permissão não é o que esta bateria mede —
    // vale mais dizer isso do que deixar a asserção seguinte falhar por outro
    // motivo.
    for (const resposta of respostas) {
      expect(
        resposta.status,
        `fiscal-emit respondeu HTTP ${resposta.status}: ${resposta.body.error ?? resposta.body.message ?? ""}`,
      ).toBe(200);
    }

    const autorizadas = respostas.filter((r) => r.body.ok);
    expect(
      autorizadas.length,
      "nenhuma das duas emissões foi autorizada — a filial e o produto de teste precisam ter " +
        "cadastro fiscal suficiente (CNPJ e endereço na filial, NCM e grupo tributário no produto). " +
        `Retorno: ${JSON.stringify(respostas.map((r) => r.body.errors))}`,
    ).toBeGreaterThanOrEqual(1);

    // **O coração da bateria.** Antes de A5 as duas emitiam, cada uma com a
    // chave de acesso da sua nota, e o upsert por `ref` guardava só a última.
    const chaves = new Set(autorizadas.map((r) => r.body.chave));
    expect(
      chaves.size,
      `as duas emissões devolveram chaves de acesso diferentes: ${[...chaves].join(" / ")}`,
    ).toBe(1);
    const chave = [...chaves][0];

    // Quem perdeu a corrida (se perdeu) não pode ter devolvido nada além do
    // desfecho do vencedor: ou a mesma chave, ou "em andamento".
    const perdedoras = respostas.filter((r) => !r.body.ok);
    for (const perdedora of perdedoras) {
      expect(perdedora.body.errors?.join(" ")).toMatch(/já está em andamento/);
    }

    const ref = `venda-${saleId}`;
    const { data: documento, error: documentoError } = await client
      .from("fiscal_documents")
      .select("id, status, chave")
      .eq("ref", ref)
      .single();
    if (documentoError || !documento) {
      throw new Error(
        `Não consegui ler a nota gravada para ${ref}: ${documentoError?.message ?? "sem linha"}`,
      );
    }
    expect(documento.status).toBe("autorizado");
    expect(documento.chave, "a nota gravada é de outra emissão que não a devolvida ao chamador").toBe(
      chave,
    );

    // A prova durável no banco: `fiscal_document_events` não tem unicidade
    // nenhuma, então cada emissão que chegou ao provedor deixou um evento de
    // autorização próprio. Duas linhas aqui significam duas notas emitidas.
    const { data: eventos, error: eventosError } = await client
      .from("fiscal_document_events")
      .select("id")
      .eq("fiscal_document_id", documento.id)
      .eq("tipo", "autorizacao");
    if (eventosError) {
      throw new Error(`Não consegui ler os eventos da nota: ${eventosError.message}`);
    }
    expect(
      eventos ?? [],
      "mais de um evento de autorização para a mesma venda: as duas requisições emitiram",
    ).toHaveLength(1);
  });
});
