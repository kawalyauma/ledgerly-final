import type { Runtime } from "../../runtime.js";

export type DeliveryRequest = {
  channel: "sms" | "whatsapp" | "email" | "push";
  phone?: string | null;
  email?: string | null;
  subject?: string | null;
  message: string;
  senderName?: string | null;
  campaignId: string;
  deliveryId: string;
};

export type DeliveryResult = { provider: string; providerMessageId?: string | null };

async function responseText(response: Response): Promise<string> {
  try { return (await response.text()).trim(); } catch { return ""; }
}

export async function sendCommunication(runtime: Runtime, request: DeliveryRequest): Promise<DeliveryResult> {
  const cfg = runtime.config;
  if (request.channel === "sms") {
    if (!cfg.EGOSMS_USERNAME || !cfg.EGOSMS_PASSWORD || !cfg.EGOSMS_SENDER_ID) throw new Error("EgoSMS is not configured");
    if (!request.phone) throw new Error("SMS recipient phone is missing");
    const url = new URL(cfg.EGOSMS_URL);
    url.searchParams.set("username", cfg.EGOSMS_USERNAME);
    url.searchParams.set("password", cfg.EGOSMS_PASSWORD);
    url.searchParams.set("sender", cfg.EGOSMS_SENDER_ID);
    url.searchParams.set("number", request.phone);
    url.searchParams.set("message", request.message);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const text = await responseText(response);
    if (!response.ok) throw new Error(`EgoSMS ${response.status}: ${text || response.statusText}`);
    return { provider: "egosms", providerMessageId: text || null };
  }

  if (request.channel === "whatsapp") {
    if (!cfg.WHATSAPP_SUPPORT_HUB_URL || !cfg.WHATSAPP_SUPPORT_APP_KEY) throw new Error("WhatsApp Hub is not configured");
    if (!request.phone) throw new Error("WhatsApp recipient phone is missing");
    const response = await fetch(cfg.WHATSAPP_SUPPORT_HUB_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": cfg.WHATSAPP_SUPPORT_APP_KEY, authorization: `Bearer ${cfg.WHATSAPP_SUPPORT_APP_KEY}` },
      body: JSON.stringify({ to: request.phone, type: "text", text: { body: request.message }, campaignId: request.campaignId, deliveryId: request.deliveryId }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await responseText(response);
    if (!response.ok) throw new Error(`WhatsApp Hub ${response.status}: ${text || response.statusText}`);
    let providerMessageId: string | null = null;
    try { const parsed = JSON.parse(text); providerMessageId = parsed.id ?? parsed.messageId ?? parsed.data?.id ?? null; } catch { providerMessageId = text || null; }
    return { provider: "whatsapp-hub", providerMessageId };
  }

  if (request.channel === "email") {
    if (!cfg.RESEND_API_KEY || !cfg.RESEND_FROM_EMAIL) throw new Error("Resend email is not configured");
    if (!request.email) throw new Error("Email recipient address is missing");
    const from = request.senderName ? `${request.senderName} <${cfg.RESEND_FROM_EMAIL}>` : cfg.RESEND_FROM_EMAIL;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.RESEND_API_KEY}` },
      body: JSON.stringify({ from, to: [request.email], subject: request.subject || "Ledgerly notification", text: request.message }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await responseText(response);
    if (!response.ok) throw new Error(`Resend ${response.status}: ${text || response.statusText}`);
    let providerMessageId: string | null = null;
    try { providerMessageId = JSON.parse(text).id ?? null; } catch { providerMessageId = text || null; }
    return { provider: "resend", providerMessageId };
  }

  throw new Error("Push delivery provider is not configured");
}
