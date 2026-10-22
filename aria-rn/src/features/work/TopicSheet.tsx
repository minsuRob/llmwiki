/**
 * 주제 만들기 · 고치기 — 이름 · 아이콘 · 비공개만. 영역은 새 주제에서 하나(일반)로 시작하고 여기서는 보이지 않는다.
 * 업무 · 자료가 남은 주제는 지우지 않는다(데이터를 잃지 않게).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

import {
  addWorkspace,
  canRemoveWorkspace,
  editWorkspace,
  removeWorkspace,
  WORKSPACE_ICONS,
  type Workspace,
} from "../../../../packages/core/src/work.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { Field, Muted } from "./parts";
import { useWork } from "./WorkContext";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** 저장된 아이콘 이름 → Ionicons 외곽선 아이콘 */
export function topicIcon(icon: string | undefined): IconName {
  return `${icon || "person"}-outline` as IconName;
}

/** editing: 고칠 주제, "new" 면 새로 만들기, null 이면 닫힘 */
export function TopicSheet({
  c,
  editing,
  onClose,
}: {
  c: Palette;
  editing: Workspace | "new" | null;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      visible={!!editing}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={onClose}
          accessibilityLabel={t("common.close")}
        />
        {editing ? (
          <TopicForm
            key={editing === "new" ? "new" : editing.id}
            c={c}
            editing={editing}
            onClose={onClose}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TopicForm({
  c,
  editing,
  onClose,
}: {
  c: Palette;
  editing: Workspace | "new";
  onClose: () => void;
}) {
  const t = useT();
  const { state, workspaceId, setWorkspaceId, saveManifest } = useWork();
  const [name, setName] = useState(editing === "new" ? "" : editing.name);
  const [icon, setIcon] = useState<string>(
    editing === "new" ? "book" : editing.icon,
  );
  const [priv, setPriv] = useState(editing === "new" ? false : editing.private);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    let created: string | null = null;
    const r = await saveManifest((m) => {
      if (editing !== "new")
        return editWorkspace(m, editing.id, { name, icon, private: priv });
      const a = addWorkspace(m, { name, icon, private: priv });
      created = a.workspace.id;
      return a.manifest;
    });
    setBusy(false);
    if (r !== "saved") return setNote(t("topic.saveFailed"));
    if (created) setWorkspaceId(created);
    onClose();
  };

  const remove = async () => {
    if (editing === "new") return;
    const ok = canRemoveWorkspace(state, editing.id);
    if (ok !== "ok") return setNote(t(`topic.cannotRemove.${ok}`));
    setBusy(true);
    const r = await saveManifest((m) => removeWorkspace(m, editing.id));
    setBusy(false);
    if (r !== "saved") return setNote(t("topic.saveFailed"));
    if (workspaceId === editing.id)
      setWorkspaceId(
        state.manifest.workspaces.find((w) => w.id !== editing.id)?.id ?? "",
      );
    onClose();
  };

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        padding: 16,
        gap: 10,
        maxWidth: 720,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ fontSize: 16, fontWeight: "700", color: c.text }}
      >
        {editing === "new" ? t("topic.new") : t("topic.edit")}
      </Text>
      <Field
        c={c}
        value={name}
        onChangeText={setName}
        placeholder={t("topic.namePlaceholder")}
        accessibilityLabel={t("topic.name")}
        autoFocus
        onSubmitEditing={() => void save()}
      />
      <Muted c={c}>{t("topic.icon")}</Muted>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
        accessibilityRole="radiogroup"
      >
        {WORKSPACE_ICONS.map((k) => {
          const on = k === icon;
          return (
            <Pressable
              key={k}
              onPress={() => setIcon(k)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={k}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? c.accent : c.soft,
              }}
            >
              <Ionicons
                name={topicIcon(k)}
                size={18}
                color={on ? c.accentText : c.text}
              />
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => setPriv(!priv)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: priv }}
        style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
      >
        <Text style={{ fontSize: 18, color: priv ? c.accent : c.muted }}>
          {priv ? "☑" : "☐"}
        </Text>
        <Text style={{ flex: 1, fontSize: 13, color: c.text }}>
          {t("topic.private")}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Btn
          c={c}
          primary
          label={t("common.save")}
          busy={busy}
          disabled={!name.trim()}
          onPress={() => void save()}
        />
        <Btn c={c} label={t("common.close")} onPress={onClose} />
        {editing !== "new" ? (
          <Btn
            c={c}
            label={t("topic.remove")}
            disabled={busy}
            onPress={() => void remove()}
          />
        ) : null}
      </View>
      {note ? (
        <Text style={{ fontSize: 13, color: c.danger }}>{note}</Text>
      ) : null}
    </View>
  );
}
