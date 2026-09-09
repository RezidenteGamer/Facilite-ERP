import { describe, expect, it } from "vitest";

import {
  describeRefOrigin,
  saleFiscalRef,
  saleReturnFiscalRef,
} from "@fiscal-core/refs.ts";

import {
  decideAcessoPorSegredo,
  segredosIguais,
} from "../../supabase/functions/_shared/http/sharedSecret.ts";
import {
  REF_TAMANHO_MAXIMO,
  leNotificacaoFocus,
} from "../../supabase/functions/fiscal-webhook/payload.ts";

/**
 * A8 (09/09/2026) — as duas decisões que a Edge Function `fiscal-webhook`
 * acrescenta e que cabem num teste sem rede: **quem entra** (o segredo
 * compartilhado) e **o que se lê do que entrou** (a notificação da Focus).
 *
 * O que **não** está aqui, e é de propósito:
 *
 * - **A decisão sobre a resposta do provedor.** Ela é de A6 (`decideConsulta`),
 *   coberta em `fiscalEmitReservation.test.ts`, e A8 a chama sem reimplementar —
 *   ver `reconciliaComProvedor` em `fiscal-emit/reconcile.ts`. Se um teste de A8
 *   precisasse cobrir "reserva + provedor respondeu autorizado", seria sinal de
 *   que esta tarefa duplicou lógica; ele não precisa, e não existe.
 * - **O despacho HTTP.** `index.ts` importa `jsr:@supabase/supabase-js@2` e não
 *   é importável de dentro do Vitest — o mesmo motivo pelo qual `reservation.ts`
 *   e `queue.ts` nasceram sem I/O. Foi por isso que a leitura do corpo e a
 *   decisão de acesso moram em arquivos separados.
 *
 * ## Sobre o payload de exemplo
 *
 * Os corpos usados abaixo são **os exemplos literais da documentação da Focus**,
 * copiados de <https://doc.focusnfe.com.br/reference/consultar_nfe.md>
 * (definição OpenAPI, `components.examples`, `updatedAt` 12/08/2026, acesso em
 * 09/09/2026) — os quatro estados que a consulta de NF-e pode devolver.
 *
 * **Eles são exemplos da consulta, não da notificação, e isso é dito de
 * propósito.** A página de gatilhos
 * (<https://doc.focusnfe.com.br/reference/webhooks>, `updatedAt` 10/04/2026)
 * afirma que "os dados do documento são enviados em formato JSON via método
 * POST" e que "cada acionamento do gatilho contém os dados de apenas um
 * documento", mas **não** publica a lista de campos nem um exemplo do corpo —
 * conferido no índice inteiro (`doc.focusnfe.com.br/llms.txt`, acesso em
 * 09/09/2026). Usar o corpo documentado mais próximo, dizendo que é o mais
 * próximo, é mais honesto que inventar um.
 *
 * E é exatamente por essa lacuna que a leitura extrai **só a identidade** do
 * documento: o desfecho vem do `provider.query(ref)` que roda depois. Se um dia
 * alguém quiser escrever `chave`/`status` direto do corpo, o teste
 * "não devolve nada que se pareça com escrituração" abaixo é onde isso quebra.
 */

/** <https://doc.focusnfe.com.br/reference/consultar_nfe.md> — `NFeAutorizada`. */
const NFE_AUTORIZADA = {
  cnpj_emitente: "12345678000123",
  ref: "referencia_000899_nfe",
  status: "autorizado",
  status_sefaz: "100",
  mensagem_sefaz: "Autorizado o uso da NF-e",
  chave_nfe: "NFe41190612345678000123550010000000221923094166",
  numero: "22",
  serie: "1",
  caminho_xml_nota_fiscal:
    "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-nfe.xml",
  caminho_danfe:
    "/arquivos/12345678000123/201906/DANFEs/41190612345678000123550010000000221923094166.pdf",
};

/** Mesma fonte — `ProcessandoAutorizacao`. É o corpo mais magro que existe. */
const NFE_PROCESSANDO = {
  cnpj_emitente: "12345678000123",
  ref: "referencia_000899_nfe",
  status: "processando_autorizacao",
};

/** Mesma fonte — `CanceladaResponse`. */
const NFE_CANCELADA = {
  cnpj_emitente: "12345678000123",
  ref: "referencia_000899_nfe",
  status: "cancelado",
  status_sefaz: "135",
  mensagem_sefaz: "Evento registrado e vinculado a NF-e",
  chave_nfe: "NFe41190612345678000123550010000000221923094166",
  numero: "22",
  serie: "1",
  caminho_xml_nota_fiscal:
    "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-nfe.xml",
  caminho_danfe:
    "/arquivos/12345678000123/201906/DANFEs/41190612345678000123550010000000221923094166.pdf",
  caminho_xml_cancelamento:
    "/arquivos/12345678000123/201906/XMLs/41190612345678000123550010000000221923094166-can.xml",
};

