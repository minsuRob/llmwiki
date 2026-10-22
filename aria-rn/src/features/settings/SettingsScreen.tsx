/**
 * 설정 — 언어 · 작업실 저장소(기기 · Google Drive) · 저장 충돌 · 기존 기록 이행 · 연결 상태 · 내 계정 · 휴지통 · 시냅스.
 */
import React, { useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";

import { SUPPORTED_TEXT_FORMATS } from "../../../../packages/core/src/drive.ts";
import { usePalette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { driveListWork, rebuildSynapse, taskAction } from "../../firebase/api";
import { useData } from "../../firebase/data";
import { GOOGLE_SUPPORTED, describeUser, signInWithGoogle } from "../../firebase/google";
import { useI18n, type Lang } from "../../i18n";
import { ConflictPanel } from "../work/ConflictPanel";
import { confirmAsk } from "../work/io";
import { JudgmentsCard } from "../work/JudgmentsCard";
import { when } from "../work/parts";
import { LegalLinks } from "../../components/LegalLinks";
import { useWork } from "../work/WorkContext";
import { McpKeysCard } from "./McpKeysCard";

export default function SettingsScreen() {
  const c = usePalette();
  const { t, lang, setLang } = useI18n();
  const { user, state, mode, run, resetUser, setError } = useData();
  const work = useWork();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [workNote, setWorkNote] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<string | null>, set: (s: string) => void = setNote) => {
    setBusy(key);
    const msg = await fn();
    if (msg) set(msg);
    setBusy(null);
  };

  const section = { backgroundColor: c.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: c.border } as const;
  const h = { fontSize: 16, fontWeight: "700", color: c.text } as const;
  const body = { fontSize: 13, color: c.muted, lineHeight: 19 } as const;
  const d = work.drive;
  const migrations = work.state.manifest.migrations.filter((m) => !m.reverted && m.kind === "legacy_scraps");
  const legacyScraps = state.scraps.filter((s) => !s.deletedAt).length;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ ...PAGE, gap: 16 }}>
      <View style={section}>
        <Text style={h}>{t("settings.lang.title")}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["ko", "en"] as Lang[]).map((l) => (
            <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="radio" accessibilityState={{ selected: lang === l }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: lang === l ? c.accent : c.soft }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: lang === l ? c.accentText : c.text }}>{t(`settings.lang.${l}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={section}>
        <Text style={h}>{t("settings.storage.title")}</Text>
        <Text style={{ fontSize: 14, color: c.text }}>{t(`settings.storage.mode.${work.storage === "drive" && d.local ? "localDrive" : work.storage}`)}</Text>
        <Text style={body}>{t(`settings.storage.explain.${work.storage}`)}</Text>
        <Text style={{ fontSize: 13, color: d.status === "connected" ? c.ok : d.status === "error" || d.status === "expired" ? c.danger : c.muted }}>{t(`drive.status.${d.status}`)}</Text>
        {d.error ? <Text style={{ fontSize: 12, color: c.danger }}>{t("drive.errorCode", { code: d.error })}</Text> : null}
        {d.status === "not_configured" ? <Text style={body}>{t("drive.notConfiguredHelp")}</Text> : null}
        {d.local ? <Text style={{ fontSize: 13, color: c.danger }}>{t("drive.local.banner")}</Text> : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {d.status === "disconnected" || d.status === "expired" || d.status === "error" ? (
            <Btn c={c} primary label={d.local ? t("drive.local.connect") : d.status === "disconnected" ? t("drive.connect") : t("drive.reconnect")} busy={false} onPress={() => void work.connectDrive()} />
          ) : null}
          {d.status === "connecting" ? <Btn c={c} primary label={t("drive.connecting")} busy onPress={() => undefined} /> : null}
          {d.folderUrl ? <Btn c={c} label={t("drive.openFolder")} onPress={() => void Linking.openURL(d.folderUrl as string)} /> : null}
          {d.status === "connected" ? (
            <Btn
              c={c}
              label={t("drive.refresh")}
              busy={busy === "refresh"}
              onPress={() =>
                void act(
                  "refresh",
                  async () => {
                    const r = await work.refreshSources();
                    return t("drive.refreshed", r);
                  },
                  setWorkNote,
                )
              }
            />
          ) : null}
          {work.storage === "drive" ? (
            <Btn
              c={c}
              label={t("drive.disconnect")}
              onPress={async () => {
                if (await confirmAsk(t("drive.disconnect"), t("drive.disconnectAsk"), t("common.ok"), t("common.cancel"))) await work.disconnectDrive();
              }}
            />
          ) : null}
        </View>
        {d.server?.linked ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: c.ok }}>{t("drive.server.linked", { email: d.server.email ?? "-" })}</Text>
            <Text style={body}>{t("drive.server.explain")}</Text>
            <View style={{ flexDirection: "row" }}>
              <Btn
                c={c}
                small
                label={t("drive.server.check")}
                busy={busy === "serverRead"}
                onPress={() =>
                  void act(
                    "serverRead",
                    async () => t("drive.server.checked", { count: (await driveListWork({})).items.length }),
                    setWorkNote,
                  )
                }
              />
            </View>
            <McpKeysCard c={c} />
          </View>
        ) : work.storage === "drive" && !d.local ? (
          <Text style={body}>{t("drive.server.notLinked")}</Text>
        ) : null}
        <Text style={body}>{t("drive.scopeNote")}</Text>
        <Text style={body}>{t("drive.formats", { list: SUPPORTED_TEXT_FORMATS.join(", ") })}</Text>
        {workNote ? <Text style={{ fontSize: 13, color: c.ok }}>{workNote}</Text> : null}
      </View>

      <ConflictPanel c={c} />
      <JudgmentsCard c={c} />

      <View style={section}>
        <Text style={h}>{t("settings.migrate.title")}</Text>
        <Text style={body}>{t("settings.migrate.body", { count: legacyScraps })}</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn
            c={c}
            label={t("settings.migrate.run")}
            busy={busy === "migrate"}
            disabled={!legacyScraps}
            onPress={() =>
              void act(
                "migrate",
                async () => {
                  const n = await work.migrateScraps();
                  return n ? t("settings.migrate.done", { count: n }) : t("settings.migrate.nothing");
                },
                setWorkNote,
              )
            }
          />
          {migrations.map((m) => (
            <Btn
              key={m.id}
              c={c}
              label={t("settings.migrate.revert", { count: m.sourceIds.length, at: when(m.at) })}
              onPress={async () => {
                if (!(await confirmAsk(t("settings.migrate.revertTitle"), t("settings.migrate.revertAsk"), t("common.ok"), t("common.cancel")))) return;
                await work.revertMigration(m.id);
                setWorkNote(t("settings.migrate.reverted"));
              }}
            />
          ))}
        </View>
      </View>

      <View style={section}>
        <Text style={h}>{t("settings.connection.title")}</Text>
        <Text style={body}>{mode === "emulator" ? t("settings.connection.emulator") : t("settings.connection.cloud")}</Text>
        <Text style={body}>{t("settings.connection.claude")}</Text>
      </View>

      <View style={section}>
        <Text style={h}>{t("settings.account.title")}</Text>
        <Text style={{ fontSize: 14, color: c.text }}>{describeUser(user, t)}</Text>
        <Text style={{ fontSize: 12, color: c.muted }} selectable>
          {user?.uid ?? "-"}
        </Text>
        {user?.isAnonymous ? <Text style={body}>{t("settings.account.linkHint")}</Text> : null}
        <Text style={body}>{t("settings.account.driveSeparate")}</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {user?.isAnonymous && GOOGLE_SUPPORTED ? (
            <Btn
              c={c}
              primary
              label={t("settings.account.googleButton")}
              busy={busy === "google"}
              onPress={() =>
                void act("google", async () => {
                  const r = await run(() => signInWithGoogle(user));
                  if (!r || r.kind === "cancelled") return null;
                  setError(null); // 앞서 막혔던 시도의 알림이 남지 않게
                  return r.kind === "linked" ? t("settings.account.linked", { email: r.email ?? "Google" }) : t("settings.account.switched", { email: r.email ?? "Google" });
                })
              }
            />
          ) : null}
          {user && !user.isAnonymous ? (
            <Btn c={c} label={t("settings.account.signOut")} busy={busy === "reset"} onPress={() => void act("reset", async () => (await resetUser(), null))} />
          ) : (
            <Btn c={c} label={t("settings.account.leaveAnon")} busy={busy === "reset"} onPress={() => void act("reset", async () => (await resetUser(), null))} />
          )}
        </View>
        {user?.isAnonymous ? <Text style={{ fontSize: 12, color: c.danger }}>{t("settings.account.anonWarning")}</Text> : null}
        {user?.isAnonymous && !GOOGLE_SUPPORTED ? <Text style={{ fontSize: 12, color: c.muted }}>{t("settings.account.webOnly")}</Text> : null}
        {note ? <Text style={{ fontSize: 13, color: c.ok }}>{note}</Text> : null}
        <LegalLinks c={c} />
      </View>

      <View style={section}>
        <Text style={h}>{t("settings.data.title")}</Text>
        <Text style={{ fontSize: 13, color: c.muted }}>
          {t("settings.data.counts", {
            tasks: state.tasks.filter((x) => !x.deletedAt).length,
            events: state.events.filter((x) => !x.deletedAt).length,
            scraps: state.scraps.filter((x) => !x.deletedAt).length,
            nodes: state.nodes.length,
            edges: state.edges.length,
          })}
        </Text>
        <Text style={{ fontSize: 13, color: c.muted }}>{t("settings.data.workCounts", { items: work.state.pages.filter((p) => !p.trashedAt).length, sources: work.state.sources.length })}</Text>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Btn
            c={c}
            label={t("settings.data.rebuild")}
            busy={busy === "syn"}
            onPress={() =>
              void act("syn", async () => {
                const r = await run(() => rebuildSynapse({}));
                return r ? t("settings.data.rebuilt", { nodes: r.nodes, edges: r.edges, via: t("settings.data.rules") }) : null;
              })
            }
          />
          <Btn c={c} label={t("settings.data.purge")} busy={busy === "purge"} onPress={() => void act("purge", async () => ((await run(() => taskAction({ op: "purge" }))) ? t("settings.data.purged") : null))} />
        </View>
      </View>
    </ScrollView>
  );
}
