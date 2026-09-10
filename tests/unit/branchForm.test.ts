import { describe, expect, it } from "vitest";
import { isValidCnpj } from "@fiscal-core/cpfCnpj.ts";
import {
  branchColumnsFromForm,
  branchFiscalWarnings,
  branchFormValuesFrom,
  COLUNA_EMAIL_COPIA_NOTA,
  COLUNA_PIX_KEY,
  EMPTY_BRANCH_FORM,
  formatCep,
  formatCnpj,
  isDuplicateBranchCodeError,
  isMissingColumnError,
  regimeTributarioLabel,
  REGIMES_TRIBUTARIOS_CRT,
  UF_SIGLAS,
  validateBranchForm,
  type BranchAdmin,
  type BranchFormValues,
} from "../../src/features/settings/branches";

/**
 * D1 — validação do formulário de Filiais.
 *
 * A tela é a primeira forma de criar filial que não é `insert` manual, e
 * `branches` é a tabela que ancora `has_branch_access` para as 12 tabelas
 * isoladas por filial. O que entra aqui errado não dá erro na hora: dá
 * rejeição da SEFAZ semanas depois, num CNPJ que ninguém mais lembra de ter
 * digitado.
 *
 * O dígito verificador **não é reimplementado aqui**: quem valida é
 * `isValidCnpj` do núcleo fiscal compartilhado (A9), o mesmo que
 * `payloadValidation.ts` usa antes de despachar para o provedor. Os testes
 * abaixo provam justamente essa amarração — que o formulário aceita e recusa
 * exatamente o que o validador da emissão aceitaria e recusaria.
 */

/** Um formulário mínimo válido, sobre o qual cada teste muda um campo só. */
function form(overrides: Partial<BranchFormValues> = {}): BranchFormValues {
  return { ...EMPTY_BRANCH_FORM, code: "002", name: "Filial Norte", ...overrides };
}

describe("validateBranchForm — obrigatórios", () => {
  it("recusa formulário vazio pedindo código e nome", () => {
    const problems = validateBranchForm(EMPTY_BRANCH_FORM);
    expect(problems).toContain("Informe o código da filial.");
    expect(problems).toContain("Informe o nome da filial.");
  });

  it("não aceita só espaços como código ou nome", () => {
    expect(validateBranchForm(form({ code: "   " }))).toContain("Informe o código da filial.");
    expect(validateBranchForm(form({ name: "  " }))).toContain("Informe o nome da filial.");
  });

  it("aceita o mínimo: código e nome, sem nenhum dado fiscal", () => {
    expect(validateBranchForm(form())).toEqual([]);
  });
});

describe("validateBranchForm — CNPJ (dígito verificador de A9)", () => {
  const validos = ["00.000.000/0001-91", "11.222.333/0001-81"];

  it.each(validos)("aceita %s, formatado", (cnpj) => {
    expect(isValidCnpj(cnpj), "o fixture precisa ser um CNPJ realmente válido").toBe(true);
    expect(validateBranchForm(form({ cnpj }))).toEqual([]);
  });

  it.each(validos)("aceita %s sem pontuação", (cnpj) => {
    const digitos = cnpj.replace(/\D/g, "");
    expect(validateBranchForm(form({ cnpj: digitos }))).toEqual([]);
  });

  it("recusa CNPJ com dígito verificador errado", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(validateBranchForm(form({ cnpj: "11.222.333/0001-82" }))).toContain(
      "CNPJ inválido — confira os dígitos verificadores.",
    );
  });

  it("recusa CNPJ com quantidade errada de dígitos", () => {
    expect(validateBranchForm(form({ cnpj: "11222333" }))).toHaveLength(1);
    expect(validateBranchForm(form({ cnpj: "112223330001811" }))).toHaveLength(1);
  });

  it("recusa a sequência repetida, que passa no módulo 11 mas não é CNPJ", () => {
    expect(validateBranchForm(form({ cnpj: "11.111.111/1111-11" }))).toHaveLength(1);
  });

  it("aceita CNPJ vazio — a filial pode ser criada antes de passar a emitir", () => {
    expect(validateBranchForm(form({ cnpj: "" }))).toEqual([]);
    expect(validateBranchForm(form({ cnpj: "   " }))).toEqual([]);
  });
});

