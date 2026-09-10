import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import FormField from "../../components/form/FormField";
import { fetchCnpjData } from "../../lib/repositories/cnpjLookup";
import { extractErrorMessage } from "../../lib/errorMessage";
import { onlyDigits } from "../../lib/fiscal/accessKey";
import BranchCertificateSection from "./BranchCertificateSection";
import {
  branchFiscalWarnings,
  EMPTY_BRANCH_FORM,
  REGIMES_TRIBUTARIOS_CRT,
  UF_SIGLAS,
  validateBranchForm,
  type BranchCertificado,
  type BranchFormValues,
} from "./branches";
import "../registry-engine/RegistryFormModal.css";
import "./BranchFormModal.css";

type BranchFormModalProps = {
  title: string;
  initialValues?: BranchFormValues;
  /**
   * A coluna `email_copia_nota_fiscal` existe neste banco? Quando não existe
   * (migration de D1 escrita e ainda não aplicada), o campo aparece
   * desabilitado com a explicação, em vez de sumir — some seria a tela
   * escondendo do operador que o cadastro tem essa casa.
   */
  emailColumnAvailable: boolean | null;
  /**
   * A coluna `pix_key` existe neste banco? Mesma convenção de
   * `emailColumnAvailable` (D11): quando não existe, o campo aparece
   * desabilitado com a explicação em vez de sumir.
   */
  pixKeyColumnAvailable: boolean | null;
  /**
   * O certificado digital **gravado** desta filial (A11). `null` em "Nova
   * filial": não há nada gravado ainda. Só leitura — nada neste formulário
   * escreve certificado, e nem existe campo para isso em `BranchFormValues`.
   */
  certificado: BranchCertificado | null;
  /** As três colunas de certificado existem neste banco? Ver `emailColumnAvailable`. */
  certificadoColumnsAvailable: boolean | null;
  saving: boolean;
  onSubmit: (values: BranchFormValues) => void;
  onCancel: () => void;
};

const UF_OPTIONS = [
  { value: "", label: "Não informada" },
  ...UF_SIGLAS.map((sigla) => ({ value: sigla, label: sigla })),
];

/** Campo que ocupa a linha inteira da grade de duas colunas. */
function Wide({ children }: { children: ReactNode }) {
  return <div className="branch-form__wide">{children}</div>;
}

/**
 * Criação e edição de filial (D1, 09/09/2026).
 *
 * O formulário é agrupado em blocos — identificação, fiscal, certificado
 * digital e endereço — porque os campos fiscais só fazem sentido juntos: é o
 * conjunto deles que a Edge Function `fiscal-emit` lê para montar o emitente
 * da nota, e é a ausência de qualquer um deles que vira rejeição na SEFAZ.
 * Deixá-los espalhados entre "nome" e "CEP" esconderia essa unidade.
 *
 * O bloco **Certificado digital** (A11, 09/09/2026) é o único que não é
 * cadastro: ele mostra a validade que a Focus devolveu e avisa do vencimento,
 * e os dois campos de envio nascem desabilitados. O arquivo `.pfx` e a senha
 * não entram neste sistema — ver `BranchCertificateSection`, onde a decisão e
 * as garantias estão por extenso.
 */
