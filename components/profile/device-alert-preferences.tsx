"use client";

import { useEffect, useState } from "react";
import { EnablePush } from "@/components/notifications/enable-push";
import { defaultAlertPrefs, type AlertPrefs } from "@/lib/notifications/live-alert";
import { readAlertPrefs, writeAlertPrefs } from "@/lib/notifications/alert-prefs";

export function DeviceAlertPreferences({
  publicKey,
  showJobAlerts,
}: {
  publicKey: string | null;
  showJobAlerts: boolean;
}) {
  const [prefs, setPrefs] = useState<AlertPrefs>(defaultAlertPrefs);
  const [permission, setPermission] = useState<string>("unknown");

  useEffect(() => {
    setPrefs(readAlertPrefs());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  function change(next: AlertPrefs) {
    setPrefs(next);
    writeAlertPrefs(next);
  }

  return (
    <section className="mt-6 rounded-3xl bg-paper-raised p-4 ring-1 ring-line">
      <h2 className="text-lg font-semibold text-ink">Notification settings</h2>
      <label className="mt-3 flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={prefs.sound}
          onChange={(event) => change({ ...prefs, sound: event.target.checked })}
        />
        Notification sounds
      </label>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={prefs.messages}
          onChange={(event) => change({ ...prefs, messages: event.target.checked })}
        />
        Messages
      </label>
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={prefs.delivery}
          onChange={(event) => change({ ...prefs, delivery: event.target.checked })}
        />
        Delivery updates
      </label>
      {showJobAlerts ? (
        <label className="flex min-h-12 items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={prefs.newJobs}
            onChange={(event) => change({ ...prefs, newJobs: event.target.checked })}
          />
          New job alerts
        </label>
      ) : null}
      <div className="mt-3">
        <p className="text-base font-semibold text-ink">Browser notifications</p>
        {permission === "denied" ? (
          <p className="mt-1 text-base text-muted">Notifications are off in this browser. Turn them on from the browser site settings. Pickuply will not ask again.</p>
        ) : permission === "granted" ? (
          <p className="mt-1 text-base text-muted">This browser allows notifications.</p>
        ) : (
          <p className="mt-1 text-base text-muted">Turn these on only if you want alerts when Pickuply is closed.</p>
        )}
        {permission === "denied" ? null : <EnablePush publicKey={publicKey} />}
      </div>
    </section>
  );
}
