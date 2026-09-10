import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  branchCertificado,
  branchColumnsFromForm,
  certificadoStatus,
  certificadoStatusLabel,
  COLUNAS_CERTIFICADO,
  diasAteVencimento,
  EMPTY_BRANCH_FORM,
  LIMIAR_AVISO_VENCIMENTO_DIAS,
  MOTIVO_CERTIFICADO_DESLIGADO,
  relacaoCnpjCertificado,
  resumoCertificado,
  type BranchAdmin,
  type BranchCertificado,
  type CertificadoStatus,
} from "../../src/features/settings/branches";

/**
 * A11 — certificado digital A1 da filial.
 *
 * Duas coisas muito diferentes são travadas aqui, e vale dizer qual é qual:
 *
 * 1. **O vocabulário de status derivado das datas** — puro, sem rede e sem
 *    relógio: toda função recebe o "hoje" como parâmetro, para que um teste de
 *    limiar não vire um teste que passa hoje e reprova em 1º de março.
 * 2. **A garantia de que o arquivo e a senha do certificado não entram neste
 *    sistema** — e essa não dá para provar chamando função, porque a garantia
 *    é justamente a *ausência* de código. Então ela é provada lendo o fonte:
 *    ver o último bloco.
 */

/** Um "hoje" fixo, para os testes de limiar não dependerem do calendário. */
const HOJE = "2026-09-09";

function cert(overrides: Partial<BranchCertificado> = {}): BranchCertificado {
  return { validoDe: null, validoAte: null, cnpj: null, ...overrides };
}

describe("diasAteVencimento", () => {
  it("conta dias inteiros até o fim da validade", () => {
    expect(diasAteVencimento("2026-09-19", HOJE)).toBe(10);
    expect(diasAteVencimento("2027-09-09", HOJE)).toBe(365);
  });

  it("devolve 0 no dia do vencimento e negativo depois dele", () => {
    expect(diasAteVencimento("2026-09-09", HOJE)).toBe(0);
    expect(diasAteVencimento("2026-09-08", HOJE)).toBe(-1);
    expect(diasAteVencimento("2026-08-09", HOJE)).toBe(-31);
  });

  it("devolve null sem data", () => {
    expect(diasAteVencimento(null, HOJE)).toBeNull();
    expect(diasAteVencimento("", HOJE)).toBeNull();
  });

  /*
   * `Date.UTC` normaliza em silêncio: 2026-02-31 viraria 3 de março, e a
   * conta devolveria um número plausível a partir de uma data que não existe.
   */
  it("recusa data que não existe no calendário em vez de normalizá-la", () => {
    expect(diasAteVencimento("2026-02-31", HOJE)).toBeNull();
    expect(diasAteVencimento("2026-13-01", HOJE)).toBeNull();
    expect(diasAteVencimento("09/09/2026", HOJE)).toBeNull();
    expect(diasAteVencimento("nao é data", HOJE)).toBeNull();
  });

  /*
   * A conta é em UTC de propósito. Em fuso local, a diferença entre duas
   * meia-noites que atravessam a virada do horário de verão dá 23 ou 25 horas,
   * e uma divisão por 24h devolveria 29,96 dias onde deveria devolver 30 —
   * exatamente em cima do limiar do aviso.
   */
  it("não perde nem ganha um dia atravessando a virada do horário de verão", () => {
    expect(diasAteVencimento("2026-11-01", "2026-10-01")).toBe(31);
    expect(diasAteVencimento("2027-03-01", "2027-02-01")).toBe(28);
  });

  /*
   * A leitura é da parte de **data** da string, não do instante: o fuso é
   * ignorado. Isso é correto porque as colunas de A11 são `date`, e o
   * PostgREST devolve `YYYY-MM-DD` — não há instante para interpretar.
   *
   * **Aviso para A12**: se algum dia essas colunas virarem `timestamptz`, esta
   * truncagem passa a errar por um dia — `2026-09-20T02:00:00Z` é 19/09 às 23h
   * em São Paulo e seria lido como dia 20. O teste está aqui para travar o
   * comportamento de hoje **e** para que essa mudança de tipo não passe
   * despercebida.
   */
  it("usa a parte da data de um timestamp, ignorando hora e fuso", () => {
    expect(diasAteVencimento("2026-09-19T23:59:59-03:00", HOJE)).toBe(10);
    expect(diasAteVencimento("2026-09-20T02:00:00Z", HOJE)).toBe(11);
  });
});

