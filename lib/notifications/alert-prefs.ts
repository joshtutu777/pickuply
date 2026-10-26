import { defaultAlertPrefs, type AlertPrefs } from "@/lib/notifications/live-alert";

const key = "pickuply-alert-prefs";

export function readAlertPrefs(): AlertPrefs {
  if (typeof localStorage === "undefined") return defaultAlertPrefs;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultAlertPrefs;
    const parsed = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      sound: parsed.sound !== false,
      newJobs: parsed.newJobs !== false,
      messages: parsed.messages !== false,
      delivery: parsed.delivery !== false,
    };
  } catch {
    return defaultAlertPrefs;
  }
}

export function writeAlertPrefs(prefs: AlertPrefs) {
  localStorage.setItem(key, JSON.stringify(prefs));
}
