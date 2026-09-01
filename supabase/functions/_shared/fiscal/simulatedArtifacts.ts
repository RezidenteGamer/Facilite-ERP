/**
 * Geração local do XML e do "DANFE" do provedor simulado.
 *
 * Não é XML assinado nem DANFE de verdade — assinatura digital e layout oficial
 * só existem no provedor real, com certificado A1. O objetivo aqui é os módulos
 * futuros (Notas Emitidas, NFC-e, Devolução) terem **algo concreto para exibir e
 * baixar** enquanto o produto é validado, com a mesma forma de dado que o
 * arquivo real terá: o XML segue a árvore do schema da SEFAZ (`infNFe` com
 * `ide`/`emit`/`dest`/`det`/`total`, mais `protNFe`), então uma tela que leia
 * uma tag hoje continua lendo a mesma tag depois da troca.
 */

import { MODEL_CODES, onlyDigits } from "./accessKey.ts";
import type { FiscalArtifact, FiscalModel, NfePayload } from "./types.ts";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Valor monetário no formato do XML da NF-e: ponto decimal, 2 casas. */
function money(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
}

function tag(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

export type SimulatedIssue = {
  chave: string;
  protocolo: string;
  model: FiscalModel;
  serie: number;
  numero: number;
  authorizedAt: Date;
  payload: NfePayload;
  /** Só para NFC-e — ver `nfceQrCode.ts`. */
  qrCodeUrl?: string | null;
};

export function buildSimulatedXml(issue: SimulatedIssue): FiscalArtifact {
  const { payload, chave } = issue;
  const cnpjEmitente = onlyDigits(payload.cnpj_emitente);
  const documentoDestinatario = payload.cnpj_destinatario
    ? tag("CNPJ", onlyDigits(payload.cnpj_destinatario))
    : payload.cpf_destinatario
      ? tag("CPF", onlyDigits(payload.cpf_destinatario))
      : "";

  const itens = payload.items
    .map(
      (item) => `
      <det nItem="${item.numero_item}">
        <prod>
          ${tag("cProd", item.codigo_produto)}
          ${tag("xProd", item.descricao)}
          ${tag("NCM", item.codigo_ncm)}
          ${tag("CEST", item.codigo_cest)}
          ${tag("CFOP", item.cfop)}
          ${tag("uCom", item.unidade_comercial)}
          <qCom>${item.quantidade_comercial}</qCom>
          <vUnCom>${money(item.valor_unitario_comercial)}</vUnCom>
          <vProd>${money(item.valor_bruto)}</vProd>
          ${item.valor_desconto ? `<vDesc>${money(item.valor_desconto)}</vDesc>` : ""}
        </prod>
        <imposto>
          <ICMS>
            ${tag("orig", item.icms_origem)}
            ${tag("CST", item.icms_situacao_tributaria)}
            ${item.icms_reducao_base_calculo === undefined ? "" : `<pRedBC>${money(item.icms_reducao_base_calculo)}</pRedBC>`}
            ${item.icms_valor === undefined ? "" : `<vICMS>${money(item.icms_valor)}</vICMS>`}
          </ICMS>
          ${
            item.ipi_situacao_tributaria
              ? `<IPI>${tag("CST", item.ipi_situacao_tributaria)}${
                  item.ipi_valor === undefined ? "" : `<vIPI>${money(item.ipi_valor)}</vIPI>`
                }</IPI>`
              : ""
          }
          ${item.pis_situacao_tributaria ? `<PIS>${tag("CST", item.pis_situacao_tributaria)}</PIS>` : ""}
          ${item.cofins_situacao_tributaria ? `<COFINS>${tag("CST", item.cofins_situacao_tributaria)}</COFINS>` : ""}
        </imposto>
      </det>`,
    )
    .join("");

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Documento SIMULADO, gerado localmente pelo Facilite ERP. Sem assinatura
     digital e sem valor fiscal. Ver AGENTS.md, decisao da camada de emissao. -->
<nfeProc versao="4.00" ambiente="simulado">
  <NFe>
    <infNFe versao="4.00" Id="NFe${chave}">
      <ide>
        <cUF>${chave.slice(0, 2)}</cUF>
        <natOp>${escapeXml(payload.natureza_operacao)}</natOp>${(payload.notas_referenciadas ?? [])
          .map((nota) => `
        <NFref><refNFe>${escapeXml(onlyDigits(nota.chave_nfe))}</refNFe></NFref>`)
          .join("")}
        <mod>${MODEL_CODES[issue.model]}</mod>
        <serie>${issue.serie}</serie>
        <nNF>${issue.numero}</nNF>
        <dhEmi>${escapeXml(payload.data_emissao)}</dhEmi>
        <tpNF>${payload.tipo_documento}</tpNF>
        ${tag("idDest", payload.local_destino)}
        <tpEmis>1</tpEmis>
        <finNFe>${payload.finalidade_emissao}</finNFe>
        ${tag("indFinal", payload.consumidor_final)}
        ${tag("indPres", payload.presenca_comprador)}
      </ide>
      <emit>
        <CNPJ>${cnpjEmitente}</CNPJ>
        ${tag("xNome", payload.nome_emitente)}
        ${tag("xFant", payload.nome_fantasia_emitente)}
        ${tag("IE", payload.inscricao_estadual_emitente)}
        ${tag("CRT", payload.regime_tributario_emitente)}
        <enderEmit>
          ${tag("xLgr", payload.logradouro_emitente)}
          ${tag("nro", payload.numero_emitente)}
          ${tag("xBairro", payload.bairro_emitente)}
          ${tag("xMun", payload.municipio_emitente)}
          ${tag("UF", payload.uf_emitente)}
          ${tag("CEP", payload.cep_emitente)}
        </enderEmit>
      </emit>
      ${
        payload.nome_destinatario || documentoDestinatario
          ? `<dest>
        ${documentoDestinatario}
        ${tag("xNome", payload.nome_destinatario)}
        ${tag("indIEDest", payload.indicador_inscricao_estadual_destinatario)}
        ${tag("IE", payload.inscricao_estadual_destinatario)}
      </dest>`
          : ""
      }${itens}
      ${
        issue.qrCodeUrl
          ? `<infNFeSupl>
        ${tag("qrCode", issue.qrCodeUrl)}
        ${tag("urlChave", issue.qrCodeUrl)}
      </infNFeSupl>`
          : ""
      }
      <total>
        <ICMSTot>
          <vBC>${money(payload.icms_base_calculo)}</vBC>
          <vICMS>${money(payload.icms_valor_total)}</vICMS>
          <vProd>${money(payload.valor_produtos)}</vProd>
          <vDesc>${money(payload.valor_desconto)}</vDesc>
          <vFrete>${money(payload.valor_frete)}</vFrete>
          <vIPI>${money(payload.valor_ipi)}</vIPI>
          <vPIS>${money(payload.valor_pis)}</vPIS>
          <vCOFINS>${money(payload.valor_cofins)}</vCOFINS>
          <vNF>${money(payload.valor_total)}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <chNFe>${chave}</chNFe>
      <dhRecbto>${issue.authorizedAt.toISOString()}</dhRecbto>
      <nProt>${issue.protocolo}</nProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e (simulado)</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;

  return { content, path: null, contentType: "application/xml" };
}

/**
 * "DANFE" simulado em HTML. HTML e não PDF de propósito: gerar PDF de verdade
 * exigiria uma biblioteca só para um arquivo descartável, e o provedor real
 * devolve o PDF pronto (`caminho_danfe`) — quem consome já vai ter que lidar
 * com `contentType` variável de qualquer jeito.
 */
export function buildSimulatedDanfe(issue: SimulatedIssue): FiscalArtifact {
  const { payload } = issue;
  const linhas = payload.items
    .map(
      (item) => `<tr>
      <td>${escapeXml(item.codigo_produto)}</td>
      <td>${escapeXml(item.descricao)}</td>
      <td class="num">${item.quantidade_comercial}</td>
      <td class="num">${money(item.valor_unitario_comercial)}</td>
      <td class="num">${money(item.valor_bruto)}</td>
    </tr>`,
    )
    .join("\n");

  const chaveFormatada = issue.chave.replace(/(\d{4})(?=\d)/g, "$1 ");
  const rotulo = issue.model === "nfce" ? "DANFCE (NFC-e)" : "DANFE (NF-e)";

  const content = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${rotulo} ${issue.numero} — simulado</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; color: #1a1a1a; }
  .aviso { background: #fff4e5; border: 1px solid #f0b357; padding: 8px 12px; margin-bottom: 16px; }
  .chave { font-family: ui-monospace, monospace; letter-spacing: .04em; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 14px; }
  th, td { border: 1px solid #d4d4d4; padding: 6px 8px; text-align: left; }
  .num { text-align: right; }
  .total { margin-top: 12px; font-size: 18px; font-weight: 600; }
</style>
</head>
<body>
  <p class="aviso"><strong>Documento simulado.</strong> Gerado localmente, sem
  assinatura digital e sem valor fiscal.</p>
  <h1>${rotulo}</h1>
  <p>Nº ${issue.numero} · Série ${issue.serie} · Emissão ${escapeXml(payload.data_emissao)}</p>
  <p class="chave">Chave de acesso: ${chaveFormatada}</p>
  <p>Protocolo de autorização: ${escapeXml(issue.protocolo)}</p>
  ${issue.qrCodeUrl ? `<p>Consulta por QR Code: <a href="${escapeXml(issue.qrCodeUrl)}">${escapeXml(issue.qrCodeUrl)}</a></p>` : ""}
  <h2>Emitente</h2>
  <p>${escapeXml(payload.nome_emitente)} — CNPJ ${escapeXml(payload.cnpj_emitente)}</p>
  <h2>Destinatário</h2>
  <p>${escapeXml(payload.nome_destinatario ?? "Consumidor não identificado")}</p>
  <h2>Produtos</h2>
  <table>
    <thead><tr><th>Código</th><th>Descrição</th><th class="num">Qtd.</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
    <tbody>
${linhas}
    </tbody>
  </table>
  <p class="total">Total da nota: R$ ${money(payload.valor_total)}</p>
</body>
</html>`;

  return { content, path: null, contentType: "text/html" };
}

/**
 * XML do evento de **carta de correção** (CC-e, `tpEvento` 110110) — A2.
 *
 * Mesma árvore do XML de cancelamento (`procEventoNFe`), porque na SEFAZ os
 * dois são o mesmo tipo de documento: muda o `tpEvento`, o `detEvento` e o
 * `nSeqEvento` (a CC-e é numerada de 1 a 20 por NF-e; o cancelamento é único e
 * por isso nem carrega sequência). O texto fixo de `xCondUso` é o da própria
 * norma, exigido dentro do evento — sem ele o XML não pareceria uma CC-e para
 * quem abrir o arquivo.
 */
export function buildSimulatedCorrectionXml(input: {
  chave: string;
  correcao: string;
  numeroSequencial: number;
  protocolo: string;
  registeredAt: Date;
}): FiscalArtifact {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Carta de correcao SIMULADA, gerada localmente. Sem valor fiscal. -->
<procEventoNFe versao="1.00" ambiente="simulado">
  <evento versao="1.00">
    <infEvento>
      <chNFe>${input.chave}</chNFe>
      <tpEvento>110110</tpEvento>
      <nSeqEvento>${input.numeroSequencial}</nSeqEvento>
      <dhEvento>${input.registeredAt.toISOString()}</dhEvento>
      <detEvento>
        <descEvento>Carta de Correcao</descEvento>
        <xCorrecao>${escapeXml(input.correcao)}</xCorrecao>
        <xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso>
      </detEvento>
    </infEvento>
  </evento>
  <retEvento versao="1.00">
    <infEvento>
      <cStat>135</cStat>
      <xMotivo>Evento registrado e vinculado a NF-e (simulado)</xMotivo>
      <nProt>${input.protocolo}</nProt>
      <dhRegEvento>${input.registeredAt.toISOString()}</dhRegEvento>
    </infEvento>
  </retEvento>
</procEventoNFe>`;

  return { content, path: null, contentType: "application/xml" };
}

/**
 * XML da **inutilização de faixa** (`procInutNFe`) — A2.
 *
 * Árvore diferente da dos eventos de propósito: inutilização não é evento de
 * uma NF-e (não existe `chNFe` aqui — não há nota nenhuma), é um serviço
 * próprio da SEFAZ sobre CNPJ + modelo + série + faixa. O `Id` segue o layout
 * do MOC — `ID` + cUF + ano + CNPJ + modelo + série + nNFIni + nNFFin —, mesmo
 * critério da chave de acesso: a forma importa, a autorização é que não existe.
 */
export function buildSimulatedInvalidationXml(input: {
  ufCode: string;
  cnpj: string;
  model: FiscalModel;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  protocolo: string;
  registeredAt: Date;
}): FiscalArtifact {
  const pad = (value: number, size: number) => String(value).padStart(size, "0");
  const ano = String(input.registeredAt.getFullYear()).slice(-2);
  const id =
    `ID${input.ufCode}${ano}${onlyDigits(input.cnpj)}${MODEL_CODES[input.model]}` +
    `${pad(input.serie, 3)}${pad(input.numeroInicial, 9)}${pad(input.numeroFinal, 9)}`;

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Inutilizacao de numeracao SIMULADA, gerada localmente. Sem valor fiscal. -->
<procInutNFe versao="4.00" ambiente="simulado">
  <inutNFe versao="4.00">
    <infInut Id="${id}">
      <tpAmb>2</tpAmb>
      <xServ>INUTILIZAR</xServ>
      <cUF>${input.ufCode}</cUF>
      <ano>${ano}</ano>
      <CNPJ>${onlyDigits(input.cnpj)}</CNPJ>
      <mod>${MODEL_CODES[input.model]}</mod>
      <serie>${input.serie}</serie>
      <nNFIni>${input.numeroInicial}</nNFIni>
      <nNFFin>${input.numeroFinal}</nNFFin>
      <xJust>${escapeXml(input.justificativa)}</xJust>
    </infInut>
  </inutNFe>
  <retInutNFe versao="4.00">
    <infInut>
      <cStat>102</cStat>
      <xMotivo>Inutilizacao de numero homologado (simulado)</xMotivo>
      <nProt>${input.protocolo}</nProt>
      <dhRecbto>${input.registeredAt.toISOString()}</dhRecbto>
    </infInut>
  </retInutNFe>
</procInutNFe>`;

  return { content, path: null, contentType: "application/xml" };
}

export function buildSimulatedCancelXml(input: {
  chave: string;
  protocolo: string;
  justificativa: string;
  canceledAt: Date;
}): FiscalArtifact {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Evento de cancelamento SIMULADO, gerado localmente. Sem valor fiscal. -->
<procEventoNFe versao="1.00" ambiente="simulado">
  <evento versao="1.00">
    <infEvento>
      <chNFe>${input.chave}</chNFe>
      <tpEvento>110111</tpEvento>
      <dhEvento>${input.canceledAt.toISOString()}</dhEvento>
      <detEvento>
        <descEvento>Cancelamento</descEvento>
        <nProt>${input.protocolo}</nProt>
        <xJust>${escapeXml(input.justificativa)}</xJust>
      </detEvento>
    </infEvento>
  </evento>
  <retEvento versao="1.00">
    <infEvento>
      <cStat>135</cStat>
      <xMotivo>Evento registrado e vinculado a NF-e (simulado)</xMotivo>
      <dhRegEvento>${input.canceledAt.toISOString()}</dhRegEvento>
    </infEvento>
  </retEvento>
</procEventoNFe>`;

  return { content, path: null, contentType: "application/xml" };
}
