import { useEffect, useRef, useState } from "react";

/**
 * "Copiar para a área de transferência, com um retorno visual de ~1,5s" —
 * padrão já repetido em três lugares deste projeto (`WorkflowSection.tsx`,
 * `ModuleBuilderPage.tsx`, e agora `PixQrCode.tsx`) antes de ganhar este
 * único lar (achado do `/code-review alto`). Os dois usos mais antigos não
 * foram migrados para cá nesta tarefa — D11 não mexe no construtor de
 * módulos — mas qualquer uso novo deve vir daqui, não de uma quarta cópia.
 *
 * Também corrige um vazamento pequeno que nenhuma das cópias anteriores
 * tratava: o `setTimeout` que desliga o "Copiado!" é cancelado no
 * desmonte, então clicar em "Copiar" e fechar o modal antes de 1,5s não
 * deixa um timer tentando atualizar um componente que já sumiu.
 */
export function useCopyToClipboard(resetDelayMs = 1500) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(false);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), resetDelayMs);
    } catch {
      setCopied(false);
      setError(true);
    }
  }

  return { copied, error, copy };
}
