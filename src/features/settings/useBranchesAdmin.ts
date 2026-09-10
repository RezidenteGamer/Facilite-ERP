import { useCallback, useEffect, useRef, useState } from "react";
import {
  branchCertificadoColumnsAvailable,
  branchEmailColumnAvailable,
  branchPixKeyColumnAvailable,
  createBranch,
  fetchBranchesForAdmin,
  updateBranch,
} from "../../lib/repositories/branchesRepository";
import { extractErrorMessage } from "../../lib/errorMessage";
import type { BranchAdmin, BranchFormValues } from "./branches";

/**
 * Dados da tela de Filiais (D1). Mesmo formato de `useUsersData`: carrega na
 * montagem, expõe `reload` e devolve mutações que releem a lista.
 *
 * `enabled` existe porque a tela é aberta por quem **não** pode gerenciar
 * filiais também (a rota é sub-rota de Configurações, que é `authenticated`).
 * Nesse caso a lista sequer é buscada: a RLS devolveria as filiais do próprio
 * usuário, o que confundiria — a tela mostra a porta fechada e mais nada.
 */
export function useBranchesAdmin(enabled: boolean) {
  const [branches, setBranches] = useState<BranchAdmin[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  /** `null` até a primeira leitura — ver `branchEmailColumnAvailable`. */
  const [emailColumnAvailable, setEmailColumnAvailable] = useState<boolean | null>(null);
  /** Idem, para as três colunas de certificado digital (A11). */
  const [certificadoColumnsAvailable, setCertificadoColumnsAvailable] = useState<boolean | null>(
    null,
  );
  /** Idem, para a coluna da chave PIX (D11). */
  const [pixKeyColumnAvailable, setPixKeyColumnAvailable] = useState<boolean | null>(null);

  /**
   * Número da leitura mais recente. Duas leituras podem estar no ar ao mesmo
   * tempo — a da montagem e a que um "Salvar" dispara logo em seguida — e nada
   * garante que voltem na ordem em que saíram: sem isto, a mais antiga
   * chegando por último repintaria a lista **sem** a filial recém-salva.
   * Também é o que impede escrever estado depois da tela desmontar.
   */
  const leituraAtual = useRef(0);
  useEffect(() => () => {
    // Desmontou: qualquer leitura no ar deixa de valer.
    leituraAtual.current += 1;
  }, []);

  const reload = useCallback(async () => {
    const leitura = (leituraAtual.current += 1);
    const aindaVale = () => leituraAtual.current === leitura;

    if (!enabled) {
      setBranches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchBranchesForAdmin();
      if (!aindaVale()) return;
      setBranches(rows);
      setEmailColumnAvailable(branchEmailColumnAvailable());
      setCertificadoColumnsAvailable(branchCertificadoColumnsAvailable());
      setPixKeyColumnAvailable(branchPixKeyColumnAvailable());
    } catch (err) {
      if (!aindaVale()) return;
      setError(extractErrorMessage(err, "Erro ao carregar as filiais."));
    } finally {
      if (aindaVale()) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (values: BranchFormValues) => {
      await createBranch(values);
      await reload();
    },
    [reload],
  );

  const update = useCallback(
    async (id: string, values: BranchFormValues) => {
      await updateBranch(id, values);
      await reload();
    },
    [reload],
  );

  return {
    branches,
    loading,
    error,
    emailColumnAvailable,
    certificadoColumnsAvailable,
    pixKeyColumnAvailable,
    reload,
    create,
    update,
  };
}