describe("validateBranchForm — CRT", () => {
  it.each(["1", "2", "3", "4"])("aceita o regime %s", (regimeTributario) => {
    expect(validateBranchForm(form({ regimeTributario }))).toEqual([]);
  });

  it("aceita vazio (ainda não cadastrado)", () => {
    expect(validateBranchForm(form({ regimeTributario: "" }))).toEqual([]);
  });

  it.each(["0", "5", "9", "simples"])("recusa o regime %s", (regimeTributario) => {
    expect(validateBranchForm(form({ regimeTributario }))).toContain(
      "Regime tributário (CRT) inválido — os válidos são 1, 2, 3 e 4.",
    );
  });

  it("as opções do formulário são exatamente o vocabulário do validador fiscal", () => {
    const oferecidos = REGIMES_TRIBUTARIOS_CRT.map((item) => item.value).filter(Boolean);
    expect(oferecidos).toEqual(["1", "2", "3", "4"]);
  });
});

describe("validateBranchForm — endereço", () => {
  it("aceita as 27 UFs oferecidas no formulário", () => {
    for (const uf of UF_SIGLAS) {
      expect(validateBranchForm(form({ uf })), `UF ${uf} recusada`).toEqual([]);
    }
    expect(UF_SIGLAS).toHaveLength(27);
  });

  it("recusa UF desconhecida", () => {
    expect(validateBranchForm(form({ uf: "XX" }))).toContain("UF desconhecida: XX.");
  });

  it("exige 8 dígitos no CEP, com ou sem máscara", () => {
    expect(validateBranchForm(form({ cep: "01310-100" }))).toEqual([]);
    expect(validateBranchForm(form({ cep: "01310100" }))).toEqual([]);
    expect(validateBranchForm(form({ cep: "0131010" }))).toContain("CEP precisa ter 8 dígitos.");
  });

  it("exige 7 dígitos no código IBGE do município", () => {
    expect(validateBranchForm(form({ codigoIbgeMunicipio: "3550308" }))).toEqual([]);
    expect(validateBranchForm(form({ codigoIbgeMunicipio: "355030" }))).toContain(
      "Código IBGE do município precisa ter 7 dígitos.",
    );
  });
});

describe("validateBranchForm — CNAE e e-mail", () => {
  it("exige 7 dígitos no CNAE", () => {
    expect(validateBranchForm(form({ cnae: "4711302" }))).toEqual([]);
    expect(validateBranchForm(form({ cnae: "47113" }))).toContain("CNAE fiscal precisa ter 7 dígitos.");
  });

  it("aceita e-mail comum e recusa texto que não é e-mail", () => {
    expect(validateBranchForm(form({ emailCopiaNotaFiscal: "contador@escritorio.com.br" }))).toEqual([]);
    expect(validateBranchForm(form({ emailCopiaNotaFiscal: "contador" }))).toContain(
      "E-mail de cópia da nota inválido.",
    );
    expect(validateBranchForm(form({ emailCopiaNotaFiscal: "a@b" }))).toHaveLength(1);
  });
});

describe("validateBranchForm — vários problemas de uma vez", () => {
  it("lista todos, não só o primeiro", () => {
    const problems = validateBranchForm({
      ...EMPTY_BRANCH_FORM,
      cnpj: "11.222.333/0001-82",
      regimeTributario: "7",
      uf: "ZZ",
      cep: "123",
    });
    expect(problems).toHaveLength(6);
  });
});

/** Uma filial que `validaEmitente` aceitaria por inteiro. */
const FILIAL_COMPLETA: Partial<BranchFormValues> = {
  cnpj: "00.000.000/0001-91",
  regimeTributario: "3",
  inscricaoEstadual: "111.222.333.444",
  logradouro: "Avenida Paulista",
  numero: "1000",
  bairro: "Bela Vista",
  municipio: "São Paulo",
  uf: "SP",
  cep: "01310-100",
};

describe("branchFiscalWarnings", () => {
  it("aponta tudo que falta para emitir, sem impedir de salvar", () => {
    const values = form();
    expect(validateBranchForm(values)).toEqual([]);
    expect(branchFiscalWarnings(values)).toEqual([
      "CNPJ",
      "regime tributário (CRT)",
      "inscrição estadual",
      "logradouro",
      "número",
      "bairro",
      "município",
      "UF",
      "CEP",
    ]);
  });

  it("cala quando a filial está completa", () => {
    expect(branchFiscalWarnings(form(FILIAL_COMPLETA))).toEqual([]);
  });

  /*
   * A regressão que este bloco existe para travar: uma primeira versão do
   * aviso cobria só CNPJ, CRT, IE, UF e município, e ficava **calada** diante
   * de uma filial sem logradouro, número, bairro ou CEP — que
   * `validaEndereco(..., "emitente", true)` recusa do mesmo jeito. Um aviso
   * que afirma "está pronta" quando não está é pior que aviso nenhum.
   */
  it.each([
    ["logradouro", "logradouro"],
    ["numero", "número"],
    ["bairro", "bairro"],
    ["cep", "CEP"],
  ] as const)("aponta a falta de %s, que validaEmitente também exige", (campo, rotulo) => {
    const values = form({ ...FILIAL_COMPLETA, [campo]: "" });
    expect(validateBranchForm(values), "faltar não pode impedir de salvar").toEqual([]);
    expect(branchFiscalWarnings(values)).toEqual([rotulo]);
  });
});

