/**
 * Peças compartilhadas dos módulos de cadastro (Clientes, Produtos e os
 * próximos). Cada tela só descreve o que muda — títulos, botões, colunas e
 * campos da ficha — em vez de remontar a mesma estrutura de novo.
 */
export { default as RegistryLayout } from "./RegistryLayout";
export { default as RegistryActions } from "./RegistryActions";
export { default as RegistryTable } from "./RegistryTable";
export { default as RegistryDetails } from "./RegistryDetails";

export type { RegistryAction } from "./RegistryActions";
export type { RegistryColumn, RegistryTab } from "./RegistryTable";
export type { RegistryField, RegistryMedia } from "./RegistryDetails";
