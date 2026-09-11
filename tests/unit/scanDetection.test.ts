import { describe, expect, it } from "vitest";

import {
  burstScanCode,
  EMPTY_SCAN_PROGRESS,
  SCAN_BURST_IDLE_MS,
  SCAN_MAX_KEY_INTERVAL_MS,
  submittedCode,
  trackScanInput,
  type ScanProgress,
} from "../../src/features/pos/scanDetection";

/**
 * Detecção de leitura de scanner no PDV (E4, 10/09/2026).
 *
 * **Não existe leitor físico para testar nesta sessão** — mesma situação de E1
 * com a impressora térmica. O que é testável sem hardware é exatamente o que
 * este arquivo testa: a *decisão*, dada uma sequência de valores do campo com
 * carimbo de tempo. Simular o leitor aqui é honesto porque a única coisa
 * simulada é o relógio; o resto (o texto que chega ao campo) é o que o
 * navegador entregaria de qualquer jeito.
 *
 * O que isto **não** prova, e está dito no relatório da tarefa: que um leitor
 * real, de um fabricante real, emite na velocidade e com o sufixo que a
 * documentação diz que emite.
 *
 * Esta bateria pagou por si mesma antes de o código ir para a tela: a primeira
 * versão de `scanDetection.ts` usava "o dígito verificador fechou" como sinal
 * de fim de leitura, e foi o teste `dispara uma vez só` abaixo que mostrou que
 * isso quebra em 1 de cada 10 códigos. Ver `SCAN_BURST_IDLE_MS`.
 */

/** GTIN-13 real (ISBN-13 de *Clean Code*), o mesmo vetor de `gtin.test.ts`. */
const GTIN13 = "9780132350884";

/** Bem depois do silêncio que fecha a rajada — o timer do PDV já teria disparado. */
const DEPOIS_DO_SILENCIO = SCAN_BURST_IDLE_MS + 1;

/**
 * Empurra `texto` caractere a caractere pelo detector, com `intervalo`
 * milissegundos entre cada um — é o leitor (intervalo curto) ou o operador
 * (intervalo longo), conforme o número.
 *
 * Devolve o estado final e **todos** os códigos que teriam disparado se o
 * silêncio tivesse caído em cada caractere. Olhar o caminho inteiro, e não só
 * o fim, é o que revela um detector que dispara cedo demais.
 */
function digitar(
  texto: string,
  intervalo: number,
  inicial: ScanProgress = EMPTY_SCAN_PROGRESS,
): { progress: ScanProgress; disparosSeOSilencioCaisseAqui: string[] } {
  let progress = inicial;
  const disparosSeOSilencioCaisseAqui: string[] = [];
  let agora = inicial.at;
  for (let i = 0; i < texto.length; i++) {
    agora += intervalo;
    progress = trackScanInput(progress, inicial.value + texto.slice(0, i + 1), agora);
    const codigo = burstScanCode(progress, agora + DEPOIS_DO_SILENCIO);
    if (codigo !== null) disparosSeOSilencioCaisseAqui.push(codigo);
  }
  return { progress, disparosSeOSilencioCaisseAqui };
}

/** O que o PDV de fato veria: o código depois que a rajada silenciou. */
function codigoAoFimDaRajada(texto: string, intervalo: number): string | null {
  const { progress } = digitar(texto, intervalo);
  return burstScanCode(progress, progress.at + DEPOIS_DO_SILENCIO);
}

describe("burstScanCode — rajada de leitor sem sufixo", () => {
  it("reconhece um GTIN-13 chegando em rajada", () => {
    expect(codigoAoFimDaRajada(GTIN13, 15)).toBe(GTIN13);
  });

  it("espera o silêncio antes de decidir, e não dispara enquanto a rajada corre", () => {
    // A regressão que esta bateria já pegou uma vez. Os 12 primeiros dígitos
    // de `9780132350884` formam `978013235088`, um GTIN-12 aritmeticamente
    // válido — 1 chance em 10 para qualquer código. Sem espera de silêncio, o
    // PDV adicionaria um produto e limparia o campo no 12º dígito, e o `4`
    // final cairia sozinho num campo vazio.
    const dozeDigitos: ScanProgress = { value: GTIN13.slice(0, -1), at: 1_000, burst: true };
    // Ainda dentro da rajada (o próximo caractere pode estar a caminho): nada.
    expect(burstScanCode(dozeDigitos, 1_000 + SCAN_BURST_IDLE_MS - 1)).toBeNull();
    // Só depois do silêncio é que o prefixo de 12 dígitos seria aceito — e no
    // caso real ele nunca chega a silenciar, porque o 13º dígito vem em 15 ms.
    expect(burstScanCode(dozeDigitos, 1_000 + SCAN_BURST_IDLE_MS)).toBe(GTIN13.slice(0, -1));
  });

  it("no fim de uma rajada real, o código é o inteiro — nunca o prefixo", () => {
    // O teste que amarra o comportamento de ponta a ponta: passando o GTIN-13
    // a 15 ms por dígito, o silêncio só cai depois do 13º.
    expect(codigoAoFimDaRajada(GTIN13, 15)).toBe(GTIN13);
    expect(codigoAoFimDaRajada(GTIN13, 15)).not.toBe(GTIN13.slice(0, -1));
  });

  it("ignora digitação humana, mesmo que o texto seja um GTIN válido", () => {
    // 200 ms por caractere é digitação rápida de gente. O texto é idêntico ao
    // do primeiro teste — só o relógio mudou.
    expect(codigoAoFimDaRajada(GTIN13, 200)).toBeNull();
  });

  it("trata o limiar entre teclas como inclusivo, e um milissegundo além já quebra", () => {
    expect(codigoAoFimDaRajada(GTIN13, SCAN_MAX_KEY_INTERVAL_MS)).toBe(GTIN13);
    expect(codigoAoFimDaRajada(GTIN13, SCAN_MAX_KEY_INTERVAL_MS + 1)).toBeNull();
  });

  it("uma única pausa no meio da rajada já a desqualifica inteira", () => {
    let progress = EMPTY_SCAN_PROGRESS;
    let agora = 1_000;
    for (let i = 0; i < GTIN13.length; i++) {
      agora += i === 6 ? 900 : 15;
      progress = trackScanInput(progress, GTIN13.slice(0, i + 1), agora);
    }
    expect(progress.burst).toBe(false);
    expect(burstScanCode(progress, agora + DEPOIS_DO_SILENCIO)).toBeNull();
  });

  it("não confunde busca por nome com código, por mais rápido que chegue", () => {
    // "cocacola2l" tem 10 caracteres e chega em rajada de leitor — e não é
    // GTIN nenhum. O comprimento sozinho nunca foi o critério.
    expect(codigoAoFimDaRajada("cocacola2l", 10)).toBeNull();
  });

  it("não dispara com dígitos rápidos que não fecham o verificador", () => {
    // Mesmo comprimento de um GTIN-13, mesma velocidade, verificador errado.
    expect(codigoAoFimDaRajada("9780132350880", 15)).toBeNull();
  });

  it("recusa rajada curta demais para ser GTIN", () => {
    const { progress } = digitar("9638507", 15); // 7 dígitos: um a menos que GTIN-8
    expect(burstScanCode(progress, progress.at + DEPOIS_DO_SILENCIO)).toBeNull();
  });
});

