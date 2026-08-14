export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      branches: {
        Row: {
          active: boolean;
          address: string | null;
          certificado_digital_ref: string | null;
          cnae: string | null;
          cnpj: string | null;
          code: string;
          codigo_ibge_municipio: string | null;
          created_at: string;
          id: string;
          inscricao_estadual: string | null;
          name: string;
          regime_tributario: string | null;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          certificado_digital_ref?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          code: string;
          codigo_ibge_municipio?: string | null;
          created_at?: string;
          id?: string;
          inscricao_estadual?: string | null;
          name: string;
          regime_tributario?: string | null;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          certificado_digital_ref?: string | null;
          cnae?: string | null;
          cnpj?: string | null;
          code?: string;
          codigo_ibge_municipio?: string | null;
          created_at?: string;
          id?: string;
          inscricao_estadual?: string | null;
          name?: string;
          regime_tributario?: string | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          active: boolean;
          address: string | null;
          birth_date: string | null;
          code: string;
          codigo_ibge_municipio: string | null;
          created_at: string;
          document: string;
          email: string | null;
          id: string;
          indicador_ie: string | null;
          inscricao_estadual: string | null;
          kind: Database["public"]["Enums"]["contact_kind"];
          name: string;
          phone: string | null;
          photo_url: string | null;
          rg: string | null;
          updated_at: string;
          whatsapp: string | null;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          birth_date?: string | null;
          code: string;
          codigo_ibge_municipio?: string | null;
          created_at?: string;
          document: string;
          email?: string | null;
          id?: string;
          indicador_ie?: string | null;
          inscricao_estadual?: string | null;
          kind: Database["public"]["Enums"]["contact_kind"];
          name: string;
          phone?: string | null;
          photo_url?: string | null;
          rg?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          birth_date?: string | null;
          code?: string;
          codigo_ibge_municipio?: string | null;
          created_at?: string;
          document?: string;
          email?: string | null;
          id?: string;
          indicador_ie?: string | null;
          inscricao_estadual?: string | null;
          kind?: Database["public"]["Enums"]["contact_kind"];
          name?: string;
          phone?: string | null;
          photo_url?: string | null;
          rg?: string | null;
          updated_at?: string;
          whatsapp?: string | null;
        };
        Relationships: [];
      };
      module_fields: {
        Row: {
          data_type: string;
          field_key: string;
          id: string;
          is_required: boolean;
          label: string;
          module_id: string;
          show_in_details: boolean;
          show_in_form: boolean;
          show_in_table: boolean;
          sort_order: number;
          table_align: string | null;
          table_width: string | null;
        };
        Insert: {
          data_type?: string;
          field_key: string;
          id?: string;
          is_required?: boolean;
          label: string;
          module_id: string;
          show_in_details?: boolean;
          show_in_form?: boolean;
          show_in_table?: boolean;
          sort_order?: number;
          table_align?: string | null;
          table_width?: string | null;
        };
        Update: {
          data_type?: string;
          field_key?: string;
          id?: string;
          is_required?: boolean;
          label?: string;
          module_id?: string;
          show_in_details?: boolean;
          show_in_form?: boolean;
          show_in_table?: boolean;
          sort_order?: number;
          table_align?: string | null;
          table_width?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "module_fields_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "modules";
            referencedColumns: ["id"];
          },
        ];
      };
      module_tabs: {
        Row: {
          id: string;
          label: string;
          module_id: string;
          sort_order: number;
          tab_key: string;
        };
        Insert: {
          id?: string;
          label: string;
          module_id: string;
          sort_order?: number;
          tab_key: string;
        };
        Update: {
          id?: string;
          label?: string;
          module_id?: string;
          sort_order?: number;
          tab_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "module_tabs_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "modules";
            referencedColumns: ["id"];
          },
        ];
      };
      modules: {
        Row: {
          created_at: string;
          data_table: string;
          id: string;
          is_locked: boolean;
          label: string;
          layout_variant: string;
        };
        Insert: {
          created_at?: string;
          data_table: string;
          id: string;
          is_locked?: boolean;
          label: string;
          layout_variant?: string;
        };
        Update: {
          created_at?: string;
          data_table?: string;
          id?: string;
          is_locked?: boolean;
          label?: string;
          layout_variant?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          active: boolean;
          branch_id: string;
          cclasstrib: string | null;
          cest: string | null;
          code: string;
          cost_price: number | null;
          created_at: string;
          csosn: string | null;
          cst_cofins: string | null;
          cst_ibs_cbs: string | null;
          cst_icms: string | null;
          cst_ipi: string | null;
          cst_pis: string | null;
          description: string;
          id: string;
          location: string | null;
          ncm: string | null;
          origem_mercadoria: string | null;
          sale_price: number;
          stock: number;
          sub_location: string | null;
          taxation: string | null;
          type: string | null;
          unidade_comercial: string | null;
          unidade_tributavel: string | null;
          updated_at: string;
          wholesale_price: number | null;
        };
        Insert: {
          active?: boolean;
          branch_id: string;
          cclasstrib?: string | null;
          cest?: string | null;
          code: string;
          cost_price?: number | null;
          created_at?: string;
          csosn?: string | null;
          cst_cofins?: string | null;
          cst_ibs_cbs?: string | null;
          cst_icms?: string | null;
          cst_ipi?: string | null;
          cst_pis?: string | null;
          description: string;
          id?: string;
          location?: string | null;
          ncm?: string | null;
          origem_mercadoria?: string | null;
          sale_price?: number;
          stock?: number;
          sub_location?: string | null;
          taxation?: string | null;
          type?: string | null;
          unidade_comercial?: string | null;
          unidade_tributavel?: string | null;
          updated_at?: string;
          wholesale_price?: number | null;
        };
        Update: {
          active?: boolean;
          branch_id?: string;
          cclasstrib?: string | null;
          cest?: string | null;
          code?: string;
          cost_price?: number | null;
          created_at?: string;
          csosn?: string | null;
          cst_cofins?: string | null;
          cst_ibs_cbs?: string | null;
          cst_icms?: string | null;
          cst_ipi?: string | null;
          cst_pis?: string | null;
          description?: string;
          id?: string;
          location?: string | null;
          ncm?: string | null;
          origem_mercadoria?: string | null;
          sale_price?: number;
          stock?: number;
          sub_location?: string | null;
          taxation?: string | null;
          type?: string | null;
          unidade_comercial?: string | null;
          unidade_tributavel?: string | null;
          updated_at?: string;
          wholesale_price?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          document: string;
          email: string;
          id: string;
          name: string;
          operator_code: string;
          role_id: string | null;
        };
        Insert: {
          active?: boolean;
          code?: string;
          created_at?: string;
          document?: string;
          email?: string;
          id: string;
          name: string;
          operator_code?: string;
          role_id?: string | null;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          document?: string;
          email?: string;
          id?: string;
          name?: string;
          operator_code?: string;
          role_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          can_create: boolean;
          can_delete: boolean;
          can_edit: boolean;
          can_view: boolean;
          id: string;
          module_id: string;
          role_id: string;
        };
        Insert: {
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_view?: boolean;
          id?: string;
          module_id: string;
          role_id: string;
        };
        Update: {
          can_create?: boolean;
          can_delete?: boolean;
          can_edit?: boolean;
          can_view?: boolean;
          id?: string;
          module_id?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_id_fkey";
            columns: ["module_id"];
            isOneToOne: false;
            referencedRelation: "modules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          can_manage_branches: boolean;
          can_manage_permissions: boolean;
          can_manage_users: boolean;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
        };
        Insert: {
          can_manage_branches?: boolean;
          can_manage_permissions?: boolean;
          can_manage_users?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          can_manage_branches?: boolean;
          can_manage_permissions?: boolean;
          can_manage_users?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      sale_items: {
        Row: {
          cfop: string | null;
          created_at: string;
          discount_amount: number;
          id: string;
          product_id: string;
          quantity: number;
          sale_id: string;
          total_amount: number;
          unit_price: number;
        };
        Insert: {
          cfop?: string | null;
          created_at?: string;
          discount_amount?: number;
          id?: string;
          product_id: string;
          quantity: number;
          sale_id: string;
          total_amount: number;
          unit_price: number;
        };
        Update: {
          cfop?: string | null;
          created_at?: string;
          discount_amount?: number;
          id?: string;
          product_id?: string;
          quantity?: number;
          sale_id?: string;
          total_amount?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_payments: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          installments: number;
          method: Database["public"]["Enums"]["sale_payment_method"];
          sale_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          installments?: number;
          method: Database["public"]["Enums"]["sale_payment_method"];
          sale_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          installments?: number;
          method?: Database["public"]["Enums"]["sale_payment_method"];
          sale_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_adjustments: {
        Row: {
          balance_after: number;
          branch_id: string;
          change: number;
          created_at: string;
          created_by: string | null;
          id: string;
          product_id: string;
          reason: string;
        };
        Insert: {
          balance_after: number;
          branch_id: string;
          change: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id: string;
          reason: string;
        };
        Update: {
          balance_after?: number;
          branch_id?: string;
          change?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_adjustments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          address: string | null;
          branch_id: string;
          cbs_total: number | null;
          code: string;
          cofins_total: number | null;
          confirmed_at: string | null;
          contact_id: string;
          cost_center: string | null;
          created_at: string;
          created_by: string;
          delivery_address: string | null;
          department: string | null;
          discount_amount: number;
          exit_date: string | null;
          freight_amount: number;
          ibs_total: number | null;
          icms_total: number | null;
          id: string;
          ipi_total: number | null;
          issue_date: string;
          operation_type: string | null;
          pis_total: number | null;
          seller_id: string;
          status: Database["public"]["Enums"]["sale_status"];
          subtotal_amount: number;
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          branch_id: string;
          cbs_total?: number | null;
          code: string;
          cofins_total?: number | null;
          confirmed_at?: string | null;
          contact_id: string;
          cost_center?: string | null;
          created_at?: string;
          created_by: string;
          delivery_address?: string | null;
          department?: string | null;
          discount_amount?: number;
          exit_date?: string | null;
          freight_amount?: number;
          ibs_total?: number | null;
          icms_total?: number | null;
          id?: string;
          ipi_total?: number | null;
          issue_date?: string;
          operation_type?: string | null;
          pis_total?: number | null;
          seller_id: string;
          status?: Database["public"]["Enums"]["sale_status"];
          subtotal_amount?: number;
          total_amount?: number;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          branch_id?: string;
          cbs_total?: number | null;
          code?: string;
          cofins_total?: number | null;
          confirmed_at?: string | null;
          contact_id?: string;
          cost_center?: string | null;
          created_at?: string;
          created_by?: string;
          delivery_address?: string | null;
          department?: string | null;
          discount_amount?: number;
          exit_date?: string | null;
          freight_amount?: number;
          ibs_total?: number | null;
          icms_total?: number | null;
          id?: string;
          ipi_total?: number | null;
          issue_date?: string;
          operation_type?: string | null;
          pis_total?: number | null;
          seller_id?: string;
          status?: Database["public"]["Enums"]["sale_status"];
          subtotal_amount?: number;
          total_amount?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      user_branches: {
        Row: {
          branch_id: string;
          user_id: string;
        };
        Insert: {
          branch_id: string;
          user_id: string;
        };
        Update: {
          branch_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_branches_branch_id_fkey";
            columns: ["branch_id"];
            isOneToOne: false;
            referencedRelation: "branches";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_manage_branches: { Args: never; Returns: boolean };
      can_manage_permissions: { Args: never; Returns: boolean };
      can_manage_users: { Args: never; Returns: boolean };
      can_manage_users_for: { Args: { p_user_id: string }; Returns: boolean };
      adjust_stock: {
        Args: { p_branch_id: string; p_product_id: string; p_change: number; p_reason: string };
        Returns: Database["public"]["Tables"]["stock_adjustments"]["Row"];
      };
      create_sale: {
        Args: { payload: Json };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      has_branch_access: { Args: { p_branch_id: string }; Returns: boolean };
      has_permission: {
        Args: { p_action: string; p_module_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      contact_kind: "clientes" | "fornecedores";
      sale_payment_method: "dinheiro" | "debito" | "credito" | "pix" | "boleto" | "outro";
      sale_status: "confirmed" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      contact_kind: ["clientes", "fornecedores"],
      sale_payment_method: ["dinheiro", "debito", "credito", "pix", "boleto", "outro"],
      sale_status: ["confirmed", "cancelled"],
    },
  },
} as const;
