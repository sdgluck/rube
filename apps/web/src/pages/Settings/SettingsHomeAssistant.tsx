import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import CardSection from "#components/CardSection";
import { FormSkeleton } from "#components/Skeleton";
import SettingsPageHeader from "./SettingsPageHeader";
import settings from "./Settings.module.css";

interface Form {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  topicPrefix: string;
  discoveryPrefix: string;
}

const EMPTY_FORM: Form = { enabled: false, url: "", username: "", password: "", topicPrefix: "", discoveryPrefix: "" };

/**
 * Home Assistant over MQTT.
 *
 * Says up front that it is one-way, because the first thing an HA user looks
 * for is a button to run something — and the answer, deliberately, is that
 * nothing on the broker can make Rube act.
 */
export default function SettingsHomeAssistant() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const saveMutation = trpc.config.save.useMutation();
  const testMutation = trpc.testMqtt.useMutation();

  const stored: Form = useMemo(() => {
    const m = configQuery.data?.global_mqtt;
    return m
      ? {
          enabled: m.enabled,
          url: m.url,
          username: m.username ?? "",
          password: m.password ?? "",
          topicPrefix: m.topicPrefix ?? "",
          discoveryPrefix: m.discoveryPrefix ?? "",
        }
      : EMPTY_FORM;
  }, [configQuery.data]);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  useEffect(() => setForm(stored), [stored]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const isDirty = JSON.stringify(form) !== JSON.stringify(stored);
  useUnsavedChanges(isDirty);

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        global_mqtt: {
          enabled: form.enabled,
          url: form.url.trim(),
          username: form.username || undefined,
          password: form.password || undefined,
          topicPrefix: form.topicPrefix.trim() || undefined,
          discoveryPrefix: form.discoveryPrefix.trim() || undefined,
        },
      });
      addToast(form.enabled ? "Saved — Home Assistant updates within 30 seconds" : "Saved", "success");
      await utils.config.get.invalidate();
    } catch (err) {
      addToast((err as Error).message || "Failed to save", "error");
    } finally {
      utils.health.status.invalidate();
    }
  };

  const handleTest = async () => {
    try {
      const { message } = await testMutation.mutateAsync({
        url: form.url,
        username: form.username || undefined,
        password: form.password || undefined,
      });
      addToast(message, "success");
    } catch (err) {
      addToast(`Connection test failed: ${(err as Error).message}`, "error");
    } finally {
      utils.health.status.invalidate();
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={4} />;

  return (
    <div className={settings.form}>
      <SettingsPageHeader title="Home Assistant" />

      <CardSection className={settings.group} titleClassName={settings.groupTitle} title="MQTT">
        <p className={settings.hint}>
          Rube publishes its state to your MQTT broker with discovery, so a Rube device appears in Home Assistant by
          itself: streams, transcodes, bandwidth, now playing, the current job, failing rules, problems, cleanup due
          soon, services down and library totals. It only publishes — nothing on the broker can make Rube do anything.
        </p>

        <label className={settings.checkRow}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <span>Publish to Home Assistant</span>
        </label>

        <label className={settings.field}>
          <span className={settings.label}>Broker address</span>
          <input
            className={settings.input}
            placeholder="mqtt://192.168.1.10:1883"
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
          />
          <span className={settings.hint}>
            mqtt://, mqtts://, ws:// or wss://. The Mosquitto add-on listens on 1883.
          </span>
        </label>

        <div className={settings.inlineFields}>
          <label className={settings.field}>
            <span className={settings.label}>Username</span>
            <input
              className={settings.input}
              autoComplete="off"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </label>
          <label className={settings.field}>
            <span className={settings.label}>Password</span>
            <input
              type="password"
              className={settings.input}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </label>
        </div>

        <div className={settings.inlineFields}>
          <label className={settings.field}>
            <span className={settings.label}>Topic prefix</span>
            <input
              className={settings.input}
              placeholder="rube"
              value={form.topicPrefix}
              onChange={(e) => set("topicPrefix", e.target.value)}
            />
            <span className={settings.hint}>Change it to run a second Rube against the same broker.</span>
          </label>
          <label className={settings.field}>
            <span className={settings.label}>Discovery prefix</span>
            <input
              className={settings.input}
              placeholder="homeassistant"
              value={form.discoveryPrefix}
              onChange={(e) => set("discoveryPrefix", e.target.value)}
            />
            <span className={settings.hint}>Only if you changed it in Home Assistant's MQTT settings.</span>
          </label>
        </div>

        <div className={settings.buttons}>
          <button className={settings.button} onClick={handleSave} disabled={!isDirty || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
          <button
            className={settings.buttonSecondary}
            onClick={handleTest}
            disabled={!form.url.trim() || testMutation.isPending}
          >
            {testMutation.isPending ? "Testing…" : "Test Connection"}
          </button>
        </div>
      </CardSection>
    </div>
  );
}
