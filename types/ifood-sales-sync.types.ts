// Tipos para o sistema de sync de vendas do iFood

export interface SyncJobData {
  accountId: string;
  merchantId: string;
  storeId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  syncType: 'backfill' | 'daily';
  userId?: string; // Quem disparou o sync
}

export interface SyncJobProgress {
  currentPage: number;
  totalPages: number;
  totalSales: number;
  processedSales: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface IfoodSale {
  id: string;
  shortId: string;
  accountId: string;
  merchantId: string;
  createdAt: string;
  currentStatus: string;
  type: string;
  category: string;
  salesChannel: string;
  merchantShortId?: number;
  merchantName?: string;
  merchantType?: string;
  merchantCnpj?: string;
  merchantMcc?: string;
  merchantCpf?: string;
  merchantTimezone?: string;
  bagValue?: number;
  deliveryFee?: number;
  serviceFee?: number;
  benefitsTotal?: number;
  benefitsTarget?: string;
  benefitsValue?: number;
  sponsorshipIfood?: number;
  sponsorshipMerchant?: number;
  sponsorshipExternal?: number;
  sponsorshipChain?: number;
  deliveryInfoProvider?: string;
  deliveryType?: string;
  deliveryLogisticProvider?: string;
  deliveryProduct?: string;
  deliveryCode?: string;
  deliverySchedulingType?: string;
  deliveryGrossValue?: number;
  deliveryDiscount?: number;
  deliveryNetValue?: number;
  paymentMethod?: string;
  paymentType?: string;
  paymentValue?: number;
  paymentCardBrand?: string;
  paymentLiability?: string;
  paymentCurrency?: string;
  saleBalance?: number;
  billingPaymentTransactionFee?: number;
  billingOrderPayment?: number;
  billingServiceFee?: number;
  billingOrderCommission?: number;
  billingStoreSubsidy?: number;
  billingIfoodSubsidy?: number;
  statusCreatedAt?: string;
  statusPlacedAt?: string;
  statusConfirmedAt?: string;
  statusDispatchedAt?: string;
  statusConcludedAt?: string;
  statusCancelledAt?: string;
  totalEvents?: number;
  eventReceivedAt?: string;
  eventConfirmedAt?: string;
  eventDeliveryDropCodeRequestedAt?: string;
  eventDeliveryAcceptedAt?: string;
  eventDeliveryGoingToOriginAt?: string;
  eventDeliveryArrivedAtOriginAt?: string;
  eventDispatchedAt?: string;
  eventDeliveryArrivedAtDestinationAt?: string;
  eventDeliveryDropCodeValidationSuccessAt?: string;
  eventConcludedAt?: string;
  eventFinancialBilledOrderEntryAt?: string;
  fboeExpectedPaymentDate?: string;
  fboePeriodBeginDate?: string;
  fboePeriodEndDate?: string;
}

export interface SyncStatusRecord {
  id: string;
  accountId: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalSales: number;
  totalPages: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}
