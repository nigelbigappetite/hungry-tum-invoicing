import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import { Invoice, WeeklyReport, Franchisee, PLATFORM_LABELS, Platform } from '@/lib/types';
import { formatRecommendedBacsDateFromInvoiceDate, getPlatformFeeRate } from '@/lib/utils';

// Use built-in Helvetica so PDF generation works in Node (no font URL fetch)
const styles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1e293b',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    width: 68,
    height: 68,
    backgroundColor: '#f97316',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandIconText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
  },
  brandName: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
  },
  brandSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  invoiceTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: '#f97316',
    textAlign: 'right',
  },
  invoiceNumber: {
    fontSize: 10,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 4,
  },
  headerRight: {
    alignItems: 'flex-end',
    maxWidth: '55%',
  },
  headerRightText: {
    textAlign: 'right',
  },
  infoSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  infoBlock: {
    maxWidth: '45%',
  },
  infoLabel: {
    fontSize: 8,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 10,
    color: '#1e293b',
    lineHeight: 1.5,
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    padding: 10,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 8,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  colPlatform: { width: '50%' },
  colAmount: { width: '25%', textAlign: 'right' },
  colFee: { width: '25%', textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#0f172a',
  },
  totalAmount: {
    fontSize: 11,
    fontWeight: 700,
    color: '#0f172a',
    textAlign: 'right',
  },
  feeRow: {
    flexDirection: 'row',
    padding: 14,
    backgroundColor: '#fff7ed',
    borderRadius: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  feeLabel: {
    width: '50%',
    fontSize: 12,
    fontWeight: 700,
    color: '#ea580c',
  },
  feeAmount: {
    width: '50%',
    fontSize: 14,
    fontWeight: 700,
    color: '#ea580c',
    textAlign: 'right',
  },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  footerTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: 8,
  },
  footerText: {
    fontSize: 9,
    color: '#64748b',
    lineHeight: 1.5,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    textAlign: 'center',
    fontSize: 8,
    color: '#94a3b8',
  },
});

