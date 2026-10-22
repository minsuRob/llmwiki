/**
 * 페이지 트리 — 지금 주제의 페이지를 접고 펴며 고른다. 줄마다 메뉴: 하위 페이지 · 이름 · 위/아래 · 옮기기 · 휴지통.
 * 열린 본문 제안이 있으면 점을 찍는다. 규칙(순환 · 범주 · 휴지통)은 core(pages.ts) — 여기서는 부르기만 한다.
 * 자식 500개(공고)도 가볍게 — 줄은 FlatList 로 그리고, 처음에는 맨 위만 펼친다.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";

import { childrenOf, flattenTree, openBodyProposals, searchPageTitles, subtreeIds, trashedPages, type PageMeta } from "../../../../packages/core/src/pages.ts";
import type { Palette } from "../../components/theme";
import { Btn } from "../../components/ui";
import { useT } from "../../i18n";
import { confirmAsk } from "./io";
import { Muted } from "./parts";
import { useWork } from "./WorkContext";

const ROW = 30;

/** 페이지 제목(아이콘 포함) — 비었으면 '제목 없음' */
export function pageLabel(p: PageMeta, untitled: string): string {
  return `${p.icon ? `${p.icon} ` : ""}${p.title || untitled}`;
}

function Menu({ c, page, onClose, onSelect }: { c: Palette; page: PageMeta; onClose: () => void; onSelect: (id: string) => void }) {
  const t = useT();
  const { createPage, renamePage, reorderPage, trashPage, state } = useWork();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [moving, setMoving] = useState(false);
  const kids = childrenOf(state.pages, page.workspaceId, page.id).length;
  const item = (icon: React.ComponentProps<typeof Ionicons>["name"], label: string, onPress: () => void, danger?: boolean) => (
    <Pressable key={label} accessibilityRole="menuitem" onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
      <Ionicons name={icon} size={16} color={danger ? c.danger : c.text} />
      <Text style={{ fontSize: 14, color: danger ? c.danger : c.text }}>{label}</Text>
    </Pressable>
  );
  const trash = async (mode: "with_children" | "lift_children") => {
    onClose();
    if (!(await confirmAsk(t("page.trash"), t("page.trashAsk", { title: page.title || t("page.untitled") }), t("common.ok"), t("common.cancel")))) return;
    await trashPage(page.id, mode);
  };
  if (moving) return <MoveDialog c={c} page={page} onClose={onClose} />;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", padding: 16 }} onPress={onClose} accessibilityLabel={t("common.close")}>
        <Pressable onPress={() => undefined} accessibilityRole="menu" style={{ minWidth: 260, maxWidth: 360, backgroundColor: c.surface, borderRadius: 14, paddingVertical: 6, borderWidth: 1, borderColor: c.border }}>
          <Text numberOfLines={1} style={{ paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, fontWeight: "700", color: c.muted }}>
            {pageLabel(page, t("page.untitled"))}
          </Text>
          {renaming ? (
            <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                autoFocus
                accessibilityLabel={t("page.rename")}
                onSubmitEditing={() => void renamePage(page.id, title).then(onClose)}
                style={{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14 }}
              />
              <Btn c={c} small primary label={t("common.save")} onPress={() => void renamePage(page.id, title).then(onClose)} />
            </View>
          ) : (
            <>
              {item("add", t("page.newChild"), async () => {
                onClose();
                const p = await createPage({ workspaceId: page.workspaceId, parentId: page.id, title: "" });
                if (p) onSelect(p.id);
              })}
              {item("create-outline", t("page.rename"), () => setRenaming(true))}
              {item("arrow-up", t("page.moveUp"), () => void reorderPage(page.id, -1).then(onClose))}
              {item("arrow-down", t("page.moveDown"), () => void reorderPage(page.id, 1).then(onClose))}
              {item("return-down-forward-outline", t("page.move"), () => setMoving(true))}
              {item("trash-outline", kids ? t("page.trashWith") : t("page.trash"), () => void trash("with_children"), true)}
              {kids ? item("arrow-undo-outline", t("page.trashLift"), () => void trash("lift_children"), true) : null}
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 옮길 곳 고르기 — 같은 주제의 페이지(자기와 그 아래는 빼고) · 맨 위 */
function MoveDialog({ c, page, onClose }: { c: Palette; page: PageMeta; onClose: () => void }) {
  const t = useT();
  const { state, movePage } = useWork();
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const banned = useMemo(() => new Set(subtreeIds(state.pages, page.id)), [state.pages, page.id]);
  const rows = useMemo(() => {
    const all = q.trim() ? searchPageTitles(state.pages, q, page.workspaceId).map((p) => ({ page: p, depth: 0 })) : flattenTree(state.pages, page.workspaceId, { depth: 6 });
    return all.filter((x) => !banned.has(x.page.id)).slice(0, 300);
  }, [state.pages, page.workspaceId, q, banned]);
  const go = async (parentId: string | null) => {
    const r = await movePage(page.id, parentId, null);
    if (r === "cycle") return setNote(t("page.cycle"));
    if (r === "cross_workspace") return setNote(t("page.cross"));
    if (r === "gone") return setNote(t("page.gone"));
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", padding: 16 }} onPress={onClose} accessibilityLabel={t("common.close")}>
        <Pressable onPress={() => undefined} style={{ width: "100%", maxWidth: 420, maxHeight: "80%", backgroundColor: c.surface, borderRadius: 14, padding: 12, gap: 8, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: c.text }}>{t("page.moveTo", { title: page.title || t("page.untitled") })}</Text>
          <TextInput value={q} onChangeText={setQ} placeholder={t("inbox.pickFilter")} placeholderTextColor={c.muted} accessibilityLabel={t("inbox.pickFilter")} style={{ borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14 }} />
          <Pressable onPress={() => void go(null)} accessibilityRole="button" style={{ paddingVertical: 8 }}>
            <Text style={{ fontSize: 14, color: c.accent }}>{t("page.moveRoot")}</Text>
          </Pressable>
          <FlatList
            data={rows}
            keyExtractor={(x) => x.page.id}
            renderItem={({ item }) => (
              <Pressable onPress={() => void go(item.page.id)} accessibilityRole="button" style={{ paddingVertical: 7, paddingLeft: 8 + item.depth * 14 }}>
                <Text numberOfLines={1} style={{ fontSize: 14, color: c.text }}>
                  {pageLabel(item.page, t("page.untitled"))}
                </Text>
              </Pressable>
            )}
          />
          {note ? <Muted c={c} danger>{note}</Muted> : null}
          <Btn c={c} small label={t("common.cancel")} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function PageTree({ c, selectedId, onSelect }: { c: Palette; selectedId: string | null; onSelect: (id: string) => void }) {
  const t = useT();
  const { state, workspaceId, createPage, restorePage } = useWork();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<PageMeta | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const withProposals = useMemo(() => new Set(openBodyProposals(state.manifest).map((p) => p.pageId)), [state.manifest]);
  // 고른 페이지의 조상은 펼쳐 둔다(오늘 화면 · 링크로 왔을 때 트리에서 보이게)
  const open = useMemo(() => {
    const s = new Set(expanded);
    let cur = state.pages.find((p) => p.id === selectedId);
    while (cur?.parentId) {
      s.add(cur.parentId);
      cur = state.pages.find((p) => p.id === cur?.parentId);
    }
    return s;
  }, [expanded, selectedId, state.pages]);
  const rows = useMemo(() => {
    const collapsed = new Set(state.pages.filter((p) => !open.has(p.id)).map((p) => p.id));
    return flattenTree(state.pages, workspaceId, { collapsed });
  }, [state.pages, workspaceId, open]);
  const trash = trashedPages(state.pages, workspaceId);
  const toggle = (id: string) => {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setExpanded(n);
  };

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
        <Text accessibilityRole="header" style={{ flex: 1, fontSize: 13, fontWeight: "700", color: c.muted }}>
          {t("page.tree")}
        </Text>
        <Pressable
          onPress={async () => {
            const p = await createPage({ workspaceId, parentId: null, title: "" });
            if (p) onSelect(p.id);
          }}
          accessibilityRole="button"
          accessibilityLabel={t("page.newRoot")}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Ionicons name="add" size={16} color={c.accent} />
          <Text style={{ fontSize: 13, color: c.accent }}>{t("page.newRoot")}</Text>
        </Pressable>
      </View>
      {rows.length ? (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.page.id}
          getItemLayout={(_, i) => ({ length: ROW, offset: ROW * i, index: i })}
          initialNumToRender={40}
          renderItem={({ item: { page, depth, childCount } }) => {
            const on = page.id === selectedId;
            return (
              <View style={{ height: ROW, flexDirection: "row", alignItems: "center", paddingLeft: 2 + depth * 14, borderRadius: 6, backgroundColor: on ? c.soft : undefined }}>
                <Pressable onPress={() => childCount && toggle(page.id)} disabled={!childCount} accessibilityRole="button" accessibilityLabel={open.has(page.id) ? t("page.collapse") : t("page.expand")} hitSlop={4} style={{ width: 20, alignItems: "center" }}>
                  {childCount ? <Ionicons name={open.has(page.id) ? "chevron-down" : "chevron-forward"} size={13} color={c.muted} /> : <Ionicons name="document-text-outline" size={12} color={c.muted} />}
                </Pressable>
                <Pressable onPress={() => onSelect(page.id)} accessibilityRole="link" accessibilityState={{ selected: on }} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 5 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: page.title ? c.text : c.muted, fontWeight: on ? "700" : "400" }}>
                    {pageLabel(page, t("page.untitled"))}
                  </Text>
                  {withProposals.has(page.id) ? <View accessibilityLabel={t("proposal.strip", { count: 1 })} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} /> : null}
                  {childCount && !open.has(page.id) ? <Text style={{ fontSize: 11, color: c.muted }}>{t("page.childCount", { count: childCount })}</Text> : null}
                </Pressable>
                <Pressable onPress={() => setMenu(page)} accessibilityRole="button" accessibilityLabel={t("page.menu")} hitSlop={6} style={{ paddingHorizontal: 6 }}>
                  <Ionicons name="ellipsis-horizontal" size={14} color={c.muted} />
                </Pressable>
              </View>
            );
          }}
        />
      ) : (
        <Muted c={c}>{t("page.empty")}</Muted>
      )}
      {trash.length ? (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 6 }}>
          <Pressable onPress={() => setShowTrash(!showTrash)} accessibilityRole="button" accessibilityState={{ expanded: showTrash }} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 }}>
            <Ionicons name="trash-outline" size={14} color={c.muted} />
            <Text style={{ fontSize: 13, color: c.muted }}>{t("page.trashBin", { count: trash.length })}</Text>
          </Pressable>
          {showTrash
            ? trash.map((p) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 20 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: c.muted }}>
                    {pageLabel(p, t("page.untitled"))}
                  </Text>
                  <Btn c={c} small label={t("page.restore")} onPress={() => void restorePage(p.id)} />
                </View>
              ))
            : null}
        </View>
      ) : null}
      {menu ? <Menu c={c} page={menu} onClose={() => setMenu(null)} onSelect={onSelect} /> : null}
    </View>
  );
}

