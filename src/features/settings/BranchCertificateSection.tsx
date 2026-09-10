import {
  MOTIVO_CERTIFICADO_DESLIGADO,
  resumoCertificado,
  type BranchCertificado,
} from "./branches";

type BranchCertificateSectionProps = {
  /**
   * O certificado **gravado** desta filial. `null` numa filial que ainda não
   * existe ("Nova filial") — não há nada gravado sobre o que informar.
   */
  certificado: BranchCertificado | null;
  /**
   * O CNPJ como está no formulário **agora**, não o gravado. A comparação com
   * o CNPJ do certificado interessa mais durante a edição: é ali que alguém
   * pode trocar o CNPJ da filial para um que o certificado atual não cobre, e
   * o aviso aparece na hora em vez de na próxima emissão.
   */
  cnpjFilial: string;
  /**
   * As três colunas de A11 existem neste banco? `false` = migration escrita e
   * não aplicada; nesse caso o bloco diz isso em vez de afirmar "não
   * cadastrado", que seria um fato inventado sobre a filial.
   */
  columnsAvailable: boolean | null;
};

/**
 * Bloco "Certificado digital" do formulário de filial (A11, 09/09/2026).
 *
 * ## Este arquivo é o único lugar do sistema com um campo de certificado, e
 * ## ele não lê o arquivo — nem uma vez, nem um byte
 *
 * Um certificado A1 é a chave privada da empresa perante a SEFAZ. A regra de
 * A11 é que ele **não entra neste sistema**: nem em coluna, nem em Storage,
 * nem em log, nem em requisição, nem em estado de React "só enquanto o modal
 * está aberto". Quem guarda certificado, no desenho da Focus, é a Focus.
 *
 * O que isso quer dizer, concretamente, sobre o código abaixo:
 *
 * - o `<input type="file">` **não tem `onChange`**. Não há função para
 *   receber um `File`, então não há como um `File` chegar a lugar nenhum;
 * - não existe `FileReader`, `arrayBuffer()`, `text()`, `stream()`, `btoa`,
 *   `URL.createObjectURL`, `FormData` nem `fetch` neste arquivo. Há um teste
 *   (`tests/unit/branchCertificate.test.ts`) que lê este fonte e reprova se
 *   qualquer um deles aparecer;
 * - os dois campos nascem **desabilitados**, com o porquê escrito ao lado —
 *   ver `MOTIVO_CERTIFICADO_DESLIGADO` para a decisão por extenso. O resumo:
 *   não existe conta na Focus para onde enviar (A12 não aconteceu), então
 *   aceitar a senha custaria o segredo mais sensível do sistema em memória em
 *   troca de função zero.
 *
 * Desabilitado, e não escondido, pelo mesmo motivo que D1 deixou o e-mail de
 * cópia da nota visível-e-desabilitado: sumir seria a tela escondendo do
 * operador que o cadastro tem essa casa.
 */
export default function BranchCertificateSection({
  certificado,
  cnpjFilial,
  columnsAvailable,
}: BranchCertificateSectionProps) {
  const resumo = certificado ? resumoCertificado(certificado, cnpjFilial) : null;

  const situacao = (() => {
    if (columnsAvailable === false) {
      return "Indisponível: as colunas deste bloco fazem parte da migration de A11, que ainda não foi aplicada neste banco.";
    }
    if (!certificado) {
      return "Salve a filial primeiro — a validade do certificado aparece aqui depois que ela existe.";
    }
    return resumo?.detalhe ?? "";
  })();

  return (
    <>
      <p className="branch-form__section">Certificado digital</p>

      <p className="branch-form__cert-status">
        <span className="branch-form__cert-badge">
          {columnsAvailable === false ? "Indisponível" : (resumo?.rotulo ?? "—")}
        </span>
        <span>{situacao}</span>
      </p>

      {resumo?.aviso && columnsAvailable !== false && (
        <p className="branch-form__warning branch-form__warning--danger" role="alert">
          {resumo.aviso}
        </p>
      )}

      <div className="branch-form__grid">
        <div className="branch-form__cert-field">
          <label className="form-field__label" htmlFor="branch-form-cert-arquivo">
            Arquivo do certificado (.pfx / .p12)
          </label>
          {/*
            Sem `onChange`, de propósito e para sempre: não existe função neste
            arquivo capaz de receber um `File`. O campo está aqui para mostrar
            a forma da tela que A12 vai ligar, não para receber nada.
          */}
          <input
            id="branch-form-cert-arquivo"
            className="branch-form__cert-file"
            type="file"
            accept=".pfx,.p12"
            disabled
          />
        </div>

        <div className="branch-form__cert-field">
          <label className="form-field__label" htmlFor="branch-form-cert-senha">
            Senha do certificado
          </label>
          {/*
            Também sem `onChange` e sem `value`: não há estado no React para a
            senha, e `BranchFormValues` não tem campo para ela. `autoComplete`
            e `spellCheck` fecham as duas portas por onde um valor digitado
            sairia daqui se alguém habilitasse o campo sem pensar — o
            gerenciador de senhas do navegador e o corretor ortográfico.
          */}
          <input
            id="branch-form-cert-senha"
            className="branch-form__cert-file"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            disabled
          />
        </div>
      </div>

      <p className="branch-form__note">{MOTIVO_CERTIFICADO_DESLIGADO}</p>
    </>
  );
}
