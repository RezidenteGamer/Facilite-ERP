export type Branch = {
  code: string;
  name: string;
  cnpj: string;
};

/**
 * Lista de filiais — só a "Filial 1" existe por enquanto (mesma que aparece
 * na faixa do cabeçalho). Sem back-end ainda: trocar por uma busca real
 * quando o cadastro de filiais existir.
 */
export const BRANCHES: Branch[] = [
  { code: "001", name: "Supermercado No Ponto Centro", cnpj: "00.000.000/0001-91" },
];