describe("certificadoStatus — o vocabulário", () => {
  it("sem_certificado quando não há data de fim de validade", () => {
    expect(certificadoStatus(cert(), HOJE)).toBe("sem_certificado");
  });

  /*
   * `validoAte` é a âncora: é a única das três colunas sobre a qual dá para
   * agir. Ter as outras duas sem ela não muda nada.
   */
  it("sem_certificado mesmo com CNPJ e início de validade gravados", () => {
    expect(
      certificadoStatus(cert({ validoDe: "2026-01-01", cnpj: "00.000.000/0001-91" }), HOJE),
    ).toBe("sem_certificado");
  });

  /*
   * Direção segura: sem conseguir ler a data não dá para avisar de nada, e
   * "não cadastrado" empurra o operador para a ação certa. Dizer "válido" em
   * cima de dado corrompido é que seria perigoso.
   */
  it("sem_certificado quando a data é ilegível, em vez de fingir validade", () => {
    expect(certificadoStatus(cert({ validoAte: "2026-02-31" }), HOJE)).toBe("sem_certificado");
    expect(certificadoStatus(cert({ validoAte: "vai vencer um dia" }), HOJE)).toBe("sem_certificado");
  });

  it("valido quando falta mais que o limiar", () => {
    expect(certificadoStatus(cert({ validoAte: "2027-09-09" }), HOJE)).toBe("valido");
  });

  it("vencido quando o prazo já passou", () => {
    expect(certificadoStatus(cert({ validoAte: "2026-09-08" }), HOJE)).toBe("vencido");
    expect(certificadoStatus(cert({ validoAte: "2020-01-01" }), HOJE)).toBe("vencido");
  });

  it("no dia do vencimento ainda é vencendo, não vencido — o prazo é o dia todo", () => {
    expect(certificadoStatus(cert({ validoAte: HOJE }), HOJE)).toBe("vencendo");
  });

  it("nao_vigente quando a validade ainda não começou", () => {
    expect(
      certificadoStatus(cert({ validoDe: "2026-10-01", validoAte: "2027-10-01" }), HOJE),
    ).toBe("nao_vigente");
  });

  /*
   * Um certificado vencido *e* com início no futuro é dado sem sentido; entre
   * as duas leituras, "já passou" é a que para a emissão, então é a que sai.
   */
  it("vencido ganha de nao_vigente quando os dois se aplicariam", () => {
    expect(
      certificadoStatus(cert({ validoDe: "2027-01-01", validoAte: "2026-01-01" }), HOJE),
    ).toBe("vencido");
  });

  it("já vigente no próprio dia de início não é nao_vigente", () => {
    expect(certificadoStatus(cert({ validoDe: HOJE, validoAte: "2027-09-09" }), HOJE)).toBe("valido");
  });
});

describe("certificadoStatus — as bordas exatas do limiar de 30 dias", () => {
  /*
   * O limiar é lido da constante, não repetido como número: se alguém mudar
   * 30 para 45, este bloco continua testando a borda certa em vez de virar
   * uma reprovação enigmática.
   */
  function daquiADias(dias: number): string {
    const base = Date.UTC(2026, 8, 9); // 2026-09-09, o mesmo HOJE
    return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
  }

  it("exatamente no limiar ainda é vencendo", () => {
    const validoAte = daquiADias(LIMIAR_AVISO_VENCIMENTO_DIAS);
    expect(diasAteVencimento(validoAte, HOJE)).toBe(LIMIAR_AVISO_VENCIMENTO_DIAS);
    expect(certificadoStatus(cert({ validoAte }), HOJE)).toBe("vencendo");
  });

  it("um dia além do limiar já é valido", () => {
    const validoAte = daquiADias(LIMIAR_AVISO_VENCIMENTO_DIAS + 1);
    expect(certificadoStatus(cert({ validoAte }), HOJE)).toBe("valido");
  });

  it("um dia aquém do limiar continua vencendo", () => {
    const validoAte = daquiADias(LIMIAR_AVISO_VENCIMENTO_DIAS - 1);
    expect(certificadoStatus(cert({ validoAte }), HOJE)).toBe("vencendo");
  });

  it("o limiar é 30 dias — a decisão está registrada, não é acidente", () => {
    expect(LIMIAR_AVISO_VENCIMENTO_DIAS).toBe(30);
  });
});

