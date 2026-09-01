/**
 * `SimulatedFiscalProvider` — implementação do `FiscalProvider` que não faz
 * chamada de rede nenhuma.
 *
 * Existe para o produto (Notas Emitidas, NFC-e, Devolução) poder ser construído
 * e validado **antes** de assumir CNPJ, certificado digital A1 e mensalidade de
 * provedor. Sem custo, sem I/O externo, sem dependência de nada — dá para rodar
 * num script, num teste ou no navegador sem configurar coisa alguma.
 *
 * ## Onde o estado mora
 *
 * Em memória, no próprio provedor (`Map` por `ref`). Isso é suficiente para o
 * contrato ser coerente dentro de uma sessão — não dá para cancelar um `ref` que
 * nunca foi emitido, e um `ref` cancelado continua respondendo `cancelado` numa
 * consulta seguinte. **Recarregar a página zera o registro**, e isso é de
 * propósito: quem persiste documento emitido é o módulo Notas Emitidas (etapa 8),
 * que tem tabela própria; duplicar essa persistência aqui criaria duas fontes
 * para o mesmo dado antes mesmo de a primeira existir. O provedor real também
 * não guarda nada localmente — quem guarda é a API dele.
 *
 * ## Determinismo
 *
 * `now` e `randomInt` são injetáveis para um teste poder fixar chave e protocolo.
 * Sem eles, o provedor usa relógio e aleatoriedade normais.
 *
 * ## `seed`: a borda devolve o estado que este provedor não guarda (A1, 01/09/2026)
 *
 * Enquanto quem emitia era o navegador, "estado em memória" significava "estado
 * da aba aberta": emitir e cancelar aconteciam na mesma instância, então o
 * `Map` bastava. A Edge Function `fiscal-emit` não tem essa continuidade — cada
 * requisição pode cair num isolate novo, e um cancelamento chegaria a um
 * provedor que nunca ouviu falar daquela `ref`, respondendo `nao_encontrado`
 * para uma nota que está `autorizado` no banco.
 *
 * A saída **não** foi dar banco ao provedor (ele existe justamente para não ter
 * I/O), e sim aceitar que a borda restaure o pouco que ele precisa lembrar:
 * `seed.documents` recoloca no `Map` as notas que a borda leu de
 * `fiscal_documents`, e `seed.lastNumbers` diz de onde a numeração continua.
 * O provedor real não precisa de nada disso — quem guarda o estado dele é a API
 * dele —, e é por isso que o parâmetro é opcional e vive só aqui, não no
 * contrato `FiscalProvider`.
 */

import { buildAccessKey, isValidAccessKey, onlyDigits, resolveUfCode } from "./accessKey.ts";
import { buildSimulatedQrCodeUrl } from "./nfceQrCode.ts";
import type { FiscalProvider } from "./provider.ts";
import {
  buildSimulatedCancelXml,
  buildSimulatedCorrectionXml,
  buildSimulatedDanfe,
  buildSimulatedInvalidationXml,
  buildSimulatedXml,
} from "./simulatedArtifacts.ts";
import type {
  FiscalArtifact,
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalCorrectionRequest,
  FiscalDocument,
  FiscalEmitRequest,
  FiscalEventResult,
  FiscalInvalidateRequest,
  FiscalModel,
  NfePayload,
} from "./types.ts";

/**
 * Uma nota que a borda já tinha guardado e está devolvendo ao provedor — ver
 * `seed` no cabeçalho.
 *
 * É `FiscalDocument` mais os dois campos que o provedor guarda por fora do
 * contrato: o CNPJ do emitente (que a inutilização precisa para saber de quem é
 * a faixa) e quantas cartas de correção a nota já tem (que decide o
 * `nSeqEvento` da próxima). Os dois são opcionais porque uma borda que só
 * precisa cancelar/consultar não tem obrigação de saber deles.
 */
export type SimulatedSeedDocument = FiscalDocument & {
  cnpjEmitente?: string;
  cartasCorrecao?: number;
};

