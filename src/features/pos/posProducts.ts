export type PosCategory = "vegetais" | "automoveis" | "outros";

export type PosProduct = {
  id: string;
  name: string;
  category: PosCategory;
  price: number;
  stock: number;
  /** Sem foto real, mostra um bloco colorido com essas iniciais. */
  placeholder: { label: string; color: string };
  lowStockThreshold?: number;
};

/** Formato monetário do sistema (pt-BR, com "R$" — o PDV mostra o símbolo). */
export function formatMoney(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const POS_PRODUCTS: PosProduct[] = [
  {
    id: "pos-batata",
    name: "Batata",
    category: "vegetais",
    price: 5,
    stock: 11,
    lowStockThreshold: 15,
    placeholder: { label: "BA", color: "#E4B457" },
  },
  {
    id: "pos-cenoura",
    name: "cenoura",
    category: "vegetais",
    price: 5,
    stock: 10,
    placeholder: { label: "CE", color: "#F0913C" },
  },
  {
    id: "pos-jetta",
    name: "jetta preto",
    category: "automoveis",
    price: 89990,
    stock: 0,
    placeholder: { label: "JP", color: "#3B3F45" },
  },
  {
    id: "pos-morango",
    name: "Morango",
    category: "outros",
    price: 2,
    stock: 0,
    placeholder: { label: "MO", color: "#5BC8E0" },
  },
  {
    id: "pos-notebook",
    name: "Notebook",
    category: "outros",
    price: 3500,
    stock: 0,
    placeholder: { label: "NB", color: "#8FA6B8" },
  },
  {
    id: "pos-teclado",
    name: "Teclado gamer",
    category: "outros",
    price: 250,
    stock: 0,
    placeholder: { label: "TG", color: "#2B2E36" },
  },
];
