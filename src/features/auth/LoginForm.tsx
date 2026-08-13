import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

type FieldErrors = {
  email?: boolean;
  senha?: boolean;
};

export default function LoginForm() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);

  function clearFieldError(field: keyof FieldErrors) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFeedback("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim()) {
      setErrors({ email: true });
      setFeedback("Informe o seu email para continuar.");
      emailRef.current?.focus();
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

    const { error } = await signIn(email.trim(), senha);

    setLoading(false);

    if (error) {
      setFeedback("Email ou senha incorretos.");
      return;
    }

    navigate("/inicio");
  }

  return (
    <form className="login__form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="email">
          Email
        </label>
        <input
          ref={emailRef}
          className="field__input"
          id="email"
          name="email"
          type="email"
          placeholder="Digite seu email aqui!"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearFieldError("email");
          }}
          aria-invalid={errors.email ? "true" : undefined}
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
