export type PaymentModel = 'percentage' | 'monthly_fixed' | 'percentage_per_platform';
export type Platform = 'deliveroo' | 'ubereats' | 'justeat' | 'slerp';
export type InvoiceStatus = 'draft' | 'sent' | 'processing' | 'paid' | 'failed';
export type FileType = 'csv' | 'pdf' | 'xlsx' | 'manual';

/** Hungry Tum brands – used for franchisee and report/invoice brand */
export const BRAND_OPTIONS = ['Wing Shack', 'SMSH BN', 'Eggs n Stuff'] as const;
export type Brand = (typeof BRAND_OPTIONS)[number];

/** DB-backed brand record from the brands table */
export interface BrandRecord {
  id: string;
  name: string;
  is_external: boolean;
  /** 'ht' = fees go to Hungry Tum; otherwise the brand name that receives the fee */
  fee_beneficiary: string;
  color: string;
  active: boolean;
  created_at: string;
}

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
  bank_account_name: string | null;
  bank_name: string | null;
  sort_code: string | null;
  account_number: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface PlatformFinancialBreakdown {
  /** Raw gross customer order value before any deductions. */
  earnings?: number;
  /** Platform marketplace commission. */
  platform_commission?: number;
  /** Advertising / promoter ad spend. */
  ad_spend?: number;
  /** Offers on items + redemption fee — covered by HT, shown for transparency. */
  offer_redemption?: number;
  /** Order error adjustments, chargebacks etc. */
  adjustments?: number;
}

export interface WeeklyReport {
  id: string;
  franchisee_id: string;
  brand: string | null;
  platform: Platform;
  week_start_date: string;
  week_end_date: string;
  gross_revenue: number;
  /** Actual payout transferred by the platform after their commission deductions. */
  platform_payout: number | null;
  /** Full statement breakdown — populated from file uploads, null for manual entry. */
  financial_breakdown: PlatformFinancialBreakdown | null;
  file_path: string | null;
  file_type: FileType;
  uploaded_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  franchisee_id: string;
  brand: string | null;
  /** All brands on this combined weekly invoice (for logo display). When set, brand may be null. */
  brands?: string[] | null;
  /** Source invoice ids when this invoice is a catch-up invoice. */
  source_invoice_ids?: string[] | null;
  /** Stored invoice lines for manual catch-up invoices. */
  line_items?: InvoiceLineItem[] | null;
  week_start_date: string;
  week_end_date: string;
  total_gross_revenue: number;
  fee_percentage: number;
  fee_amount: number;
  invoice_date: string;
  status: InvoiceStatus;
  pdf_path: string | null;
  payment_intent_id: string | null;
  payment_failure_reason: string | null;
  created_at: string;
  franchisee?: Franchisee;
  weekly_reports?: WeeklyReport[];
}

export interface InvoiceLineItem {
  label: string;
  period_start: string;
  period_end: string;
  gross_revenue: number;
  fee_amount: number;
  source_invoice_id?: string | null;
  source_invoice_number?: string | null;
}

export interface ParsedFileResult {
  platform: Platform;
  gross_revenue: number;
  /** Actual payout transferred by the platform after their commission — extracted from statement where available. */
  platform_payout?: number;
  /** Full financial breakdown from the platform statement. */
  financial_breakdown?: PlatformFinancialBreakdown;
  file_type: FileType;
  raw_text?: string;
  confidence: 'high' | 'medium' | 'low';
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  deliveroo: 'Deliveroo',
  ubereats: 'Uber Eats',
  justeat: 'Just Eat',
  slerp: 'Wing Shack Direct',
};

/** Platforms that use the standard report upload (CSV/PDF). Slerp uses a separate xlsx upload. */
export type AggregatorPlatform = 'deliveroo' | 'ubereats' | 'justeat';
export const AGGREGATOR_PLATFORMS: AggregatorPlatform[] = ['deliveroo', 'ubereats', 'justeat'];

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
};

export const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: 'bg-orange-100 text-primary-dark',
  sent: 'bg-purple-100 text-purple-800',
  processing: 'bg-orange-100 text-primary-dark',
  paid: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};
