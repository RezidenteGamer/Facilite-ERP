import "./RegistryActions.css";

export type RegistryAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Abre um espaço maior antes do botão — separa ações destrutivas das demais. */
  detached?: boolean;
};

type RegistryActionsProps = {
  title: string;
  actions: RegistryAction[];
};

/** Coluna da esquerda dos módulos de cadastro: título + botões de ação. */
export default function RegistryActions({ title, actions }: RegistryActionsProps) {
  return (
    <aside className="registry-actions">
      <p className="registry-actions__title">{title}</p>

      {actions.map((action) => (
        <button
          key={action.id}
          className={`registry-actions__btn${action.detached ? " registry-actions__btn--detached" : ""}`}
          type="button"
          data-action={action.id}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </aside>
  );
}
