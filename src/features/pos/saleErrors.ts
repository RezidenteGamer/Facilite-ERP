/**
 * Erro de `create_pos_sale` → frase que o operador do caixa entende.
 *
 * Estava dentro de `usePosSale.ts` até E6 (10/09/2026); saiu para cá porque
 * agora há **dois** lugares que precisam dela: a venda feita na hora, e a
 * venda que ficou na fila offline e só foi recusada pela RPC na hora de
 * sincronizar (`useOfflineSales.ts`). Eram a mesma tradução, e duas cópias
 * divergiriam na primeira mensagem nova que o banco ganhasse.
 *
 * A mudança de assinatura em relação à versão de dentro do hook: em vez do
 * carrinho (`PosCartLine[]`), recebe só o que ela usava dele — um jeito de
 * descobrir a descrição de um produto pelo id. A fila não tem carrinho; ela
 * tem o payload e o catálogo da tela.
 */
import { formatMoney } from "./pos";

const STOCK_ERROR = /^Estoque insuficiente para o produto ([0-9a-f-]{36})\.$/i;
const PAYMENTS_MISMATCH_ERROR =
  /^A soma dos pagamentos \(([\d.,-]+)\) não bate com o total da venda \(([\d.,-]+)\)\.$/;
/** `assert_discount_within_cap` (tarefa C3, 29/08/2026) — teto de `roles.max_discount_percent`. */
const DISCOUNT_CAP_ERROR = /^Desconto de [\d.,]+% acima do limite do seu perfil \([\d.,]+%\)\.$/;
export const NO_OPEN_SESSION_ERROR = "Abra uma sessão de caixa antes de vender.";

export const GENERIC_SALE_ERROR =
  "Não foi possível confirmar a venda. Tente novamente — se o problema continuar, acione o suporte.";

const KNOWN_MESSAGES = [
  "Sem permissão para vender no ponto de venda.",
  "Sem permissão para criar vendas.",
  "Sem acesso a esta filial.",
  "A venda precisa de ao menos um item.",
  "A venda precisa de ao menos uma forma de pagamento.",
  "Produto não encontrado.",
  "Produto não pertence à filial da venda.",
  "Quantidade inválida em um dos itens.",
  "Desconto do item maior que o valor do item.",
];

/**
 * `create_pos_sale`/`create_sale` já levantam mensagens em português prontas
 * — mesmo tratamento de `useSaleDraft.ts` (Realizar Venda): só traduzimos o
 * erro de estoque (a RPC só tem o id do produto) e blindamos contra erro cru
 * não previsto.
 */
export function posSaleErrorMessage(err: unknown, describeProduct: (productId: string) => string | null): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err && typeof err.message === "string"
        ? err.message
        : null;

  if (!raw) return GENERIC_SALE_ERROR;

  if (raw === NO_OPEN_SESSION_ERROR) return raw;

  const stockMatch = raw.match(STOCK_ERROR);
  if (stockMatch) {
    const description = describeProduct(stockMatch[1]);
    return description
      ? `Estoque insuficiente para "${description}" — reduza a quantidade ou remova o item.`
      : "Estoque insuficiente para um dos produtos da venda.";
  }

  const mismatchMatch = raw.match(PAYMENTS_MISMATCH_ERROR);
  if (mismatchMatch) {
    const paid = Number(mismatchMatch[1].replace(",", "."));
    const total = Number(mismatchMatch[2].replace(",", "."));
    return `A soma dos pagamentos (${formatMoney(paid)}) não bate com o total da venda (${formatMoney(total)}).`;
  }

  if (DISCOUNT_CAP_ERROR.test(raw)) return raw;

  if (KNOWN_MESSAGES.includes(raw)) return raw;

  return GENERIC_SALE_ERROR;
}
