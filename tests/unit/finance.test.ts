import { describe, expect, it } from "vitest";
import { validateFinanceEntryEditValues } from "../../src/features/finance/finance";

/**
 * D11 (10/09/2026) — achado do `/code-review alto`: a migration cria um
 * `CHECK` em `financial_entries.payment_method` restrito a 6 rótulos (ou
 * `NULL`), mas o campo de edição continua sendo texto livre (motor
 * genérico, `module_fields` não tem `dataType: "select"`). Sem esta
 * validação, um valor fora do vocabulário só falharia no banco, com um erro
 * cru do Postgres em vez de uma mensagem em português no formulário.
 */
describe("validateFinanceEntryEditValues — forma de pagamento", () => {
  const valores = (paymentMethod: string) => ({ total: "100,00", paymentMethod });

  it("aceita os 6 rótulos que o CHECK do banco aceita", () => {
    for (const rotulo of ["Dinheiro", "Débito", "Crédito", "PIX", "Boleto", "Outro"]) {
      expect(validateFinanceEntryEditValues(valores(rotulo))).toEqual([]);
    }
  });

  it("aceita vazio — significa 'não mexer no que já está gravado'", () => {
    expect(validateFinanceEntryEditValues(valores(""))).toEqual([]);
    expect(validateFinanceEntryEditValues(valores("   "))).toEqual([]);
  });

  it("recusa um valor fora do vocabulário, com mensagem em português", () => {
    const problems = validateFinanceEntryEditValues(valores("pix"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Forma de pagamento inválida");
  });

  it("recusa texto livre inventado", () => {
    expect(validateFinanceEntryEditValues(valores("Transferência"))).toHaveLength(1);
  });
});
