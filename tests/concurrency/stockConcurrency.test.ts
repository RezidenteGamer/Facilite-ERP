import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * C4 — teste automatizado de concorrência na baixa de estoque.
 *
 * A auditoria do banco (ver AGENTS.md, "O que a auditoria do banco encontrou")
 * confirmou direto no catálogo do Postgres que as seis funções que escrevem em
 * `products.stock` (`create_sale`, `create_pos_sale`, `create_purchase`,
 * `create_sale_return`, `create_conditional`, `adjust_stock_batch`) já fazem
 * `select ... from products where id = ... for update` antes de calcular o
 * saldo — a trava existe. O que faltava era o teste que prova isso e que
 * quebra o build se alguém remover a trava no futuro.
 *
 * A bateria cria (ou reaproveita) um produto de teste com estoque em
 * exatamente 1 e dispara duas `create_sale` simultâneas comprando 1 unidade
 * cada. Sem o `for update`, as duas leriam `stock = 1` antes de qualquer uma
 * escrever, e as duas passariam — vendendo a mesma unidade duas vezes e
 * deixando o estoque em -1. Com a trava, a segunda só lê a linha depois que a
 * primeira libera o lock com o `stock` já decrementado, e vê saldo
 * insuficiente.
 *
 * Roda contra o Supabase real de propósito, como `tests/isolation`: o que
 * está sendo testado é o comportamento da trava no banco, não uma simulação
 * dela.
 */

const PRODUCT_MARKER = "TESTE-CONCORRENCIA-";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `A bateria de concorrência precisa de ${name} em .env.local.\n` +
        "Ver tests/concurrency/README.md para o preparo.",
    );
  }
  return value;
}

let client: SupabaseClient;
let branchId: string;
let sellerId: string;
let productId: string;
let salePrice: number;

beforeAll(async () => {
  const url = requireEnv("VITE_SUPABASE_URL");
  const anonKey = requireEnv("VITE_SUPABASE_ANON_KEY");
  const email = requireEnv("FACILITE_TEST_EMAIL");
  const password = requireEnv("FACILITE_TEST_PASSWORD");

  // Cliente próprio com `persistSession: false`, mesmo motivo de
  // tests/isolation/fixtures.ts: evitar qualquer storage compartilhado de
  // sessão entre execuções.
  client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
  if (authError || !auth.user) {
    throw new Error(`Não consegui autenticar a conta de teste (${email}): ${authError?.message ?? "sem usuário"}`);
  }
  sellerId = auth.user.id;

  const { data: links, error: linksError } = await client
    .from("user_branches")
    .select("branch_id")
    .eq("user_id", auth.user.id)
    .limit(1);
  if (linksError) {
    throw new Error(`Não consegui ler as filiais da conta de teste: ${linksError.message}`);
  }
  if (!links || links.length === 0) {
    throw new Error(
      `A conta de teste (${email}) precisa estar vinculada a ao menos uma filial (\`user_branches\`) ` +
        "para a bateria de concorrência rodar.",
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
    throw new Error(`Não consegui procurar o produto de teste da bateria de concorrência: ${findError.message}`);
  }

  if (existing) {
    productId = existing.id as string;
    // Arredondado a 2 casas: create_sale confere pagamentos contra o total em
    // `round(..., 2)`, e um `sale_price` reaproveitado de outra execução podia
    // ter mais casas decimais que o round-trip por JSON preserva com exatidão.
    salePrice = Math.round(Number(existing.sale_price) * 100) / 100;
  } else {
    const { data: created, error: createError } = await client
      .from("products")
      .insert({
        branch_id: branchId,
        code: `TESTE-CONC-${Date.now()}`,
        description: `${PRODUCT_MARKER}${Date.now()}`,
        sale_price: 10,
      })
      .select("id, sale_price")
      .single();
    if (createError || !created) {
      throw new Error(
        `Não consegui criar o produto de teste da bateria de concorrência: ${createError?.message ?? "sem retorno"}`,
      );
    }
    productId = created.id as string;
    salePrice = Math.round(Number(created.sale_price) * 100) / 100;
  }

  // Estoque em exatamente 1, sempre — tanto num produto recém-criado quanto
  // num reaproveitado de uma execução anterior (ver README, produto não é
  // apagável depois da primeira venda real).
  // `.select().single()` de propósito: um UPDATE que a RLS barra silenciosamente
  // não afeta linha nenhuma e não devolve erro — sem conferir o retorno, o
  // teste seguiria achando que o estoque está em 1 sem ter mudado nada.
  const { data: reset, error: stockError } = await client
    .from("products")
    .update({ stock: 1 })
    .eq("id", productId)
    .select("stock")
    .single();
  if (stockError || !reset) {
    throw new Error(`Não consegui colocar o estoque do produto de teste em 1: ${stockError?.message ?? "update não afetou nenhuma linha"}`);
  }
});

afterAll(async () => {
  if (!client || !productId) return;
  // Best-effort: a venda vencedora do teste grava uma `sale_items` real
  // apontando para este produto, e essa FK não tem cascade — a partir da
  // primeira execução este delete sempre falha e o produto fica para trás de
  // propósito. Ver README.
  await client.from("products").delete().eq("id", productId);
});

describe("baixa de estoque atômica (C4)", () => {
  it("duas create_sale simultâneas do último item em estoque: só uma pode passar", async () => {
    const payload = {
      branch_id: branchId,
      seller_id: sellerId,
      items: [{ product_id: productId, quantity: 1, unit_price: salePrice, discount_amount: 0 }],
      payments: [{ method: "dinheiro", amount: salePrice, installments: 1 }],
    };

    const [first, second] = await Promise.all([
      client.rpc("create_sale", { payload }),
      client.rpc("create_sale", { payload }),
    ]);
    const results = [first, second];

    const successes = results.filter((r) => !r.error);
    const failures = results.filter((r) => r.error);

    expect(successes, "exatamente uma das duas create_sale deveria ter passado").toHaveLength(1);
    expect(failures, "exatamente uma das duas create_sale deveria ter sido recusada").toHaveLength(1);
    expect(successes[0].data).toHaveProperty("id");
    // O id do produto varia a cada execução — não faz parte do que a bateria afirma.
    expect(failures[0].error?.message).toMatch(/^Estoque insuficiente para o produto .+\.$/);

    const { data: finalProduct, error: finalError } = await client
      .from("products")
      .select("stock")
      .eq("id", productId)
      .single();
    if (finalError || !finalProduct) {
      throw new Error(`Não consegui conferir o estoque final do produto de teste: ${finalError?.message ?? ""}`);
    }
    expect(Number(finalProduct.stock)).toBe(0);
  });
});