/** 이을 페이지 고르기(받은 것) — 찾기 칸 + 트리 순서 목록. 같은 주제 페이지만 */
export function PagePicker({ c, workspaceId, onPick, onCancel }: { c: Palette; workspaceId: string; onPick: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const { state } = useWork();
  const [q, setQ] = useState("");
  const rows = useMemo(() => (q.trim() ? searchPageTitles(state.pages, q, workspaceId).map((p) => ({ page: p, depth: 0 })) : flattenTree(state.pages, workspaceId, { depth: 3 })).slice(0, 40), [state.pages, workspaceId, q]);
  return (
    <View style={{ gap: 6 }}>
      <Muted c={c}>{rows.length || q ? t("inbox.pickItem") : t("inbox.noItems")}</Muted>
      <TextInput value={q} onChangeText={setQ} placeholder={t("inbox.pickFilter")} placeholderTextColor={c.muted} accessibilityLabel={t("inbox.pickFilter")} style={{ borderRadius: 8, borderWidth: 1, borderColor: c.border, color: c.text, paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {rows.map(({ page }) => (
          <Pressable key={page.id} onPress={() => onPick(page.id)} accessibilityRole="button" accessibilityLabel={page.title} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: c.soft }}>
            <Text style={{ fontSize: 12, color: c.text }}>{pageLabel(page, t("page.untitled"))}</Text>
          </Pressable>
        ))}
        <Btn c={c} small label={t("common.close")} onPress={onCancel} />
      </View>
    </View>
  );
}
