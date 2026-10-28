/**
 * Online credit orders paid through PayU.
 *
 * Money-critical rules: credits for an order are booked exactly once. The conditional status change to PAID
 * (updateMany ... count === 1) and every addCredits call run in ONE transaction, so PAID never exists without
 * the credits and credits never exist without PAID; the guarded updateMany is the serialization point for
 * parallel notifications. Amount and currency from PayU must match the stored order before ANY status change.
 */
import type { CreditType, OrderStatus, PrismaClient } from "@prisma/client";
import { addCredits, isPrepaid } from "./credits.ts";
import { priceCart, type CartPackage } from "./pricing.ts";
import { parsePayuSignatureHeader, verifyPayuSignature, type createPayuClient } from "../payments/payu.ts";

export type PayuClientLike = Pick<ReturnType<typeof createPayuClient>, "createOrder" | "getOrder">;

/** Order totals are stored in an Int column (max ~2.1e9); stay well below it. */
const MAX_ORDER_GROSS_GROSZE = 1_000_000_000;

/** An order younger than this is left to the PayU notification instead of being polled. */
const SYNC_MIN_AGE_MS = 10_000;

export class CheckoutError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CheckoutError";
    this.status = status;
  }
}

export async function createCheckout(
  db: PrismaClient,
  args: {
    user: { id: string; email: string; name: string; organizationId: string | null };
    items: Array<{ packageId: string; quantity: number }>;
    customerIp: string;
    payu: PayuClientLike;
    appUrl: string;
    /** True when PayU runs against its sandbox; recorded on the order so test payments are recognizable. */
    sandbox: boolean;
    /** Gross total the buyer saw; when it differs from the freshly priced cart the checkout is refused. */
    expectedTotalGrossGrosze?: number;
  },
): Promise<{ orderId: string; redirectUri: string }> {
  const { user, items, customerIp, payu, appUrl, sandbox, expectedTotalGrossGrosze } = args;

  const organization = user.organizationId
    ? await db.organization.findUnique({
        where: { id: user.organizationId },
        select: {
          billingMode: true,
          isActive: true,
          nip: true,
          street: true,
          postalCode: true,
          city: true,
          billingEmail: true,
        },
      })
    : null;
  if (!user.organizationId || !organization || !organization.isActive || !isPrepaid(organization)) {
    throw new CheckoutError(409, "Twoja organizacja nie jest rozliczana kredytami.");
  }

  // Invoices (phase 3) need complete company data; refuse before any money moves.
  const companyData = [organization.nip, organization.street, organization.postalCode, organization.city, organization.billingEmail];
  if (companyData.some((value) => !value || value.trim() === "")) {
    throw new CheckoutError(
      409,
      "Uzupełnij dane firmy (NIP, adres, e-mail do faktur), aby kupić kredyty. Skontaktuj się z opiekunem Izzy Lease.",
    );
  }

  // Prices always come from the database; the client only names packages and quantities.
  const packageIds = Array.isArray(items)
    ? items.map((item) => item?.packageId).filter((id): id is string => typeof id === "string")
    : [];
  const packages: CartPackage[] = await db.creditPackage.findMany({
    where: { id: { in: packageIds } },
    select: {
      id: true,
      name: true,
      creditType: true,
      credits: true,
      priceNetGrosze: true,
      vatRate: true,
      isActive: true,
    },
  });

  const priced = priceCart(packages, items);
  if ("error" in priced) throw new CheckoutError(400, priced.error);
  if (priced.totalGrossGrosze > MAX_ORDER_GROSS_GROSZE) {
    throw new CheckoutError(400, "Kwota zamówienia jest zbyt wysoka.");
  }
  // Before the order row and before PayU: the buyer must pay exactly what they were shown.
  if (expectedTotalGrossGrosze !== undefined && expectedTotalGrossGrosze !== priced.totalGrossGrosze) {
    throw new CheckoutError(409, "Ceny zostały zaktualizowane. Sprawdź podsumowanie i spróbuj ponownie.");
  }

  // Nested create: the order and its lines are written atomically.
  const order = await db.order.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      status: "PENDING_PAYMENT",
      paymentMethod: "PAYU",
      totalNetGrosze: priced.totalNetGrosze,
      totalVatGrosze: priced.totalVatGrosze,
      totalGrossGrosze: priced.totalGrossGrosze,
      currency: "PLN",
      payuSandbox: sandbox,
      items: { create: priced.lines },
    },
    select: { id: true },
  });

  const trimmedName = user.name.trim();
  const spaceIndex = trimmedName.indexOf(" ");
  const firstName = spaceIndex === -1 ? trimmedName : trimmedName.slice(0, spaceIndex);
  const lastName = spaceIndex === -1 ? "" : trimmedName.slice(spaceIndex + 1).trim();

  let created: { payuOrderId: string; redirectUri: string };
  try {
    created = await payu.createOrder({
      extOrderId: order.id,
      description: `IzzyCheck: kredyty, zamówienie ${order.id.slice(0, 8)}`,
      totalAmount: priced.totalGrossGrosze,
      customerIp,
      buyer: {
        email: user.email,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      },
      products: priced.lines.map((line) => ({
        name: line.packageName,
        unitPrice: line.unitGrossGrosze,
        quantity: line.quantity,
      })),
      notifyUrl: `${appUrl}/api/payments/payu/notify`,
      continueUrl: `${appUrl}/credits/payment-return?orderId=${order.id}`,
    });
  } catch (error) {
    console.error("[PAYU_CREATE_ORDER_ERROR]", order.id, error);
    // Conditional: a notification that already moved the order on must not be overwritten.
    await db.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT" },
      data: { status: "FAILED" },
    });
    throw new CheckoutError(502, "Nie udało się rozpocząć płatności. Spróbuj ponownie.");
  }

  await db.order.update({
    where: { id: order.id },
    data: { payuOrderId: created.payuOrderId, payuRedirectUri: created.redirectUri },
  });
  return { orderId: order.id, redirectUri: created.redirectUri };
}

