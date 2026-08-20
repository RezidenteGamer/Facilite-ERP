import { useCallback, useEffect, useState } from "react";
import {
  cancelConditional,
  convertConditionalToSale,
  createConditional,
  fetchConditionals,
  registerConditionalReturn,
  type ConditionalListRow,
  type ConvertConditionalToSaleInput,
  type CreateConditionalInput,
  type RegisterConditionalReturnInput,
} from "../../lib/repositories/conditionalsRepository";
import { extractErrorMessage } from "../sales/useInvoicesData";

/** Carrega as condicionais de uma filial e expõe as quatro ações que escrevem. */
export function useConditionalsData(branchId: string | null) {
  const [conditionals, setConditionals] = useState<ConditionalListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!branchId) {
      setConditionals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setConditionals(await fetchConditionals(branchId));
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar as condicionais."));
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function create(input: Omit<CreateConditionalInput, "branchId">): Promise<string> {
    if (!branchId) throw new Error("Selecione uma filial.");
    const created = await createConditional({ ...input, branchId });
    await reload();
    return created.id;
  }

  async function registerReturn(input: RegisterConditionalReturnInput): Promise<void> {
    await registerConditionalReturn(input);
    await reload();
  }

  async function convertToSale(input: ConvertConditionalToSaleInput) {
    const sale = await convertConditionalToSale(input);
    await reload();
    return sale;
  }

  async function cancel(conditionalId: string): Promise<void> {
    await cancelConditional(conditionalId);
    await reload();
  }

  return { conditionals, loading, error, reload, create, registerReturn, convertToSale, cancel };
}
