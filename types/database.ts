export interface Party {
  id: string;
  party_name: string;
  code?: string;
  created_at?: string;
}

export interface Product {
  id: string;
  party_id: string;
  product_name: string;
  created_at?: string;
}

export interface ComponentItem {
  id: string;
  product_id: string;
  component_name: string;
  weight_per_unit_grams: number;
  created_at?: string;
}

export interface Requisition {
  id: string;
  party_id: string;
  product_id: string;
  requested_units: number;
  status: 'PENDING' | 'ISSUED' | 'RECEIVED' | 'REJECTED';
  created_at?: string;
}