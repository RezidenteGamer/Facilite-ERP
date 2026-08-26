import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import FormField from "../../components/form/FormField";
import SearchCombobox from "../../components/form/SearchCombobox";
import PhotoDropzone from "./PhotoDropzone";
import type { ModuleFieldDefinition } from "./types";
import "./RegistryFormModal.css";

type RegistryFormModalMediaField = {
  label: string;
  imageUrl?: string | null;
  hint?: string;
  uploading?: boolean;
  onFileSelected: (file: File) => void;
};

/**
 * Ponte para um campo de consulta a outro cadastro (ex.: o grupo tributário
 * de um produto) dentro do formulário genérico.
 *
 * Mesmo papel de `mediaField`: `module_fields` não tem um `dataType` de
 * consulta, e criar um seria generalizar o motor inteiro por causa de um
 * campo. O formulário renderiza o `SearchCombobox` e cuida do texto digitado;
 * quem consome só diz o que buscar e o que fazer com o escolhido.
 */
type RegistryFormModalLookupField<TItem> = {
  label: string;
  /** Descrição do item já escolhido. Vazio = nada escolhido ainda. */
  value: string;
  isRequired?: boolean;
  searchPlaceholder?: string;
  fetchItems: (query: string) => Promise<TItem[]>;
  getKey: (item: TItem) => string;
  renderItem: (item: TItem) => { primary: string; secondary?: string };
  onSelect: (item: TItem) => void;
  /**
   * Desfaz a escolha quando o operador digita por cima dela. Sem isto o
   * formulário gravaria o item antigo enquanto mostra um texto novo — risco
   * que só existe porque o campo passou a ser digitável.
   */
  onClear?: () => void;
};

/**
 * Ponte para um `<select>` de opções fixas dentro do formulário genérico —
 * mesmo papel de `lookupField`/`mediaField`: `module_fields` não tem
 * `dataType: 'select'` (a engine só distingue `text`/`date` no `<input>`,
 * ver AGENTS.md), e criar um generalizaria o motor inteiro por causa de um
 * campo. Usado pelo estoque negativo do produto (três estados) e pelas
 * unidades comercial/tributável (lista curta vinda de `units_of_measure`).
 * `key` só precisa ser único dentro do formulário — vira parte do `id` do
 * `<select>` no DOM, já que agora pode haver mais de um.
 */
type RegistryFormModalSelectField = {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  onChange: (value: string) => void;
};

type RegistryFormModalProps<TItem> = {
  title: string;
  fields: ModuleFieldDefinition[];
  initialValues?: Record<string, string>;
  submitLabel?: string;
  mediaField?: RegistryFormModalMediaField;
  lookupField?: RegistryFormModalLookupField<TItem>;
  selectFields?: RegistryFormModalSelectField[];
  /**
   * Opções dos campos de referência (`module_fields.reference_module_id`),
   * por `accessorKey`. Quando um campo tem lista aqui, ele deixa de ser
   * `<input>` de texto e vira `<select>` de registros do módulo apontado —
   * senão o formulário estaria pedindo que alguém colasse um uuid à mão.
   */
  referenceOptions?: Record<string, { value: string; label: string }[]>;
  /**
   * Conteúdo extra renderizado logo depois de um campo específico, por
   * `accessorKey` — ex.: a calculadora de margem de Produtos, que fica junto
   * do campo "Preço custo". `module_fields` não tem um conceito de "campo
   * com widget auxiliar"; criar um generalizaria o motor inteiro por causa de
   * um caso (mesma disciplina de `mediaField`/`lookupField`/`selectFields`,
   * ver AGENTS.md). Vem como função — não `ReactNode` puro — porque o widget
   * geralmente precisa ler e escrever outros campos do MESMO formulário (ex.:
   * ler "Preço custo" e escrever em "Preço venda"), e esse estado só existe
   * aqui dentro.
   */
  fieldExtras?: Record<
    string,
    (helpers: { values: Record<string, string>; setValue: (accessorKey: string, value: string) => void }) => ReactNode
  >;
  /**
   * Validação além de "preenchido/vazio" — mesmo papel do `validateRow` do
   * motor de lote (`RegistryBatchFormModal`). Devolve mensagens de erro
   * prontas (não nomes de campo); quem usa decide a regra (ex.: Financeiro
   * recusa "abc" ou valor <= 0 no campo Valor total).
   */
  validate?: (values: Record<string, string>) => string[];
  /**
   * Erro vindo de fora, depois do envio (ex.: a gravação falhou) — mostrado
   * junto dos erros de validação. Sem isto um `onSubmit` assíncrono que
   * rejeita deixa o formulário aberto sem dizer nada ao operador.
   */
  submitError?: string | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
};

