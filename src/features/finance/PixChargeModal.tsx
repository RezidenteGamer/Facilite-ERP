import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PixQrCode from "../../components/PixQrCode";
import { extractErrorMessage } from "../../lib/errorMessage";
import { fetchBranchPixChargeInfo } from "../../lib/repositories/branchesRepository";
import { buildPixBRCode } from "../../lib/pix/pixPayload";
import { useAuth } from "../auth/AuthContext";
import "../registry-engine/RegistryFormModal.css";
import "./PixChargeModal.css";
import type { FinanceEntry } from "./finance";

type PixChargeModalProps = {
  entry: FinanceEntry;
  branchId: string;
  onCancel: () => void;
};

/**
 * "Sem chave" é um caso do mesmo formato que qualquer outro erro que impede
 * de montar a cobrança — os dois só mostram uma mensagem, e "sem chave" só
 * acrescenta o quê fazer a respeito. Um único estado `error` com uma `action`
 * opcional cobre os dois sem duplicar a renderização (achado do `/code-review
 * alto`: a versão anterior tinha um quarto estado, `sem-chave`, idêntico a
 * `error` além do botão).
 */
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; action?: { label: string; onClick: () => void } }
  | { status: "pronto"; payload: string };

/**
 * "Cobrar via PIX" (D11, 10/09/2026) — mostra o QR Code de um BR Code
 * estático montado na hora, no cliente, a partir da chave PIX da filial e do
 * valor do lançamento selecionado em Financeiro.
 *
 * **Não confirma pagamento nenhum.** PIX estático é auto-contido — não há
 * provedor no meio para avisar quando o cliente paga. Fechar este modal não
 * muda o status do lançamento; quem baixa é o operador, clicando "Baixar",
 * exatamente como antes desta tarefa existir.
 */
export default function PixChargeModal({ entry, branchId, onCancel }: PixChargeModalProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelado = false;
    setState({ status: "loading" });

    fetchBranchPixChargeInfo(branchId)
      .then((info) => {
        if (cancelado) return;
        if (!info.pixKey) {
          /*
           * A tela de Filiais exige `can_manage_branches` — um operador só de
           * Financeiro (que é quem chega até aqui, via `has_branch_access`)
           * pode não ter esse papel. Achado do `/code-review alto`: oferecer
           * o botão de qualquer jeito levaria esse operador a um beco sem
           * saída ("Você não tem permissão para gerenciar filiais"). Sem o
           * papel, a mensagem já diz o caminho em palavras, sem link morto.
           */
          const podeCadastrar = Boolean(profile?.canManageBranches);
          setState({
            status: "error",
            message: podeCadastrar
              ? "Esta filial ainda não tem uma chave PIX cadastrada."
              : "Esta filial ainda não tem uma chave PIX cadastrada. Peça a um administrador para " +
                "cadastrá-la em Configurações > Filiais.",
            action: podeCadastrar
              ? { label: "Cadastrar chave PIX", onClick: () => navigate("/configuracoes/filiais") }
              : undefined,
          });
          return;
        }
        const payload = buildPixBRCode({
          pixKey: info.pixKey,
          merchantName: info.name,
          merchantCity: info.municipio ?? "",
          amount: entry.total,
          txid: entry.code,
        });
        setState({ status: "pronto", payload });
      })
      .catch((err) => {
        if (cancelado) return;
        setState({ status: "error", message: extractErrorMessage(err, "Não foi possível montar a cobrança.") });
      });

    return () => {
      cancelado = true;
    };
  }, [branchId, entry.code, entry.total, navigate, profile?.canManageBranches]);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Cobrar via PIX — {entry.contactName}</p>
            </Dialog.Title>

            {state.status === "loading" && <p className="pix-charge-modal__status">Montando cobrança…</p>}

            {state.status === "error" && (
              <>
                <p className="registry-form-modal__error">{state.message}</p>
                {state.action && (
                  <button
                    className="registry-form-modal__btn registry-form-modal__btn--confirm"
                    type="button"
                    onClick={state.action.onClick}
                  >
                    {state.action.label}
                  </button>
                )}
              </>
            )}

            {state.status === "pronto" && (
              <>
                <p className="pix-charge-modal__amount">{entry.totalFormatted}</p>
                <PixQrCode payload={state.payload} />
              </>
            )}

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
              >
                Fechar
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
