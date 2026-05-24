import type { PurchaseRequest, LineItem, Vendor } from "@flowprocure/db";

export type QbPurchaseOrderPayload = {
  externalId: string;
  vendorRef: { value: string; name: string };
  lineItems: Array<{
    description: string;
    amount: number;
    accountCode?: string;
  }>;
  totalAmt: number;
  docNumber: string;
  txnDate: string;
  privateNote?: string;
};

export type QbPurchaseOrderResponse = {
  id: string;
  docNumber: string;
  totalAmt: number;
  status: string;
};

export class QuickBooksClient {
  private readonly baseUrl: string;
  private readonly realmId: string;
  private accessToken: string;

  constructor(config: {
    baseUrl?: string;
    realmId: string;
    accessToken: string;
  }) {
    this.baseUrl = config.baseUrl ?? "https://quickbooks.api.intuit.com/v3";
    this.realmId = config.realmId;
    this.accessToken = config.accessToken;
  }

  async createPurchaseOrder(
    payload: QbPurchaseOrderPayload
  ): Promise<QbPurchaseOrderResponse> {
    const response = await fetch(
      `${this.baseUrl}/company/${this.realmId}/purchaseorder`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          DocNumber: payload.docNumber,
          TxnDate: payload.txnDate,
          PrivateNote: payload.privateNote,
          VendorRef: payload.vendorRef,
          Line: payload.lineItems.map((item, idx) => ({
            Id: String(idx + 1),
            LineNum: idx + 1,
            Description: item.description,
            Amount: item.amount,
            DetailType: "ItemBasedExpenseLineDetail",
            ItemBasedExpenseLineDetail: {
              ItemRef: { value: "1", name: "Services" },
              Qty: 1,
              UnitPrice: item.amount,
              AccountRef: item.accountCode ? { value: item.accountCode } : undefined,
            },
          })),
          TotalAmt: payload.totalAmt,
        }),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(`QuickBooks API error: ${body || response.statusText}`);
      (err as { status?: number }).status = response.status;
      throw err;
    }

    const data = await response.json() as { PurchaseOrder: { Id: string; DocNumber: string; TotalAmt: number; POStatus: string } };
    return {
      id: data.PurchaseOrder.Id,
      docNumber: data.PurchaseOrder.DocNumber,
      totalAmt: data.PurchaseOrder.TotalAmt,
      status: data.PurchaseOrder.POStatus,
    };
  }

  async getPurchaseOrder(id: string): Promise<QbPurchaseOrderResponse | null> {
    const response = await fetch(
      `${this.baseUrl}/company/${this.realmId}/purchaseorder/${id}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (response.status === 404) return null;
    if (!response.ok) return null;

    const data = await response.json() as { PurchaseOrder: { Id: string; DocNumber: string; TotalAmt: number; POStatus: string } };
    return {
      id: data.PurchaseOrder.Id,
      docNumber: data.PurchaseOrder.DocNumber,
      totalAmt: data.PurchaseOrder.TotalAmt,
      status: data.PurchaseOrder.POStatus,
    };
  }
}

export function buildQbPayload(
  request: PurchaseRequest,
  lineItems: LineItem[],
  vendor: Vendor | null
): QbPurchaseOrderPayload {
  return {
    externalId: request.requestNumber,
    docNumber: request.requestNumber,
    txnDate: new Date().toISOString().split("T")[0],
    privateNote: request.businessJustification ?? undefined,
    vendorRef: {
      value: vendor?.preferredErpVendorId ?? "1",
      name: vendor?.name ?? "Unknown Vendor",
    },
    lineItems: lineItems.map((item) => ({
      description: item.description,
      amount: Number(item.unitPrice) * Number(item.quantity),
      accountCode: item.glAccountCode ?? undefined,
    })),
    totalAmt: Number(request.totalAmount),
  };
}
