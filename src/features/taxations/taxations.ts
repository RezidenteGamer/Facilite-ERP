export type Taxation = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
};

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const TAXATIONS: Taxation[] = [
  { id: "trib-001", code: "", name: "Simples nacional - ICMS", createdAt: "" },
  { id: "trib-002", code: "", name: "Lucro real", createdAt: "" },
];
