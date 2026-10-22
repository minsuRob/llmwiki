/**
 * 페이지 하나 — 경로 · 아이콘 · 제목 · 본문 제안 띠 · 본문 편집기(마크다운이 정본) · 하위 페이지 · 자료 · 바꾼 기록.
 * 본문은 편집기가 1.5초 멈춤 · 초점을 잃을 때 넘기고, 바뀐 때만 저장한다(WorkContext.saveBody → core editBody).
 * 바깥에서 본문이 바뀌면(제안 받기 · 되돌리기) 편집기를 새로 만든다(key).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, useColorScheme, View } from "react-native";

import { ancestors, childrenOf, pageOf, type PageMeta } from "../../../../packages/core/src/pages.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, PAGE } from "../../components/ui";
import { useT } from "../../i18n";
import LexicalEditor from "../editor/LexicalEditor";
import { confirmAsk } from "./io";
import { PageHandoffPanel } from "./PageHandoffPanel";
import { pageLabel } from "./PageTree";
import { Fold, msgText, Muted, Pill, when } from "./parts";
import { DesktopRunLines } from "./DesktopRunLines";
import { describeQuery, type PageQuery } from "../../../../packages/core/src/pageQuery.ts";
import { ExpandedView, useChildren } from "./ExpandedView";
import { ImportPagesSheet } from "./ImportPagesSheet";
import { ProposalStrip } from "./ProposalCompare";
import { SourcePicker } from "./SourcePicker";
import { useWork, type SaveState } from "./WorkContext";

const ICONS = ["📄", "📌", "💼", "📚", "💡", "✅", "🗂️", "🔥", "🧭", "🎯", "🧪", "📝"];
const SAVE_TONE: Record<SaveState, "ok" | "danger" | "muted"> = { saving: "muted", saved: "ok", failed: "danger", conflict: "danger" };
const SHOW_CHILDREN = 30;

function TitleRow({ c, page }: { c: Palette; page: PageMeta }) {
  const t = useT();
  const { renamePage, setIcon } = useWork();
  const [title, setTitle] = useState(page.title);
  const [icons, setIcons] = useState(false);
  const commit = () => {
    if (title.trim() !== page.title) void renamePage(page.id, title);
  };
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable onPress={() => setIcons(!icons)} accessibilityRole="button" accessibilityLabel={t("page.icon")} style={{ width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: page.icon ? undefined : c.soft }}>
          {page.icon ? <Text style={{ fontSize: 26 }}>{page.icon}</Text> : <Ionicons name="happy-outline" size={18} color={c.muted} />}
        </Pressable>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={t("page.titlePlaceholder")}
          placeholderTextColor={c.muted}
          accessibilityLabel={t("page.rename")}
          style={{ flex: 1, fontSize: 26, fontWeight: "700", color: c.text, paddingVertical: 4 }}
        />
      </View>
      {icons ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {ICONS.map((i) => (
            <Pressable key={i} onPress={() => (setIcons(false), void setIcon(page.id, i))} accessibilityRole="button" accessibilityLabel={i} style={{ padding: 6, borderRadius: 8, backgroundColor: page.icon === i ? c.soft : undefined }}>
              <Text style={{ fontSize: 20 }}>{i}</Text>
            </Pressable>
          ))}
          {page.icon ? <Btn c={c} small label={t("page.noIcon")} onPress={() => (setIcons(false), void setIcon(page.id, null))} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Status({ c, page }: { c: Palette; page: PageMeta }) {
  const t = useT();
  const { saves, storage, drive, retry } = useWork();
  const doc = saves[page.id];
  const index = saves[`index:${page.workspaceId}`];
  const worst = [doc, index].filter(Boolean).sort((a, b) => ["failed", "conflict", "saving", "saved"].indexOf(a!.state) - ["failed", "conflict", "saving", "saved"].indexOf(b!.state))[0];
  const sync =
    storage === "device" ? { label: t("status.sync.device"), tone: "muted" as const, icon: "phone-portrait-outline" as const } : drive.status === "connected" ? { label: t(drive.local ? "status.sync.localDrive" : "status.sync.drive"), tone: "ok" as const, icon: "cloud-done-outline" as const } : { label: t("status.sync.driveOffline"), tone: "danger" as const, icon: "cloud-offline-outline" as const };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {worst ? <Pill c={c} icon="save-outline" label={t(`page.${worst.state === "failed" ? "saveFailed" : worst.state}`)} tone={SAVE_TONE[worst.state]} /> : null}
      <Pill c={c} icon={sync.icon} label={sync.label} tone={sync.tone} />
      <Muted c={c}>{when(page.updatedAt)}</Muted>
      {doc?.state === "failed" ? <Btn c={c} small label={t("page.retry")} onPress={() => void retry(page.id)} /> : null}
    </View>
  );
}

/** 작은 값(속성) — 가져온 표의 칸 · 사람이 붙인 값. 펼쳐 보기에서 이것으로 거르고 정렬한다. 고치기는 사람만 */
function PropsRow({ c, page }: { c: Palette; page: PageMeta }) {
  const t = useT();
  const { setProps } = useWork();
  const [editing, setEditing] = useState<[string, string][] | null>(null);
  const props = Object.entries(page.props ?? {});
  if (editing)
    return (
      <View style={{ gap: 6, backgroundColor: c.row, borderRadius: 10, padding: 8 }}>
        {editing.map(([k, v], i) => (
          <View key={i} style={{ flexDirection: "row", gap: 6 }}>
            <TextInput value={k} onChangeText={(x) => setEditing(editing.map((e, j) => (j === i ? [x, e[1]] : e)))} placeholder={t("props.key")} placeholderTextColor={c.muted} accessibilityLabel={t("props.key")} style={{ width: 120, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13 }} />
            <TextInput value={v} onChangeText={(x) => setEditing(editing.map((e, j) => (j === i ? [e[0], x] : e)))} placeholder={t("props.value")} placeholderTextColor={c.muted} accessibilityLabel={t("props.value")} style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 8, paddingVertical: 5, fontSize: 13 }} />
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Btn c={c} small label={t("props.add")} onPress={() => setEditing([...editing, ["", ""]])} />
          <Btn
            c={c}
            small
            primary
            label={t("common.save")}
            onPress={() => {
              void setProps(page.id, Object.fromEntries(editing.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])));
              setEditing(null);
            }}
          />
          <Btn c={c} small label={t("common.cancel")} onPress={() => setEditing(null)} />
        </View>
        <Muted c={c}>{t("props.hint")}</Muted>
      </View>
    );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {props.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: c.soft }}>
          <Text style={{ fontSize: 12, color: c.muted }}>{k}</Text>
          <Text style={{ fontSize: 12, color: c.text }}>{v}</Text>
        </View>
      ))}
      <Pressable onPress={() => setEditing(props.length ? props : [["", ""]])} accessibilityRole="button" accessibilityLabel={t("props.edit")} hitSlop={6}>
        <Text style={{ fontSize: 12, color: c.accent }}>{props.length ? t("props.edit") : t("props.addFirst")}</Text>
      </Pressable>
    </View>
  );
}