/**
 * Formulário de criação/edição genérico: renderiza um `FormField` por campo
 * de metadados do módulo (`showInForm`), sem conhecer o domínio do módulo.
 * Usada tanto para "Novo" quanto "Editar" — a diferença é só `initialValues`.
 */
export default function RegistryFormModal<TItem = unknown>({
  title,
  fields,
  initialValues,
  submitLabel = "Salvar",
  mediaField,
  lookupField,
  selectFields,
  referenceOptions,
  fieldExtras,
  validate,
  submitError,
  onSubmit,
  onCancel,
}: RegistryFormModalProps<TItem>) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields) {
      initial[field.accessorKey] = initialValues?.[field.accessorKey] ?? "";
    }
    return initial;
  });
  const [formErrors, setFormErrors] = useState<string[]>([]);
  /* O texto digitado no campo de consulta é do formulário, não de quem
     consome: `lookupField.value` descreve o item **escolhido**, e os dois só
     coincidem enquanto ninguém estiver digitando uma busca nova. */
  const [lookupQuery, setLookupQuery] = useState(lookupField?.value ?? "");

  const lookupValue = lookupField?.value ?? "";
  useEffect(() => {
    setLookupQuery(lookupValue);
  }, [lookupValue]);

  function handleSubmit() {
    const missing = fields
      .filter((field) => field.isRequired && !values[field.accessorKey]?.trim())
      .map((field) => field.label);
    if (lookupField?.isRequired && !lookupField.value.trim()) {
      missing.unshift(lookupField.label);
    }

    const errors: string[] = [];
    if (missing.length > 0) {
      errors.push(`Preencha os campos obrigatórios: ${missing.join(", ")}.`);
    }
    errors.push(...(validate?.(values) ?? []));

    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
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

            {formErrors.map((message, index) => (
              <p key={index} className="registry-form-modal__error">
                {message}
              </p>
            ))}

            {submitError && <p className="registry-form-modal__error">{submitError}</p>}

            {mediaField && (
              <div className="registry-form-modal__media">
                <PhotoDropzone
                  imageUrl={mediaField.imageUrl}
                  hint={mediaField.hint ?? "Ou arraste para cá"}
                  uploading={mediaField.uploading}
                  onFileSelected={mediaField.onFileSelected}
                />
                <span className="registry-form-modal__media-label">{mediaField.label}</span>
              </div>
            )}

            <div className="registry-form-modal__fields">
              {lookupField && (
                <SearchCombobox<TItem>
                  id="registry-form-lookup"
                  label={lookupField.isRequired ? `${lookupField.label} *` : lookupField.label}
                  placeholder={lookupField.searchPlaceholder}
                  value={lookupQuery}
                  onChange={(text) => {
                    setLookupQuery(text);
                    if (lookupField.value) lookupField.onClear?.();
                  }}
                  fetchItems={lookupField.fetchItems}
                  getKey={lookupField.getKey}
                  renderItem={lookupField.renderItem}
                  onSelect={(item) => {
                    lookupField.onSelect(item);
                    setLookupQuery(lookupField.renderItem(item).primary);
                  }}
                />
              )}

              {selectFields?.map((select) => (
                <FormField
                  key={select.key}
                  id={`registry-form-select-${select.key}`}
                  label={select.label}
                  type="select"
                  options={select.options}
                  value={select.value}
                  onChange={select.onChange}
                  hint={select.hint}
                />
              ))}

              {fields.map((field) => {
                const options = field.referenceModuleId
                  ? referenceOptions?.[field.accessorKey]
                  : undefined;

                return (
                  <div key={field.accessorKey}>
                    <FormField
                      id={`registry-form-${field.accessorKey}`}
                      label={field.isRequired ? `${field.label} *` : field.label}
                      type={options ? "select" : field.dataType === "date" ? "date" : "text"}
                      options={
                        options
                          ? [{ value: "", label: "— nenhum —" }, ...options]
                          : undefined
                      }
                      value={values[field.accessorKey] ?? ""}
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [field.accessorKey]: value }))
                      }
                    />
                    {fieldExtras?.[field.accessorKey]?.({
                      values,
                      setValue: (accessorKey, value) =>
                        setValues((current) => ({ ...current, [accessorKey]: value })),
                    })}
                  </div>
                );
              })}
            </div>

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
              >
                {submitLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
