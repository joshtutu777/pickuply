// Merges hosted test-phone codes. Existing entries are copied through unchanged.

const rosterPattern = /^55555503(0[1-9]|1[0-3])$/;

export function parseOtpMap(value) {
  const text = String(value ?? "").trim();
  if (!text) return { entries: new Map(), separator: ",", marker: "=" };
  const separator = text.includes(",") ? "," : "\n";
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);
  const marker = parts.some((part) => part.includes("=")) ? "=" : ":";
  const entries = new Map();
  for (const part of parts) {
    const index = part.indexOf(marker);
    if (index <= 0) throw new Error("An existing test OTP entry is not valid.");
    const phone = part.slice(0, index).trim();
    const code = part.slice(index + marker.length).trim();
    if (!/^\d{10,15}$/.test(phone) || code.length === 0 || code.includes(marker)) {
      throw new Error("An existing test OTP entry is not valid.");
    }
    entries.set(phone, code);
  }
  return { entries, separator: text.includes(",") ? "," : separator, marker };
}

export function rosterCodes(env, phones, existing) {
  const additions = new Map();
  for (const phone of phones) {
    if (!rosterPattern.test(phone)) throw new Error("A roster phone is not valid.");
    const saved = String(env[`PICKUPLY_TEST_OTP_${phone.slice(-4)}`] ?? "").trim();
    const already = existing.has(phone) || existing.has(`1${phone}`);
    if (!saved) {
      if (already) continue;
      throw new Error("A roster code is missing.");
    }
    if (!/^\d{6}$/.test(saved)) throw new Error("A roster code is not valid.");
    additions.set(phone, saved);
  }
  return additions;
}

export function mergeOtpMap(existingText, additions) {
  const parsed = parseOtpMap(existingText);
  const next = new Map(parsed.entries);
  const lengths = new Set([...next.keys()].map((phone) => phone.length));
  if (lengths.size > 1) throw new Error("Existing test OTP numbers use more than one length.");
  const width = lengths.size === 0 ? 11 : [...lengths][0];
  if (width !== 10 && width !== 11) throw new Error("Existing test OTP numbers use an unsupported length.");

  for (const [phone, code] of additions) {
    const key = width === 10 ? phone : `1${phone}`;
    if (next.has(key) || (width === 11 && next.has(phone)) || (width === 10 && next.has(`1${phone}`))) {
      continue;
    }
    next.set(key, code);
  }

  const serialized = [...next.entries()]
    .map(([phone, code]) => `${phone}${parsed.marker}${code}`)
    .join(parsed.separator);
  const check = parseOtpMap(serialized);
  for (const [phone, code] of parsed.entries) {
    if (check.entries.get(phone) !== code) throw new Error("The merge would change an existing test OTP.");
  }
  if (check.entries.size < parsed.entries.size) throw new Error("The merge would drop an existing test OTP.");
  return serialized;
}
