import { useState, type FormEvent } from "react";
import { ArrowRightIcon, PaperclipIcon } from "../../components/icons";
import LoginForm from "./LoginForm";
import "./LoginPage.css";

type ChatMessage = {
  id: number;
  from: "bot" | "user";
  text: string;
};

let nextMessageId = 0;

export default function LoginPage() {
  const [supportExpanded, setSupportExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cnpj, setCnpj] = useState("");
  const [ticketSent, setTicketSent] = useState(false);

  function openChat() {
    setChatOpen(true);
    setTicketSent(false);
    setCnpj("");
    setMessages([
      { id: nextMessageId++, from: "bot", text: "Para abrir seu ticket, me informe o CNPJ da sua empresa:" },
    ]);
  }

  function handleTicketSubmit(event: FormEvent) {
    event.preventDefault();
    const value = cnpj.trim();
    if (!value || ticketSent) return;

    setMessages((prev) => [
      ...prev,
      { id: nextMessageId++, from: "user", text: value },
      {
        id: nextMessageId++,
        from: "bot",
        text: "Seu ticket foi aberto, em breve nosso suporte entrará em contato com você.",
      },
    ]);
    setCnpj("");
    setTicketSent(true);
  }

  return (
    <>
      <div className="backdrop" aria-hidden="true" />

      <main className="screen">
        <aside
          className={`card support${supportExpanded ? " support--expanded" : ""}`}
          aria-labelledby="support-title"
        >
          <button
            className="support__toggle"
            type="button"
            aria-expanded={supportExpanded}
            aria-controls="support-body"
            onClick={() => setSupportExpanded((value) => !value)}
          >
            <span className="support__heading">
              <h2 className="support__title" id="support-title">
                Suporte
              </h2>
              <svg className="swoosh swoosh--underline" viewBox="0 0 240 32" fill="none" aria-hidden="true">
                <path
                  d="M4 25C54 29 146 23 236 6"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </button>

          <div className="support__body" id="support-body">
            {!chatOpen ? (
              <>
                <p className="support__text">Precisa de ajuda para entrar no seu sistema?</p>
                <p className="support__text">Abra um ticket</p>

                <button className="btn btn--amber" type="button" data-action="ticket" onClick={openChat}>
                  Abrir
                </button>
              </>
            ) : (
              <div className="support__chat">
                <div className="support__chat-panel">
                  <div className="support__chat-messages">
                    {messages.map((message) => (
                      <p
                        key={message.id}
                        className={`support__chat-bubble support__chat-bubble--${message.from}`}
                      >
                        {message.text}
                      </p>
                    ))}
                  </div>

                  {!ticketSent && (
                    <form className="support__chat-form" onSubmit={handleTicketSubmit}>
                      <div className="support__chat-input-wrap">
                        <input
                          className="support__chat-input"
                          type="text"
                          inputMode="numeric"
                          placeholder="Insira seu CNPJ aqui"
                          value={cnpj}
                          onChange={(event) => setCnpj(event.target.value)}
                          autoFocus
                        />
                        <button
                          className="support__chat-attach"
                          type="button"
                          aria-label="Anexar arquivo"
                          data-action="anexar-arquivo"
                        >
                          <PaperclipIcon />
                        </button>
                      </div>
                      <button className="support__chat-send" type="submit" aria-label="Enviar">
                        <ArrowRightIcon />
                      </button>
                    </form>
                  )}
                </div>

                <button className="support__chat-back" type="button" onClick={() => setChatOpen(false)}>
                  Voltar
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className="card login" aria-labelledby="brand-name">
          <p className="login__by">
            By <span className="login__by-brand">SimpleSoft</span>
          </p>

          <div className="brand">
            <h1 className="brand__word" id="brand-name">
              <span className="brand__ink">Faci</span>
              <span className="brand__accent">lit</span>
              <span className="brand__ink">e</span>
            </h1>
            <svg className="swoosh brand__swoosh" viewBox="0 0 150 42" fill="none" aria-hidden="true">
              <path
                d="M5 13C13 30 45 38 84 33c23-3 41-13 52-27"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <path
                d="M120 11 136 6 135 23"
                stroke="currentColor"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <LoginForm />
        </section>
      </main>
    </>
  );
}
