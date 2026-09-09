import { describe, expect, it } from "vitest";

import type { FiscalStatus } from "@fiscal-core/types.ts";

import {
  BACKOFF_TETO_MS,
  INTERVALO_TICK_MS,
  LIMIAR_RESERVA_ORFA_MS,
  TOLERANCIA_AGENDAMENTO_MS,
  agendarAposAguardar,
  agendarAposFalha,
  corteDeIdade,
  decideElegibilidade,
  selecionaLote,
  type CandidatoFila,
} from "../../supabase/functions/fiscal-emit/queue.ts";
import { RESERVA_STATUS } from "../../supabase/functions/fiscal-emit/reservation.ts";

/**
 * A7 (09/09/2026) — a metade da fila de reprocessamento que cabe num teste sem
 * rede.
 *
 * O que **não** está aqui, e é de propósito:
 *
 * - **A decisão sobre a resposta do provedor.** Ela é de A6 (`decideConsulta`),
 *   já coberta em `fiscalEmitReservation.test.ts`, e A7 a chama sem reimplementar
 *   — ver `reconciliaComProvedor` em `index.ts`.
 * - **O agendamento em si.** `pg_cron` não é testável em Vitest; a validação
 *   manual está escrita na seção 7 da migration
 *   `00000000000012_a7_fila_de_emissao_agendada.sql`.
 *
 * O que está aqui é a única decisão que A7 acrescenta: **o que entra na fila e o
 * que não entra**, e como uma tentativa que falhou é remarcada.
 *
 * O import de `queue.ts` é relativo pelo mesmo motivo do de `reservation.ts`:
 * `@fiscal-core` é o núcleo compartilhado com o front, e estes dois arquivos são
 * da Edge Function. Os dois foram escritos sem import de runtime justamente para
 * poderem ser lidos daqui.
 */

const AGORA = new Date("2026-09-09T12:00:00.000Z");

/** Um instante `ms` milissegundos antes de `AGORA`, em ISO. */
function atras(ms: number): string {
  return new Date(AGORA.getTime() - ms).toISOString();
}

/** Um instante `ms` milissegundos depois de `AGORA`, em ISO. */
function adiante(ms: number): string {
  return new Date(AGORA.getTime() + ms).toISOString();
}

function candidato(over: Partial<CandidatoFila> = {}): CandidatoFila {
  return {
    status: RESERVA_STATUS,
    reservadaEm: atras(LIMIAR_RESERVA_ORFA_MS + 60_000),
    fila: null,
    ...over,
  };
}

/* ------------------------------------------------------------------------ */
/* 1. O que entra na fila                                                    */
/* ------------------------------------------------------------------------ */

describe("decideElegibilidade — o que a varredura pergunta ao provedor", () => {
  it("consulta uma reserva mais velha que o limite de relógio da plataforma", () => {
    expect(decideElegibilidade(candidato(), AGORA)).toEqual({ kind: "consultar" });
  });

  it("consulta exatamente no limite — o limiar é o piso, não uma margem", () => {
    const noLimite = candidato({ reservadaEm: atras(LIMIAR_RESERVA_ORFA_MS) });
    expect(decideElegibilidade(noLimite, AGORA).kind).toBe("consultar");
  });

  it("ignora a reserva ainda nova: pode ser uma emissão em voo, e perguntar não traria informação nova", () => {
    const nova = candidato({ reservadaEm: atras(LIMIAR_RESERVA_ORFA_MS - 1) });
    const decisao = decideElegibilidade(nova, AGORA);
    expect(decisao.kind).toBe("ignorar");
    expect(decisao).toMatchObject({ motivo: expect.stringContaining("limite de relógio") });
  });

  it("ignora a reserva de agora mesmo", () => {
    expect(decideElegibilidade(candidato({ reservadaEm: AGORA.toISOString() }), AGORA).kind).toBe(
      "ignorar",
    );
  });
});

/* ------------------------------------------------------------------------ */
/* 2. O que NÃO entra na fila — a decisão de escopo desta tarefa             */
/* ------------------------------------------------------------------------ */

