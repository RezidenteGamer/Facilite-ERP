export type StockAdjustment = {
  id: string;
  code: string;
  description: string;
  change: number;
  balanceAtDate?: string;
  lastChange?: string;
  type?: string;
  costPrice?: string;
  changeDate?: string;
  location?: string;
  subLocation?: string;
  createdAt?: string;
  operator?: string;
  currentStock?: string;
};

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const STOCK_ADJUSTMENTS: StockAdjustment[] = [
  {
    id: "ajuste-001",
    code: "",
    description: "Doritos 120g pizza",
    change: 150,
  },
];