/** Mesma fonte — `ErroAutorizacaoResponse`. O único que traz a lista `erros`. */
const NFE_ERRO_AUTORIZACAO = {
  cnpj_emitente: "12345678000123",
  ref: "referencia_000899_nfe",
  status: "erro_autorizacao",
  status_sefaz: "598",
  mensagem_sefaz:
    "Rejeição: Total da NF difere do somatório dos valores que compõe o valor total da NF",
  erros: [
    {
      codigo: "",
      mensagem: "Total da NF difere do somatório dos valores que compõe o valor total da NF",
    },
  ],
};

describe("A8 — leitura da notificação da Focus", () => {
  it("lê a `ref` do exemplo de nota autorizada da documentação", () => {
    const leitura = leNotificacaoFocus(NFE_AUTORIZADA);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;

    expect(leitura.notificacao.ref).toBe("referencia_000899_nfe");
    expect(leitura.notificacao.cnpjEmitente).toBe("12345678000123");
    expect(leitura.notificacao.statusInformado).toBe("autorizado");
  });

  it("lê os quatro estados que a consulta de NF-e documenta", () => {
    const casos: Array<[Record<string, unknown>, string]> = [
      [NFE_AUTORIZADA, "autorizado"],
      [NFE_PROCESSANDO, "processando_autorizacao"],
      [NFE_CANCELADA, "cancelado"],
      [NFE_ERRO_AUTORIZACAO, "erro_autorizacao"],
    ];

    for (const [corpo, status] of casos) {
      const leitura = leNotificacaoFocus(corpo);
      expect(leitura.ok).toBe(true);
      if (!leitura.ok) continue;
      expect(leitura.notificacao.ref).toBe("referencia_000899_nfe");
      expect(leitura.notificacao.statusInformado).toBe(status);
    }
  });

  it("o corpo mais magro (`processando_autorizacao`) é lido igual ao mais gordo", () => {
    // Importa porque é o estado que A12 vai receber primeiro: a Focus responde
    // 202 na emissão e notifica depois. Um leitor que exigisse `chave_nfe` ou
    // `status_sefaz` recusaria justamente a primeira notificação de toda nota.
    const leitura = leNotificacaoFocus(NFE_PROCESSANDO);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.notificacao.ref).toBe("referencia_000899_nfe");
  });

  it("registra os nomes das chaves recebidas, ordenados — nunca os valores", () => {
    // É o que vai documentar, por observação, o formato que a documentação da
    // Focus não documenta (ver o cabeçalho de `payload.ts`). Os valores ficam
    // de fora de propósito: são dado fiscal.
    const leitura = leNotificacaoFocus(NFE_PROCESSANDO);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;

    expect(leitura.notificacao.campos).toEqual(["cnpj_emitente", "ref", "status"]);
    expect(leitura.notificacao.campos).toEqual([...leitura.notificacao.campos].sort());

    const gorda = leNotificacaoFocus(NFE_CANCELADA);
    if (!gorda.ok) throw new Error("o exemplo de nota cancelada deveria ser legível");
    expect(gorda.notificacao.campos).toContain("caminho_xml_cancelamento");
    expect(JSON.stringify(gorda.notificacao.campos)).not.toContain("41190612345678");
  });

  it("não devolve nada que se pareça com escrituração fiscal", () => {
    // A trava da decisão central de A8: o corpo é aviso, não extrato. Se alguém
    // acrescentar `chave`, `numero`, `protocolo` ou artefato aqui, é porque a
    // notificação voltou a ser tratada como fonte da verdade — e aí este teste
    // quebra antes de a nota errada ser gravada.
    const leitura = leNotificacaoFocus(NFE_AUTORIZADA);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;

    expect(Object.keys(leitura.notificacao).sort()).toEqual([
      "campos",
      "cnpjEmitente",
      "ref",
      "statusInformado",
    ]);
  });

  it("`statusInformado` aceita qualquer texto — ele não é validado, porque não decide nada", () => {
    const leitura = leNotificacaoFocus({ ref: "venda-1", status: "estado_que_nao_existe" });
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.notificacao.statusInformado).toBe("estado_que_nao_existe");
  });

  it("recusa o que não é um objeto JSON", () => {
    for (const corpo of [null, undefined, 42, "referencia_000899_nfe", true, [NFE_AUTORIZADA]]) {
      const leitura = leNotificacaoFocus(corpo);
      expect(leitura.ok).toBe(false);
    }
  });

  it("recusa a notificação sem `ref` utilizável", () => {
    for (const corpo of [{}, { ref: "" }, { ref: "   " }, { ref: 12345 }, { ref: null }]) {
      const leitura = leNotificacaoFocus(corpo);
      expect(leitura.ok).toBe(false);
      if (leitura.ok) continue;
      expect(leitura.motivo).toContain("ref");
    }
  });

  it("recusa uma `ref` longa demais para ser nossa", () => {
    const nossa = saleFiscalRef("0f8b2c4e-1d3a-4b5c-8e9f-0a1b2c3d4e5f");
    expect(nossa.length).toBeLessThan(REF_TAMANHO_MAXIMO);

    const noLimite = leNotificacaoFocus({ ref: "r".repeat(REF_TAMANHO_MAXIMO) });
    expect(noLimite.ok).toBe(true);

    const passou = leNotificacaoFocus({ ref: "r".repeat(REF_TAMANHO_MAXIMO + 1) });
    expect(passou.ok).toBe(false);
  });

  it("apara espaço em volta da `ref` — a consulta ao banco é por igualdade exata", () => {
    const leitura = leNotificacaoFocus({ ref: "  venda-abc  " });
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.notificacao.ref).toBe("venda-abc");
  });

  it("`cnpj_emitente` e `status` ausentes viram nulo, não recusa", () => {
    const leitura = leNotificacaoFocus({ ref: "venda-abc" });
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.notificacao.cnpjEmitente).toBeNull();
    expect(leitura.notificacao.statusInformado).toBeNull();
  });
});

