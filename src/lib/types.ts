export type PaymentModel = 'percentage' | 'monthly_fixed' | 'percentage_per_platform';
export type Platform = 'deliveroo' | 'ubereats' | 'justeat' | 'slerp';
export type InvoiceStatus = 'draft' | 'sent' | 'processing' | 'paid';
export type FileType = 'csv' | 'pdf' | 'xlsx' | 'manual';

/** Hungry Tum brands – used for franchisee and report/invoice brand */
export const BRAND_OPTIONS = ['Wing Shack', 'SMSH BN', 'Eggs n Stuff'] as const;
export type Brand = (typeof BRAND_OPTIONS)[number];

export interface Franchisee {
  id: string;
  name: string;
  location: string;
  email: string;
  /** Registered / business address (multiline). Optional; used on invoice Bill To. */
  business_address: string | null;
  /** Physical site / trading address (multiline). Optional; used on invoice Bill To. */
  site_address: string | null;
  brands: string[];
  payment_model: PaymentModel;
  percentage_rate: number | null;
  monthly_fee: number | null;
  deliveroo_percentage: number | null;
  ubereats_percentage: number | null;
  justeat_percentage: number | null;
  slerp_percentage: number | null;
  payment_direction: 'collect_fees' | 'pay_them';
  stripe_customer_id: string | null;
  bacs_payment_method_id: string | null;
  created_at: string;
}

export interface WeeklyReport {
  id: string;
  franchisee_id: string;
  brand: string | null;
  platform: Platform;
  week_start_date: string;
  week_end_date: string;
  gross_revenue: number;
  file_path: string | null;
  file_type: FileType;
  uploaded_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  franchisee_id: string;
  brand: string | null;
  week_start_date: string;
  week_end_date: string;
  total_gross_revenue: number;
  fee_percentage: number;
  fee_amount: number;
  status: InvoiceStatus;
  pdf_path: string | null;
  created_at: string;
  franchisee?: Franchisee;
  weekly_reports?: WeeklyReport[];
}

export interface ParsedFileResult {
  platform: Platform;
  gross_revenue: number;
  file_type: FileType;
  raw_text?: string;
  confidence: 'high' | 'medium' | 'low';
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  deliveroo: 'Deliveroo',
  ubereats: 'Uber Eats',
  justeat: 'Just Eat',
  slerp: 'Slerp (Direct)',
};

/** Platforms that use the standard report upload (CSV/PDF). Slerp uses a separate xlsx upload. */
export const AGGREGATOR_PLATFORMS: Platform[] = ['deliveroo', 'ubereats', 'justeat'];

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  processing: 'Processing',
  paid: 'Paid',
};

export const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-blue-100 text-blue-800',
  processing: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
};
