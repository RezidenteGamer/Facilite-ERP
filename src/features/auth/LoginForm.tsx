import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

type FieldErrors = {
  usuario?: boolean;
  senha?: boolean;
};

export default function LoginForm() {
  const navigate = useNavigate();

  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  const usuarioRef = useRef<HTMLInputElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);

  function clearFieldError(field: keyof FieldErrors) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFeedback("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!usuario.trim()) {
      setErrors({ usuario: true });
      setFeedback("Informe o seu login para continuar.");
      usuarioRef.current?.focus();
      return;
    }

    if (!senha) {
      setErrors({ senha: true });
      setFeedback("Informe a sua senha para continuar.");
      senhaRef.current?.focus();
      return;
    }

    setErrors({});
    setFeedback("");
    setLoading(true);

    // Sem back-end por enquanto: qualquer login/senha preenchidos encaminham
    // para a próxima tela. Ponto de integração futuro:
    // `supabase.auth.signInWithPassword` (ver src/lib/supabaseClient.ts).
    window.setTimeout(() => {
      navigate("/inicio", { state: { usuario } });
    }, 500);
  }

  return (
    <form className="login__form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="usuario">
          Login
        </label>
        <input
          ref={usuarioRef}
          className="field__input"
          id="usuario"
          name="usuario"
          type="text"
          placeholder="Digite seu login aqui!"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={usuario}
          onChange={(event) => {
            setUsuario(event.target.value);
            clearFieldError("usuario");
          }}
          aria-invalid={errors.usuario ? "true" : undefined}
          required
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="senha">
          Senha
        </label>
        <input
          ref={senhaRef}
          className="field__input"
          id="senha"
          name="senha"
          type="password"
          placeholder="Digite sua senha aqui!"
          autoComplete="current-password"
          value={senha}
          onChange={(event) => {
            setSenha(event.target.value);
            clearFieldError("senha");
          }}
          aria-invalid={errors.senha ? "true" : undefined}
          required
        />
        <a className="field__forgot" href="#" data-action="recuperar-senha">
          Esqueceu a senha? Clique aqui!
        </a>
      </div>

      <button
        className="btn btn--amber btn--submit"
        type="submit"
        data-loading={loading ? "true" : undefined}
      >
        <span className="btn__label">{loading ? "ENTRANDO..." : "ENTRAR"}</span>
      </button>

      <p className="login__feedback" role="status" aria-live="polite">
        {feedback}
      </p>
    </form>
  );
}
