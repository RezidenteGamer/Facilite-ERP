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

/**
 * D1 (09/09/2026) — o cadastro de filiais ganhou tela
 * (`/configuracoes/filiais`), e com ela a primeira forma de criar e editar
 * `branches` que não é `insert` manual de administrador.
 *
 * `branches` é a tabela que **ancora** todas as outras deste arquivo: é
 * `has_branch_access(branch_id)` que decide o que cada operador enxerga nas 12
 * tabelas acima. Uma tela que deixasse alguém sem `can_manage_branches` criar
 * filial, ou renomear a filial de outro, não vazaria um produto — vazaria o
 * eixo de isolamento inteiro.
 *
 * A e B **não têm** as flags globais (o preparo da bateria exige isso, e
 * `can_manage_branches` em especial — ver o README), então tudo aqui é o lado
 * negativo: o que a RLS tem de recusar. O lado positivo (quem **tem** a flag
 * consegue) não cabe nesta bateria, que só conhece dois atores sem flag
 * nenhuma; ele está coberto pelos testes de formulário em
 * `tests/unit/branchForm.test.ts` e pelo uso real da tela.
 */
describe("cadastro de filiais (D1)", () => {
  it("A não tem can_manage_branches — a premissa do resto deste bloco", async () => {
    const { data, error } = await a.client.rpc("can_manage_branches");
    expect(error).toBeNull();
    expect(
      data,
      "a conta A tem can_manage_branches; a bateria não provaria nada assim — ver tests/isolation/README.md",
    ).toBe(false);
  });

  it("A enxerga só a própria filial, nunca a de B", async () => {
    const { data, error } = await a.client.from("branches").select("id");
    expect(error).toBeNull();

    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(a.branchId);
    expect(ids, "A enxergou a filial de B na listagem de filiais").not.toContain(b.branchId);
  });

  it("A não consegue criar filial", async () => {
    const { data, error } = await a.client
      .from("branches")
      .insert({ code: `ISO-${Date.now()}`, name: "filial de teste de isolamento — não deveria existir" })
      .select("id");

    // O erro do `insert` é a prova inteira, e é por uma limitação real: nenhum
    // dos dois atores desta bateria conseguiria **ver** a filial fantasma se
    // ela nascesse (A não teria vínculo em `user_branches` com ela, B muito
    // menos), então uma consulta de conferência aqui voltaria vazia mesmo com o
    // insert tendo passado — pareceria corroboração e não seria nenhuma.
    // Confirmar a ausência exigiria uma conta com `can_manage_branches`, que
    // esta bateria não tem de propósito.
    expect(error, "o banco deixou A criar uma filial").not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("A não consegue editar a própria filial", async () => {
    const { data: antes } = await a.client
      .from("branches")
      .select("name")
      .eq("id", a.branchId)
      .maybeSingle();

    await a.client.from("branches").update({ name: "renomeada sem permissão" }).eq("id", a.branchId);

    const { data: depois } = await a.client
      .from("branches")
      .select("name")
      .eq("id", a.branchId)
      .maybeSingle();

    // Ver a própria filial (has_branch_access) não é o mesmo que poder mudá-la
    // (can_manage_branches) — é a distinção que a tela de D1 desabilita no
    // botão e que o banco tem de impor de verdade.
    expect(depois?.name, "A renomeou a própria filial sem can_manage_branches").toBe(antes?.name);
  });

  it("A não consegue editar a filial de B", async () => {
    const { data: antes } = await b.client
      .from("branches")
      .select("name, code")
      .eq("id", b.branchId)
      .maybeSingle();

    await a.client
      .from("branches")
      .update({ name: "sequestrada pela filial A" })
      .eq("id", b.branchId);

    const { data: depois } = await b.client
      .from("branches")
      .select("name, code")
      .eq("id", b.branchId)
      .maybeSingle();

    expect(depois?.name, "A renomeou a filial de B").toBe(antes?.name);
  });

  it("A não consegue apagar a filial de B", async () => {
    await a.client.from("branches").delete().eq("id", b.branchId);

    const { data: aindaExiste } = await b.client
      .from("branches")
      .select("id")
      .eq("id", b.branchId)
      .maybeSingle();

    expect(aindaExiste?.id, "A apagou a filial de B").toBe(b.branchId);
  });

  it("A não consegue se vincular à filial de B por user_branches", async () => {
    const { error } = await a.client
      .from("user_branches")
      .insert({ user_id: a.userId, branch_id: b.branchId });

    expect(error, "A conseguiu se dar acesso à filial de B").not.toBeNull();

    const { data } = await a.client.rpc("has_branch_access", { p_branch_id: b.branchId });
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
