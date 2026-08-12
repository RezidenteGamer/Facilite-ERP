import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorBoundary.css";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Rede de segurança contra tela branca: qualquer erro de renderização não
 * tratado em algum componente abaixo cai aqui em vez de derrubar o app
 * inteiro em silêncio. Fica na raiz (ver main.tsx) para cobrir todas as rotas.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro não tratado capturado pelo ErrorBoundary:", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.href = "/";
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <h1 className="error-boundary__title">Algo deu errado</h1>
            <p className="error-boundary__message">
              Ocorreu um erro inesperado nesta tela. Você pode tentar voltar para o início.
            </p>
            <button className="error-boundary__btn" type="button" onClick={this.handleReload}>
              Voltar para o início
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