/** 하위 거른 조건을 맡기기 패널에 넘긴다 */
function Handoff({ c, page, query }: { c: Palette; page: PageMeta; query: PageQuery }) {
  const { all, shown } = useChildren(page, query);
  const filtered = shown.length !== all.length;
  return <PageHandoffPanel c={c} pageId={page.id} filter={filtered ? { childIds: shown.map((p) => p.id), query: describeQuery(query), total: all.length } : null} />;
}

export function PageScreen({ id, onSelect, onBack }: { id: string; onSelect: (id: string) => void; onBack?: () => void }) {
  const c = usePalette();
  const t = useT();
  const dark = useColorScheme() === "dark";
  const { ready, state, docs, openDoc, saveBody, createPage, undoDoc, unlink, trashPage } = useWork();
  const [failedId, setFailedId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [allKids, setAllKids] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState<PageQuery>({});
  const page = pageOf(state.pages, id);
  const doc = docs[id];
  useEffect(() => {
    if (!ready || !page || docs[id]) return;
    let alive = true;
    void openDoc(id).then((d) => alive && setFailedId(d ? null : id));
    return () => {
      alive = false;
    };
  }, [ready, id, page, docs, openDoc]);

  if (!ready) return <ActivityIndicator style={{ flex: 1, backgroundColor: c.bg }} color={c.muted} />;
  if (!page || page.trashedAt)
    return (
      <View style={{ ...PAGE, gap: 8 }}>
        {onBack ? <Btn c={c} small label={t("page.back")} onPress={onBack} /> : null}
        <Muted c={c}>{t("page.notFound")}</Muted>
      </View>
    );
  const path = ancestors(state.pages, id);
  const kids = childrenOf(state.pages, page.workspaceId, id);
  const sources = doc ? state.sources.filter((s) => doc.sourceIds.includes(s.id)) : [];
  const latest = doc?.changes.find((x) => !x.undone);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ ...PAGE, maxWidth: 860 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("page.back")} hitSlop={6} style={{ marginRight: 6 }}>
            <Ionicons name="chevron-back" size={18} color={c.muted} />
          </Pressable>
        ) : null}
        {path.map((a) => (
          <React.Fragment key={a.id}>
            <Pressable onPress={() => onSelect(a.id)} accessibilityRole="link">
              <Text numberOfLines={1} style={{ fontSize: 12, color: c.muted }}>
                {pageLabel(a, t("page.untitled"))}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 12, color: c.muted }}>/</Text>
          </React.Fragment>
        ))}
      </View>
      {/* 제목이 바깥에서 바뀌면(트리에서 이름 바꾸기) 입력칸을 새로 */}
      <TitleRow key={`${page.id}:${page.title}`} c={c} page={page} />
      <PropsRow c={c} page={page} />
      <Status c={c} page={page} />
      <DesktopRunLines c={c} itemId={id} />
      {doc ? <ProposalStrip c={c} page={page} current={doc.body} onChanged={() => setEpoch((e) => e + 1)} /> : null}

      {doc ? (
        <View style={{ minHeight: 320, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border }}>
          <LexicalEditor
            key={`${id}:${epoch}`}
            palette={c}
            dark={dark}
            placeholder={t("page.placeholder")}
            initialMarkdown={doc.body}
            onMarkdown={async (md) => void (await saveBody(id, md))}
            dom={{ style: { minHeight: 320, width: "100%" }, scrollEnabled: Platform.OS !== "web" }}
          />
        </View>
      ) : failedId === id ? (
        <Muted c={c} danger>{t("page.loadFailed")}</Muted>
      ) : (
        <Muted c={c}>{t("page.loading")}</Muted>
      )}

      <Fold c={c} title={t("page.children", { count: kids.length })} count={kids.length} initial={kids.length > 0 && kids.length <= SHOW_CHILDREN}>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {kids.length ? <Btn c={c} small primary={expanded} label={expanded ? t("expanded.close") : t("expanded.open")} onPress={() => setExpanded(!expanded)} /> : null}
          <Btn
            c={c}
            small
            label={t("page.newChild")}
            onPress={async () => {
              const p = await createPage({ workspaceId: page.workspaceId, parentId: id, title: "" });
              if (p) onSelect(p.id);
            }}
          />
          <Btn c={c} small label={t("importPages.menu")} onPress={() => setImporting(true)} />
        </View>
        {expanded ? (
          <ExpandedView c={c} page={page} query={query} setQuery={setQuery} onSelect={onSelect} />
        ) : (
          <>
            {(allKids ? kids : kids.slice(0, SHOW_CHILDREN)).map((k) => (
              <Pressable key={k.id} onPress={() => onSelect(k.id)} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
                <Ionicons name="document-text-outline" size={14} color={c.muted} />
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: k.title ? c.text : c.muted }}>
                  {pageLabel(k, t("page.untitled"))}
                </Text>
                {k.props?.dueText ? <Text style={{ fontSize: 11, color: c.muted }}>{k.props.dueText}</Text> : null}
              </Pressable>
            ))}
            {kids.length > SHOW_CHILDREN && !allKids ? <Btn c={c} small label={t("page.more", { count: kids.length - SHOW_CHILDREN })} onPress={() => setAllKids(true)} /> : null}
          </>
        )}
      </Fold>
      {importing ? <ImportPagesSheet c={c} workspaceId={page.workspaceId} parentId={id} onClose={() => setImporting(false)} /> : null}

      {doc ? (
        <Fold c={c} title={t("page.sources", { count: sources.length })} count={sources.length}>
          {sources.map((s) => (
            <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.row, borderRadius: 10, padding: 8 }}>
              <Pressable style={{ flex: 1 }} onPress={s.url ? () => void Linking.openURL(s.url as string) : undefined} disabled={!s.url}>
                <Text numberOfLines={2} style={{ fontSize: 13, color: s.url ? c.accent : c.text }}>
                  {s.title}
                </Text>
                {s.text ? (
                  <Text numberOfLines={2} style={{ fontSize: 12, color: c.muted }}>
                    {s.text}
                  </Text>
                ) : null}
              </Pressable>
              <Btn c={c} small label={t("source.unlink")} onPress={() => void unlink(id, s.id)} />
            </View>
          ))}
          {adding ? <SourcePicker c={c} page={page} doc={doc} onDone={() => setAdding(false)} /> : <Btn c={c} small label={t("source.add")} onPress={() => setAdding(true)} />}
        </Fold>
      ) : null}

      <Fold c={c} title={t("pageHandoff.title")}>
        <Handoff c={c} page={page} query={query} />
      </Fold>

      {doc ? (
        <Fold c={c} title={t("page.history")} count={doc.changes.length}>
          {doc.changes.length ? (
            doc.changes.map((ch) => (
              <View key={ch.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13, color: ch.undone ? c.muted : c.text, textDecorationLine: ch.undone ? "line-through" : "none" }}>
                  {msgText(t, ch.msg)} · {when(ch.at)}
                </Text>
                {latest?.id === ch.id ? (
                  <Btn
                    c={c}
                    small
                    label={t("common.undo")}
                    onPress={async () => {
                      await undoDoc(id, ch.id);
                      setEpoch((e) => e + 1);
                    }}
                  />
                ) : null}
              </View>
            ))
          ) : (
            <Muted c={c}>{t("page.noHistory")}</Muted>
          )}
        </Fold>
      ) : null}

      <View style={{ flexDirection: "row" }}>
        <Btn
          c={c}
          small
          label={kids.length ? t("page.trashWith") : t("page.trash")}
          onPress={async () => {
            if (!(await confirmAsk(t("page.trash"), t("page.trashAsk", { title: page.title || t("page.untitled") }), t("common.ok"), t("common.cancel")))) return;
            await trashPage(id, "with_children");
            if (page.parentId) onSelect(page.parentId);
            else onBack?.();
          }}
        />
      </View>
    </ScrollView>
  );
}