describe("formatação guardada no banco", () => {
  it("uniformiza o CNPJ para a forma com pontuação, venha como vier", () => {
    expect(formatCnpj("00000000000191")).toBe("00.000.000/0001-91");
    expect(formatCnpj("00.000.000/0001-91")).toBe("00.000.000/0001-91");
  });

  it("deixa texto incompleto como está — quem recusa é a validação, não o formatador", () => {
    expect(formatCnpj("112223")).toBe("112223");
    expect(formatCnpj("  ")).toBe("");
  });

  it("uniformiza o CEP", () => {
    expect(formatCep("01310100")).toBe("01310-100");
    expect(formatCep("01310-100")).toBe("01310-100");
    expect(formatCep("0131")).toBe("0131");
  });
});

describe("branchFormValuesFrom", () => {
  const branch: BranchAdmin = {
    id: "b1",
    code: "001",
    name: "Matriz",
    cnpj: "00.000.000/0001-91",
    active: true,
    inscricaoEstadual: null,
    regimeTributario: "3",
    cnae: null,
    codigoIbgeMunicipio: null,
    logradouro: "Avenida Paulista",
    numero: "1000",
    bairro: "Bela Vista",
    municipio: "São Paulo",
    uf: "SP",
    cep: "01310-100",
    allowNegativeStock: true,
    emailCopiaNotaFiscal: null,
    /* A11: a filial lida carrega a validade do certificado, e o formulário
       ignora as três — ver o teste do fim deste bloco. */
    certificadoValidoDe: "2026-09-01",
    certificadoValidoAte: "2027-09-01",
    certificadoCnpj: "00.000.000/0001-91",
    pixKey: null,
  };

  /*
   * A11: `BranchFormValues` não tem — e não pode ter — campo de certificado.
   * Este teste trava a fronteira pelo lado do formulário: o que a filial
   * carrega sobre o certificado não atravessa para os valores editáveis, então
   * não existe caminho de volta até as colunas.
   */
  it("não traz nada de certificado para os valores do formulário", () => {
    const values = branchFormValuesFrom(branch);
    const chaves = Object.keys(values);
    expect(chaves.filter((chave) => /certificad|senha|arquivo/i.test(chave))).toEqual([]);
    expect(Object.values(values)).not.toContain("2027-09-01");
  });

  it("transforma nulo em campo vazio, nunca na string 'null'", () => {
    const values = branchFormValuesFrom(branch);
    expect(values.inscricaoEstadual).toBe("");
    expect(values.cnae).toBe("");
    expect(values.emailCopiaNotaFiscal).toBe("");
  });

  it("preserva os booleanos como estão", () => {
    const values = branchFormValuesFrom(branch);
    expect(values.active).toBe(true);
    expect(values.allowNegativeStock).toBe(true);
    expect(branchFormValuesFrom({ ...branch, active: false }).active).toBe(false);
  });

  it("o que sai do banco válido volta válido para o formulário", () => {
    expect(validateBranchForm(branchFormValuesFrom(branch))).toEqual([]);
  });
});

