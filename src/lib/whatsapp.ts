const WHATSAPP_API_VERSION = "v21.0";

interface SendResult {
  delivered: boolean;
  error?: string;
}

/**
 * Sends a message via the Meta WhatsApp Cloud API. Requires
 * WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN. Returns rather than
 * throws on failure so pass issuance never blocks on a WhatsApp outage —
 * callers are expected to surface `delivered: false` to the resident.
 */
export async function sendWhatsAppMessage(toPhone: string, body: string): Promise<SendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    return { delivered: false, error: "WhatsApp Cloud API is not configured" };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone.replace(/[^\d+]/g, ""),
        type: "text",
        text: { body },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { delivered: false, error: `WhatsApp API ${res.status}: ${errBody}` };
    }

    return { delivered: true };
  } catch (err) {
    return { delivered: false, error: err instanceof Error ? err.message : "Unknown WhatsApp error" };
  }
}
