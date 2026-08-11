import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import FormField from "../../components/form/FormField";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { SaleHandIcon } from "../home/icons";
import "./SalePage.css";

type SaleForm = {
  cliente: string;
  endereco: string;
  enderecoEntrega: string;
  formaPagamento: string;
  vendedor: string;
  tipoOperacao: string;
  departamento: string;
  centroCustos: string;
  dataEmissao: string;
  dataSaida: string;
};

const FORM_INICIAL: SaleForm = {
  cliente: "",
  endereco: "",
  enderecoEntrega: "",
  formaPagamento: "",
  vendedor: "",
  tipoOperacao: "",
  departamento: "",
  centroCustos: "",
  dataEmissao: "",
  dataSaida: "",
};

/** Módulo "Realizar uma venda" — primeira etapa: dados da operação. */
export default function SalePage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const [form, setForm] = useState<SaleForm>(FORM_INICIAL);

  useEffect(() => {
    openWindow({
      id: "realizar-venda",
      label: "Realizar uma venda",
      path: "/realizar-venda",
      icon: SaleHandIcon,
    });
  }, [openWindow]);

  function set<K extends keyof SaleForm>(campo: K, valor: SaleForm[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Realizar venda">
      <div className="sale">
        {/* Aba lateral: fica atrás do painel e só aparece a parte que sobra */}
        <button className="sale__freight" type="button" data-action="frete">
          <span>Frete</span>
        </button>

        <div className="sale__panel">
          <div className="sale__card">
            <div className="sale__grid">
              <FormField
                id="venda-cliente"
                label="Cliente"
                value={form.cliente}
                onChange={(v) => set("cliente", v)}
                lookup
              />
              <FormField
                id="venda-tipo-operacao"
                label="Tipo de operação"
                value={form.tipoOperacao}
                onChange={(v) => set("tipoOperacao", v)}
                lookup
              />

              <FormField
                id="venda-endereco"
                label="Endereço"
                value={form.endereco}
                onChange={(v) => set("endereco", v)}
                lookup
                /* Vem do cadastro do cliente: fica cinza até haver um cliente. */
                disabled={!form.cliente.trim()}
              />
              <FormField
                id="venda-departamento"
                label="Departamento"
                value={form.departamento}
                onChange={(v) => set("departamento", v)}
                lookup
              />

              <FormField
                id="venda-endereco-entrega"
                label="Endereço de entrega"
                value={form.enderecoEntrega}
                onChange={(v) => set("enderecoEntrega", v)}
                lookup
              />
              <FormField
                id="venda-centro-custos"
                label="Centro de custos"
                value={form.centroCustos}
                onChange={(v) => set("centroCustos", v)}
                lookup
              />

              <FormField
                id="venda-forma-pagamento"
                label="Forma de pagamento"
                value={form.formaPagamento}
                onChange={(v) => set("formaPagamento", v)}
                lookup
              />
              <FormField
                id="venda-data-emissao"
                label="Data de emissão"
                type="date"
                value={form.dataEmissao}
                onChange={(v) => set("dataEmissao", v)}
              />

              <FormField
                id="venda-vendedor"
                label="Vendedor"
                value={form.vendedor}
                onChange={(v) => set("vendedor", v)}
                lookup
              />
              <FormField
                id="venda-data-saida"
                label="Data de saída"
                type="date"
                value={form.dataSaida}
                onChange={(v) => set("dataSaida", v)}
              />
            </div>

            <div className="sale__footer">
              <button className="sale__continue" type="button" data-action="continuar">
                Continuar
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
