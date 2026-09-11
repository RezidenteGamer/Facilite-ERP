import { describe, expect, it } from "vitest";

import { claimTurn } from "../../src/lib/latestTurn";

/**
 * "Senha da vez" das leituras assíncronas do PDV (E6, 10/09/2026).
 *
 * O caso concreto que isto protege está em `useOpenCashSession`
 * (`usePosSale.ts`): duas leituras da sessão de caixa em voo ao mesmo tempo —
 * o operador troca de filial, ou uma venda confirmada dispara `reloadSession`
 * enquanto outra leitura ainda não voltou. Sem esta regra, quem escrevia o
 * estado da tela era quem **respondesse** por último, não quem tivesse sido
 * **pedido** por último: o PDV podia acabar mostrando o caixa da filial
 * anterior, com `canConfirm` liberando venda em cima disso.
 *
 * O que estes testes cobrem é a regra. O que eles **não** cobrem, e está dito
 * no relatório: o hook React em volta dela. Os testes deste projeto rodam em
 * `node`, sem DOM (ver `vitest.config.ts`), e não há biblioteca de teste de
 * componente aqui — foi justamente por isso que a regra saiu de dentro do
 * hook e virou uma função.
 *
 * Também não foi possível reproduzir a corrida no navegador: `sessionLoading`
 * desabilita "Confirmar Venda" enquanto uma leitura está em voo, então não dá
 * para disparar a segunda leitura por uma segunda venda, e a base de teste tem
 * uma filial só — não há como trocar de filial nela.
 */

describe("claimTurn", () => {
  it("quem acabou de pegar a senha é o mais recente", () => {
    const contador = { current: 0 };
    const aindaValho = claimTurn(contador);
    expect(aindaValho()).toBe(true);
  });

  it("a senha nova invalida a velha — e não o contrário", () => {
    const contador = { current: 0 };
    const primeira = claimTurn(contador);
    const segunda = claimTurn(contador);

    expect(primeira()).toBe(false);
    expect(segunda()).toBe(true);
  });

  it("a resposta que chega atrasada continua sem valer depois que a nova termina", () => {
    /*
     * É o cenário exato do PDV: R1 (filial A) foi pedida primeiro, R2 (filial
     * B) depois, e R1 é quem responde por último. R1 não pode "recuperar" o
     * direito de escrever só porque agora é a única ainda rodando.
     */
    const contador = { current: 0 };
    const r1 = claimTurn(contador);
    const r2 = claimTurn(contador);

    expect(r2()).toBe(true); // R2 respondeu e escreveu
    expect(r1()).toBe(false); // R1 responde depois — e continua sem direito
  });

  it("vale para qualquer número de leituras sobrepostas: só a última escreve", () => {
    const contador = { current: 0 };
    const senhas = Array.from({ length: 10 }, () => claimTurn(contador));

    expect(senhas.map((vale) => vale())).toEqual([
      false, false, false, false, false, false, false, false, false, true,
    ]);
  });

  it("a senha continua valendo enquanto ninguém pedir outra", () => {
    const contador = { current: 0 };
    const minha = claimTurn(contador);

    expect(minha()).toBe(true);
    expect(minha()).toBe(true);
    expect(minha()).toBe(true);
  });

  it("contadores diferentes não se atrapalham — um hook não invalida o do outro", () => {
    const sessao = { current: 0 };
    const catalogo = { current: 0 };

    const daSessao = claimTurn(sessao);
    claimTurn(catalogo);
    claimTurn(catalogo);

    expect(daSessao()).toBe(true);
  });

  it("respeita um contador que já vinha de leituras anteriores", () => {
    const contador = { current: 7 };
    const oitava = claimTurn(contador);

    expect(contador.current).toBe(8);
    expect(oitava()).toBe(true);
  });
});
