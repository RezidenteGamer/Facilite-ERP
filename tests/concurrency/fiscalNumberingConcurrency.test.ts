import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { SERIE_SIMULADA } from "@fiscal-core/simulatedFiscalProvider.ts";

/**
 * A10 — teste de concorrência na **numeração** fiscal (09/09/2026).
 *
 * Dispara três emissões simultâneas de **vendas diferentes** na mesma filial e
 * modelo, e afirma que elas saem com números **distintos e sequenciais**.
 *
 * ## Em que ela difere da bateria de A5
 *
 * São duas corridas diferentes, e é por isso que são duas baterias:
 *
 * - **A5 (`fiscalEmitConcurrency.test.ts`)** — duas emissões da **mesma** venda.
 *   O certo ali é que só **uma** nota exista: mesma `ref`, um vencedor.
 * - **A10 (esta)** — três emissões de **vendas diferentes**. O certo aqui é que
 *   **todas** passem, cada uma com o **seu** número. "Quem chega primeiro ganha"
 *   seria a resposta errada.
 *
 * Antes de A10, `handleEmit` lia `readLastNumero` — um `select max()` na coluna
 * `numero`, sem trava nenhuma — e semeava com esse máximo uma instância nova do
 * provedor simulado por requisição. As três liam o mesmo máximo, cada uma somava
 * 1 dentro do próprio processo, e as três gravavam **o mesmo número**. Como cada
 * uma tem `ref` própria, a reserva de A5 não impedia nada: ela protege a
 * identidade da emissão, não a sequência.
 *
 * A correção é `public.fiscal_numbering_next` (migration
 * `00000000000013_a10_numeracao_fiscal_atomica.sql`): `insert ... on conflict
 * do update set ultimo_numero = ultimo_numero + 1 returning`, que o Postgres
 * serializa sozinho na linha da sequência.
 *
 * ## Ela testa o que está implantado e aplicado, não o repositório
 *
 * Como a de A5, e por dois motivos agora: `fiscal-emit` roda no Supabase, e a
 * função `fiscal_numbering_next` só existe se a migration tiver sido aplicada.
 * Contra um ambiente sem uma das duas coisas ela **falha**, e a falha é
 * verdadeira:
 *
 * - sem a migration, a emissão devolve erro do RPC ausente;
 * - com a migration e sem o deploy, as três notas saem com o mesmo número — que
 *   é exatamente a corrida que esta bateria existe para reprovar.
 *
 * Ver `tests/concurrency/README.md` para o preparo e o rastro que ela deixa.
 */

const PRODUCT_MARKER = "TESTE-CONCORRENCIA-NUMERACAO-";
/** Quantas emissões simultâneas. Três já distingue "distintos" de "sequenciais". */
const EMISSOES = 3;
const MODEL = "nfe" as const;
/**
 * O provedor simulado é **sempre** homologação (`resolveAmbiente` força isso), e
 * o ambiente faz parte da chave da sequência — por isso ele entra no filtro da
 * linha de base, e não é suposição.
 */
const AMBIENTE = "homologacao";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `A bateria de concorrência da numeração fiscal precisa de ${name} em .env.local.\n` +
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
    throw new Error(`Não consegui procurar o produto de teste da numeração: ${findError.message}`);
  }

  if (existing) {
    productId = existing.id as string;
    salePrice = Math.round(Number(existing.sale_price) * 100) / 100;
  } else {
    const { data: grupo } = await client.from("tax_groups").select("id").limit(1).maybeSingle();

    const { data: created, error: createError } = await client
      .from("products")
      .insert({
        branch_id: branchId,
        code: `TESTE-CONC-NUM-${Date.now()}`,
        description: `${PRODUCT_MARKER}${Date.now()}`,
        sale_price: 10,
        ncm: "19059090",
        tax_group_id: grupo?.id ?? null,
      })
      .select("id, sale_price")
      .single();
    if (createError || !created) {
      throw new Error(
        `Não consegui criar o produto de teste da numeração: ${createError?.message ?? "sem retorno"}`,
      );
    }
    productId = created.id as string;
    salePrice = Math.round(Number(created.sale_price) * 100) / 100;
  }

  // Estoque folgado: quem testa estoque é C4, e uma venda recusada por saldo não
  // chegaria à emissão.
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
    body: JSON.stringify({ action: "emit", branchId, saleId, model: MODEL }),
  });
  return { status: response.status, body: (await response.json()) as EmitResponse["body"] };
}

/**
 * O maior número já gravado nesta filial, modelo, série e ambiente — uma **cota
 * inferior** do contador, não o valor dele.
 *
 * Não dá para ler `fiscal_numbering` daqui: a tabela nasce com RLS ligada e
 * **nenhuma policy** (ver a seção 4 da migration de A10), e este teste fala com
 * o banco como usuário autenticado, não como `service_role`. Sobra deduzir do
 * que está gravado.
 *
 * E é só uma cota inferior mesmo, por dois motivos que **não** são defeito:
 * a sequência é por CNPJ (esta filial é um subconjunto dele), e um número
 * alocado numa emissão que falhou fica queimado — o contador anda, o
 * `fiscal_documents` não. Por isso a asserção final compara os três números
 * entre si e contra este piso, nunca contra uma faixa exata calculada daqui.
 *
 * O máximo sai em JavaScript, e não de um `max()` no banco: a coluna é `text`
 * (o provedor real devolve string), e em `text` "9" ordena acima de "10" — a
 * mesma pegadinha que o `readLastNumero` de A1 documentava.
 */
