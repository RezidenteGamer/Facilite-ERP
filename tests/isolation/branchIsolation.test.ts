import { beforeAll, describe, expect, it } from "vitest";
import { BRANCH_SCOPED_TABLES, loadActors, type IsolationActor } from "./fixtures";

/**
 * C1 — teste automatizado de isolamento entre clientes.
 *
 * Revisão manual de RLS não escala e não sobrevive a um deploy apressado. Esta
 * bateria autentica como um usuário da filial A e tenta ler e escrever na
 * filial B, tabela por tabela. **Qualquer sucesso reprova o build.**
 *
 * Ela roda contra o Supabase real de propósito: o que está sendo testado é a
 * policy do banco, não uma imitação dela.
 */

let a: IsolationActor;
let b: IsolationActor;

beforeAll(async () => {
  ({ a, b } = await loadActors());
});

describe("leitura entre filiais", () => {
  it.each(BRANCH_SCOPED_TABLES)("A não enxerga linha nenhuma de %s da filial B", async (table) => {
    const { data, error } = await a.client.from(table).select("id").eq("branch_id", b.branchId);

    // Uma policy pode barrar de dois jeitos legítimos: devolvendo erro, ou
    // devolvendo conjunto vazio (é o normal do RLS de SELECT). O que não pode
    // é vir linha.
    if (error) {
      expect(error.code).toBeDefined();
      return;
    }
    expect(data ?? []).toHaveLength(0);
  });
});

describe("escrita entre filiais", () => {
  it("A não consegue criar produto na filial B", async () => {
    const { data, error } = await a.client
      .from("products")
      .insert({
        branch_id: b.branchId,
        code: `ISO-${Date.now()}`,
        description: "produto de teste de isolamento — não deveria existir",
        sale_price: 1,
      })
      .select("id");

    expect(error, "o banco deixou A criar produto na filial B").not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("A não consegue mover um produto seu para a filial B", async () => {
    const { data: meus } = await a.client
      .from("products")
      .select("id")
      .eq("branch_id", a.branchId)
      .limit(1);

    if (!meus || meus.length === 0) {
      throw new Error(
        `A filial de A (${a.branchId}) não tem nenhum produto — a bateria precisa de ao menos um ` +
          "para testar o update. Ver tests/isolation/README.md.",
      );
    }

    const { error } = await a.client
      .from("products")
      .update({ branch_id: b.branchId })
      .eq("id", meus[0].id);

    const { data: conferencia } = await a.client
      .from("products")
      .select("branch_id")
      .eq("id", meus[0].id)
      .maybeSingle();

    // Ou o update é recusado, ou ele "passa" sem afetar linha (o RLS avalia o
    // WITH CHECK e some com a linha). O que não pode é o produto realmente
    // acabar na filial B.
    expect(
      error !== null || conferencia?.branch_id === a.branchId,
      "um produto de A acabou na filial B",
    ).toBe(true);
  });

  it("A não consegue apagar produto da filial B", async () => {
    const { data: doB } = await b.client
      .from("products")
      .select("id")
      .eq("branch_id", b.branchId)
      .limit(1);

    if (!doB || doB.length === 0) {
      throw new Error(
        `A filial de B (${b.branchId}) não tem nenhum produto — a bateria precisa de ao menos um. ` +
          "Ver tests/isolation/README.md.",
      );
    }

    await a.client.from("products").delete().eq("id", doB[0].id);

    // O DELETE bloqueado por RLS não devolve erro: ele simplesmente não acha
    // linha para apagar. Quem responde de verdade é B, conferindo se o produto
    // dele continua lá.
    const { data: aindaExiste } = await b.client
      .from("products")
      .select("id")
      .eq("id", doB[0].id)
      .maybeSingle();

    expect(aindaExiste?.id, "A apagou um produto da filial B").toBe(doB[0].id);
  });
});

describe("RPC entre filiais", () => {
  it("A não consegue ajustar estoque da filial B", async () => {
    const { data: doB } = await b.client
      .from("products")
      .select("id")
      .eq("branch_id", b.branchId)
      .limit(1);
    if (!doB || doB.length === 0) throw new Error("A filial de B precisa de ao menos um produto.");

    const { error } = await a.client.rpc("adjust_stock_batch", {
      p_branch_id: b.branchId,
      p_items: [{ product_id: doB[0].id, change: 999, reason: "teste de isolamento" }],
    });

    expect(error, "adjust_stock_batch deixou A mexer no estoque da filial B").not.toBeNull();
  });

  it("has_branch_access diz não para a filial do outro", async () => {
    const { data, error } = await a.client.rpc("has_branch_access", { p_branch_id: b.branchId });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

describe("escalação de papel", () => {
  it("A não consegue trocar o próprio papel", async () => {
    const { data: perfil } = await a.client
      .from("profiles")
      .select("role_id")
      .eq("id", a.userId)
      .maybeSingle();

    const { data: outroPapel } = await a.client
      .from("roles")
      .select("id")
      .neq("id", perfil?.role_id ?? "")
      .limit(1);

    if (!outroPapel || outroPapel.length === 0) {
      throw new Error("Preciso de ao menos dois papéis cadastrados para testar escalação.");
    }

    await a.client.from("profiles").update({ role_id: outroPapel[0].id }).eq("id", a.userId);

    const { data: depois } = await a.client
      .from("profiles")
      .select("role_id")
      .eq("id", a.userId)
      .maybeSingle();

    expect(depois?.role_id, "A conseguiu trocar o próprio papel").toBe(perfil?.role_id);
  });
});
