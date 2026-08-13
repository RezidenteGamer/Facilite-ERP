import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext";
import RouteFallback from "./RouteFallback";

/** Redireciona para o login se não houver sessão autenticada. */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <RouteFallback />;
  if (!session) return <Navigate to="/" replace />;

  return <>{children}</>;
}
