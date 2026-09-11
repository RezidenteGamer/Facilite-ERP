/**
 * "Senha da vez" para leitura assíncrona que escreve estado de tela — só a
 * mais recente tem direito de escrever (E6, 10/09/2026).
 *
 * ## O problema, em uma frase
 *
 * Quem responde por último **não** é necessariamente quem foi pedido por
 * último. Duas leituras em voo (trocar de filial, recarregar no meio de outra
 * recarga) terminam na ordem que a rede quiser, e a última a chegar
 * sobrescreve a última a ser pedida. No PDV isso apareceu como o risco de
 * mostrar a sessão de caixa da filial anterior enquanto `branchId` já era a
 * nova — com `canConfirm` liberando venda em cima dessa informação errada.
 *
 * ## Por que isto é uma função e não três linhas soltas no hook
 *
 * Porque as três linhas soltas não têm como ser testadas: elas vivem dentro
 * de um hook React, e este projeto roda os testes em `node`, sem DOM (ver
 * `vitest.config.ts`). Mesmo motivo de `scanDetection.ts` (E4) e
 * `offlineQueue.ts` (E6): o que decide fica num lugar puro, e a borda só usa.
 *
 * O contador vem de fora (`useRef(0)`, no caso do hook) para que o estado
 * viva onde tem que viver — atravessando renders — sem esta função precisar
 * saber o que é React.
 *
 * ```ts
 * const turno = useRef(0);
 * const aindaValho = claimTurn(turno);
 * const dados = await buscar();
 * if (!aindaValho()) return;   // alguém pediu de novo enquanto eu buscava
 * setDados(dados);
 * ```
 *
 * Note que `aindaValho()` precisa ser perguntado **depois de cada `await`** —
 * um `await` no meio é exatamente onde outra chamada consegue começar.
 */

/**
 * Toma a senha da vez em `counter` e devolve a pergunta "ainda sou a mais
 * recente?".
 *
 * A chamada mais nova sempre invalida as anteriores, e nunca o contrário:
 * uma senha velha não volta a valer nem quando a mais nova termina.
 */
export function claimTurn(counter: { current: number }): () => boolean {
  const meuTurno = counter.current + 1;
  counter.current = meuTurno;
  return () => counter.current === meuTurno;
}