export type ApplyPayuStatusResult =
  | "PAID_NOW"
  | "ALREADY_PAID"
  | "CANCELED"
  | "FAILED"
  | "IGNORED"
  | "AMOUNT_MISMATCH"
  | "UNKNOWN_ORDER";

/** Statuses a COMPLETED payment may overwrite: the money arrived, so even a canceled/failed order is paid. */
const PAYABLE_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "CANCELED", "FAILED"];

export async function applyPayuStatus(
  db: PrismaClient,
  args: {
    orderId: string;
    payuOrderId?: string;
    status: string;
    totalAmount: number;
    currencyCode: string;
  },
): Promise<ApplyPayuStatusResult> {
  const { orderId, payuOrderId, status, totalAmount, currencyCode } = args;

  // Lines and totals never change after checkout, so reading them outside the transaction is safe;
  // the guarded updateMany below decides the status.
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      totalGrossGrosze: true,
      currency: true,
      payuSandbox: true,
      items: { select: { creditType: true, creditsPerPackage: true, quantity: true }, orderBy: { id: "asc" } },
    },
  });
  if (!order) {
    console.error("[PAYU_UNKNOWN_ORDER]", { extOrderId: orderId, payuOrderId, status, totalAmount, currencyCode });
    return "UNKNOWN_ORDER";
  }

  // Checked before any status change, for every status.
  if (totalAmount !== order.totalGrossGrosze || currencyCode !== order.currency) {
    console.error("[PAYU_AMOUNT_MISMATCH]", {
      orderId,
      payuOrderId,
      status,
      expectedAmount: order.totalGrossGrosze,
      expectedCurrency: order.currency,
      receivedAmount: totalAmount,
      receivedCurrency: currencyCode,
    });
    return "AMOUNT_MISMATCH";
  }

  if (status === "COMPLETED") {
    const creditsByType = new Map<CreditType, number>();
    for (const item of order.items) {
      creditsByType.set(item.creditType, (creditsByType.get(item.creditType) ?? 0) + item.creditsPerPackage * item.quantity);
    }
    if (creditsByType.size === 0) {
      throw new Error(`Zamówienie ${orderId} nie ma pozycji do zaksięgowania.`);
    }

    // Read at call time so tests (and a staging env) can flip it without a restart.
    const shouldInvoice = !order.payuSandbox || process.env.INVOICE_SANDBOX_ORDERS === "true";

    const outcome = await db.$transaction(async (tx) => {
      // Row lock first: the status read here is exactly the one the guarded update below acts on.
      const locked = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const previousStatus = locked[0]?.status;
      const now = new Date();
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: PAYABLE_STATUSES } },
        data: {
          status: "PAID",
          paidAt: now,
          invoiceStatus: shouldInvoice ? "PENDING" : "NOT_REQUIRED",
          invoiceNextAttemptAt: now,
          ...(payuOrderId ? { payuOrderId } : {}),
        },
      });
      if (count === 0) return { result: "ALREADY_PAID" as const, previousStatus };

      // Fixed credit type order: concurrent payments of one organization lock the balance rows in the same
      // order whatever the cart order was, so they cannot deadlock.
      for (const [creditType, amount] of [...creditsByType].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
        await addCredits(tx, {
          organizationId: order.organizationId,
          creditType,
          amount,
          idempotencyKey: `purchase:${orderId}:${creditType}`,
          userId: order.userId,
          orderId,
          note: "Zakup online (PayU)",
        });
      }
      return { result: "PAID_NOW" as const, previousStatus };
    });

    // After commit, so the log only exists for a payment that really was booked.
    if (outcome.result === "PAID_NOW" && (outcome.previousStatus === "CANCELED" || outcome.previousStatus === "FAILED")) {
      console.error("[PAYU_PAID_AFTER_CANCEL]", {
        orderId,
        previousStatus: outcome.previousStatus,
        payuOrderId,
        totalAmount,
      });
    }
    return outcome.result;
  }

  if (status === "CANCELED") {
    await db.order.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELED" },
    });
    return "CANCELED";
  }

  if (status === "REJECTED") {
    await db.order.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT" },
      data: { status: "FAILED" },
    });
    return "FAILED";
  }

  // PENDING, WAITING_FOR_CONFIRMATION, NEW and anything unknown: nothing to do yet.
  return "IGNORED";
}