function formatGBP(amount: number | null | undefined): string {
  const n = amount ?? 0;
  return `£${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatDateStr(dateStr: string | null | undefined): string {
  if (dateStr == null) return '—';
  const part = typeof dateStr === 'string' ? dateStr.split('T')[0] : String(dateStr).split('T')[0];
  const d = new Date(part + 'T00:00:00');
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface InvoicePaymentDetails {
  paymentDays?: number;
  bankName?: string;
  sortCode?: string;
  accountNumber?: string;
}

interface InvoicePDFProps {
  invoice: Invoice;
  franchisee: Franchisee;
  reports: WeeklyReport[];
  /** Slerp (Wing Shack Direct) reports for reference – payout date is Monday after invoice week. */
  slerpReports?: WeeklyReport[];
  /** Payout date for Slerp (yyyy-MM-dd) when slerpReports present. */
  slerpPayoutDate?: string;
  paymentDetails?: InvoicePaymentDetails;
  /** When set, payment will be taken by BACS on this date; bank details are omitted. */
  bacsCollectionDate?: string;
  /** For pay_them franchisees: amount we will pay (Deliveroo gross − our fees). Omit for collect_fees. */
  amountWePay?: number;
  /** Absolute path to logo image for PDF (e.g. from generate-invoice API). Omit to show "HT" text. */
  logoPath?: string;
  /** Business address lines (issuer / "From") to show on the invoice. */
  businessAddressLines?: string[];
}

const AGGREGATOR_PLATFORMS = ['deliveroo', 'ubereats', 'justeat'] as const;

export default function InvoicePDF({ invoice, franchisee, reports, slerpReports = [], slerpPayoutDate, paymentDetails, bacsCollectionDate, amountWePay, logoPath, businessAddressLines }: InvoicePDFProps) {
  const payThem = franchisee.payment_direction === 'pay_them' && amountWePay != null;
  const showLogo = Boolean(logoPath?.trim());
  const directDebitFriday = bacsCollectionDate?.trim() || (invoice.created_at ? formatRecommendedBacsDateFromInvoiceDate(invoice.created_at) : '');
  const aggregatorReports = (reports || []).filter((r) => r && AGGREGATOR_PLATFORMS.includes(r.platform as typeof AGGREGATOR_PLATFORMS[number]));
  const hasSlerp = slerpReports.length > 0 && slerpPayoutDate;
  const slerpGross = slerpReports.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0);
  const slerpPct = franchisee.slerp_percentage != null ? Number(franchisee.slerp_percentage) : 0;
  const slerpFee = Math.round(slerpGross * (slerpPct / 100) * 100) / 100;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}>
              {showLogo ? (
                <Image src={logoPath!} style={{ width: 68, height: 68, borderRadius: 8 }} />
              ) : (
                <Text style={styles.brandIconText}>HT</Text>
              )}
            </View>
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.brandSub}>
                Franchise Invoice{invoice.brand?.trim() ? ` – ${invoice.brand.trim()}` : ''}
              </Text>
              {businessAddressLines && businessAddressLines.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  {businessAddressLines.filter(Boolean).map((line, i) => (
                    <Text key={i} style={styles.infoText}>{line}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
          </View>
        </View>

        {/* Info section */}
        <View style={styles.infoSection}>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Bill To</Text>
            <Text style={styles.infoText}>{franchisee.name}</Text>
            {(() => {
              const businessLines = franchisee.business_address?.trim()
                ? franchisee.business_address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
                : [];
              const siteLines = franchisee.site_address?.trim()
                ? franchisee.site_address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
                : [];
              const addressLines = [...businessLines, ...siteLines];
              if (addressLines.length > 0) {
                return addressLines.map((line, i) => (
                  <Text key={i} style={styles.infoText}>{line}</Text>
                ));
              }
              return franchisee.location ? (
                <Text style={styles.infoText}>{franchisee.location}</Text>
              ) : null;
            })()}
            <Text style={styles.infoText}>{franchisee.email}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Invoice Date</Text>
            <Text style={styles.infoText}>
              {formatDateStr(invoice.created_at)}
            </Text>
            <Text style={{ ...styles.infoLabel, marginTop: 10 }}>
              Period
            </Text>
            <Text style={styles.infoText}>
              {formatDateStr(invoice.week_start_date)} &ndash;{' '}
              {formatDateStr(invoice.week_end_date)}
            </Text>
          </View>
        </View>

        {/* Block 1: Aggregator platforms – per row: Brand/Platform, Gross Revenue, Our fee (X%) */}
        <View style={styles.table}>
          <Text style={{ ...styles.infoLabel, marginBottom: 6 }}>
            Franchise fee – aggregator sales
          </Text>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderText, ...styles.colPlatform }}>
              Brand / Platform
            </Text>
            <Text style={{ ...styles.tableHeaderText, ...styles.colAmount }}>
              Gross Revenue
            </Text>
            <Text style={{ ...styles.tableHeaderText, ...styles.colFee }}>
              Fee
            </Text>
          </View>

          {aggregatorReports.map((report, idx) => {
            const platform = (report?.platform as Platform) ?? 'deliveroo';
            const gross = Number(report?.gross_revenue ?? 0);
            const pct = getPlatformFeeRate(franchisee, platform);
            const fee = Math.round(gross * (pct / 100) * 100) / 100;
            return (
              <View key={report?.id ?? `report-${idx}`} style={styles.tableRow}>
                <Text style={{ ...styles.infoText, ...styles.colPlatform }}>
                  {report?.brand?.trim()
                    ? `${report.brand} – ${PLATFORM_LABELS[platform]}`
                    : PLATFORM_LABELS[platform]}
                </Text>
                <Text style={{ ...styles.infoText, ...styles.colAmount, fontWeight: 600 }}>
                  {formatGBP(gross)}
                </Text>
                <Text style={{ ...styles.infoText, ...styles.colFee, fontWeight: 600, color: '#ea580c' }}>
                  {pct}% · {formatGBP(fee)}
                </Text>
              </View>
            );
          })}

          <View style={styles.totalRow}>
            <Text style={{ ...styles.totalLabel, ...styles.colPlatform }}>Total Gross Revenue</Text>
            <Text style={{ ...styles.totalAmount, ...styles.colAmount }}>
              {formatGBP(aggregatorReports.reduce((sum, r) => sum + Number(r?.gross_revenue ?? 0), 0))}
            </Text>
            <View style={styles.colFee} />
          </View>

          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>
              {payThem ? 'Amount due (invoice total)' : `Total franchise fee (${invoice.fee_percentage}%)`}
            </Text>
            <Text style={styles.feeAmount}>
              {formatGBP(invoice.fee_amount)}
            </Text>
          </View>
        </View>

        {/* Block 2: Wing Shack Direct (Slerp) – paid to them, reference only */}
        {hasSlerp && (
          <View style={{ marginTop: 24 }}>
            <Text style={{ ...styles.infoLabel, marginBottom: 6 }}>Wing Shack Direct (Slerp)</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={{ ...styles.tableHeaderText, ...styles.colPlatform }}>Description</Text>
                <Text style={{ ...styles.tableHeaderText, ...styles.colAmount }}>Amount</Text>
              </View>
              {slerpReports.map((r, idx) => (
                <View key={r?.id ?? `slerp-${idx}`} style={styles.tableRow}>
                  <Text style={{ ...styles.infoText, ...styles.colPlatform }}>
                    {r?.brand?.trim() ? `${r.brand} – Direct (GMV)` : 'Direct sales (GMV)'}
                  </Text>
                  <Text style={{ ...styles.infoText, ...styles.colAmount, fontWeight: 600 }}>{formatGBP(r?.gross_revenue ?? 0)}</Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total GMV</Text>
                <Text style={styles.totalAmount}>{formatGBP(slerpGross)}</Text>
              </View>
              <View style={{ ...styles.feeRow, backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }}>
                <Text style={{ ...styles.feeLabel, color: '#0369a1' }}>Fee ({slerpPct}%)</Text>
                <Text style={{ ...styles.feeAmount, color: '#0369a1' }}>{formatGBP(slerpFee)}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Payment / Direct debit */}
        <View style={styles.footer}>
          {payThem ? (
            <>
              <Text style={styles.footerTitle}>Payment</Text>
              <Text style={styles.footerText}>
                Remaining funds will be transferred to {franchisee.name}.
              </Text>
              <Text style={styles.footerText}>
                Reference: {invoice.invoice_number}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.footerTitle}>Direct Debit</Text>
              <Text style={styles.footerText}>
                The direct debit payment will take place on or around the following Friday: {directDebitFriday}.
              </Text>
              <Text style={styles.footerText}>
                Reference: {invoice.invoice_number}
              </Text>
            </>
          )}
        </View>

        {/* Page footer */}
        <Text style={styles.pageFooter}>
          Hungry Tum Ltd &bull; Franchise Invoicing System
        </Text>
      </Page>
    </Document>
  );
}