export default function BranchFormModal({
  title,
  initialValues,
  emailColumnAvailable,
  pixKeyColumnAvailable,
  certificado,
  certificadoColumnsAvailable,
  saving,
  onSubmit,
  onCancel,
}: BranchFormModalProps) {
  const [values, setValues] = useState<BranchFormValues>(initialValues ?? EMPTY_BRANCH_FORM);
  const [problems, setProblems] = useState<string[]>([]);
  const [lookupState, setLookupState] = useState<"idle" | "loading">("idle");
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);

  const warnings = branchFiscalWarnings(values);
  const cnpjCompleto = onlyDigits(values.cnpj).length === 14;

  function set<K extends keyof BranchFormValues>(key: K, value: BranchFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  /**
   * Preenche só o que está vazio — nunca sobrescreve o que o operador digitou.
   * Mesma regra do `CnpjLookupField` de Clientes e Fornecedores, de onde este
   * atalho foi reaproveitado (a busca em si é a mesma função).
   */
  async function handleLookup() {
    setLookupState("loading");
    setLookupMessage(null);
    try {
      const data = await fetchCnpjData(values.cnpj);
      setValues((current) => ({
        ...current,
        name: current.name.trim() ? current.name : data.name,
        logradouro: current.logradouro.trim() ? current.logradouro : (data.logradouro ?? ""),
        numero: current.numero.trim() ? current.numero : (data.numero ?? ""),
        bairro: current.bairro.trim() ? current.bairro : (data.bairro ?? ""),
        municipio: current.municipio.trim() ? current.municipio : (data.municipio ?? ""),
        uf: current.uf.trim() ? current.uf : (data.uf ?? ""),
        cep: current.cep.trim() ? current.cep : (data.cep ?? ""),
        codigoIbgeMunicipio: current.codigoIbgeMunicipio.trim()
          ? current.codigoIbgeMunicipio
          : (data.codigoIbgeMunicipio ?? ""),
      }));
      setLookupMessage("Dados públicos preenchidos — confira antes de salvar.");
    } catch (err) {
      setLookupMessage(extractErrorMessage(err, "Não foi possível buscar o CNPJ."));
    } finally {
      setLookupState("idle");
    }
  }

  function handleSubmit() {
    const found = validateBranchForm(values);
    setProblems(found);
    if (found.length > 0) return;
    onSubmit(values);
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {problems.length > 0 && (
              <div className="registry-form-modal__error" role="alert">
                {problems.map((problem) => (
                  <p key={problem} style={{ margin: 0 }}>
                    {problem}
                  </p>
                ))}
              </div>
            )}

            <p className="branch-form__section">Identificação</p>
            <div className="branch-form__grid">
              <FormField
                id="branch-form-code"
                label="Código *"
                value={values.code}
                onChange={(value) => set("code", value)}
                hint="Único no sistema."
              />
              <FormField
                id="branch-form-cnpj"
                label="CNPJ"
                value={values.cnpj}
                onChange={(value) => set("cnpj", value)}
              />
              <Wide>
                <FormField
                  id="branch-form-name"
                  label="Nome *"
                  value={values.name}
                  onChange={(value) => set("name", value)}
                />
              </Wide>
            </div>

            <div className="branch-form__lookup">
              <button
                className="branch-form__lookup-btn"
                type="button"
                disabled={!cnpjCompleto || lookupState === "loading"}
                onClick={handleLookup}
              >
                {lookupState === "loading" ? "Buscando…" : "Buscar dados do CNPJ"}
              </button>
              <span className="branch-form__note">
                {lookupMessage ??
                  (cnpjCompleto
                    ? "Preenche nome e endereço a partir de dados públicos — você edita tudo antes de salvar."
                    : "Digite os 14 dígitos do CNPJ para habilitar a busca.")}
              </span>
            </div>

            <p className="branch-form__section">Fiscal</p>
            <div className="branch-form__grid">
              <FormField
                id="branch-form-regime"
                label="Regime tributário (CRT)"
                type="select"
                options={REGIMES_TRIBUTARIOS_CRT}
                value={values.regimeTributario}
                onChange={(value) => set("regimeTributario", value)}
              />
              <FormField
                id="branch-form-ie"
                label="Inscrição estadual"
                value={values.inscricaoEstadual}
                onChange={(value) => set("inscricaoEstadual", value)}
              />
              <FormField
                id="branch-form-cnae"
                label="CNAE fiscal"
                value={values.cnae}
                onChange={(value) => set("cnae", value)}
                hint="7 dígitos."
              />
              <FormField
                id="branch-form-ibge"
                label="Código IBGE do município"
                value={values.codigoIbgeMunicipio}
                onChange={(value) => set("codigoIbgeMunicipio", value)}
                hint="7 dígitos."
              />
              <Wide>
                <FormField
                  id="branch-form-email"
                  label="E-mail para cópia da nota"
                  type="email"
                  value={values.emailCopiaNotaFiscal}
                  disabled={emailColumnAvailable === false}
                  onChange={(value) => set("emailCopiaNotaFiscal", value)}
                  hint={
                    emailColumnAvailable === false
                      ? "Indisponível: a coluna deste campo faz parte da migration de D1, que ainda não foi aplicada neste banco."
                      : "Só cadastro — o sistema ainda não envia e-mail nenhum (ver D1 no AGENTS.md)."
                  }
                />
              </Wide>
            </div>

            <p className="branch-form__note">
              A <strong>série</strong> das notas desta filial é fixa (série 1) e não é cadastrável —
              ver a decisão de D1 no AGENTS.md. A <strong>alíquota de crédito do Simples</strong>{" "}
              (<code>pCredSN</code>) continua em Configurações, escopada pela filial ativa.
            </p>

            <p className="branch-form__section">Cobrança</p>
            <div className="branch-form__grid">
              <Wide>
                <FormField
                  id="branch-form-pix-key"
                  label="Chave PIX"
                  value={values.pixKey}
                  disabled={pixKeyColumnAvailable === false}
                  onChange={(value) => set("pixKey", value)}
                  hint={
                    pixKeyColumnAvailable === false
                      ? "Indisponível: a coluna deste campo faz parte da migration de D11, que ainda não foi aplicada neste banco."
                      : "CPF, CNPJ, e-mail, telefone ou chave aleatória — sem validação de formato aqui. É a chave usada para gerar o QR Code de cobrança em Financeiro."
                  }
                />
              </Wide>
            </div>

            <BranchCertificateSection
              certificado={certificado}
              cnpjFilial={values.cnpj}
              columnsAvailable={certificadoColumnsAvailable}
            />

            <p className="branch-form__section">Endereço</p>
            <div className="branch-form__grid">
              <Wide>
                <FormField
                  id="branch-form-logradouro"
                  label="Logradouro"
                  value={values.logradouro}
                  onChange={(value) => set("logradouro", value)}
                />
              </Wide>
              <FormField
                id="branch-form-numero"
                label="Número"
                value={values.numero}
                onChange={(value) => set("numero", value)}
              />
              <FormField
                id="branch-form-bairro"
                label="Bairro"
                value={values.bairro}
                onChange={(value) => set("bairro", value)}
              />
              <FormField
                id="branch-form-municipio"
                label="Município"
                value={values.municipio}
                onChange={(value) => set("municipio", value)}
              />
              <FormField
                id="branch-form-uf"
                label="UF"
                type="select"
                options={UF_OPTIONS}
                value={values.uf}
                onChange={(value) => set("uf", value)}
              />
              <FormField
                id="branch-form-cep"
                label="CEP"
                value={values.cep}
                onChange={(value) => set("cep", value)}
              />
            </div>

            <div className="branch-form__toggles">
              <label className="branch-form__toggle" htmlFor="branch-form-active">
                <input
                  id="branch-form-active"
                  type="checkbox"
                  checked={values.active}
                  onChange={(event) => set("active", event.target.checked)}
                />
                <span>
                  Filial ativa
                  <span className="branch-form__toggle-hint">
                    Desmarcar não retira o acesso de ninguém nem esconde os dados dela — é uma marca
                    de cadastro.
                  </span>
                </span>
              </label>

              <label className="branch-form__toggle" htmlFor="branch-form-negative-stock">
                <input
                  id="branch-form-negative-stock"
                  type="checkbox"
                  checked={values.allowNegativeStock}
                  onChange={(event) => set("allowNegativeStock", event.target.checked)}
                />
                <span>
                  Permitir estoque negativo
                  <span className="branch-form__toggle-hint">
                    Padrão da filial; um produto pode sobrescrevê-lo no próprio cadastro. É o mesmo
                    parâmetro que Configurações mostra para a filial ativa.
                  </span>
                </span>
              </label>
            </div>

            {warnings.length > 0 && (
              <p className="branch-form__warning">
                Esta filial ainda não consegue emitir nota: falta {warnings.join(", ")}. Dá para
                salvar assim mesmo e completar depois.
              </p>
            )}

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                disabled={saving}
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                disabled={saving}
                onClick={handleSubmit}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
