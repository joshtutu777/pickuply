const inAppPattern = /FBAN|FBAV|Instagram|Messenger|TikTok|Bytedance|Twitter|Line\//i;

export function inAppBrowser(userAgent: string): boolean {
  return inAppPattern.test(userAgent);
}

export type InstallPlan = "hidden" | "native" | "ios" | "ios-browser" | "in-app" | "guidance";

const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i;

export function isIosDevice(userAgent: string): boolean {
  return /iPhone|iPad|iPod/.test(userAgent);
}

export function isIosSafari(userAgent: string): boolean {
  return isIosDevice(userAgent) && !otherIosBrowser.test(userAgent) && !inAppBrowser(userAgent);
}

export function headerInstallPlan(input: { installed: boolean; userAgent: string; canPrompt: boolean }): InstallPlan {
  if (input.installed) return "hidden";
  if (inAppBrowser(input.userAgent)) return "in-app";
  if (isIosDevice(input.userAgent)) return otherIosBrowser.test(input.userAgent) ? "ios-browser" : "ios";
  if (input.canPrompt) return "native";
  return "guidance";
}

export function installButtonLabel(plan: InstallPlan): string {
  return plan === "ios" ? "Add Pickuply to Home Screen" : "Install Pickuply";
}

export function installCopy(input: { userAgent: string; installed: boolean; ios: boolean }): string | null {
  if (input.installed) return null;
  if (inAppBrowser(input.userAgent)) {
    return "To install Pickuply, open this page in Safari (iPhone) or Chrome (Android): tap ••• → Open in browser.";
  }
  if (input.ios) return "In Safari, tap Share, then Add to Home Screen.";
  return "Install Pickuply";
}

export function showInstallPrompt(input: {
  installed: boolean;
  dismissedAt: string | null;
  now: string;
  audience: "driver" | "customer";
  hasRequest: boolean;
}): boolean {
  if (input.installed) return false;
  if (input.audience === "customer" && !input.hasRequest) return false;
  if (!input.dismissedAt) return true;
  const dismissed = Date.parse(input.dismissedAt);
  const now = Date.parse(input.now);
  return now - dismissed >= 14 * 24 * 60 * 60 * 1000;
}

export function startDestination(input: { signedIn: boolean; role: "customer" | "driver" | "admin" | null }): string {
  if (!input.signedIn || !input.role) return "/";
  if (input.role === "driver") return "/driver";
  if (input.role === "admin") return "/admin";
  return "/account";
}