describe("certificadoStatusLabel", () => {
  it("tem rótulo para os cinco estados, e nenhum deles vazio", () => {
    const estados: CertificadoStatus[] = [
      "sem_certificado",
      "nao_vigente",
      "valido",
      "vencendo",
      "vencido",
    ];
    for (const estado of estados) {
      expect(certificadoStatusLabel(estado).trim().length).toBeGreaterThan(0);
    }
    expect(certificadoStatusLabel("vencido")).toBe("Vencido");
    expect(certificadoStatusLabel("sem_certificado")).toBe("Não cadastrado");
  });
});

describe("relacaoCnpjCertificado — a raiz, não os 14 dígitos", () => {
  /*
   * Este é o teste que impede o alarme falso em massa. Um certificado e-CNPJ
   * da matriz assina nota das filiais: o que se exige é que a RAIZ (8 primeiros
   * dígitos) bata. Comparar o CNPJ inteiro acusaria toda filial não-matriz de
   * estar com o certificado errado.
   */
  it("mesma_raiz quando é o certificado da matriz servindo a filial", () => {
    expect(relacaoCnpjCertificado("11.222.333/0002-04", "11.222.333/0001-81")).toBe("mesma_raiz");
  });

  it("mesma_empresa quando os 14 dígitos batem", () => {
    expect(relacaoCnpjCertificado("11.222.333/0001-81", "11222333000181")).toBe("mesma_empresa");
  });

  it("divergente só quando a raiz não bate", () => {
    expect(relacaoCnpjCertificado("11.222.333/0001-81", "00.000.000/0001-91")).toBe("divergente");
  });

  it("indeterminada sem dado dos dois lados, ou com CNPJ incompleto", () => {
    expect(relacaoCnpjCertificado(null, "11222333000181")).toBe("indeterminada");
    expect(relacaoCnpjCertificado("11222333000181", null)).toBe("indeterminada");
    expect(relacaoCnpjCertificado("", "")).toBe("indeterminada");
    expect(relacaoCnpjCertificado("11222333", "11222333000181")).toBe("indeterminada");
  });
});

describe("resumoCertificado — o que a tela mostra", () => {
  it("não avisa nada sobre certificado válido e da própria empresa", () => {
    const resumo = resumoCertificado(
      cert({ validoDe: "2026-09-01", validoAte: "2027-09-01", cnpj: "11.222.333/0001-81" }),
      "11.222.333/0001-81",
      HOJE,
    );
    expect(resumo.status).toBe("valido");
    expect(resumo.aviso).toBeNull();
    expect(resumo.detalhe).toContain("01/09/2026");
    expect(resumo.detalhe).toContain("01/09/2027");
  });

  it("não avisa quando é o certificado da matriz servindo a filial", () => {
    const resumo = resumoCertificado(
      cert({ validoAte: "2027-09-01", cnpj: "11.222.333/0001-81" }),
      "11.222.333/0002-04",
      HOJE,
    );
    expect(resumo.relacaoCnpj).toBe("mesma_raiz");
    expect(resumo.aviso).toBeNull();
  });

  it("avisa do vencimento próximo, com o prazo em dias", () => {
    const resumo = resumoCertificado(cert({ validoAte: "2026-09-19" }), null, HOJE);
    expect(resumo.status).toBe("vencendo");
    expect(resumo.aviso).toContain("vence em 10 dias");
  });

  it("usa 'vence hoje' e 'venceu ontem' em vez de contar zero e um", () => {
    expect(resumoCertificado(cert({ validoAte: HOJE }), null, HOJE).aviso).toContain("vence hoje");
    expect(resumoCertificado(cert({ validoAte: "2026-09-08" }), null, HOJE).aviso).toContain(
      "venceu ontem",
    );
    expect(resumoCertificado(cert({ validoAte: "2026-09-10" }), null, HOJE).aviso).toContain(
      "vence amanhã",
    );
  });

  it("avisa que a filial parou de emitir quando venceu", () => {
    const resumo = resumoCertificado(cert({ validoAte: "2026-08-09" }), null, HOJE);
    expect(resumo.status).toBe("vencido");
    expect(resumo.aviso).toContain("não emite nota fiscal");
  });

  /*
   * Os dois problemas somam, não se substituem: quem está consertando um
   * certificado precisa ver os dois de uma vez, não descobrir o segundo
   * depois de resolver o primeiro.
   */
  it("acumula o aviso de vencimento e o de CNPJ divergente", () => {
    const resumo = resumoCertificado(
      cert({ validoAte: "2026-08-09", cnpj: "00.000.000/0001-91" }),
      "11.222.333/0001-81",
      HOJE,
    );
    expect(resumo.aviso).toContain("venceu");
    expect(resumo.aviso).toContain("00.000.000/0001-91");
  });

  it("sem certificado: diz isso, e não avisa de vencimento nenhum", () => {
    const resumo = resumoCertificado(cert(), "11.222.333/0001-81", HOJE);
    expect(resumo.status).toBe("sem_certificado");
    expect(resumo.rotulo).toBe("Não cadastrado");
    expect(resumo.aviso).toBeNull();
    expect(resumo.detalhe).toContain("Nenhum certificado");
  });
});