describe("decideElegibilidade — o que a fila não toca", () => {
  /**
   * A asserção mais importante do arquivo. A fila **não reemite nota**: uma
   * recusa da SEFAZ é determinística (um NCM inválido recusa igual para sempre,
   * consumindo crédito do provedor a cada tentativa), e reemitir consome
   * numeração, que ainda não é atômica (A10). Se alguém um dia afrouxar isto,
   * é aqui que vai quebrar primeiro.
   */
  it("só encosta em processando_autorizacao — nenhum outro estado do vocabulário entra", () => {
    const estados: FiscalStatus[] = [
      "processando_autorizacao",
      "autorizado",
      "cancelado",
      "erro_autorizacao",
      "denegado",
      "nao_encontrado",
    ];

    const entram = estados.filter(
      (status) => decideElegibilidade(candidato({ status }), AGORA).kind === "consultar",
    );

    expect(entram).toEqual([RESERVA_STATUS]);
  });

  it("ignora explicitamente erro_autorizacao, por mais velho que esteja", () => {
    const recusada = candidato({
      status: "erro_autorizacao",
      reservadaEm: atras(30 * 24 * 60 * 60_000),
    });
    expect(decideElegibilidade(recusada, AGORA)).toEqual({
      kind: "ignorar",
      motivo: "a linha não está mais reservada",
    });
  });

  it("ignora a linha que se resolveu entre a leitura dos candidatos e a decisão", () => {
    expect(decideElegibilidade(candidato({ status: "autorizado" }), AGORA).kind).toBe("ignorar");
  });
});

/* ------------------------------------------------------------------------ */
/* 3. O backoff decide quando perguntar de novo                              */
/* ------------------------------------------------------------------------ */

describe("decideElegibilidade — o backoff de uma tentativa que já falhou", () => {
  it("ignora enquanto a próxima tentativa não venceu", () => {
    const esperando = candidato({ fila: { tentativas: 2, proximaTentativaEm: adiante(60_000) } });
    const decisao = decideElegibilidade(esperando, AGORA);
    expect(decisao.kind).toBe("ignorar");
    expect(decisao).toMatchObject({ motivo: expect.stringContaining("ainda não venceu") });
  });

  it("consulta quando a próxima tentativa venceu", () => {
    const vencida = candidato({ fila: { tentativas: 4, proximaTentativaEm: atras(1) } });
    expect(decideElegibilidade(vencida, AGORA).kind).toBe("consultar");
  });

  it("consulta uma linha que já falhou muitas vezes — não existe limite de tentativas", () => {
    const insistente = candidato({ fila: { tentativas: 999, proximaTentativaEm: atras(60_000) } });
    expect(decideElegibilidade(insistente, AGORA).kind).toBe("consultar");
  });

  /**
   * A defasagem que `TOLERANCIA_AGENDAMENTO_MS` existe para corrigir: o
   * agendador dispara em 12:00:00, a linha é processada em 12:00:02 e a próxima
   * tentativa fica marcada para 12:05:02 — depois do tique das 12:05:00, que a
   * pularia. Sem a folga, cada degrau do backoff valeria um tique a mais que o
   * documentado.
   */
  it("aceita a tentativa marcada para logo depois do tique que deveria pegá-la", () => {
    const marcadaAdiante = candidato({
      fila: { tentativas: 1, proximaTentativaEm: adiante(2_000) },
    });
    expect(decideElegibilidade(marcadaAdiante, AGORA).kind).toBe("consultar");
  });

  it("a folga não engole um degrau inteiro do backoff", () => {
    const bemAdiante = candidato({
      fila: { tentativas: 1, proximaTentativaEm: adiante(TOLERANCIA_AGENDAMENTO_MS + 1_000) },
    });
    expect(decideElegibilidade(bemAdiante, AGORA).kind).toBe("ignorar");
    expect(TOLERANCIA_AGENDAMENTO_MS).toBeLessThan(INTERVALO_TICK_MS);
  });

  it("a idade da reserva é checada antes do backoff", () => {
    // Uma linha recém-reservada cuja entrada de fila já venceu continua sendo
    // nova demais: o limiar não é negociável pelo estado da fila.
    const nova = candidato({
      reservadaEm: atras(1_000),
      fila: { tentativas: 1, proximaTentativaEm: atras(60_000) },
    });
    expect(decideElegibilidade(nova, AGORA).kind).toBe("ignorar");
  });
});

/* ------------------------------------------------------------------------ */
/* 4. Datas ilegíveis: os dois erros não são simétricos                      */
/* ------------------------------------------------------------------------ */

describe("decideElegibilidade — data que não é data", () => {
  it("ignora quando a data da reserva é ilegível: sem ela o limiar não protege de nada", () => {
    const corrompida = candidato({ reservadaEm: "não é uma data" });
    const decisao = decideElegibilidade(corrompida, AGORA);
    expect(decisao.kind).toBe("ignorar");
    expect(decisao).toMatchObject({ motivo: expect.stringContaining("data da reserva") });
  });

  it("consulta quando a data da fila é ilegível: travar uma reserva órfã para sempre é o pior erro", () => {
    const corrompida = candidato({ fila: { tentativas: 1, proximaTentativaEm: "" } });
    expect(decideElegibilidade(corrompida, AGORA).kind).toBe("consultar");
  });
});