export async function handlePayuNotification(
  db: PrismaClient,
  args: { rawBody: string; signatureHeader: string | null; config: { secondKey: string } },
): Promise<{ status: number; body: object }> {
  const { rawBody, signatureHeader, config } = args;

  if (!verifyPayuSignature(rawBody, signatureHeader, config.secondKey)) {
    // Metadata only: never the body or any key. Usually a wrong PAYU_SECOND_KEY or APP_URL/notify URL setup.
    console.error("[PAYU_INVALID_SIGNATURE]", {
      hasHeader: Boolean(signatureHeader),
      algorithm: parsePayuSignatureHeader(signatureHeader)?.algorithm ?? null,
      bodyLength: rawBody.length,
    });
    return { status: 400, body: { error: "Invalid signature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { status: 400, body: { error: "Invalid payload" } };
  }

  const order = (payload as { order?: unknown }).order;
  // Signed notifications that are not about an order payment (e.g. refunds) are acknowledged and ignored.
  if (order === undefined) {
    console.warn("[PAYU_NOTIFY_IGNORED]", { keys: Object.keys(payload) });
    return { status: 200, body: { status: "OK" } };
  }
  const o = order as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null || Array.isArray(o)) {
    return { status: 400, body: { error: "Invalid payload" } };
  }
  // Without our order id there is nothing to retry for: acknowledge, so PayU does not resend it forever.
  if (typeof o.extOrderId !== "string") {
    console.warn("[PAYU_NOTIFY_NO_EXT_ORDER_ID]", { payuOrderId: typeof o.orderId === "string" ? o.orderId : undefined });
    return { status: 200, body: { status: "OK" } };
  }
  if (typeof o.status !== "string" || typeof o.currencyCode !== "string") {
    return { status: 400, body: { error: "Invalid payload" } };
  }

  try {
    await applyPayuStatus(db, {
      orderId: o.extOrderId,
      payuOrderId: typeof o.orderId === "string" ? o.orderId : undefined,
      status: o.status,
      totalAmount: Number(o.totalAmount),
      currencyCode: o.currencyCode,
    });
    return { status: 200, body: { status: "OK" } };
  } catch (error) {
    // 5xx makes PayU retry the notification later.
    console.error("[PAYU_NOTIFY_ERROR]", error);
    return { status: 500, body: { error: "Internal error" } };
  }
}

/**
 * Pull-based fallback for a missed notification: asks PayU for the order state and applies it. Only for
 * PENDING_PAYMENT orders with a PayU id, older than 10 s. Errors are logged and swallowed (a status read
 * must not fail because PayU is slow).
 */
export async function syncOrderWithPayu(db: PrismaClient, orderId: string, payu: PayuClientLike): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true, payuOrderId: true, createdAt: true },
    });
    if (!order || order.status !== "PENDING_PAYMENT" || !order.payuOrderId) return;
    if (Date.now() - order.createdAt.getTime() < SYNC_MIN_AGE_MS) return;

    const info = await payu.getOrder(order.payuOrderId);
    if (info.extOrderId !== orderId) {
      console.error("[PAYU_SYNC_MISMATCH]", { orderId, payuOrderId: order.payuOrderId, receivedExtOrderId: info.extOrderId });
      return;
    }
    await applyPayuStatus(db, {
      orderId,
      payuOrderId: order.payuOrderId,
      status: info.status,
      totalAmount: info.totalAmount,
      currencyCode: info.currencyCode,
    });
  } catch (error) {
    console.error("[PAYU_SYNC_ERROR]", orderId, error);
  }
}
