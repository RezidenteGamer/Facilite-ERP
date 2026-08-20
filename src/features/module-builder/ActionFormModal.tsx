import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import FormField from "../../components/form/FormField";
import type {
  ActionTargetKind,
  ActionValueKind,
  TransitionActionInput,
} from "../modules/moduleWorkflow";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import "../registry-engine/RegistryFormModal.css";
import type { ReferenceTarget } from "./useModuleWorkflowBuilder";
import "./ModuleBuilderPage.css";

type ActionFormModalProps = {
  title: string;
  /** Campos do próprio módulo — o destino possível da Camada 1. */
  ownFields: ModuleFieldDefinition[];
  /**
   * Saltos de referência disponíveis. **Vazio esconde a Camada 2 inteira**:
   * quem não é desenvolvedor do Facilite recebe `[]` e nem chega a ver que
   * existe a opção de escrever noutro módulo — não é um cadeado anunciando
   * uma capacidade que a pessoa nunca vai poder usar.
   */
  references: ReferenceTarget[];
  initial?: TransitionActionInput;
  submitLabel?: string;
  onSubmit: (input: TransitionActionInput) => void;
  onCancel: () => void;
};

/** Campo de referência não é destino de escrita: gravar por cima dele quebraria o apontamento. */
function writableFields(fields: ModuleFieldDefinition[]) {
  return fields
    .filter((field) => !field.referenceModuleId)
    .map((field) => ({ value: field.fieldKey, label: field.label }));
}

export default function ActionFormModal({
  title,
  ownFields,
  references,
  initial,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: ActionFormModalProps) {
  const [targetKind, setTargetKind] = useState<ActionTargetKind>(initial?.targetKind ?? "self");
  const [valueKind, setValueKind] = useState<ActionValueKind>(initial?.valueKind ?? "literal");
  const [via, setVia] = useState(initial?.viaReferenceFieldKey ?? "");
  const [targetFieldKey, setTargetFieldKey] = useState(initial?.targetFieldKey ?? "");
  const [sourceFieldKey, setSourceFieldKey] = useState(initial?.sourceFieldKey ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [error, setError] = useState("");

  const canCrossModule = references.length > 0;
  const crosses = targetKind === "related_record" || valueKind === "related_field";

  const referenceOptions = references.map((reference) => ({
    value: reference.fieldKey,
    label: `${reference.fieldLabel} → ${reference.moduleLabel}`,
  }));

  /* Selects derivados em vez de sincronizados por efeito: quando a lista de
     opções muda (trocou o campo de referência, trocou o destino), o valor
     escolhido antes pode não existir mais — cair na primeira opção é mais
     previsível do que um `useEffect` limpando estado a cada render. */
  function pick(current: string, options: { value: string }[]) {
    return options.some((option) => option.value === current) ? current : (options[0]?.value ?? "");
  }

  const effectiveVia = crosses ? pick(via, referenceOptions) : "";
  const selectedReference = references.find((reference) => reference.fieldKey === effectiveVia);

  const targetOptions = writableFields(
    targetKind === "related_record" ? (selectedReference?.fields ?? []) : ownFields,
  );
  const effectiveTarget = pick(targetFieldKey, targetOptions);

  const sourceOptions = writableFields(selectedReference?.fields ?? []);
  const effectiveSource = valueKind === "related_field" ? pick(sourceFieldKey, sourceOptions) : "";

  const targetKindOptions = [
    { value: "self", label: "Preenche um campo deste registro" },
    ...(canCrossModule
      ? [{ value: "related_record", label: "Preenche um campo de um registro relacionado" }]
      : []),
  ];

  /* `related_field` só existe com destino no próprio registro: ler do
     relacionado E escrever no relacionado exigiria dois campos de referência
     (o de leitura e o de escrita podem ser diferentes), e é vizinho de
     referência multi-hop — fora de escopo. O CHECK da tabela recusa a
     combinação; aqui ela nem aparece. */
  const valueKindOptions = [
    { value: "literal", label: "Valor fixo" },
    { value: "now", label: "Data/hora da transição" },
    { value: "current_user", label: "Usuário que acionou" },
    ...(canCrossModule && targetKind === "self"
      ? [{ value: "related_field", label: "Campo de um registro relacionado" }]
      : []),
  ];

  function handleTargetKind(next: string) {
    setTargetKind(next as ActionTargetKind);
    if (next === "related_record" && valueKind === "related_field") setValueKind("literal");
  }

  function handleSubmit() {
    if (!effectiveTarget) {
      setError("Escolha o campo que a ação preenche.");
      return;
    }
    if (crosses && !effectiveVia) {
      setError("Escolha o campo de referência que a ação vai seguir.");
      return;
    }
    if (valueKind === "related_field" && !effectiveSource) {
      setError("Escolha o campo que a ação vai ler no registro relacionado.");
      return;
    }
    setError("");
    onSubmit({
      id: initial?.id ?? null,
      targetKind,
      targetFieldKey: effectiveTarget,
      viaReferenceFieldKey: crosses ? effectiveVia : null,
      valueKind,
      value: valueKind === "literal" ? value : null,
      sourceFieldKey: valueKind === "related_field" ? effectiveSource : null,
      sortOrder: Number(sortOrder) || 0,
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>{title}</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}

            <div className="registry-form-modal__fields">
              <FormField
                id="action-target-kind"
                label="O que a ação faz"
                type="select"
                options={targetKindOptions}
                value={targetKind}
                onChange={handleTargetKind}
              />

              {crosses && (
                <FormField
                  id="action-via"
                  label="Seguindo o campo de referência *"
                  type="select"
                  options={referenceOptions}
                  value={effectiveVia}
                  onChange={setVia}
                />
              )}

              <FormField
                id="action-target-field"
                label={
                  targetKind === "related_record"
                    ? `Campo preenchido em ${selectedReference?.moduleLabel ?? "outro módulo"} *`
                    : "Campo preenchido *"
                }
                type="select"
                options={targetOptions}
                value={effectiveTarget}
                onChange={setTargetFieldKey}
              />

              <FormField
                id="action-value-kind"
                label="Valor"
                type="select"
                options={valueKindOptions}
                value={valueKind}
                onChange={(next) => setValueKind(next as ActionValueKind)}
              />

              {valueKind === "literal" && (
                <FormField id="action-value" label="Valor fixo" value={value} onChange={setValue} />
              )}

              {valueKind === "related_field" && (
                <FormField
                  id="action-source-field"
                  label={`Campo lido em ${selectedReference?.moduleLabel ?? "outro módulo"} *`}
                  type="select"
                  options={sourceOptions}
                  value={effectiveSource}
                  onChange={setSourceFieldKey}
                />
              )}

              <FormField
                id="action-order"
                label="Ordem"
                value={sortOrder}
                onChange={setSortOrder}
              />

              {crosses && (
                <p className="module-builder__hint">
                  Esta ação atravessa a referência e mexe em outro módulo. Quem acionar a transição
                  no dia a dia não precisa (nem vai saber que precisa) de permissão lá — a
                  permissão que vale é a de quem configurou isto aqui.
                </p>
              )}
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