/* ------------------------------------------------------------------------ */
/* 5. O lote                                                                 */
/* ------------------------------------------------------------------------ */

describe("selecionaLote", () => {
  const identidade = (c: CandidatoFila) => c;

  it("mantém a ordem de entrada — quem espera há mais tempo é atendido primeiro", () => {
    const itens = [
      candidato({ reservadaEm: atras(3_000_000) }),
      candidato({ reservadaEm: atras(2_000_000) }),
      candidato({ reservadaEm: atras(1_000_000) }),
    ];
    expect(selecionaLote(itens, identidade, AGORA)).toEqual(itens);
  });

  it("pula os inelegíveis sem gastar vaga do lote", () => {
    const elegivel = candidato();
    const itens = [
      candidato({ status: "autorizado" }),
      elegivel,
      candidato({ reservadaEm: AGORA.toISOString() }),
      elegivel,
    ];
    expect(selecionaLote(itens, identidade, AGORA, 2)).toEqual([elegivel, elegivel]);
  });

  it("respeita o limite do lote", () => {
    const itens = Array.from({ length: 40 }, () => candidato());
    expect(selecionaLote(itens, identidade, AGORA, 25)).toHaveLength(25);
  });

  it("devolve lote vazio quando nada é elegível", () => {
    const itens = Array.from({ length: 10 }, () => candidato({ status: "erro_autorizacao" }));
    expect(selecionaLote(itens, identidade, AGORA)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* 6. O reagendamento depois de uma tentativa                                */
/* ------------------------------------------------------------------------ */

describe("agendarAposFalha", () => {
  const minutos = (n: number) => n * 60_000;

  it("cresce por um fator de 3 a partir do intervalo do tique", () => {
    const esperas = [0, 1, 2, 3].map(
      (anteriores) =>
        Date.parse(agendarAposFalha(anteriores, AGORA).proximaTentativaEm) - AGORA.getTime(),
    );
    expect(esperas).toEqual([minutos(5), minutos(15), minutos(45), minutos(135)]);
  });

  it("nunca remarca para antes do próximo tique", () => {
    const espera =
      Date.parse(agendarAposFalha(0, AGORA).proximaTentativaEm) - AGORA.getTime();
    expect(espera).toBeGreaterThanOrEqual(INTERVALO_TICK_MS);
  });

  it("para de crescer no teto de 6 horas", () => {
    for (const anteriores of [4, 5, 10, 999]) {
      const espera =
        Date.parse(agendarAposFalha(anteriores, AGORA).proximaTentativaEm) - AGORA.getTime();
      expect(espera).toBe(BACKOFF_TETO_MS);
    }
  });

  it("conta falhas consecutivas", () => {
    expect(agendarAposFalha(0, AGORA).tentativas).toBe(1);
    expect(agendarAposFalha(7, AGORA).tentativas).toBe(8);
  });
});

describe("agendarAposAguardar", () => {
  /**
   * "O provedor respondeu que ainda está processando" **não é falha** — ele
   * falou com a gente. Contá-la como falha faria o backoff abandonar a nota que
   * a fila existe para acompanhar até o fim, que é exatamente o caso normal da
   * emissão assíncrona de A12.
   */
  it("zera o contador de falhas e remarca para o próximo tique", () => {
    const agendamento = agendarAposAguardar(AGORA);
    expect(agendamento.tentativas).toBe(0);
    expect(Date.parse(agendamento.proximaTentativaEm) - AGORA.getTime()).toBe(INTERVALO_TICK_MS);
  });
});

describe("corteDeIdade", () => {
  it("é o instante a partir do qual uma reserva vira candidata", () => {
    expect(corteDeIdade(AGORA)).toBe(atras(LIMIAR_RESERVA_ORFA_MS));
  });

  it("concorda com decideElegibilidade nos dois lados do corte", () => {
    const corte = Date.parse(corteDeIdade(AGORA));
    const antes = candidato({ reservadaEm: new Date(corte - 1).toISOString() });
    const depois = candidato({ reservadaEm: new Date(corte + 1).toISOString() });
    expect(decideElegibilidade(antes, AGORA).kind).toBe("consultar");
    expect(decideElegibilidade(depois, AGORA).kind).toBe("ignorar");
  });
});
