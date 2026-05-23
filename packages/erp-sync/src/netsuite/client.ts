import type { PurchaseRequest, LineItem, Vendor } from "@flowprocure/db";

export type NsPurchaseOrderPayload = {
  externalId: string;
  entity: { id: string };
  subsidiary: { id: string };
  tranDate: string;
  memo?: string;
  items: Array<{
    item: { id: string };
    description: string;
    quantity: number;
    rate: number;
    amount: number;
    department?: { id: string };
  }>;
};

export type NsPurchaseOrderResponse = {
  id: string;
  tranId: string;
  status: string;
};

export class NetSuiteClient {
  private readonly accountId: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly tokenId: string;
  private readonly tokenSecret: string;

  constructor(config: {
    accountId: string;
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  }) {
    this.accountId = config.accountId;
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.tokenId = config.tokenId;
    this.tokenSecret = config.tokenSecret;
  }

  private get baseUrl(): string {
    return `https://${this.accountId}.suitetalk.api.netsuite.com/services/rest/record/v1`;
  }

  private buildAuthHeader(): string {
    // OAuth 1.0a signature — simplified; production would use a proper OAuth library
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).substring(2);
    return [
      `realm="${this.accountId}"`,
      `oauth_consumer_key="${this.consumerKey}"`,
      `oauth_token="${this.tokenId}"`,
      `oauth_signature_method="HMAC-SHA256"`,
      `oauth_timestamp="${timestamp}"`,
      `oauth_nonce="${nonce}"`,
      `oauth_version="1.0"`,
    ].join(", ");
  }

  async createPurchaseOrder(
    payload: NsPurchaseOrderPayload
  ): Promise<NsPurchaseOrderResponse> {
    const response = await fetch(`${this.baseUrl}/purchaseorder`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${this.buildAuthHeader()}`,
        "Content-Type": "application/json",
        Prefer: "respond-async",
      },
      body: JSON.stringify({
        externalId: payload.externalId,
        entity: payload.entity,
        subsidiary: payload.subsidiary,
        tranDate: payload.tranDate,
        memo: payload.memo,
        item: {
          items: payload.items.map((item, idx) => ({
            line: idx + 1,
            item: item.item,
            description: item.description,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          })),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const err = new Error(`NetSuite API error: ${body || response.statusText}`);
      (err as { status?: number }).status = response.status;
      throw err;
    }

    const locationHeader = response.headers.get("Location") ?? "";
    const id = locationHeader.split("/").pop() ?? "";

    return { id, tranId: payload.externalId, status: "open" };
  }

  async getPurchaseOrder(id: string): Promise<NsPurchaseOrderResponse | null> {
    const response = await fetch(`${this.baseUrl}/purchaseorder/${id}`, {
      headers: { Authorization: `OAuth ${this.buildAuthHeader()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { id: string; tranId: string; status: { id: string } };
    return { id: data.id, tranId: data.tranId, status: data.status.id };
  }
}

export function buildNsPayload(
  request: PurchaseRequest,
  lineItems: LineItem[],
  vendor: Vendor | null
): NsPurchaseOrderPayload {
  return {
    externalId: request.requestNumber,
    entity: { id: vendor?.preferredErpVendorId ?? "1" },
    subsidiary: { id: "1" },
    tranDate: new Date().toISOString().split("T")[0],
    memo: request.businessJustification ?? undefined,
    items: lineItems.map((item) => ({
      item: { id: item.glAccountCode ?? "1" },
      description: item.description,
      quantity: Number(item.quantity),
      rate: Number(item.unitPrice),
      amount: Number(item.quantity) * Number(item.unitPrice),
    })),
  };
}
