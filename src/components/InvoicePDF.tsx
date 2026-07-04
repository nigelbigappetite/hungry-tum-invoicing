import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from '@react-pdf/renderer';
import { Invoice, WeeklyReport, Franchisee, PLATFORM_LABELS, InvoiceLineItem, Platform, PlatformFinancialBreakdown } from '@/lib/types';
import { getPlatformFeeRate } from '@/lib/utils';

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
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#0f172a',
  },
  totalAmount: {
    fontSize: 10,
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
  // Per-platform breakdown styles
  platformSectionHeader: {
    flexDirection: 'row',
    paddingBottom: 5,
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    marginBottom: 3,
  },
  platformSectionHeaderText: {
    fontSize: 8,
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  breakdownRow: {
    flexDirection: 'row',
    paddingVertical: 3,
  },
  breakdownLabel: {
    width: '65%',
    fontSize: 9,
    color: '#475569',
  },
  breakdownAmount: {
    width: '35%',
    fontSize: 9,
    color: '#1e293b',
    textAlign: 'right',
  },
  breakdownSubtotalRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  breakdownSubtotalLabel: {
    width: '65%',
    fontSize: 9,
    fontWeight: 700,
    color: '#1e293b',
  },
  breakdownSubtotalAmount: {
    width: '35%',
    fontSize: 9,
    fontWeight: 700,
    color: '#1e293b',
    textAlign: 'right',
  },
  platformDivider: {
    height: 1,
    backgroundColor: '#f1f5f9',
    marginVertical: 6,
  },
  // Grand totals
  grandTotalRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#cbd5e1',
  },
  grandTotalDeductRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  payoutRow: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    marginTop: 6,
  },
  payoutLabel: {
    width: '65%',
    fontSize: 12,
    fontWeight: 700,
    color: '#15803d',
  },
  payoutAmount: {
    width: '35%',
    fontSize: 14,
    fontWeight: 700,
    color: '#15803d',
    textAlign: 'right',
  },
  addressLabel: {
    fontSize: 7,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 2,
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
  /** Slerp (Wing Shack Direct) reports passed by older invoice generation route versions. */
  slerpReports?: WeeklyReport[];
  /** Kept for compatibility with the invoice generation route; Slerp now renders in the main table. */
  slerpPayoutDate?: string;
  paymentDetails?: InvoicePaymentDetails;
  /** For pay_them franchisees: amount we will pay (Deliveroo gross − our fees). Omit for collect_fees. */
  amountWePay?: number;
  /** Absolute path to logo image for PDF (e.g. from generate-invoice API). Omit to show "HT" text. */
  logoPath?: string;
  /** Business address lines (issuer / "From") to show on the invoice. */
  businessAddressLines?: string[];
}

const INVOICE_PLATFORMS = ['deliveroo', 'ubereats', 'justeat', 'slerp'] as const;
type InvoicePlatform = (typeof INVOICE_PLATFORMS)[number];

function getInvoiceBrandFallback(invoice: Invoice): string | null {
  const invoiceBrand = invoice.brand?.trim();
  if (invoiceBrand) return invoiceBrand;
  const brands = Array.isArray(invoice.brands) ? invoice.brands.map((b) => b.trim()).filter(Boolean) : [];
  return brands.length === 1 ? brands[0] : null;
}

function formatPercentageLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function isTzPeriPeriInvoice(franchisee: Franchisee): boolean {
  const text = [
    franchisee.name,
    franchisee.location,
    franchisee.email,
    franchisee.business_address,
    franchisee.site_address,
    ...(Array.isArray(franchisee.brands) ? franchisee.brands : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /\bt\s*z\b|\btz\b|tz group/.test(text) || text.includes('peri');
}

export default function InvoicePDF({ invoice, franchisee, reports, slerpReports = [], paymentDetails, logoPath, businessAddressLines }: InvoicePDFProps) {
  const payThem = franchisee.payment_direction === 'pay_them';
  const showLogo = Boolean(logoPath?.trim());
  const hidePlatformCommission = isTzPeriPeriInvoice(franchisee);
  const isFeeOnlyInvoice = hidePlatformCommission;
  const platformReports = [...(reports || []), ...(slerpReports || [])].filter((r) =>
    r && INVOICE_PLATFORMS.includes(r.platform as typeof INVOICE_PLATFORMS[number])
  );
  // Build per-platform blocks for detailed breakdown display
  const byPlatform = new Map<InvoicePlatform, WeeklyReport[]>();
  for (const r of platformReports) {
    const p = r.platform as InvoicePlatform;
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p)!.push(r);
  }
  const platformBlocks = INVOICE_PLATFORMS
    .filter((p) => byPlatform.has(p))
    .map((platform) => {
      const rs = byPlatform.get(platform)!;
      const grossRevenue = Math.round(rs.reduce((s, r) => s + Number(r.gross_revenue ?? 0), 0) * 100) / 100;
      const platformPayout = Math.round(rs.reduce((s, r) => s + Number(r.platform_payout ?? 0), 0) * 100) / 100;
      const pct = getPlatformFeeRate(franchisee, platform as Platform);
      const pctLabel = formatPercentageLabel(pct);
      const fee = Math.round(grossRevenue * (pct / 100) * 100) / 100;
      // Aggregate breakdown fields across all reports for this platform
      const earnings = Math.round(rs.reduce((s, r) => {
        const bd = r.financial_breakdown as PlatformFinancialBreakdown | null;
        return s + Number(bd?.earnings ?? r.gross_revenue ?? 0);
      }, 0) * 100) / 100;
      const commission = Math.round(rs.reduce((s, r) => s + Number((r.financial_breakdown as PlatformFinancialBreakdown | null)?.platform_commission ?? 0), 0) * 100) / 100;
      const adSpend = Math.round(rs.reduce((s, r) => s + Number((r.financial_breakdown as PlatformFinancialBreakdown | null)?.ad_spend ?? 0), 0) * 100) / 100;
      const offerRedemption = Math.round(rs.reduce((s, r) => s + Number((r.financial_breakdown as PlatformFinancialBreakdown | null)?.offer_redemption ?? 0), 0) * 100) / 100;
      const adjustments = Math.round(rs.reduce((s, r) => s + Number((r.financial_breakdown as PlatformFinancialBreakdown | null)?.adjustments ?? 0), 0) * 100) / 100;
      const hasBreakdown = commission > 0 || adSpend > 0 || offerRedemption > 0;
      return { platform, grossRevenue, fee, pct, pctLabel, platformPayout, hasBreakdown, earnings, commission, adSpend, offerRedemption, adjustments };
    })
    .filter((b) => b.grossRevenue > 0 || b.platformPayout > 0);

  const platformGrossTotal = Math.round(platformBlocks.reduce((s, b) => s + b.grossRevenue, 0) * 100) / 100;
  const platformFeeTotal = Math.round(platformBlocks.reduce((s, b) => s + b.fee, 0) * 100) / 100;
  const platformPayoutTotal = Math.round(platformBlocks.reduce((s, b) => s + b.platformPayout, 0) * 100) / 100;
  const hasPayoutData = platformPayoutTotal > 0;
  const kitchenPayout = hasPayoutData
    ? Math.round((platformPayoutTotal - platformFeeTotal) * 100) / 100
    : Math.round((platformGrossTotal - platformFeeTotal) * 100) / 100;
  const catchUpLineItems = Array.isArray(invoice.line_items) ? invoice.line_items.filter(Boolean) as InvoiceLineItem[] : [];
  const isCatchUpInvoice = catchUpLineItems.length > 0;
  const isMonthlyFixedInvoice = franchisee.payment_model === 'monthly_fixed';
  const isMaidstoneSite = ((franchisee.location || '').toLowerCase().includes('maidstone') || (franchisee.name || '').toLowerCase().includes('maidstone'));
  const periodLabel = `${formatDateStr(invoice.week_start_date)} - ${formatDateStr(invoice.week_end_date)}`;
  const displayedInvoiceFeeAmount =
    !isMonthlyFixedInvoice && !isCatchUpInvoice
      ? platformFeeTotal
      : Number(invoice.fee_amount ?? 0);
  let maidstoneWaivedAmount: number | null = null;
  let maidstoneBalanceAfter: number | null = null;
  let maidstoneAmountToPay: number | null = null;
  if (isMonthlyFixedInvoice && isMaidstoneSite) {
    const startYear = 2025;
    const startMonthIndex = 5; // June
    const initialDebt = 6500;
    const monthlyFee = Number(franchisee.monthly_fee ?? invoice.fee_amount ?? 0);
    const periodStartDate = new Date(`${invoice.week_start_date}T00:00:00`);
    if (!isNaN(periodStartDate.getTime()) && monthlyFee > 0) {
      const monthsElapsed = (periodStartDate.getFullYear() - startYear) * 12 + (periodStartDate.getMonth() - startMonthIndex);
      const periodsApplied = Math.max(0, monthsElapsed + 1);
      const waivedTotal = Math.min(initialDebt, periodsApplied * monthlyFee);
      const balanceAfter = Math.max(0, Math.round((initialDebt - waivedTotal) * 100) / 100);
      const balanceBefore = Math.max(0, Math.round((balanceAfter + monthlyFee) * 100) / 100);
      maidstoneWaivedAmount = Math.min(monthlyFee, balanceBefore);
      maidstoneBalanceAfter = balanceAfter;
      maidstoneAmountToPay = Math.max(0, Math.round((Number(invoice.fee_amount ?? 0) - maidstoneWaivedAmount) * 100) / 100);
    }
  }
  const noPaymentRequired = isMonthlyFixedInvoice && isMaidstoneSite && maidstoneAmountToPay != null && maidstoneAmountToPay <= 0;
  const showMaidstoneWaiverFooter = isMonthlyFixedInvoice && isMaidstoneSite && maidstoneWaivedAmount != null && maidstoneAmountToPay != null;
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
                Digital Franchise{invoice.brand?.trim() ? ` – ${invoice.brand.trim()}` : ''}
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
            <Text style={{ ...styles.infoText, fontWeight: 700 }}>{franchisee.name}</Text>

            {franchisee.business_address?.trim() ? (
              <>
                <Text style={styles.addressLabel}>Registered Address</Text>
                {franchisee.business_address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => (
                  <Text key={`ba-${i}`} style={styles.infoText}>{line}</Text>
                ))}
              </>
            ) : null}

            {franchisee.site_address?.trim() ? (
              <>
                <Text style={styles.addressLabel}>Site Address</Text>
                {franchisee.site_address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => (
                  <Text key={`sa-${i}`} style={styles.infoText}>{line}</Text>
                ))}
              </>
            ) : null}

            {!franchisee.business_address?.trim() && !franchisee.site_address?.trim() && franchisee.location ? (
              <Text style={styles.infoText}>{franchisee.location}</Text>
            ) : null}

            <Text style={{ ...styles.infoText, marginTop: 6 }}>{franchisee.email}</Text>
          </View>
          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Invoice Date</Text>
            <Text style={styles.infoText}>
              {formatDateStr(invoice.invoice_date)}
            </Text>
            <Text style={{ ...styles.infoLabel, marginTop: 10 }}>
              Period Covered
            </Text>
            <Text style={styles.infoText}>
              {formatDateStr(invoice.week_start_date)} &ndash;{' '}
              {formatDateStr(invoice.week_end_date)}
            </Text>
          </View>
        </View>

        {/* Block 1: Standard weekly aggregator fee table or monthly fixed-fee line item */}
        <View style={styles.table}>
          {isMonthlyFixedInvoice ? (
            <>
              <Text style={{ ...styles.infoLabel, marginBottom: 6 }}>
                Monthly franchise fee
              </Text>
              <View style={styles.tableHeader}>
                <Text style={{ ...styles.tableHeaderText, ...styles.colPlatform }}>
                  Description
                </Text>
                <Text style={{ ...styles.tableHeaderText, ...styles.colAmount }}>
                  Period
                </Text>
                <Text style={{ ...styles.tableHeaderText, ...styles.colFee }}>
                  Amount
                </Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={{ ...styles.infoText, ...styles.colPlatform }}>
                  {`${franchisee.name} monthly franchise fee`}
                </Text>
                <Text style={{ ...styles.infoText, ...styles.colAmount }}>
                  {periodLabel}
                </Text>
                <Text style={{ ...styles.infoText, ...styles.colFee, fontWeight: 600, color: '#ea580c' }}>
                  {formatGBP(invoice.fee_amount)}
                </Text>
              </View>
              {maidstoneWaivedAmount != null && maidstoneBalanceAfter != null && (
                <View style={{ marginTop: 6, padding: 8, backgroundColor: '#fff7ed', borderRadius: 4 }}>
                  <Text style={{ ...styles.footerText, color: '#9a3412' }}>
                    Fee waived toward arrears: {formatGBP(maidstoneWaivedAmount)}. Arrears balance after this month: {formatGBP(maidstoneBalanceAfter)}.
                  </Text>
                </View>
              )}
            </>
          ) : isCatchUpInvoice ? (
            <>
              <Text style={{ ...styles.infoLabel, marginBottom: 6 }}>
                Catch-up invoice
              </Text>
              <View style={styles.tableHeader}>
                <Text style={{ ...styles.tableHeaderText, ...styles.colPlatform }}>
                  Week
                </Text>
                <Text style={{ ...styles.tableHeaderText, ...styles.colAmount }}>
                  Gross Revenue
                </Text>
                <Text style={{ ...styles.tableHeaderText, ...styles.colFee }}>
                  Amount Due
                </Text>
              </View>

              {catchUpLineItems.map((item, idx) => (
                <View key={`${item.source_invoice_id ?? item.label}-${idx}`} style={styles.tableRow}>
                  <Text style={{ ...styles.infoText, ...styles.colPlatform }}>
                    {item.label}
                  </Text>
                  <Text style={{ ...styles.infoText, ...styles.colAmount, fontWeight: 600 }}>
                    {formatGBP(item.gross_revenue)}
                  </Text>
                  <Text style={{ ...styles.infoText, ...styles.colFee, fontWeight: 600, color: '#ea580c' }}>
                    {formatGBP(item.fee_amount)}
                  </Text>
                </View>
              ))}

              <View style={styles.totalRow}>
                <Text style={{ ...styles.totalLabel, ...styles.colPlatform }}>Total Gross Revenue</Text>
                <Text style={{ ...styles.totalAmount, ...styles.colAmount }}>
                  {formatGBP(catchUpLineItems.reduce((sum, item) => sum + Number(item.gross_revenue ?? 0), 0))}
                </Text>
                <View style={styles.colFee} />
              </View>
            </>
          ) : (
            <>
              <Text style={{ ...styles.infoLabel, marginBottom: 4 }}>
                Platform breakdown — {periodLabel}
              </Text>

              {/* Per-platform sections */}
              {platformBlocks.map((block, idx) => (
                <View key={block.platform}>
                  {/* Platform header */}
                  <View style={styles.platformSectionHeader}>
                    <Text style={styles.platformSectionHeaderText}>
                      {`${PLATFORM_LABELS[block.platform]} (${block.pctLabel}%)`}
                    </Text>
                  </View>

                  {/* Gross revenue */}
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Gross revenue</Text>
                    <Text style={styles.breakdownAmount}>
                      {formatGBP(block.grossRevenue)}
                    </Text>
                  </View>

                  {/* HT fee */}
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      {`Hungry Tum fee (${block.pctLabel}% of gross revenue)`}
                    </Text>
                    <Text style={styles.breakdownAmount}>-{formatGBP(block.fee)}</Text>
                  </View>

                  {/* Platform commission */}
                  {!hidePlatformCommission && (block.commission > 0 || block.adSpend > 0) && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Platform commission</Text>
                      <Text style={styles.breakdownAmount}>
                        -{formatGBP(Math.round((block.commission + block.adSpend) * 100) / 100)}
                      </Text>
                    </View>
                  )}

                  {/* Offer redemption */}
                  {block.offerRedemption > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>
                        Promotional offer costs (deducted by platform, covered by HT)
                      </Text>
                      <Text style={styles.breakdownAmount}>-{formatGBP(block.offerRedemption)}</Text>
                    </View>
                  )}

                  {/* Adjustments */}
                  {block.adjustments > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Order adjustments</Text>
                      <Text style={styles.breakdownAmount}>-{formatGBP(block.adjustments)}</Text>
                    </View>
                  )}

                  {/* Platform payout subtotal */}
                  {block.platformPayout > 0 && !(hidePlatformCommission && block.platform === 'deliveroo') && (
                    <View style={styles.breakdownSubtotalRow}>
                      <Text style={styles.breakdownSubtotalLabel}>Platform payout received</Text>
                      <Text style={styles.breakdownSubtotalAmount}>{formatGBP(block.platformPayout)}</Text>
                    </View>
                  )}

                  {/* Divider between platforms */}
                  {idx < platformBlocks.length - 1 && <View style={styles.platformDivider} />}
                </View>
              ))}

              {/* Grand totals */}
              {hasPayoutData && !isFeeOnlyInvoice && (
                <View style={styles.grandTotalRow}>
                  <Text style={{ ...styles.totalLabel, width: '65%' }}>Total platform payout received</Text>
                  <Text style={{ ...styles.totalAmount, width: '35%' }}>{formatGBP(platformPayoutTotal)}</Text>
                </View>
              )}

              {!isFeeOnlyInvoice && (
                <View style={styles.grandTotalDeductRow}>
                  <Text style={{ ...styles.breakdownLabel, width: '65%' }}>
                    {franchisee.payment_model === 'percentage_per_platform'
                      ? 'Total Hungry Tum fee'
                      : `Total Hungry Tum fee (${invoice.fee_percentage}%)`}
                  </Text>
                  <Text style={{ ...styles.breakdownAmount, width: '35%' }}>
                    -{formatGBP(platformFeeTotal)}
                  </Text>
                </View>
              )}

              <View style={styles.payoutRow}>
                <Text style={styles.payoutLabel}>
                  {isFeeOnlyInvoice ? 'Total Hungry Tum fee' : 'Your payout this week'}
                </Text>
                <Text style={styles.payoutAmount}>
                  {formatGBP(isFeeOnlyInvoice ? platformFeeTotal : kitchenPayout)}
                </Text>
              </View>
            </>
          )}

          {(isMonthlyFixedInvoice || isCatchUpInvoice) && (
            <>
              <View style={styles.feeRow}>
                <Text
                  style={
                    isMonthlyFixedInvoice
                      ? { ...styles.infoText, ...styles.colPlatform, fontWeight: 600, color: '#ea580c' }
                      : styles.feeLabel
                  }
                >
                  {isMonthlyFixedInvoice ? 'Total monthly franchise fee' : 'Total catch-up invoice'}
                </Text>
                <Text
                  style={
                    isMonthlyFixedInvoice
                      ? { ...styles.infoText, ...styles.colFee, fontWeight: 600, color: '#ea580c', textAlign: 'right' }
                      : styles.feeAmount
                  }
                >
                  {formatGBP(displayedInvoiceFeeAmount)}
                </Text>
              </View>
              {isMonthlyFixedInvoice && isMaidstoneSite && maidstoneAmountToPay != null && (
                <View style={{ ...styles.totalRow, marginTop: 8 }}>
                  <Text style={{ ...styles.totalLabel, ...styles.colPlatform }}>Amount to pay</Text>
                  <Text style={{ ...styles.totalAmount, ...styles.colAmount }}>
                    {formatGBP(maidstoneAmountToPay)}
                  </Text>
                  <View style={styles.colFee} />
                </View>
              )}
            </>
          )}
        </View>

        {/* Payment */}
        <View style={styles.footer}>
          {payThem ? (
            <>
              <Text style={styles.footerTitle}>Payment</Text>
              <Text style={styles.footerText}>
                Remaining funds will be transferred to {franchisee.name}.
              </Text>
              {(franchisee.bank_account_name || franchisee.bank_name || franchisee.sort_code || franchisee.account_number) && (
                <>
                  {franchisee.bank_account_name && (
                    <Text style={styles.footerText}>Account name: {franchisee.bank_account_name}</Text>
                  )}
                  {franchisee.bank_name && (
                    <Text style={styles.footerText}>Bank: {franchisee.bank_name}</Text>
                  )}
                  {franchisee.sort_code && (
                    <Text style={styles.footerText}>Sort code: {franchisee.sort_code}</Text>
                  )}
                  {franchisee.account_number && (
                    <Text style={styles.footerText}>Account number: {franchisee.account_number}</Text>
                  )}
                </>
              )}
              <Text style={styles.footerText}>
                Reference: {invoice.invoice_number}
              </Text>
            </>
          ) : showMaidstoneWaiverFooter ? (
            <>
              <Text style={styles.footerTitle}>Payment Summary</Text>
              <Text style={styles.footerText}>
                This month&apos;s franchise fee of {formatGBP(invoice.fee_amount)} has been waived for {franchisee.name}.
              </Text>
              <Text style={styles.footerText}>
                Waiver applied: {formatGBP(maidstoneWaivedAmount)}. Amount due: {formatGBP(maidstoneAmountToPay)}.
              </Text>
              {maidstoneBalanceAfter != null && (
                <Text style={styles.footerText}>
                  Remaining arrears balance after this invoice: {formatGBP(maidstoneBalanceAfter)}.
                </Text>
              )}
              <Text style={styles.footerText}>
                No payment collection will be made for this invoice.
              </Text>
              <Text style={styles.footerText}>
                Reference: {invoice.invoice_number}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.footerTitle}>
                {isCatchUpInvoice ? 'Payment options' : 'Payment'}
              </Text>
              {noPaymentRequired ? (
                <Text style={styles.footerText}>No payment is required.</Text>
              ) : isCatchUpInvoice && (paymentDetails?.bankName || paymentDetails?.sortCode || paymentDetails?.accountNumber) ? (
                <>
                  <Text style={styles.footerText}>
                    Please pay by bank transfer using the details below.
                  </Text>
                  {paymentDetails?.bankName && (
                    <Text style={styles.footerText}>Bank: {paymentDetails.bankName}</Text>
                  )}
                  {paymentDetails?.sortCode && (
                    <Text style={styles.footerText}>Sort code: {paymentDetails.sortCode}</Text>
                  )}
                  {paymentDetails?.accountNumber && (
                    <Text style={styles.footerText}>Account number: {paymentDetails.accountNumber}</Text>
                  )}
                  <Text style={styles.footerText}>
                    Reference: {invoice.invoice_number}
                  </Text>
                </>
              ) : (
                <Text style={styles.footerText}>
                  Payment is handled through the agreed payment method.
                </Text>
              )}
              {!isCatchUpInvoice && (
                <Text style={styles.footerText}>
                  Reference: {invoice.invoice_number}
                </Text>
              )}
            </>
          )}
        </View>

        {/* Page footer */}
        <Text style={styles.pageFooter}>
          Powered by Hungry Tum OS
        </Text>
      </Page>
    </Document>
  );
}