describe("trackScanInput — o que quebra a rajada", () => {
  it("texto colado não é rajada, mesmo sendo um GTIN válido", () => {
    // Colar salta de "" para 13 caracteres numa mudança só: não cresceu um
    // caractere por vez. Recusar é a escolha certa — colar é gesto de gente
    // (Ctrl+V), e a lista filtrada mostra o produto para ela clicar.
    const progress = trackScanInput(EMPTY_SCAN_PROGRESS, GTIN13, 1_000);
    expect(progress.burst).toBe(false);
    expect(burstScanCode(progress, 1_000 + DEPOIS_DO_SILENCIO)).toBeNull();
  });

  it("apagar um caractere quebra a rajada", () => {
    const { progress } = digitar("97801323508", 15);
    expect(progress.burst).toBe(true);
    const apagou = trackScanInput(progress, "9780132350", progress.at + 15);
    expect(apagou.burst).toBe(false);
    expect(burstScanCode(apagou, apagou.at + DEPOIS_DO_SILENCIO)).toBeNull();
  });

  it("editar no meio do texto quebra a rajada, mesmo crescendo um caractere", () => {
    // `978013235088` -> `9780132350884` cresce um caractere e é GTIN válido;
    // `978013235088` -> `9978013235088` também cresce um caractere, mas o
    // anterior deixou de ser prefixo do novo. Só o primeiro é rajada.
    const anterior: ScanProgress = { value: "978013235088", at: 1_000, burst: true };
    const cresceu = trackScanInput(anterior, GTIN13, 1_010);
    expect(burstScanCode(cresceu, 1_010 + DEPOIS_DO_SILENCIO)).toBe(GTIN13);
    const editou = trackScanInput(anterior, "9978013235088", 1_010);
    expect(burstScanCode(editou, 1_010 + DEPOIS_DO_SILENCIO)).toBeNull();
  });

  it("limpar o campo zera a rajada e deixa a próxima leitura começar limpa", () => {
    const { progress } = digitar(GTIN13, 15);
    const limpou = trackScanInput(progress, "", progress.at + 5);
    expect(limpou.burst).toBe(false);
    expect(burstScanCode(limpou, limpou.at + DEPOIS_DO_SILENCIO)).toBeNull();
    // E o próximo código entra normalmente, sem carregar nada do anterior —
    // é o ciclo real do balcão: passa produto, adiciona, limpa, passa o próximo.
    const segunda = digitar(GTIN13, 15, limpou);
    expect(burstScanCode(segunda.progress, segunda.progress.at + DEPOIS_DO_SILENCIO)).toBe(GTIN13);
  });

  it("duas leituras seguidas sem limpar o campo não viram um código só", () => {
    // Se o PDV esquecesse de limpar, o segundo código se concatenaria ao
    // primeiro — 26 caracteres, que não são GTIN de comprimento nenhum.
    expect(codigoAoFimDaRajada(GTIN13 + GTIN13, 15)).toBeNull();
  });
});

describe("submittedCode — o Enter do leitor e o código digitado na mão", () => {
  it("devolve o texto do campo, sem exigir rajada nem GTIN válido", () => {
    // É o mesmo caminho para o sufixo do leitor e para o botão "Digitar
    // código". Não olha o relógio: um código digitado devagar e confirmado
    // com Enter tem que funcionar.
    expect(submittedCode(GTIN13)).toBe(GTIN13);
    expect(submittedCode("9780132350880")).toBe("9780132350880"); // verificador errado
    expect(submittedCode("coca")).toBe("coca");
  });

  it("apara espaço em volta — alguns leitores mandam espaço antes do CR", () => {
    expect(submittedCode(`  ${GTIN13} `)).toBe(GTIN13);
  });

  it("devolve null quando não há nada para submeter", () => {
    // Enter num campo vazio não pode disparar busca nenhuma.
    expect(submittedCode("")).toBeNull();
    expect(submittedCode("   ")).toBeNull();
  });
});