/** O último número já usado numa combinação CNPJ + modelo (a série é a do provedor). */
export type SimulatedSeedNumbering = {
  cnpj: string;
  model: FiscalModel;
  /** A próxima emissão sai com `ultimoNumero + 1`. */
  ultimoNumero: number;
};

export type SimulatedFiscalProviderSeed = {
  documents?: SimulatedSeedDocument[];
  lastNumbers?: SimulatedSeedNumbering[];
};

export type SimulatedFiscalProviderOptions = {
  /** Relógio. Injetável para o teste fixar a data que entra na chave (AAMM). */
  now?: () => Date;
  /** Sorteio de inteiro em [0, max). Injetável para chave e protocolo determinísticos. */
  randomInt?: (max: number) => number;
  /** Série usada nas notas simuladas. */
  serie?: number;
  /** cUF de reserva quando a filial não tem UF nem código IBGE cadastrados. */
  fallbackUfCode?: string;
  /**
   * Estado restaurado pela borda que não consegue manter a instância viva entre
   * duas operações (a Edge Function `fiscal-emit`). Ver o cabeçalho do arquivo.
   */
  seed?: SimulatedFiscalProviderSeed;
};

type StoredDocument = FiscalDocument & {
  protocoloNumerico: string;
  /** Quantas cartas de correção já foram registradas (a SEFAZ aceita no máximo 20). */
  cartasCorrecao: number;
  /**
   * CNPJ do emitente, só dígitos. Não está em `FiscalDocument` (quem consulta
   * uma nota já sabe de quem ela é), mas a inutilização precisa dele para
   * responder "esse número já virou nota" olhando só a faixa daquele emitente.
   */
  cnpjEmitente: string;
};

/** Faixa de numeração já inutilizada, por CNPJ + modelo + série. */
type StoredInvalidation = {
  ref: string;
  cnpj: string;
  model: FiscalModel;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  result: FiscalEventResult;
};

/** Limite de cartas de correção por NF-e — regra da SEFAZ, não escolha nossa. */
const MAX_CARTAS_CORRECAO = 20;

/**
 * Validação **estrutural** do payload — só o que impede a nota de existir como
 * documento. Nada de regra tributária: alíquota, CFOP e CST são responsabilidade
 * do módulo Tributações (etapa 7), e esta camada não sabe nada sobre eles.
 *
 * Serve para os módulos consumidores exercitarem o caminho de recusa sem
 * depender de uma API real, que é justamente o caminho que ninguém testa.
 */
function validatePayload(payload: NfePayload): string[] {
  const problems: string[] = [];
  if (!payload.cnpj_emitente || onlyDigits(payload.cnpj_emitente).length !== 14) {
    problems.push("CNPJ do emitente ausente ou fora do formato de 14 dígitos");
  }
  if (!payload.nome_emitente?.trim()) problems.push("Nome do emitente ausente");
  if (!payload.natureza_operacao?.trim()) problems.push("Natureza da operação ausente");
  if (!payload.data_emissao?.trim()) problems.push("Data de emissão ausente");
  if (!payload.items?.length) problems.push("Nota sem itens");

  payload.items?.forEach((item) => {
    const onde = `item ${item.numero_item}`;
    if (!item.descricao?.trim()) problems.push(`${onde}: descrição ausente`);
    if (!item.cfop?.trim()) problems.push(`${onde}: CFOP ausente`);
    if (!item.codigo_ncm?.trim()) problems.push(`${onde}: NCM ausente`);
    if (!item.icms_situacao_tributaria?.trim()) {
      problems.push(`${onde}: situação tributária do ICMS (CST/CSOSN) ausente`);
    }
    if (!(item.quantidade_comercial > 0)) problems.push(`${onde}: quantidade deve ser maior que zero`);
  });

  return problems;
}

/**
 * Projeta o registro interno no que o contrato promete.
 *
 * O `Map` guarda dois campos a mais que `FiscalDocument` — o protocolo em
 * forma numérica (que o XML de evento precisa) e a contagem de cartas de
 * correção. Espalhar o registro inteiro (`{ ...stored }`) devolveria os dois
 * para quem chama, e um deles acabaria virando dependência de alguma tela sem
 * estar no contrato. Listar campo a campo custa uma linha por campo e, em
 * troca, quebra a compilação aqui se `FiscalDocument` ganhar um campo novo.
 */
