/**
 * MCP 열쇠 — Claude Code · Codex 의 llmwiki MCP(tools/llmwiki-mcp)가 이 사용자 Drive 에 쓰게 하는 열쇠.
 * 서버에 Drive 를 이어 둔 Google 로그인 사용자에게만 보인다. 열쇠는 만들 때 한 번만 보이고, 서버엔 해시만 남는다.
 * 원칙: docs/architecture.md 원칙 4 의 표("MCP 열쇠").
 */
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { errorText, mcpKeyCreate, mcpKeyList, mcpKeyRevoke, type McpKeyInfo } from "../../firebase/api";
import { useT } from "../../i18n";
import { confirmAsk, copyText } from "../work/io";
import { Field, when } from "../work/parts";

const KEY_FILE = "~/.config/llmwiki/mcp-key";

export function McpKeysCard({ c }: { c: Palette }) {
  const t = useT();
  const [keys, setKeys] = useState<McpKeyInfo[] | null>(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

  // 만들기 · 거두기 뒤에 tick 을 올려 다시 읽는다
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    mcpKeyList({}).then(
      (r) => alive && setKeys(r.keys),
      (e) => alive && setNote({ text: errorText(e, t), bad: true }),
    );
    return () => {
      alive = false;
    };
  }, [t, tick]);

  const create = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await mcpKeyCreate({ label: label.trim() || t("mcp.defaultLabel") });
      setFresh({ key: r.key, label: r.label });
      setLabel("");
      load();
    } catch (e) {
      setNote({ text: errorText(e, t), bad: true });
    }
    setBusy(false);
  };
  const revoke = async (k: McpKeyInfo) => {
    if (!(await confirmAsk(t("mcp.revoke"), t("mcp.revokeAsk", { label: k.label }), t("common.ok"), t("common.cancel")))) return;
    try {
      await mcpKeyRevoke({ id: k.id });
      setNote({ text: t("mcp.revoked", { label: k.label }) });
      load();
    } catch (e) {
      setNote({ text: errorText(e, t), bad: true });
    }
  };
  const saveCmd = fresh ? `mkdir -p ~/.config/llmwiki && printf '%s' '${fresh.key}' > ${KEY_FILE} && chmod 600 ${KEY_FILE}` : "";

  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
      <Text style={{ fontSize: 14, fontWeight: "700", color: c.text }}>{t("mcp.title")}</Text>
      <Text style={{ fontSize: 13, color: c.muted, lineHeight: 19 }}>{t("mcp.explain")}</Text>

      {fresh ? (
        <View style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 13, color: c.danger, fontWeight: "600" }}>{t("mcp.onlyOnce", { label: fresh.label })}</Text>
          <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
            {saveCmd}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Btn c={c} small primary label={t("mcp.copySave")} onPress={async () => setNote({ text: (await copyText(saveCmd)) ? t("handoff.copied") : t("handoff.copyFailed") })} />
            <Btn c={c} small label={t("mcp.copyKey")} onPress={async () => setNote({ text: (await copyText(fresh.key)) ? t("handoff.copied") : t("handoff.copyFailed") })} />
            <Btn c={c} small label={t("mcp.done")} onPress={() => setFresh(null)} />
          </View>
          <Text style={{ fontSize: 12, color: c.muted }}>{t("mcp.then")}</Text>
          <Text selectable style={{ fontSize: 12, color: c.text, fontFamily: "monospace" }}>
            claude mcp add llmwiki -- node {"<저장소>"}/tools/llmwiki-mcp/server.mjs
          </Text>
        </View>
      ) : null}

      {keys?.map((k) => (
        <View key={k.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: c.text }}>{k.label}</Text>
            <Text style={{ fontSize: 12, color: c.muted }}>{t("mcp.meta", { created: when(k.createdAt), used: k.lastUsedAt ? when(k.lastUsedAt) : t("mcp.never") })}</Text>
          </View>
          <Btn c={c} small label={t("mcp.revoke")} onPress={() => void revoke(k)} />
        </View>
      ))}
      {keys && !keys.length && !fresh ? <Text style={{ fontSize: 12, color: c.muted }}>{t("mcp.none")}</Text> : null}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Field c={c} value={label} onChangeText={setLabel} placeholder={t("mcp.labelPlaceholder")} accessibilityLabel={t("mcp.label")} />
        </View>
        <Btn c={c} small label={t("mcp.create")} busy={busy} onPress={() => void create()} />
      </View>
      {note ? <Text style={{ fontSize: 13, color: note.bad ? c.danger : c.ok }}>{note.text}</Text> : null}
    </View>
  );
}