describe("branchColumnsFromForm", () => {
  it("traduz para snake_case e transforma campo vazio em null, nunca em string vazia", () => {
    const row = branchColumnsFromForm(form(), { includeEmail: true, includePix: true });
    expect(row.code).toBe("002");
    expect(row.name).toBe("Filial Norte");
    expect(row.cnpj).toBeNull();
    expect(row.inscricao_estadual).toBeNull();
    expect(row.codigo_ibge_municipio).toBeNull();
    expect(row.allow_negative_stock).toBe(false);
    expect(row.active).toBe(true);
  });

  it("uniformiza CNPJ e CEP antes de gravar, e sobe a UF para maiúsculas", () => {
    const row = branchColumnsFromForm(
      form({ cnpj: "00000000000191", cep: "01310100", uf: "sp" }),
      { includeEmail: true, includePix: true },
    );
    expect(row.cnpj).toBe("00.000.000/0001-91");
    expect(row.cep).toBe("01310-100");
    expect(row.uf).toBe("SP");
  });

  it("apara espaços de código e nome — o código é chave única no banco", () => {
    const row = branchColumnsFromForm(form({ code: "  002  ", name: " Filial Norte " }), {
      includeEmail: true,
      includePix: true,
    });
    expect(row.code).toBe("002");
    expect(row.name).toBe("Filial Norte");
  });

  it("só inclui a coluna de e-mail quando mandam incluir", () => {
    const values = form({ emailCopiaNotaFiscal: "contador@escritorio.com.br" });

    const com = branchColumnsFromForm(values, { includeEmail: true, includePix: true });
    expect(com[COLUNA_EMAIL_COPIA_NOTA]).toBe("contador@escritorio.com.br");

    // Sem a coluna no banco, a chave não pode nem aparecer: o PostgREST recusa
    // o insert/update inteiro por causa de um campo opcional.
    const sem = branchColumnsFromForm(values, { includeEmail: false, includePix: true });
    expect(Object.keys(sem)).not.toContain(COLUNA_EMAIL_COPIA_NOTA);
  });

  it("e-mail vazio vira null quando a coluna existe", () => {
    const row = branchColumnsFromForm(form({ emailCopiaNotaFiscal: "  " }), {
      includeEmail: true,
      includePix: true,
    });
    expect(row[COLUNA_EMAIL_COPIA_NOTA]).toBeNull();
  });

  it("só inclui a coluna da chave PIX quando mandam incluir (D11, mesma regra do e-mail)", () => {
    const values = form({ pixKey: "financeiro@facilite.com.br" });

    const com = branchColumnsFromForm(values, { includeEmail: true, includePix: true });
    expect(com[COLUNA_PIX_KEY]).toBe("financeiro@facilite.com.br");

    const sem = branchColumnsFromForm(values, { includeEmail: true, includePix: false });
    expect(Object.keys(sem)).not.toContain(COLUNA_PIX_KEY);
  });

  it("chave PIX vazia vira null quando a coluna existe", () => {
    const row = branchColumnsFromForm(form({ pixKey: "  " }), {
      includeEmail: true,
      includePix: true,
    });
    expect(row[COLUNA_PIX_KEY]).toBeNull();
  });
});

describe("isMissingColumnError", () => {
  it("reconhece o 42703 do Postgres — o que este banco devolve hoje", () => {
    expect(
      isMissingColumnError({
        code: "42703",
        message: "column branches.email_copia_nota_fiscal does not exist",
      }),
    ).toBe(true);
  });

  it("reconhece o PGRST204 do cache de schema do PostgREST", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  /*
   * A armadilha que este teste tranca: uma primeira versão também aceitava
   * qualquer erro cuja **mensagem** citasse o nome da coluna. Como a conclusão
   * "a coluna não existe" fica em cache pela sessão inteira, um erro de
   * constraint ou de policy que mencionasse a coluna desligaria o campo de
   * vez — e a tela passaria a afirmar que a migration não foi aplicada quando
   * ela foi.
   */
  it("NÃO se deixa enganar por outro erro que só cita o nome da coluna", () => {
    expect(
      isMissingColumnError({
        code: "23514",
        message: 'new row violates check constraint on "email_copia_nota_fiscal"',
      }),
    ).toBe(false);
    expect(isMissingColumnError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});

describe("isDuplicateBranchCodeError", () => {
  it("reconhece a violação de unicidade de branches_code_key", () => {
    expect(
      isDuplicateBranchCodeError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "branches_code_key"',
      }),
    ).toBe(true);
  });

  it("não confunde com outros erros", () => {
    expect(isDuplicateBranchCodeError({ code: "42703" })).toBe(false);
    expect(isDuplicateBranchCodeError(null)).toBe(false);
  });
});

describe("regimeTributarioLabel", () => {
  it("traduz as chaves conhecidas", () => {
    expect(regimeTributarioLabel("3")).toBe("3 — Regime Normal");
    expect(regimeTributarioLabel("4")).toBe("4 — Simples Nacional, MEI");
  });

  it("diz 'não informado' para nulo e devolve o desconhecido cru", () => {
    expect(regimeTributarioLabel(null)).toBe("Não informado");
    expect(regimeTributarioLabel("9")).toBe("9");
  });
});
