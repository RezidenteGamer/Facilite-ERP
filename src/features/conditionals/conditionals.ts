export type ConditionalStatus = "Em aberto" | "Vencida" | "Devolvida" | "Convertida em venda";

export type Conditional = {
  id: string;
  code: string;
  client: string;
  sentAt: string;
  dueDate: string;
  status: ConditionalStatus;
  total: number;
};

/** Formato monetário do sistema (pt-BR, sem símbolo — a coluna já diz "Valor"). */
export function formatConditionalTotal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const CONDITIONALS: Conditional[] = [
  {
    id: "condicional-001",
    code: "001",
    client: "Bruno venzo debacco",
    sentAt: "10/08/2026",
    dueDate: "15/08/2026",
    status: "Em aberto",
    total: 450,
  },
];