function toDocument(stored: StoredDocument): FiscalDocument {
  return {
    ref: stored.ref,
    model: stored.model,
    status: stored.status,
    chave: stored.chave,
    numero: stored.numero,
    serie: stored.serie,
    protocolo: stored.protocolo,
    statusSefaz: stored.statusSefaz,
    mensagemSefaz: stored.mensagemSefaz,
    xml: stored.xml,
    pdf: stored.pdf,
    xmlCancelamento: stored.xmlCancelamento,
    qrCodeUrl: stored.qrCodeUrl,
  };
}

function notFound(ref: string): FiscalDocument {
  return {
    ref,
    model: "nfe",
    status: "nao_encontrado",
    chave: null,
    numero: null,
    serie: null,
    protocolo: null,
    statusSefaz: null,
    mensagemSefaz: "Documento não encontrado para a referência informada",
    xml: null,
    pdf: null,
    xmlCancelamento: null,
    qrCodeUrl: null,
  };
}

export function createSimulatedFiscalProvider(
  options: SimulatedFiscalProviderOptions = {},
): FiscalProvider {
  const now = options.now ?? (() => new Date());
  const randomInt = options.randomInt ?? ((max: number) => Math.floor(Math.random() * max));
  const serie = options.serie ?? 1;
  const fallbackUfCode = options.fallbackUfCode ?? "35"; // SP

  const documents = new Map<string, StoredDocument>();
  /** Contador de numeração por CNPJ + modelo + série, como a SEFAZ exige. */
  const counters = new Map<string, number>();
  /** Faixas já inutilizadas — ver `invalidateRange`. */
  const invalidations: StoredInvalidation[] = [];

  for (const document of options.seed?.documents ?? []) {
    documents.set(document.ref, {
      ...document,
      // O protocolo em forma numérica é o que entra no XML de evento. O
      // contrato só expõe `protocolo` (que no simulado é o mesmo valor), então
      // é dele que a restauração parte.
      protocoloNumerico: document.protocolo ?? "",
      cartasCorrecao: document.cartasCorrecao ?? 0,
      cnpjEmitente: onlyDigits(document.cnpjEmitente ?? ""),
    });
  }

  for (const numbering of options.seed?.lastNumbers ?? []) {
    const cnpj = onlyDigits(numbering.cnpj);
    if (!cnpj || !Number.isInteger(numbering.ultimoNumero) || numbering.ultimoNumero < 0) continue;
    counters.set(`${cnpj}:${numbering.model}:${serie}`, numbering.ultimoNumero);
  }

  function invalidationCovering(cnpj: string, model: string, numero: number): StoredInvalidation | undefined {
    return invalidations.find(
      (range) =>
        range.cnpj === cnpj &&
        range.model === model &&
        range.serie === serie &&
        numero >= range.numeroInicial &&
        numero <= range.numeroFinal,
    );
  }

  function nextNumero(cnpj: string, model: string): number {
    const key = `${cnpj}:${model}:${serie}`;
    let next = (counters.get(key) ?? 0) + 1;

    // Número inutilizado não volta a ser usado — é justamente o que a
    // inutilização declara à SEFAZ. Pular a faixa inteira de uma vez (em vez de
    // incrementar de um em um) mantém o custo proporcional ao número de faixas,
    // não ao tamanho delas.
    for (let guard = 0; guard < invalidations.length + 1; guard += 1) {
      const covering = invalidationCovering(cnpj, model, next);
      if (!covering) break;
      next = covering.numeroFinal + 1;
    }

    counters.set(key, next);
    return next;
  }

  return {
    id: "simulado",

    async emit(request: FiscalEmitRequest): Promise<FiscalDocument> {
      const { ref, model, payload } = request;

      if (!ref?.trim()) {
        throw new Error("FiscalProvider.emit: `ref` é obrigatório e identifica a emissão.");
      }

      // Emissão idempotente por `ref`: reemitir a mesma referência devolve o
      // documento que já existe, em vez de gerar uma segunda nota. É a proteção
      // contra duplo clique / retry — e o provedor real precisa preservar isto
      // (a Focus recusa `ref` repetida; o adaptador mapeia essa recusa para uma
      // consulta do `ref` existente).
      const existing = documents.get(ref);
      if (existing) return toDocument(existing);

      const problems = validatePayload(payload);
      if (problems.length > 0) {
        const rejected: StoredDocument = {
          ref,
          model,
          status: "erro_autorizacao",
          chave: null,
          numero: null,
          serie: null,
          protocolo: null,
          protocoloNumerico: "",
          cartasCorrecao: 0,
          cnpjEmitente: onlyDigits(payload.cnpj_emitente ?? ""),
          statusSefaz: "225",
          mensagemSefaz: `Rejeição: falha no schema XML da NF-e — ${problems.join("; ")}`,
          xml: null,
          pdf: null,
          xmlCancelamento: null,
          qrCodeUrl: null,
        };
        documents.set(ref, rejected);
        return toDocument(rejected);
      }

      const issuedAt = now();
      const cnpj = onlyDigits(payload.cnpj_emitente);
      const numero = nextNumero(cnpj, model);
      const ufCode =
        resolveUfCode({ uf: payload.uf_emitente ?? null, codigoIbgeMunicipio: null }) ??
        fallbackUfCode;

      const chave = buildAccessKey({
        ufCode,
        issuedAt,
        cnpj,
        model,
        serie,
        numero,
        codigoNumerico: randomInt(100_000_000),
      });

      // nProt real tem 15 dígitos: cUF (2) + ano (2) + sequencial (11).
      const protocolo =
        ufCode +
        String(issuedAt.getFullYear()).slice(-2) +
        String(randomInt(100_000_000_000)).padStart(11, "0");

      // QR Code só existe para NFC-e — o CSC que assinaria de verdade não
      // trafega aqui (é config de conta no provedor real, ver types.ts).
      const qrCodeUrl = model === "nfce" ? buildSimulatedQrCodeUrl({ chave }) : null;
      const issue = { chave, protocolo, model, serie, numero, authorizedAt: issuedAt, payload, qrCodeUrl };

      const authorized: StoredDocument = {
        ref,
        model,
        status: "autorizado",
        chave,
        numero: String(numero),
        serie: String(serie),
        protocolo,
        protocoloNumerico: protocolo,
        cartasCorrecao: 0,
        cnpjEmitente: cnpj,
        statusSefaz: "100",
        mensagemSefaz: "Autorizado o uso da NF-e (simulado)",
        xml: buildSimulatedXml(issue),
        pdf: buildSimulatedDanfe(issue),
        xmlCancelamento: null,
        qrCodeUrl,
      };

      documents.set(ref, authorized);
      return toDocument(authorized);
    },

    async query(ref: string): Promise<FiscalDocument> {
      const found = documents.get(ref);
      if (!found) return notFound(ref);
      return toDocument(found);
    },

    async cancel(request: FiscalCancelRequest): Promise<FiscalCancelResult> {
      const { ref, justificativa } = request;
      const found = documents.get(ref);

      if (!found) {
        return {
          ref,
          status: "nao_encontrado",
          statusSefaz: null,
          mensagemSefaz: "Documento não encontrado para a referência informada",
          xmlCancelamento: null,
        };
      }

      // 15 a 255 caracteres é regra da SEFAZ, validada antes de sair daqui — no
      // provedor real isso economiza uma chamada que voltaria recusada.
      const texto = justificativa?.trim() ?? "";
      if (texto.length < 15 || texto.length > 255) {
        return {
          ref,
          status: "erro_cancelamento",
          statusSefaz: null,
          mensagemSefaz: "Justificativa deve ter de 15 a 255 caracteres",
          xmlCancelamento: null,
        };
      }

      if (found.status === "cancelado") {
        return {
          ref,
          status: "erro_cancelamento",
          statusSefaz: "573",
          mensagemSefaz: "Rejeição: duplicidade de evento",
          xmlCancelamento: found.xmlCancelamento,
        };
      }

      if (found.status !== "autorizado" || !found.chave) {
        return {
          ref,
          status: "erro_cancelamento",
          statusSefaz: "501",
          mensagemSefaz: "Rejeição: cancelamento só é possível para documento autorizado",
          xmlCancelamento: null,
        };
      }

      const canceledAt = now();
      const xmlCancelamento = buildSimulatedCancelXml({
        chave: found.chave,
        protocolo: found.protocoloNumerico,
        justificativa: texto,
        canceledAt,
      });

      documents.set(ref, {
        ...found,
        status: "cancelado",
        statusSefaz: "135",
        mensagemSefaz: "Evento registrado e vinculado a NF-e (simulado)",
        xmlCancelamento,
      });

      return {
        ref,
        status: "cancelado",
        statusSefaz: "135",
        mensagemSefaz: "Evento registrado e vinculado a NF-e (simulado)",
        xmlCancelamento,
      };
    },

    async correctionLetter(request: FiscalCorrectionRequest): Promise<FiscalEventResult> {
      const { ref, correcao } = request;
      const found = documents.get(ref);

      if (!found) {
        return {
          ref,
          status: "nao_encontrado",
          statusSefaz: null,
          mensagemSefaz: "Documento não encontrado para a referência informada",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      // 15 a 1000 caracteres é a regra da SEFAZ para o texto da CC-e — mais
      // folgada que a do cancelamento (15 a 255) de propósito, porque aqui se
      // descreve uma correção, não se justifica um cancelamento.
      const texto = correcao?.trim() ?? "";
      if (texto.length < 15 || texto.length > 1000) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: null,
          mensagemSefaz: "Texto da correção deve ter de 15 a 1000 caracteres",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      // CC-e não corrige nota cancelada (não há o que corrigir) nem nota que
      // não chegou a ser autorizada (não existe documento na SEFAZ para
      // vincular o evento) — mesma checagem, e mesmo código, que o
      // cancelamento já faz.
      if (found.status !== "autorizado" || !found.chave) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: "501",
          mensagemSefaz: "Rejeição: carta de correção só é possível para documento autorizado",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      if (found.cartasCorrecao >= MAX_CARTAS_CORRECAO) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: "594",
          mensagemSefaz: `Rejeição: número máximo de cartas de correção por NF-e (${MAX_CARTAS_CORRECAO}) já atingido`,
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      const registeredAt = now();
      const numeroSequencial = found.cartasCorrecao + 1;
      const protocolo =
        found.protocoloNumerico.slice(0, 4) + String(randomInt(100_000_000_000)).padStart(11, "0");

      const xml = buildSimulatedCorrectionXml({
        chave: found.chave,
        correcao: texto,
        numeroSequencial,
        protocolo,
        registeredAt,
      });

      // A carta de correção **não** muda o status do documento: ele continua
      // `autorizado`, e é isso que a distingue do cancelamento. O que muda é a
      // contagem de eventos, que decide o `nSeqEvento` da próxima.
      documents.set(ref, { ...found, cartasCorrecao: numeroSequencial });

      return {
        ref,
        status: "registrado",
        statusSefaz: "135",
        mensagemSefaz: "Evento registrado e vinculado a NF-e (simulado)",
        protocolo,
        numeroSequencial,
        xml,
      };
    },

    async invalidateRange(request: FiscalInvalidateRequest): Promise<FiscalEventResult> {
      const { ref, model, numeroInicial, numeroFinal, justificativa } = request;
      const cnpj = onlyDigits(request.cnpj);
      // A série vem do **pedido**, não da opção do provedor: inutilizar a faixa
      // de uma série é diferente de inutilizar a da outra, e usar `serie` (a
      // série em que este provedor emite) faria o simulado registrar e recusar
      // faixas da série errada em silêncio.
      const serieSolicitada = request.serie;

      if (!Number.isInteger(serieSolicitada) || serieSolicitada < 0) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: null,
          mensagemSefaz: "Série inválida: deve ser um inteiro não negativo",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      if (!ref?.trim()) {
        throw new Error("FiscalProvider.invalidateRange: `ref` é obrigatório e identifica o pedido.");
      }

      // Idempotente por `ref`, exatamente como `emit` — pedir a mesma
      // inutilização duas vezes devolve o resultado que já existe, em vez de
      // registrar duas e a segunda cair na recusa de faixa duplicada.
      const existing = invalidations.find((range) => range.ref === ref);
      if (existing) return { ...existing.result };

      const texto = justificativa?.trim() ?? "";
      if (texto.length < 15 || texto.length > 255) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: null,
          mensagemSefaz: "Justificativa deve ter de 15 a 255 caracteres",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      if (
        !Number.isInteger(numeroInicial) ||
        !Number.isInteger(numeroFinal) ||
        numeroInicial < 1 ||
        numeroFinal < numeroInicial
      ) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: null,
          mensagemSefaz:
            "Faixa inválida: número inicial e final devem ser inteiros positivos, com o inicial menor ou igual ao final",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      const overlapping = invalidations.find(
        (range) =>
          range.cnpj === cnpj &&
          range.model === model &&
          range.serie === serieSolicitada &&
          numeroInicial <= range.numeroFinal &&
          numeroFinal >= range.numeroInicial,
      );
      if (overlapping) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: "563",
          mensagemSefaz: "Rejeição: já existe pedido de inutilização com a mesma faixa de numeração",
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      // Coerência de estado, no mesmo espírito do resto do simulado: não se
      // inutiliza número que já virou nota. Sem código da SEFAZ aqui de
      // propósito — a recusa vem da própria checagem local, e inventar um
      // `cStat` para ela seria fingir uma resposta que não houve.
      const usado = [...documents.values()].find(
        (document) =>
          document.status !== "erro_autorizacao" &&
          document.cnpjEmitente === cnpj &&
          document.model === model &&
          document.serie === String(serieSolicitada) &&
          document.numero !== null &&
          Number(document.numero) >= numeroInicial &&
          Number(document.numero) <= numeroFinal,
      );
      if (usado) {
        return {
          ref,
          status: "erro_evento",
          statusSefaz: null,
          mensagemSefaz: `Faixa contém número já utilizado: a nota ${usado.numero} da série ${serieSolicitada} existe e não pode ser inutilizada`,
          protocolo: null,
          numeroSequencial: null,
          xml: null,
        };
      }

      const registeredAt = now();
      // O cUF vem da opção de reserva porque a requisição de inutilização não
      // carrega UF nenhuma — nem aqui nem no provedor real, onde a SEFAZ a
      // deriva do cadastro do CNPJ na conta. Não é lacuna do simulado.
      const ufCode = fallbackUfCode;
      const protocolo =
        ufCode +
        String(registeredAt.getFullYear()).slice(-2) +
        String(randomInt(100_000_000_000)).padStart(11, "0");

      const xml = buildSimulatedInvalidationXml({
        ufCode,
        cnpj,
        model,
        serie: serieSolicitada,
        numeroInicial,
        numeroFinal,
        justificativa: texto,
        protocolo,
        registeredAt,
      });

      const result: FiscalEventResult = {
        ref,
        status: "registrado",
        statusSefaz: "102",
        // "Inutilização de número homologado" é o texto do cStat 102 — o mesmo
        // que a SEFAZ devolve, não uma frase nossa.
        mensagemSefaz: "Inutilização de número homologado (simulado)",
        protocolo,
        // Inutilização não é evento de um documento e por isso não tem
        // `nSeqEvento` — ver `FiscalEventResult.numeroSequencial`.
        numeroSequencial: null,
        xml,
      };

      invalidations.push({ ref, cnpj, model, serie: serieSolicitada, numeroInicial, numeroFinal, result });
      return { ...result };
    },

    async getXml(ref: string): Promise<FiscalArtifact | null> {
      return documents.get(ref)?.xml ?? null;
    },

    async getDanfe(ref: string): Promise<FiscalArtifact | null> {
      return documents.get(ref)?.pdf ?? null;
    },
  };
}

/** Reexportado para quem quiser conferir a chave devolvida pelo simulado. */
export { isValidAccessKey };
