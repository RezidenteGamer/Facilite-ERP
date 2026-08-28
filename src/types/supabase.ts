export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      branches: {
        Row: {
          active: boolean
          allow_negative_stock: boolean
          bairro: string | null
          cep: string | null
          certificado_digital_ref: string | null
          cnae: string | null
          cnpj: string | null
          code: string
          codigo_ibge_municipio: string | null
          created_at: string
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          municipio: string | null
          name: string
          numero: string | null
          regime_tributario: string | null
          uf: string | null
        }
        Insert: {
          active?: boolean
          allow_negative_stock?: boolean
          bairro?: string | null
          cep?: string | null
          certificado_digital_ref?: string | null
          cnae?: string | null
          cnpj?: string | null
          code: string
          codigo_ibge_municipio?: string | null
          created_at?: string
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          name: string
          numero?: string | null
          regime_tributario?: string | null
          uf?: string | null
        }
        Update: {
          active?: boolean
          allow_negative_stock?: boolean
          bairro?: string | null
          cep?: string | null
          certificado_digital_ref?: string | null
          cnae?: string | null
          cnpj?: string | null
          code?: string
          codigo_ibge_municipio?: string | null
          created_at?: string
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          municipio?: string | null
          name?: string
          numero?: string | null
          regime_tributario?: string | null
          uf?: string | null
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          session_id: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          session_id: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          session_id?: string
          type?: Database["public"]["Enums"]["cash_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_registers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          code: string
          counted_amount: number | null
          difference: number | null
          expected_amount: number | null
          id: string
          opened_at: string
          opened_by: string | null
          opening_amount: number
          register_id: string
          status: Database["public"]["Enums"]["cash_session_status"]
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          code?: string
          counted_amount?: number | null
          difference?: number | null
          expected_amount?: number | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_amount: number
          register_id: string
          status?: Database["public"]["Enums"]["cash_session_status"]
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          code?: string
          counted_amount?: number | null
          difference?: number | null
          expected_amount?: number | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_amount?: number
          register_id?: string
          status?: Database["public"]["Enums"]["cash_session_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
        ]
      }
      cfop_codes: {
        Row: {
          codigo: string
          created_at: string
          descricao: string
          id: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descricao: string
          id?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descricao?: string
          id?: string
        }
        Relationships: []
      }
      conditional_item_conversions: {
        Row: {
          conditional_item_id: string
          created_at: string
          created_by: string | null
          id: string
          quantity: number
          sale_id: string
          sale_item_id: string
        }
        Insert: {
          conditional_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          quantity: number
          sale_id: string
          sale_item_id: string
        }
        Update: {
          conditional_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          quantity?: number
          sale_id?: string
          sale_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conditional_item_conversions_conditional_item_id_fkey"
            columns: ["conditional_item_id"]
            isOneToOne: false
            referencedRelation: "conditional_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditional_item_conversions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditional_item_conversions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditional_item_conversions_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
        ]
      }
      conditional_item_returns: {
        Row: {
          conditional_item_id: string
          created_at: string
          created_by: string | null
          id: string
          quantity: number
          reason: string
        }
        Insert: {
          conditional_item_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          quantity: number
          reason?: string
        }
        Update: {
          conditional_item_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          quantity?: number
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "conditional_item_returns_conditional_item_id_fkey"
            columns: ["conditional_item_id"]
            isOneToOne: false
            referencedRelation: "conditional_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditional_item_returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conditional_items: {
        Row: {
          conditional_id: string
          created_at: string
          id: string
          product_id: string
          quantity: number
          total_amount: number
          unit_price: number
        }
        Insert: {
          conditional_id: string
          created_at?: string
          id?: string
          product_id: string
          quantity: number
          total_amount: number
          unit_price: number
        }
        Update: {
          conditional_id?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "conditional_items_conditional_id_fkey"
            columns: ["conditional_id"]
            isOneToOne: false
            referencedRelation: "conditionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditional_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      conditionals: {
        Row: {
          branch_id: string
          code: string
          contact_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          status: Database["public"]["Enums"]["conditional_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          code: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          id?: string
          issue_date?: string
          status?: Database["public"]["Enums"]["conditional_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          code?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          id?: string
          issue_date?: string
          status?: Database["public"]["Enums"]["conditional_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conditionals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditionals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conditionals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          active: boolean
          bairro: string | null
          birth_date: string | null
          cep: string | null
          code: string
          codigo_ibge_municipio: string | null
          created_at: string
          document: string
          email: string | null
          id: string
          indicador_ie: string | null
          inscricao_estadual: string | null
          is_favorite: boolean
          kind: Database["public"]["Enums"]["contact_kind"]
          logradouro: string | null
          municipio: string | null
          name: string
          numero: string | null
          phone: string | null
          photo_url: string | null
          rg: string | null
          uf: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          active?: boolean
          bairro?: string | null
          birth_date?: string | null
          cep?: string | null
          code: string
          codigo_ibge_municipio?: string | null
          created_at?: string
          document: string
          email?: string | null
          id?: string
          indicador_ie?: string | null
          inscricao_estadual?: string | null
          is_favorite?: boolean
          kind: Database["public"]["Enums"]["contact_kind"]
          logradouro?: string | null
          municipio?: string | null
          name: string
          numero?: string | null
          phone?: string | null
          photo_url?: string | null
          rg?: string | null
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          active?: boolean
          bairro?: string | null
          birth_date?: string | null
          cep?: string | null
          code?: string
          codigo_ibge_municipio?: string | null
          created_at?: string
          document?: string
          email?: string | null
          id?: string
          indicador_ie?: string | null
          inscricao_estadual?: string | null
          is_favorite?: boolean
          kind?: Database["public"]["Enums"]["contact_kind"]
          logradouro?: string | null
          municipio?: string | null
          name?: string
          numero?: string | null
          phone?: string | null
          photo_url?: string | null
          rg?: string | null
          uf?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          code?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document?: string | null
          due_date: string
          id?: string
          installment_group_id?: string
          installment_number?: number
          installment_total?: number
          issue_date?: string
          origin_id?: string | null
          origin_kind?: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          code?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          document?: string | null
          due_date?: string
          id?: string
          installment_group_id?: string
          installment_number?: number
          installment_total?: number
          issue_date?: string
          origin_id?: string | null
          origin_kind?: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method?: string | null
          settled_at?: string | null
          status?: Database["public"]["Enums"]["financial_entry_status"]
          total?: number
          type?: Database["public"]["Enums"]["financial_entry_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          branch_id: string
          cancel_justificativa: string | null
          cancel_xml_content: string | null
          cancel_xml_path: string | null
          chave: string | null
          created_at: string
          created_by: string | null
          id: string
          mensagem_sefaz: string | null
          model: Database["public"]["Enums"]["fiscal_document_model"]
          numero: string | null
          pdf_content: string | null
          pdf_path: string | null
          protocolo: string | null
          qr_code_url: string | null
          ref: string
          sale_id: string | null
          sale_return_id: string | null
          serie: string | null
          status: Database["public"]["Enums"]["fiscal_document_status"]
          status_sefaz: string | null
          updated_at: string
          xml_content: string | null
          xml_path: string | null
        }
        Insert: {
          branch_id: string
          cancel_justificativa?: string | null
          cancel_xml_content?: string | null
          cancel_xml_path?: string | null
          chave?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mensagem_sefaz?: string | null
          model?: Database["public"]["Enums"]["fiscal_document_model"]
          numero?: string | null
          pdf_content?: string | null
          pdf_path?: string | null
          protocolo?: string | null
          qr_code_url?: string | null
          ref: string
          sale_id?: string | null
          sale_return_id?: string | null
          serie?: string | null
          status: Database["public"]["Enums"]["fiscal_document_status"]
          status_sefaz?: string | null
          updated_at?: string
          xml_content?: string | null
          xml_path?: string | null
        }
        Update: {
          branch_id?: string
          cancel_justificativa?: string | null
          cancel_xml_content?: string | null
          cancel_xml_path?: string | null
          chave?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mensagem_sefaz?: string | null
          model?: Database["public"]["Enums"]["fiscal_document_model"]
          numero?: string | null
          pdf_content?: string | null
          pdf_path?: string | null
          protocolo?: string | null
          qr_code_url?: string | null
          ref?: string
          sale_id?: string | null
          sale_return_id?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["fiscal_document_status"]
          status_sefaz?: string | null
          updated_at?: string
          xml_content?: string | null
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_sale_return_id_fkey"
            columns: ["sale_return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      module_fields: {
        Row: {
          data_type: string
          field_key: string
          hint: string | null
          id: string
          is_required: boolean
          label: string
          module_id: string
          reference_module_id: string | null
          show_in_details: boolean
          show_in_form: boolean
          show_in_table: boolean
          sort_order: number
          table_align: string | null
          table_width: string | null
        }
        Insert: {
          data_type?: string
          field_key: string
          hint?: string | null
          id?: string
          is_required?: boolean
          label: string
          module_id: string
          reference_module_id?: string | null
          show_in_details?: boolean
          show_in_form?: boolean
          show_in_table?: boolean
          sort_order?: number
          table_align?: string | null
          table_width?: string | null
        }
        Update: {
          data_type?: string
          field_key?: string
          hint?: string | null
          id?: string
          is_required?: boolean
          label?: string
          module_id?: string
          reference_module_id?: string | null
          show_in_details?: boolean
          show_in_form?: boolean
          show_in_table?: boolean
          sort_order?: number
          table_align?: string | null
          table_width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "module_fields_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_fields_reference_module_id_fkey"
            columns: ["reference_module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_records: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          data: Json
          id: string
          module_id: string
          status: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          module_id: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          module_id?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_records_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_records_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_situations: {
        Row: {
          canvas_x: number | null
          canvas_y: number | null
          code: string
          created_at: string
          id: string
          is_initial: boolean
          label: string
          module_id: string
          sort_order: number
        }
        Insert: {
          canvas_x?: number | null
          canvas_y?: number | null
          code: string
          created_at?: string
          id?: string
          is_initial?: boolean
          label: string
          module_id: string
          sort_order?: number
        }
        Update: {
          canvas_x?: number | null
          canvas_y?: number | null
          code?: string
          created_at?: string
          id?: string
          is_initial?: boolean
          label?: string
          module_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "module_situations_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_tabs: {
        Row: {
          id: string
          label: string
          module_id: string
          sort_order: number
          tab_key: string
        }
        Insert: {
          id?: string
          label: string
          module_id: string
          sort_order?: number
          tab_key: string
        }
        Update: {
          id?: string
          label?: string
          module_id?: string
          sort_order?: number
          tab_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_tabs_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      module_transition_actions: {
        Row: {
          created_at: string
          id: string
          sort_order: number
          source_field_key: string | null
          target_field_key: string
          target_kind: string
          transition_id: string
          value: string | null
          value_kind: string
          via_reference_field_key: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          sort_order?: number
          source_field_key?: string | null
          target_field_key: string
          target_kind?: string
          transition_id: string
          value?: string | null
          value_kind: string
          via_reference_field_key?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          sort_order?: number
          source_field_key?: string | null
          target_field_key?: string
          target_kind?: string
          transition_id?: string
          value?: string | null
          value_kind?: string
          via_reference_field_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "module_transition_actions_transition_id_fkey"
            columns: ["transition_id"]
            isOneToOne: false
            referencedRelation: "module_transitions"
            referencedColumns: ["id"]
          },
        ]
      }
      module_transitions: {
        Row: {
          created_at: string
          from_situation_id: string
          id: string
          label: string
          module_id: string
          sort_order: number
          to_situation_id: string
        }
        Insert: {
          created_at?: string
          from_situation_id: string
          id?: string
          label: string
          module_id: string
          sort_order?: number
          to_situation_id: string
        }
        Update: {
          created_at?: string
          from_situation_id?: string
          id?: string
          label?: string
          module_id?: string
          sort_order?: number
          to_situation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_transitions_from_situation_id_fkey"
            columns: ["from_situation_id"]
            isOneToOne: false
            referencedRelation: "module_situations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_transitions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_transitions_to_situation_id_fkey"
            columns: ["to_situation_id"]
            isOneToOne: false
            referencedRelation: "module_situations"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          access_gate: string
          branch_scoped: boolean
          created_at: string
          data_table: string | null
          icon_key: string | null
          id: string
          is_locked: boolean
          label: string
          layout_variant: string
          path: string | null
          show_on_home: boolean
          sort_order: number
          storage_kind: string
        }
        Insert: {
          access_gate?: string
          branch_scoped?: boolean
          created_at?: string
          data_table?: string | null
          icon_key?: string | null
          id: string
          is_locked?: boolean
          label: string
          layout_variant?: string
          path?: string | null
          show_on_home?: boolean
          sort_order?: number
          storage_kind?: string
        }
        Update: {
          access_gate?: string
          branch_scoped?: boolean
          created_at?: string
          data_table?: string | null
          icon_key?: string | null
          id?: string
          is_locked?: boolean
          label?: string
          layout_variant?: string
          path?: string | null
          show_on_home?: boolean
          sort_order?: number
          storage_kind?: string
        }
        Relationships: []
      }
      ncm_codes: {
        Row: {
          codigo: string
          created_at: string
          descricao: string
          id: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descricao: string
          id?: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descricao?: string
          id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          allow_negative_stock: boolean | null
          branch_id: string
          cest: string | null
          code: string
          cost_price: number | null
          created_at: string
          cst_ipi: string | null
          description: string
          id: string
          location: string | null
          minimum_stock: number | null
          ncm: string | null
          origem_mercadoria: string | null
          photo_url: string | null
          sale_price: number
          stock: number
          sub_location: string | null
          tax_group_id: string | null
          type: string | null
          unidade_comercial: string | null
          unidade_tributavel: string | null
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          active?: boolean
          allow_negative_stock?: boolean | null
          branch_id: string
          cest?: string | null
          code: string
          cost_price?: number | null
          created_at?: string
          cst_ipi?: string | null
          description: string
          id?: string
          location?: string | null
          minimum_stock?: number | null
          ncm?: string | null
          origem_mercadoria?: string | null
          photo_url?: string | null
          sale_price?: number
          stock?: number
          sub_location?: string | null
          tax_group_id?: string | null
          type?: string | null
          unidade_comercial?: string | null
          unidade_tributavel?: string | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          active?: boolean
          allow_negative_stock?: boolean | null
          branch_id?: string
          cest?: string | null
          code?: string
          cost_price?: number | null
          created_at?: string
          cst_ipi?: string | null
          description?: string
          id?: string
          location?: string | null
          minimum_stock?: number | null
          ncm?: string | null
          origem_mercadoria?: string | null
          photo_url?: string | null
          sale_price?: number
          stock?: number
          sub_location?: string | null
          tax_group_id?: string | null
          type?: string | null
          unidade_comercial?: string | null
          unidade_tributavel?: string | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          code: string
          created_at: string
          document: string
          email: string
          id: string
          is_facilite_developer: boolean
          name: string
          operator_code: string
          role_id: string | null
        }
        Insert: {
          active?: boolean
          code?: string
          created_at?: string
          document?: string
          email?: string
          id: string
          is_facilite_developer?: boolean
          name: string
          operator_code?: string
          role_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          document?: string
          email?: string
          id?: string
          is_facilite_developer?: boolean
          name?: string
          operator_code?: string
          role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          purchase_id: string
          quantity: number
          total_amount: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          purchase_id: string
          quantity: number
          total_amount: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          purchase_id?: string
          quantity?: number
          total_amount?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          branch_id: string
          code: string
          contact_id: string
          created_at: string
          created_by: string | null
          document: string | null
          entry_date: string
          id: string
          installment_total: number
          issue_date: string
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          status: Database["public"]["Enums"]["purchase_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          code?: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          document?: string | null
          entry_date?: string
          id?: string
          installment_total?: number
          issue_date?: string
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          status?: Database["public"]["Enums"]["purchase_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          code?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          document?: string | null
          entry_date?: string
          id?: string
          installment_total?: number
          issue_date?: string
          payment_method?: Database["public"]["Enums"]["sale_payment_method"]
          status?: Database["public"]["Enums"]["purchase_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      regimes_tributarios: {
        Row: {
          chave: string
          created_at: string
          id: string
          rotulo: string
        }
        Insert: {
          chave: string
          created_at?: string
          id?: string
          rotulo: string
        }
        Update: {
          chave?: string
          created_at?: string
          id?: string
          rotulo?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          id: string
          module_id: string
          role_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          id?: string
          module_id: string
          role_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          id?: string
          module_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          can_manage_branches: boolean
          can_manage_modules: boolean
          can_manage_permissions: boolean
          can_manage_users: boolean
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          can_manage_branches?: boolean
          can_manage_modules?: boolean
          can_manage_permissions?: boolean
          can_manage_users?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          can_manage_branches?: boolean
          can_manage_modules?: boolean
          can_manage_permissions?: boolean
          can_manage_users?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          cfop: string | null
          created_at: string
          discount_amount: number
          id: string
          product_id: string
          quantity: number
          sale_id: string
          total_amount: number
          unit_price: number
        }
        Insert: {
          cfop?: string | null
          created_at?: string
          discount_amount?: number
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          total_amount: number
          unit_price: number
        }
        Update: {
          cfop?: string | null
          created_at?: string
          discount_amount?: number
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_order_items: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          product_id: string
          quantity: number
          sale_order_id: string
          total_amount: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          product_id: string
          quantity: number
          sale_order_id: string
          total_amount: number
          unit_price: number
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          product_id?: string
          quantity?: number
          sale_order_id?: string
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_order_items_sale_order_id_fkey"
            columns: ["sale_order_id"]
            isOneToOne: false
            referencedRelation: "sale_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_orders: {
        Row: {
          address: string | null
          branch_id: string
          code: string
          contact_id: string
          converted_sale_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          delivery_address: string | null
          department: string | null
          discount_amount: number
          freight_amount: number
          id: string
          installments: number
          issue_date: string
          operation_type: string | null
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          seller_id: string
          status: Database["public"]["Enums"]["sale_order_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_id: string
          code: string
          contact_id: string
          converted_sale_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          department?: string | null
          discount_amount?: number
          freight_amount?: number
          id?: string
          installments?: number
          issue_date?: string
          operation_type?: string | null
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          seller_id: string
          status?: Database["public"]["Enums"]["sale_order_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_id?: string
          code?: string
          contact_id?: string
          converted_sale_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          delivery_address?: string | null
          department?: string | null
          discount_amount?: number
          freight_amount?: number
          id?: string
          installments?: number
          issue_date?: string
          operation_type?: string | null
          payment_method?: Database["public"]["Enums"]["sale_payment_method"]
          seller_id?: string
          status?: Database["public"]["Enums"]["sale_order_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_converted_sale_id_fkey"
            columns: ["converted_sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          installments: number
          method: Database["public"]["Enums"]["sale_payment_method"]
          sale_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          installments?: number
          method: Database["public"]["Enums"]["sale_payment_method"]
          sale_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          installments?: number
          method?: Database["public"]["Enums"]["sale_payment_method"]
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          product_id: string
          quantity: number
          sale_item_id: string
          sale_return_id: string
          total_amount: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          product_id: string
          quantity: number
          sale_item_id: string
          sale_return_id: string
          total_amount: number
          unit_price: number
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          product_id?: string
          quantity?: number
          sale_item_id?: string
          sale_return_id?: string
          total_amount?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_sale_return_id_fkey"
            columns: ["sale_return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          branch_id: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          issue_date: string
          reason: string
          sale_id: string
          status: Database["public"]["Enums"]["sale_return_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          issue_date?: string
          reason?: string
          sale_id: string
          status?: Database["public"]["Enums"]["sale_return_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          issue_date?: string
          reason?: string
          sale_id?: string
          status?: Database["public"]["Enums"]["sale_return_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          address: string | null
          branch_id: string
          cash_session_id: string | null
          cbs_total: number | null
          code: string
          cofins_total: number | null
          confirmed_at: string | null
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          department: string | null
          discount_amount: number
          exit_date: string | null
          freight_amount: number
          ibs_total: number | null
          icms_total: number | null
          id: string
          ipi_total: number | null
          issue_date: string
          operation_type: string | null
          pis_total: number | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_id: string
          cash_session_id?: string | null
          cbs_total?: number | null
          code: string
          cofins_total?: number | null
          confirmed_at?: string | null
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by: string
          delivery_address?: string | null
          department?: string | null
          discount_amount?: number
          exit_date?: string | null
          freight_amount?: number
          ibs_total?: number | null
          icms_total?: number | null
          id?: string
          ipi_total?: number | null
          issue_date?: string
          operation_type?: string | null
          pis_total?: number | null
          seller_id: string
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_id?: string
          cash_session_id?: string | null
          cbs_total?: number | null
          code?: string
          cofins_total?: number | null
          confirmed_at?: string | null
          contact_id?: string | null
          cost_center?: string | null
          created_at?: string
          created_by?: string
          delivery_address?: string | null
          department?: string | null
          discount_amount?: number
          exit_date?: string | null
          freight_amount?: number
          ibs_total?: number | null
          icms_total?: number | null
          id?: string
          ipi_total?: number | null
          issue_date?: string
          operation_type?: string | null
          pis_total?: number | null
          seller_id?: string
          status?: Database["public"]["Enums"]["sale_status"]
          subtotal_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          balance_after: number
          branch_id: string
          change: number
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          reason: string
        }
        Insert: {
          balance_after: number
          branch_id: string
          change: number
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          reason: string
        }
        Update: {
          balance_after?: number
          branch_id?: string
          change?: number
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_groups: {
        Row: {
          aliquota_cofins: number | null
          aliquota_icms: number | null
          aliquota_pis: number | null
          cclasstrib: string | null
          code: string
          created_at: string
          csosn: string | null
          cst_cofins: string | null
          cst_ibs_cbs: string | null
          cst_icms: string | null
          cst_pis: string | null
          id: string
          name: string
        }
        Insert: {
          aliquota_cofins?: number | null
          aliquota_icms?: number | null
          aliquota_pis?: number | null
          cclasstrib?: string | null
          code: string
          created_at?: string
          csosn?: string | null
          cst_cofins?: string | null
          cst_ibs_cbs?: string | null
          cst_icms?: string | null
          cst_pis?: string | null
          id?: string
          name: string
        }
        Update: {
          aliquota_cofins?: number | null
          aliquota_icms?: number | null
          aliquota_pis?: number | null
          cclasstrib?: string | null
          code?: string
          created_at?: string
          csosn?: string | null
          cst_cofins?: string | null
          cst_ibs_cbs?: string | null
          cst_icms?: string | null
          cst_pis?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      tax_rules: {
        Row: {
          cfop: string
          created_at: string
          id: string
          natureza_operacao: string
          regime: string
          tipo_cliente: string
          uf_destino: string
          uf_origem: string
        }
        Insert: {
          cfop: string
          created_at?: string
          id?: string
          natureza_operacao: string
          regime: string
          tipo_cliente: string
          uf_destino: string
          uf_origem: string
        }
        Update: {
          cfop?: string
          created_at?: string
          id?: string
          natureza_operacao?: string
          regime?: string
          tipo_cliente?: string
          uf_destino?: string
          uf_origem?: string
        }
        Relationships: []
      }
      tipos_cliente: {
        Row: {
          chave: string
          created_at: string
          id: string
          rotulo: string
        }
        Insert: {
          chave: string
          created_at?: string
          id?: string
          rotulo: string
        }
        Update: {
          chave?: string
          created_at?: string
          id?: string
          rotulo?: string
        }
        Relationships: []
      }
      ufs: {
        Row: {
          created_at: string
          id: string
          nome: string
          sigla: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          sigla: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          sigla?: string
        }
        Relationships: []
      }
      units_of_measure: {
        Row: {
          allows_fraction: boolean
          code: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          allows_fraction?: boolean
          code: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          allows_fraction?: boolean
          code?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: []
      }
      user_branches: {
        Row: {
          branch_id: string
          user_id: string
        }
        Insert: {
          branch_id: string
          user_id: string
        }
        Update: {
          branch_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      report_purchase_items_by_product_day: {
        Row: {
          branch_id: string | null
          cost_amount: number | null
          product_code: string | null
          product_description: string | null
          product_id: string | null
          purchase_date: string | null
          quantity: number | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      report_purchases_by_contact_day: {
        Row: {
          branch_id: string | null
          contact_id: string | null
          contact_name: string | null
          purchase_count: number | null
          purchase_date: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      report_sale_items_by_product_day: {
        Row: {
          branch_id: string | null
          product_code: string | null
          product_description: string | null
          product_id: string | null
          quantity: number | null
          sale_date: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      report_sales_by_contact_day: {
        Row: {
          branch_id: string | null
          contact_id: string | null
          contact_name: string | null
          sale_count: number | null
          sale_date: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      report_sales_by_day: {
        Row: {
          branch_id: string | null
          sale_count: number | null
          sale_date: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements_view: {
        Row: {
          branch_id: string | null
          id: string | null
          movement_type: string | null
          occurred_at: string | null
          origin_code: string | null
          product_code: string | null
          product_description: string | null
          product_id: string | null
          quantity_delta: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_stock_batch: {
        Args: { p_branch_id: string; p_items: Json }
        Returns: undefined
      }
      assert_module_workflow_editable: {
        Args: { p_module_id: string }
        Returns: undefined
      }
      can_manage_branches: { Args: never; Returns: boolean }
      can_manage_modules: { Args: never; Returns: boolean }
      can_manage_permissions: { Args: never; Returns: boolean }
      can_manage_users: { Args: never; Returns: boolean }
      can_manage_users_for: { Args: { p_user_id: string }; Returns: boolean }
      cancel_conditional: {
        Args: { p_conditional_id: string }
        Returns: {
          branch_id: string
          code: string
          contact_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          status: Database["public"]["Enums"]["conditional_status"]
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "conditionals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_cash_session: {
        Args: { p_counted_amount: number; p_session_id: string }
        Returns: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          code: string
          counted_amount: number | null
          difference: number | null
          expected_amount: number | null
          id: string
          opened_at: string
          opened_by: string | null
          opening_amount: number
          register_id: string
          status: Database["public"]["Enums"]["cash_session_status"]
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_conditional_to_sale: {
        Args: { payload: Json }
        Returns: {
          address: string | null
          branch_id: string
          cash_session_id: string | null
          cbs_total: number | null
          code: string
          cofins_total: number | null
          confirmed_at: string | null
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          department: string | null
          discount_amount: number
          exit_date: string | null
          freight_amount: number
          ibs_total: number | null
          icms_total: number | null
          id: string
          ipi_total: number | null
          issue_date: string
          operation_type: string | null
          pis_total: number | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      convert_sale_order_to_sale: {
        Args: { p_sale_order_id: string }
        Returns: {
          address: string | null
          branch_id: string
          cash_session_id: string | null
          cbs_total: number | null
          code: string
          cofins_total: number | null
          confirmed_at: string | null
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          department: string | null
          discount_amount: number
          exit_date: string | null
          freight_amount: number
          ibs_total: number | null
          icms_total: number | null
          id: string
          ipi_total: number | null
          issue_date: string
          operation_type: string | null
          pis_total: number | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_conditional: {
        Args: { payload: Json }
        Returns: {
          branch_id: string
          code: string
          contact_id: string
          created_at: string
          created_by: string | null
          due_date: string
          id: string
          issue_date: string
          status: Database["public"]["Enums"]["conditional_status"]
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "conditionals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_financial_entry_installments: {
        Args: {
          p_branch_id: string
          p_contact_id: string
          p_document: string
          p_first_due_date: string
          p_installment_count: number
          p_interval_days: number
          p_payment_method: string
          p_settled: boolean
          p_total: number
          p_type: Database["public"]["Enums"]["financial_entry_type"]
        }
        Returns: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "financial_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_pos_sale: {
        Args: { payload: Json }
        Returns: {
          address: string | null
          branch_id: string
          cash_session_id: string | null
          cbs_total: number | null
          code: string
          cofins_total: number | null
          confirmed_at: string | null
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          department: string | null
          discount_amount: number
          exit_date: string | null
          freight_amount: number
          ibs_total: number | null
          icms_total: number | null
          id: string
          ipi_total: number | null
          issue_date: string
          operation_type: string | null
          pis_total: number | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_purchase: {
        Args: { payload: Json }
        Returns: {
          branch_id: string
          code: string
          contact_id: string
          created_at: string
          created_by: string | null
          document: string | null
          entry_date: string
          id: string
          installment_total: number
          issue_date: string
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          status: Database["public"]["Enums"]["purchase_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "purchases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_sale: {
        Args: { payload: Json }
        Returns: {
          address: string | null
          branch_id: string
          cash_session_id: string | null
          cbs_total: number | null
          code: string
          cofins_total: number | null
          confirmed_at: string | null
          contact_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string
          delivery_address: string | null
          department: string | null
          discount_amount: number
          exit_date: string | null
          freight_amount: number
          ibs_total: number | null
          icms_total: number | null
          id: string
          ipi_total: number | null
          issue_date: string
          operation_type: string | null
          pis_total: number | null
          seller_id: string
          status: Database["public"]["Enums"]["sale_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_sale_order: {
        Args: { payload: Json }
        Returns: {
          address: string | null
          branch_id: string
          code: string
          contact_id: string
          converted_sale_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          delivery_address: string | null
          department: string | null
          discount_amount: number
          freight_amount: number
          id: string
          installments: number
          issue_date: string
          operation_type: string | null
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          seller_id: string
          status: Database["public"]["Enums"]["sale_order_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sale_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_sale_return: {
        Args: { payload: Json }
        Returns: {
          branch_id: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          issue_date: string
          reason: string
          sale_id: string
          status: Database["public"]["Enums"]["sale_return_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sale_returns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_user_module: {
        Args: {
          p_branch_scoped: boolean
          p_fields: Json
          p_label: string
          p_sort_order: number
        }
        Returns: string
      }
      delete_module_situation: { Args: { p_id: string }; Returns: undefined }
      delete_module_transition: { Args: { p_id: string }; Returns: undefined }
      delete_module_transition_action: {
        Args: { p_id: string }
        Returns: undefined
      }
      delete_user_module: { Args: { p_module_id: string }; Returns: undefined }
      financial_entries_cash_sales_in_window: {
        Args: {
          p_branch_id: string
          p_from: string
          p_session_id?: string
          p_to: string
        }
        Returns: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "financial_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      financial_entries_create_installments: {
        Args: {
          p_branch_id: string
          p_contact_id: string
          p_document: string
          p_first_due_date: string
          p_installment_count: number
          p_interval_days: number
          p_issue_date?: string
          p_origin_id: string
          p_origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          p_payment_method: string
          p_settled: boolean
          p_total: number
          p_type: Database["public"]["Enums"]["financial_entry_type"]
        }
        Returns: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "financial_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_branch_access: { Args: { p_branch_id: string }; Returns: boolean }
      has_facilite_developer_access: { Args: never; Returns: boolean }
      has_permission: {
        Args: { p_action: string; p_module_id: string }
        Returns: boolean
      }
      list_cash_session_cash_sales: {
        Args: { p_session_id: string }
        Returns: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "financial_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_orphan_cash_sales: {
        Args: { p_branch_id: string }
        Returns: {
          branch_id: string
          code: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          document: string | null
          due_date: string
          id: string
          installment_group_id: string
          installment_number: number
          installment_total: number
          issue_date: string
          origin_id: string | null
          origin_kind: Database["public"]["Enums"]["financial_entry_origin_kind"]
          payment_method: string | null
          settled_at: string | null
          status: Database["public"]["Enums"]["financial_entry_status"]
          total: number
          type: Database["public"]["Enums"]["financial_entry_type"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "financial_entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      module_field_key: { Args: { p_label: string }; Returns: string }
      open_cash_session: {
        Args: { p_opening_amount: number; p_register_id: string }
        Returns: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          code: string
          counted_amount: number | null
          difference: number | null
          expected_amount: number | null
          id: string
          opened_at: string
          opened_by: string | null
          opening_amount: number
          register_id: string
          status: Database["public"]["Enums"]["cash_session_status"]
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_cash_movement: {
        Args: {
          p_amount: number
          p_description: string
          p_session_id: string
          p_type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          session_id: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        SetofOptions: {
          from: "*"
          to: "cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      register_conditional_return: {
        Args: { payload: Json }
        Returns: undefined
      }
      save_module_situation: {
        Args: {
          p_id: string
          p_is_initial: boolean
          p_label: string
          p_module_id: string
          p_sort_order: number
        }
        Returns: string
      }
      save_module_situation_position: {
        Args: { p_canvas_x: number; p_canvas_y: number; p_id: string }
        Returns: undefined
      }
      save_module_transition: {
        Args: {
          p_from_situation_id: string
          p_id: string
          p_label: string
          p_module_id: string
          p_sort_order: number
          p_to_situation_id: string
        }
        Returns: string
      }
      save_module_transition_action: {
        Args: {
          p_id: string
          p_sort_order: number
          p_source_field_key: string
          p_target_field_key: string
          p_target_kind: string
          p_transition_id: string
          p_value: string
          p_value_kind: string
          p_via_reference_field_key: string
        }
        Returns: string
      }
      search_contacts_by_kind: {
        Args: {
          p_kind: Database["public"]["Enums"]["contact_kind"]
          p_term?: string
        }
        Returns: {
          active: boolean
          bairro: string | null
          birth_date: string | null
          cep: string | null
          code: string
          codigo_ibge_municipio: string | null
          created_at: string
          document: string
          email: string | null
          id: string
          indicador_ie: string | null
          inscricao_estadual: string | null
          is_favorite: boolean
          kind: Database["public"]["Enums"]["contact_kind"]
          logradouro: string | null
          municipio: string | null
          name: string
          numero: string | null
          phone: string | null
          photo_url: string | null
          rg: string | null
          uf: string | null
          updated_at: string
          whatsapp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_returnable_sales: {
        Args: { p_branch_id: string; p_term?: string }
        Returns: {
          client_name: string
          code: string
          id: string
          issue_date: string
          total_amount: number
        }[]
      }
      search_sale_sellers: {
        Args: { p_term?: string }
        Returns: {
          id: string
          name: string
          operator_code: string
        }[]
      }
      search_ncm_codes: {
        Args: { p_term?: string }
        Returns: {
          codigo: string
          created_at: string
          descricao: string
          id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ncm_codes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_tax_groups: {
        Args: { p_term?: string }
        Returns: {
          aliquota_cofins: number | null
          aliquota_icms: number | null
          aliquota_pis: number | null
          cclasstrib: string | null
          code: string
          created_at: string
          csosn: string | null
          cst_cofins: string | null
          cst_ibs_cbs: string | null
          cst_icms: string | null
          cst_pis: string | null
          id: string
          name: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tax_groups"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      slugify_text: { Args: { p_text: string }; Returns: string }
      stock_allows_negative: {
        Args: { p_branch_id: string; p_product_id: string }
        Returns: boolean
      }
      transition_module_record: {
        Args: { p_record_id: string; p_to_situation_id: string }
        Returns: string
      }
      update_sale_order: {
        Args: { p_id: string; payload: Json }
        Returns: {
          address: string | null
          branch_id: string
          code: string
          contact_id: string
          converted_sale_id: string | null
          cost_center: string | null
          created_at: string
          created_by: string | null
          delivery_address: string | null
          department: string | null
          discount_amount: number
          freight_amount: number
          id: string
          installments: number
          issue_date: string
          operation_type: string | null
          payment_method: Database["public"]["Enums"]["sale_payment_method"]
          seller_id: string
          status: Database["public"]["Enums"]["sale_order_status"]
          subtotal_amount: number
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sale_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      cash_movement_type: "sangria" | "suprimento"
      cash_session_status: "aberto" | "fechado"
      conditional_status: "confirmed" | "cancelled"
      contact_kind: "clientes" | "fornecedores"
      financial_entry_origin_kind: "manual" | "venda" | "compra" | "devolucao"
      financial_entry_status: "aberto" | "baixado" | "cancelado"
      financial_entry_type: "a_pagar" | "a_receber"
      fiscal_document_model: "nfe" | "nfce"
      fiscal_document_status:
        | "processando_autorizacao"
        | "autorizado"
        | "cancelado"
        | "erro_autorizacao"
        | "denegado"
      purchase_status: "confirmed" | "cancelled"
      sale_order_status: "aberto" | "convertido" | "cancelado"
      sale_payment_method:
        | "dinheiro"
        | "debito"
        | "credito"
        | "pix"
        | "boleto"
        | "outro"
      sale_return_status: "confirmed" | "cancelled"
      sale_status: "confirmed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cash_movement_type: ["sangria", "suprimento"],
      cash_session_status: ["aberto", "fechado"],
      conditional_status: ["confirmed", "cancelled"],
      contact_kind: ["clientes", "fornecedores"],
      financial_entry_origin_kind: ["manual", "venda", "compra", "devolucao"],
      financial_entry_status: ["aberto", "baixado", "cancelado"],
      financial_entry_type: ["a_pagar", "a_receber"],
      fiscal_document_model: ["nfe", "nfce"],
      fiscal_document_status: [
        "processando_autorizacao",
        "autorizado",
        "cancelado",
        "erro_autorizacao",
        "denegado",
      ],
      purchase_status: ["confirmed", "cancelled"],
      sale_order_status: ["aberto", "convertido", "cancelado"],
      sale_payment_method: [
        "dinheiro",
        "debito",
        "credito",
        "pix",
        "boleto",
        "outro",
      ],
      sale_return_status: ["confirmed", "cancelled"],
      sale_status: ["confirmed", "cancelled"],
    },
  },
} as const