describe("branchCertificado", () => {
  it("extrai os três campos da filial lida", () => {
    const branch = {
      certificadoValidoDe: "2026-09-01",
      certificadoValidoAte: "2027-09-01",
      certificadoCnpj: "11.222.333/0001-81",
    } as BranchAdmin;
    expect(branchCertificado(branch)).toEqual({
      validoDe: "2026-09-01",
      validoAte: "2027-09-01",
      cnpj: "11.222.333/0001-81",
    });
  });
});

/* ------------------------------------------------------------------ *
 * A garantia central de A11: o certificado não entra neste sistema.
 *
 * Esta parte é diferente do resto do arquivo. As outras provam que uma função
 * devolve o que deve; estas provam que **certo código não existe** — e código
 * que não existe não se prova chamando função nenhuma. Então elas leem o fonte
 * e reprovam se ele ganhar o que não pode ter.
 *
 * Parece indireto, e é a única forma direta que existe para esta afirmação. Um
 * teste que montasse um `File` e verificasse que "nada aconteceu" provaria
 * menos: ele passaria igual se alguém acrescentasse um `FileReader` num
 * caminho que aquele teste não exercita.
 * ------------------------------------------------------------------ */

function fonte(caminhoRelativo: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../src/features/settings/${caminhoRelativo}`, import.meta.url)),
    "utf-8",
  );
}

/**
 * O fonte sem comentários.
 *
 * Não é refinamento: sem isto o teste **reprova o próprio arquivo que ele
 * protege**. `BranchCertificateSection.tsx` explica, num comentário de cabeçalho,
 * que não usa `FileReader`, `arrayBuffer`, `btoa` e companhia — e a varredura
 * encontraria cada um desses nomes ali, na frase que diz que eles não estão lá.
 * A alternativa (não escrever a explicação) trocaria a documentação da decisão
 * mais importante de A11 por um teste mais fácil de escrever.
 *
 * Blocos `/* ... *\/` primeiro (é a forma de todo JSDoc e de todo comentário
 * dentro de JSX), depois as linhas que começam com `//`. Linha iniciada por
 * `//`, e não `//` em qualquer posição, para não estragar uma `https://` que
 * apareça dentro de uma string.
 */
function codigoSemComentarios(caminhoRelativo: string): string {
  return fonte(caminhoRelativo)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Toda forma de ler o conteúdo de um `File` no navegador. A lista é de APIs, e
 * não de nomes de variável, de propósito: não dá para ler um arquivo em JS sem
 * passar por uma delas.
 */
const APIS_DE_LEITURA_DE_ARQUIVO = [
  "FileReader",
  "readAsArrayBuffer",
  "readAsDataURL",
  "readAsBinaryString",
  "readAsText",
  "arrayBuffer",
  "createObjectURL",
  "btoa",
];

/** Formas de mandar o que foi lido embora, ou de deixá-lo em algum lugar. */
const APIS_DE_SAIDA = [
  "FormData",
  "fetch(",
  "XMLHttpRequest",
  "supabase",
  "navigator.clipboard",
  "localStorage",
  "sessionStorage",
  "indexedDB",
];

describe("BranchCertificateSection: não tem como ler o certificado nem mandá-lo embora", () => {
  const codigo = () => codigoSemComentarios("BranchCertificateSection.tsx");

  /*
   * As duas metades são cobradas **deste** arquivo, e só dele, porque é ele o
   * único lugar do sistema com campo de certificado — e, ao contrário do modal
   * que o hospeda, ele não tem nenhuma outra razão para tocar em rede.
   */
  it("não usa nenhuma API de leitura de arquivo", () => {
    expect(APIS_DE_LEITURA_DE_ARQUIVO.filter((api) => codigo().includes(api))).toEqual([]);
  });

  it("não usa nenhuma API de rede nem de armazenamento", () => {
    expect(APIS_DE_SAIDA.filter((api) => codigo().includes(api))).toEqual([]);
  });

  /*
   * O ponto central: sem manipulador não existe função capaz de receber um
   * `File`, e o objeto nunca entra em estado de React nenhum. A checagem é do
   * arquivo inteiro, e não do texto da tag, porque `onChange={(e) => …}` tem um
   * `>` dentro — um casamento de tag pararia nele e o teste reprovaria dizendo
   * que o campo sumiu, mandando quem lê procurar a coisa errada.
   */
  it("não tem manipulador de mudança em campo nenhum", () => {
    expect(codigo()).not.toContain("onChange");
  });

  it("não guarda estado nenhum", () => {
    expect(codigo()).not.toContain("useState");
  });

  it("o campo de arquivo existe e está desabilitado", () => {
    const campo = /<input\b[^>]*type="file"[^>]*\/>/s.exec(codigo());
    expect(campo, "o campo de arquivo do certificado sumiu da tela").not.toBeNull();
    expect(campo?.[0]).toContain("disabled");
    expect(campo?.[0]).not.toContain("ref=");
  });

  it("o campo de senha existe, está desabilitado e não guarda valor", () => {
    const campo = /<input\b[^>]*type="password"[^>]*\/>/s.exec(codigo());
    expect(campo, "o campo de senha do certificado sumiu da tela").not.toBeNull();
    expect(campo?.[0]).toContain("disabled");
    expect(campo?.[0]).not.toContain("value=");
    // Fecha a porta do gerenciador de senhas do navegador.
    expect(campo?.[0]).toContain('autoComplete="new-password"');
  });

  it("a tela explica por que o envio está desligado, em vez de só travar", () => {
    expect(MOTIVO_CERTIFICADO_DESLIGADO).toContain("A12");
    expect(codigo()).toContain("MOTIVO_CERTIFICADO_DESLIGADO");
  });
});

describe("BranchFormModal: o certificado não vaza para o formulário que o hospeda", () => {
  const codigo = () => codigoSemComentarios("BranchFormModal.tsx");

  /*
   * Aqui a cobrança é **mais estreita**, e de propósito. Este arquivo faz uma
   * chamada de rede legítima e antiga: `fetchCnpjData`, a busca de dados
   * públicos do CNPJ que D1 reaproveitou de Clientes. Cobrar dele "nenhuma API
   * de rede" seria uma asserção falsa que só passa por acidente de substring —
   * e uma asserção falsa que passa é pior que nenhuma, porque quem a lê conclui
   * algo que não é verdade.
   *
   * O que **é** verdade e importa: nada de certificado passa por aqui. Nenhuma
   * leitura de arquivo, nenhum campo de arquivo ou senha, nenhum armazenamento.
   */
  it("não usa nenhuma API de leitura de arquivo", () => {
    expect(APIS_DE_LEITURA_DE_ARQUIVO.filter((api) => codigo().includes(api))).toEqual([]);
  });

  it("não guarda nada no navegador", () => {
    const armazenamento = ["localStorage", "sessionStorage", "indexedDB", "navigator.clipboard"];
    expect(armazenamento.filter((api) => codigo().includes(api))).toEqual([]);
  });

  it("não tem campo de arquivo nem de senha próprio — os dois moram na seção", () => {
    expect(codigo()).not.toContain('type="file"');
    expect(codigo()).not.toContain('type="password"');
  });
});

describe("nada de certificado chega ao banco pelo formulário", () => {
  /*
   * A outra metade da garantia: mesmo que a tela mudasse, a tradução
   * formulário → colunas não tem por onde carregar certificado. As três
   * colunas de A11 são escritas pela resposta da Focus (A12), nunca daqui — e
   * arquivo e senha não têm coluna em lugar nenhum.
   */
  it("branchColumnsFromForm não escreve nenhuma coluna de certificado", () => {
    for (const includeEmail of [true, false]) {
      const colunas = branchColumnsFromForm(
        { ...EMPTY_BRANCH_FORM, code: "002", name: "Filial Norte", cnpj: "11.222.333/0001-81" },
        { includeEmail, includePix: includeEmail },
      );
      const chaves = Object.keys(colunas);
      for (const coluna of COLUNAS_CERTIFICADO) {
        expect(chaves).not.toContain(coluna);
      }
      expect(chaves.filter((chave) => /certificad|senha|pfx|p12/i.test(chave))).toEqual([]);
    }
  });

  it("BranchFormValues não tem campo de certificado nem de senha", () => {
    const chaves = Object.keys(EMPTY_BRANCH_FORM);
    expect(chaves.filter((chave) => /certificad|senha|arquivo/i.test(chave))).toEqual([]);
  });
});
