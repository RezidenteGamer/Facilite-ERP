import "./RouteFallback.css";

/** Suspense fallback das rotas lazy — só aparece se o chunk demorar pra chegar. */
export default function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-label="Carregando">
      <span className="route-fallback__spinner" />
    </div>
  );
}
