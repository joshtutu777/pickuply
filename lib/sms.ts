import "server-only";

type SmsResult = { ok: boolean; sid: string | null; errorCode: string | null };

async function postSms(to: string, body: string, statusCallback?: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, sid: null, errorCode: null };
  const payload = new URLSearchParams({ To: to, From: from, Body: body });
  if (statusCallback) payload.set("StatusCallback", statusCallback);
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { code?: number } | null;
    return { ok: false, sid: null, errorCode: failure?.code ? String(failure.code) : null };
  }
  const saved = (await response.json()) as { sid?: string };
  return { ok: true, sid: saved.sid ?? null, errorCode: null };
}

/** Sends one text only when the caller has already checked the platform switch. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const result = await postSms(to, body);
  return result.ok;
}

/** Admin and campaign texts. Delivery updates come back to the status webhook. */
export async function sendAdminSms(to: string, body: string, statusCallback?: string): Promise<SmsResult> {
  return postSms(to, body, statusCallback);
}