async function maiorNumeroAtual(): Promise<number> {
  const { data, error } = await client
    .from("fiscal_documents")
    .select("numero")
    .eq("branch_id", branchId)
    .eq("model", MODEL)
    .eq("ambiente", AMBIENTE)
    .eq("serie", String(SERIE_SIMULADA))
    .not("numero", "is", null);
  if (error) throw new Error(`Não consegui ler a numeração atual: ${error.message}`);

  let maior = 0;
  for (const row of (data ?? []) as { numero: string | null }[]) {
    const numero = Number(row.numero);
    if (Number.isInteger(numero) && numero > maior) maior = numero;
  }
  return maior;
}

describe("numeração fiscal atômica por CNPJ + modelo + série (A10)", () => {
  it("três emissões simultâneas de vendas diferentes saem com números distintos e sequenciais", async () => {
    const base = await maiorNumeroAtual();

    // As vendas são criadas **antes** da corrida, e sequencialmente: o que esta
    // bateria mede é a concorrência da emissão, não a de `create_sale` (essa é
    // C4). Emitir a partir de vendas já prontas deixa as três requisições
    // saírem juntas de verdade.
    const vendas: string[] = [];
    for (let i = 0; i < EMISSOES; i += 1) vendas.push(await criarVenda());

    const respostas = await Promise.all(vendas.map((saleId) => emitir(saleId)));

    for (const resposta of respostas) {
      expect(
        resposta.status,
        `fiscal-emit respondeu HTTP ${resposta.status}: ${resposta.body.error ?? resposta.body.message ?? ""}`,
      ).toBe(200);
    }

    // Todas têm de passar. Uma recusa aqui não é "perdeu a corrida" (elas são
    // vendas diferentes, não há corrida de `ref` nenhuma) — é cadastro fiscal
    // faltando, ou a migration de A10 não aplicada, e nos dois casos as
    // asserções seguintes não significariam nada.
    const recusadas = respostas.filter((r) => !r.body.ok);
    expect(
      recusadas.length,
      "alguma emissão não foi autorizada. Ou a filial/produto de teste não têm cadastro fiscal " +
        "suficiente (CNPJ e endereço na filial, NCM e grupo tributário no produto), ou a migration " +
        `de A10 não foi aplicada (fiscal_numbering_next ausente). Retorno: ${JSON.stringify(
          recusadas.map((r) => r.body.errors ?? r.body.error),
        )}`,
    ).toBe(0);

    const { data: documentos, error: documentosError } = await client
      .from("fiscal_documents")
      .select("ref, numero, serie, status")
      .in(
        "ref",
        vendas.map((saleId) => `venda-${saleId}`),
      );
    if (documentosError) {
      throw new Error(`Não consegui ler as notas gravadas: ${documentosError.message}`);
    }
    expect(documentos ?? []).toHaveLength(EMISSOES);

    const numeros = (documentos ?? []).map((d) => Number(d.numero));
    for (const numero of numeros) {
      expect(Number.isInteger(numero) && numero > 0, `número inválido gravado: ${numeros.join(", ")}`).toBe(
        true,
      );
    }

    // **O coração da bateria.** Antes de A10 as três liam o mesmo
    // `readLastNumero` e gravavam o mesmo número — este `Set` teria tamanho 1.
    expect(
      new Set(numeros).size,
      `duas ou mais emissões concorrentes receberam o mesmo número: ${numeros.join(", ")}`,
    ).toBe(EMISSOES);

    // Nenhum deles pode reusar um número que já está gravado: é o que a semente
    // da migration existe para garantir (o contador nasce sabendo o maior número
    // já emitido, em vez de começar do zero e colidir).
    expect(
      Math.min(...numeros) > base,
      `alguma emissão recebeu um número que já existe: ${numeros.join(", ")} contra o maior já ` +
        `gravado (${base}). O contador de fiscal_numbering nasceu abaixo do que fiscal_documents já tem.`,
    ).toBe(true);

    // **E sequenciais**: três números distintos podiam, em tese, ser 5, 40 e 900
    // — o que significaria contador pulando. Entre si eles têm de ser
    // consecutivos.
    //
    // A comparação é `max - min`, e **não** uma faixa exata a partir de `base`:
    // um número queimado por uma emissão que falhou (o comportamento correto,
    // ver a migration) desloca o contador para além do maior número gravado
    // **para sempre**, e uma faixa exata passaria a reprovar uma numeração
    // certa. O que importa aqui é que os três saíram em sequência.
    expect(
      Math.max(...numeros) - Math.min(...numeros),
      `os três números não são consecutivos: ${[...numeros].sort((a, b) => a - b).join(", ")}. ` +
        "Se outra emissão da mesma filial e modelo (outra execução desta bateria, ou alguém usando o " +
        "sistema) caiu no meio, a sequência se intercala — ver 'Risco aceito' em " +
        "tests/concurrency/README.md.",
    ).toBe(EMISSOES - 1);

    // A série tem de ser a mesma nas três: numeração é por série, e três notas
    // sequenciais em séries diferentes não provariam nada.
    expect(new Set((documentos ?? []).map((d) => d.serie)).size).toBe(1);
  });
});
