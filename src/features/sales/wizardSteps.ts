/** Ordem fixa das etapas do wizard de Realizar Venda — única fonte de verdade. */
export type StepId = "cliente" | "produtos" | "detalhes" | "faturamento" | "revisao" | "confirmacao";

export const WIZARD_STEPS: { id: StepId; label: string }[] = [
  { id: "cliente", label: "Cliente" },
  { id: "produtos", label: "Produtos" },
  { id: "detalhes", label: "Detalhes" },
  { id: "faturamento", label: "Faturamento" },
  { id: "revisao", label: "Revisão" },
  { id: "confirmacao", label: "Confirmação" },
];
