/**
 * "Isto foi um scan ou alguém está digitando?" — a decisão do modo scanner do
 * PDV, isolada do DOM e do React para poder ser testada (E4, 10/09/2026).
 *
 * ## O que um leitor barato faz, de fábrica
 *
 * Pesquisa desta tarefa (mesma situação de E1: **não há leitor físico
 * disponível para testar nesta sessão**, então o que está aqui é o
 * comportamento documentado, não comportamento observado):
 *
 *   * Leitor de código de barras de balcão age como **teclado USB (HID)**. Não
 *     é driver, não é porta serial, não é permissão de navegador: para o
 *     sistema operacional ele é um segundo teclado, e os dígitos do código
 *     chegam como eventos de tecla normais no campo que estiver focado.
 *   * Ele "digita" o código inteiro numa **rajada**, tipicamente concluindo o
 *     payload em menos de um segundo, e termina com um **sufixo terminador**.
 *     O sufixo de fábrica mais comum é **Enter (CR, `0x0D`)**; TAB e CR+LF
 *     aparecem em alguns modelos.
 *
 * Esses dois fatos são tudo o que o PDV precisa para separar "chegou um
 * código" de "o operador está buscando um produto pelo nome".
 *
 * ## Por que prefixo/sufixo **customizado** ficou de fora
 *
 * Muitos leitores aceitam prefixo/sufixo arbitrário (um `#` antes, um `*`
 * depois) — mas isso **não vem de fábrica**: exige programar o leitor passando
 * ele por códigos de barras de configuração impressos no manual daquele
 * fabricante. Expor isso como opção configurável no sistema significaria pedir
 * ao lojista que reprogramasse o leitor para casar com uma configuração que
 * ele teria que digitar aqui também — duas coisas para desalinhar, para
 * resolver um problema que ninguém tem, e **impossível de testar sem
 * hardware**. O par "rajada rápida + Enter" cobre o leitor saído da caixa, que
 * é o caso real da loja. Decisão registrada em AGENTS.md.
 *
 * ## "Nenhuma tecla perdida" — por que isto lê valor, e não teclas
 *
 * A exigência do plano é de implementação, não de protocolo. A maneira de
 * perder tecla numa rajada é **remontar o texto a partir dos eventos de
 * tecla**: qualquer `keydown` que escape (tecla morta, composição, autorepeat,
 * um `preventDefault` no caminho) sai do texto reconstruído e o código chega
 * truncado — o que num PDV significa produto errado no carrinho, não um erro
 * visível.
 *
 * Então este módulo **não reconstrói texto**. Ele recebe o `value` que o
 * próprio campo já tem a cada mudança, e usa o relógio só para saber a que
 * velocidade esse valor cresceu. Se o navegador entregou o caractere ao
 * `<input>`, ele está no `value`; não há caminho pelo qual uma tecla aceita
 * pelo campo deixe de entrar na conta. (Conferido também que **não existe
 * nenhum `debounce`/`throttle`** no campo de busca do PDV — é um `<input>`
 * controlado comum, `onChange` direto no `setState`.)
 *
 * O outro jeito de perder tecla é mais banal e mais provável: a rajada começar
 * com o foco em outro lugar, e os primeiros dígitos caírem no nada. Isso não
 * se resolve aqui — resolve-se com o "foco travado" em `PosPage.tsx`.
 */
import { isValidGtin } from "../../lib/gtin";

/**
 * Intervalo máximo, em milissegundos, entre dois caracteres para que eles
 * ainda contem como parte da **mesma rajada**.
 *
 * De onde sai o número:
 *
 *   * **Leitor**: um HID keyboard wedge de fábrica não acrescenta atraso entre
 *     caracteres; o piso prático é o próprio polling USB do teclado (~8 ms por
 *     relatório, e um caractere custa um keydown mais um keyup), o que põe o
 *     leitor na casa de **10–20 ms por caractere**.
 *   * **Humano**: 100 palavras por minuto — digitação rápida de verdade — são
 *     cerca de 500 caracteres por minuto, ou **~120 ms por caractere**. E um
 *     operador de caixa buscando "coca" não digita nem perto disso.
 *
 * `100` fica no vão entre os dois: cinco a dez vezes acima do leitor, e abaixo
 * do datilógrafo rápido. A literatura de HMI costuma sugerir **150 ms** para
 * essa separação, o que é mais folgado — e que se sobrepõe de fato à faixa da
 * digitação humana rápida (80–250 ms/caractere). Fomos mais apertados de
 * propósito, porque aqui a folga não compra nada: o caminho principal do
 * leitor de fábrica é o **Enter**, e a rajada é só o plano B para o leitor
 * configurado sem sufixo. Errar para o lado apertado no plano B custa, no
 * pior caso, o operador ver a lista filtrada e clicar no produto — que é
 * exatamente o comportamento que o PDV já tinha antes de E4.
 *
 * Limitação conhecida e aceita: leitor **Bluetooth** pode ter jitter de
 * emparelhamento acima disso (a mesma literatura sugere 200–250 ms para eles).
 * Um leitor Bluetooth sem sufixo configurado não dispara a rajada. Com sufixo
 * — o padrão — funciona igual, porque o Enter não olha o relógio.
 */
export const SCAN_MAX_KEY_INTERVAL_MS = 100;