describe("A8 — a origem lida da própria `ref`", () => {
  it("distingue venda de devolução pelo formato que `refs.ts` escreve", () => {
    expect(describeRefOrigin(saleFiscalRef("abc"))).toBe("venda");
    expect(describeRefOrigin(saleReturnFiscalRef("abc"))).toBe("devolução");
  });

  it("uma `ref` de formato desconhecido cai em 'venda' e não quebra nada", () => {
    // A palavra só entra em texto de mensagem (`decideConsulta`), nunca em
    // despacho — errar nela não muda nenhuma escrita.
    expect(describeRefOrigin("referencia_000899_nfe")).toBe("venda");
  });
});

describe("A8 — o porteiro do segredo compartilhado", () => {
  const porta = { porta: "A notificação fiscal", variavel: "FISCAL_WEBHOOK_SECRET" };

  it("falha fechada: sem o segredo configurado, responde 503 e não deixa entrar", () => {
    // É o que "construída e desligada" significa neste código: hoje a variável
    // não existe em produção, e todo POST para em 503 antes de tocar o banco.
    for (const configurado of [undefined, null, "", "   "]) {
      const recusa = decideAcessoPorSegredo("qualquer-coisa", configurado, porta);
      expect(recusa?.status).toBe(503);
      expect(recusa?.error).toContain("FISCAL_WEBHOOK_SECRET");
    }
  });

  it("503 e 401 dizem coisas diferentes, de propósito", () => {
    // 503 é "esta porta não está configurada" (problema nosso, insista depois);
    // 401 é "você não é quem devia chamar". A Focus reenvia nos dois casos, e
    // quem lê o painel dela precisa saber qual dos dois aconteceu.
    expect(decideAcessoPorSegredo("errado", undefined, porta)?.status).toBe(503);
    expect(decideAcessoPorSegredo("errado", "certo", porta)?.status).toBe(401);
  });

  it("recusa header ausente, vazio e errado; aceita o certo", () => {
    expect(decideAcessoPorSegredo(null, "segredo", porta)?.status).toBe(401);
    expect(decideAcessoPorSegredo("", "segredo", porta)?.status).toBe(401);
    expect(decideAcessoPorSegredo("segred", "segredo", porta)?.status).toBe(401);
    expect(decideAcessoPorSegredo("segredoo", "segredo", porta)?.status).toBe(401);
    expect(decideAcessoPorSegredo("Segredo", "segredo", porta)?.status).toBe(401);
    expect(decideAcessoPorSegredo("segredo", "segredo", porta)).toBeNull();
  });

  it("apara o segredo configurado, mas não o recebido", () => {
    // A variável de ambiente costuma vir com quebra de linha de um copiar/colar,
    // e recusar por isso seria um chamado de suporte sem causa. O header, não:
    // o que a Focus manda é literalmente o valor cadastrado, e aparar ali faria
    // dois segredos diferentes valerem o mesmo.
    expect(decideAcessoPorSegredo("segredo", "  segredo\n", porta)).toBeNull();
    expect(decideAcessoPorSegredo(" segredo ", "segredo", porta)?.status).toBe(401);
  });

  it("a comparação é de tempo constante e não mente sobre igualdade", () => {
    expect(segredosIguais("abc", "abc")).toBe(true);
    expect(segredosIguais("abc", "abd")).toBe(false);
    expect(segredosIguais("abc", "abcd")).toBe(false);
    expect(segredosIguais("", "")).toBe(true);
    expect(segredosIguais("", "a")).toBe(false);
    // Bytes, não caracteres: um segredo com acento tem de comparar igual a si
    // mesmo e diferente de um vizinho do mesmo comprimento visual.
    expect(segredosIguais("segredão", "segredão")).toBe(true);
    expect(segredosIguais("segredão", "segredao")).toBe(false);
  });
});
