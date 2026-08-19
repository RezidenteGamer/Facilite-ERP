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
 */

import { buildAccessKey, isValidAccessKey, onlyDigits, resolveUfCode } from "./accessKey";
import { buildSimulatedQrCodeUrl } from "./nfceQrCode";
import {
  buildSimulatedCancelXml,
  buildSimulatedDanfe,
  buildSimulatedXml,
} from "./simulatedArtifacts";
import type {
  FiscalCancelRequest,
  FiscalCancelResult,
  FiscalDocument,
  FiscalEmitRequest,
  FiscalProvider,
  NfePayload,
} from "./types";

export type SimulatedFiscalProviderOptions = {
  /** Relógio. Injetável para o teste fixar a data que entra na chave (AAMM). */
  now?: () => Date;
  /** Sorteio de inteiro em [0, max). Injetável para chave e protocolo determinísticos. */
  randomInt?: (max: number) => number;
  /** Série usada nas notas simuladas. */
  serie?: number;
  /** cUF de reserva quando a filial não tem UF nem código IBGE cadastrados. */
  fallbackUfCode?: string;
};

type StoredDocument = FiscalDocument & { protocoloNumerico: string };

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

  function nextNumero(cnpj: string, model: string): number {
    const key = `${cnpj}:${model}:${serie}`;
    const next = (counters.get(key) ?? 0) + 1;
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
      if (existing) return { ...existing };

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
          statusSefaz: "225",
          mensagemSefaz: `Rejeição: falha no schema XML da NF-e — ${problems.join("; ")}`,
          xml: null,
          pdf: null,
          xmlCancelamento: null,
          qrCodeUrl: null,
        };
        documents.set(ref, rejected);
        return { ...rejected };
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
        statusSefaz: "100",
        mensagemSefaz: "Autorizado o uso da NF-e (simulado)",
        xml: buildSimulatedXml(issue),
        pdf: buildSimulatedDanfe(issue),
        xmlCancelamento: null,
        qrCodeUrl,
      };

      documents.set(ref, authorized);
      return { ...authorized };
    },

    async query(ref: string): Promise<FiscalDocument> {
      const found = documents.get(ref);
      if (!found) return notFound(ref);
      return { ...found };
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
  };
}

/** Reexportado para quem quiser conferir a chave devolvida pelo simulado. */
export { isValidAccessKey };