/**
 * Silêncio, em milissegundos, que marca o **fim** de uma rajada sem sufixo.
 *
 * Este número não estava no desenho original desta tarefa, e a bateria de
 * testes é que o exigiu. A primeira versão usava "o dígito verificador
 * fechou" como sinal de fim de leitura — parecia elegante, e está errado:
 * **um GTIN pode ser prefixo válido de outro**. `9780132350884` (GTIN-13 real)
 * sem o último dígito é `978013235088`, um GTIN-12 que fecha a conta por
 * coincidência, e a chance disso acontecer é de **1 em 10 para qualquer
 * código** — o verificador tem dez valores possíveis. Ou seja: um em cada dez
 * códigos de barras da loja dispararia no 12º dígito, o PDV limparia o campo,
 * e o 13º dígito cairia sozinho num campo vazio. Bug visível no balcão, em
 * 10% das leituras.
 *
 * Com espera de silêncio não há ambiguidade: a rajada acabou quando parou de
 * chegar caractere. `150` é `SCAN_MAX_KEY_INTERVAL_MS` mais uma folga — tem
 * que ser maior que o intervalo entre caracteres, senão o "fim" dispararia no
 * meio; e pequeno o bastante para o operador não perceber espera nenhuma entre
 * passar o produto e ver o item no carrinho.
 */
export const SCAN_BURST_IDLE_MS = 150;

/**
 * Comprimento mínimo para uma rajada ser considerada um código: 8, o GTIN-8,
 * a menor chave GS1 que o cadastro aceita. Piso de tamanho, nada mais — quem
 * decide quando a leitura terminou é `SCAN_BURST_IDLE_MS`.
 */
export const SCAN_MIN_LENGTH = 8;

/**
 * O que se sabe sobre a digitação em curso no campo de busca. Imutável: cada
 * mudança devolve um estado novo, nunca altera o que recebeu.
 */
export type ScanProgress = {
  /** O valor do campo na última mudança observada. */
  value: string;
  /** Quando essa mudança chegou (`performance.now()` ou `Date.now()`). */
  at: number;
  /**
   * Todas as mudanças desde o início desta sequência cresceram **um caractere
   * por vez** e dentro de `SCAN_MAX_KEY_INTERVAL_MS`? Colar um texto, apagar,
   * ou digitar devagar derrubam isto para `false`.
   */
  burst: boolean;
};

export const EMPTY_SCAN_PROGRESS: ScanProgress = { value: "", at: 0, burst: false };

/**
 * Registra uma mudança do campo de busca e devolve o estado novo.
 *
 * `value` é o texto que o campo tem **agora** (já com o caractere novo), e
 * `at` é o instante em que ela chegou. Chamado de `onChange`, nunca de
 * `onKeyDown`: ver a nota sobre "nenhuma tecla perdida" no topo do arquivo.
 *
 * Não decide nada sozinho de propósito — só acumula. Quem pergunta "a rajada
 * acabou e virou um código?" é `burstScanCode`, depois do silêncio.
 */
export function trackScanInput(previous: ScanProgress, value: string, at: number): ScanProgress {
  const cresceuUmCaractere = value.length === previous.value.length + 1 && value.startsWith(previous.value);

  let burst: boolean;
  if (!cresceuUmCaractere) {
    // Colar, apagar, editar no meio, ou o campo ser limpo: seja lá o que foi,
    // não foi um caractere chegando em sequência. A rajada recomeça do zero.
    burst = false;
  } else if (previous.value === "") {
    // Primeiro caractere num campo vazio. Não há intervalo anterior para
    // medir, então ainda não há como desqualificar — e um caractere sozinho
    // nunca é longo o bastante para virar código (`SCAN_MIN_LENGTH`).
    burst = true;
  } else {
    burst = previous.burst && at - previous.at <= SCAN_MAX_KEY_INTERVAL_MS;
  }

  return { value, at, burst };
}

/**
 * A rajada terminou e formou um código de barras? Devolve o código, ou `null`
 * se não há leitura a comemorar.
 *
 * `agora` é o instante da pergunta — quem chama é um `setTimeout` de
 * `SCAN_BURST_IDLE_MS` reagendado a cada caractere, então na prática a
 * pergunta só acontece depois do silêncio. A conferência de tempo está aqui
 * dentro mesmo assim, e não só no agendamento, para o módulo ser honesto
 * sozinho: um timer atrasado ou disparado cedo não faz o PDV adicionar
 * produto errado.
 *
 * Este é o caminho do leitor **sem sufixo configurado**. O leitor de fábrica
 * manda Enter e nem chega aqui — cai em `submittedCode`, que é imediato.
 */
export function burstScanCode(progress: ScanProgress, agora: number): string | null {
  if (!progress.burst) return null;
  if (progress.value.length < SCAN_MIN_LENGTH) return null;
  if (agora - progress.at < SCAN_BURST_IDLE_MS) return null;
  return isValidGtin(progress.value) ? progress.value : null;
}

/**
 * O código que um **Enter** no campo de busca submete, ou `null` se não há
 * nada para submeter.
 *
 * Este é o caminho principal — o sufixo de fábrica do leitor — e é
 * deliberadamente o **mesmo** caminho do "Digitar código" na mão: não olha o
 * relógio, não exige rajada, não exige nem que o texto seja um GTIN válido.
 * Quem decide o que fazer com ele é o PDV, que só adiciona ao carrinho se
 * casar exatamente um produto; qualquer outra coisa segue como busca normal.
 *
 * Não exigir GTIN válido aqui é de propósito: se o operador digita um código
 * e erra um dígito, o certo é a busca não achar nada e ele ver isso — não o
 * sistema recusar o Enter como se a tecla não existisse.
 */
export function submittedCode(value: string): string | null {
  const texto = value.trim();
  return texto === "" ? null : texto;
}
