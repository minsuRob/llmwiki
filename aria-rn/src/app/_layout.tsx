import { Ionicons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePalette } from "../components/theme";
import LoginScreen, { AuthLoading } from "../features/auth/LoginScreen";
import { LocalDrivePickerHost } from "../features/work/drive/LocalDrivePicker";
import { ConfirmHost } from "../features/work/ConfirmHost";
import { DriveBanner } from "../features/work/DriveBanner";
import { QuickAdd } from "../features/work/QuickAdd";
import { DesktopRunsProvider } from "../features/work/DesktopRuns";
import { WorkProvider } from "../features/work/WorkContext";
import { DataProvider, useData } from "../firebase/data";
import { I18nProvider, useT } from "../i18n";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** 아래 탭 — 오늘 · 업무 · 보관함 · 대화. 나머지(할일 · 일정 · 기록 · 그래프 · 설정)는 위 오른쪽 메뉴에서 */
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "nav.today", icon: "sunny-outline" },
  { name: "work/index", title: "nav.work", icon: "briefcase-outline" },
  { name: "archive", title: "nav.archive", icon: "archive-outline" },
  { name: "chat", title: "nav.chat", icon: "chatbubble-ellipses-outline" },
];
const HIDDEN: { name: string; title: string }[] = [
  { name: "work/[id]", title: "nav.workDetail" },
  { name: "tasks", title: "nav.allTasks" },
  { name: "calendar", title: "nav.calendar" },
  { name: "notes", title: "nav.notes" },
  { name: "jobs", title: "nav.jobs" },
  { name: "synapse", title: "nav.graph" },
  { name: "settings", title: "nav.settings" },
];
const MENU: { href: "/tasks" | "/calendar" | "/notes" | "/jobs" | "/synapse" | "/settings"; title: string; icon: IconName }[] = [
  { href: "/tasks", title: "nav.allTasks", icon: "checkbox-outline" },
  { href: "/calendar", title: "nav.calendar", icon: "calendar-outline" },
  { href: "/notes", title: "nav.notes", icon: "document-text-outline" },
  { href: "/jobs", title: "nav.jobs", icon: "newspaper-outline" },
  { href: "/synapse", title: "nav.graph", icon: "git-network-outline" },
  { href: "/settings", title: "nav.settings", icon: "settings-outline" },
];

/** 함수 호출 · 구독이 실패하면 화면 위에 한 줄로 알린다(누르면 닫힌다) */
function ErrorBanner() {
  const c = usePalette();
  const t = useT();
  const { error, setError, mode } = useData();
  return (
    <>
      {mode === "emulator" ? (
        <View style={{ backgroundColor: c.soft, paddingVertical: 3 }}>
          <Text style={{ textAlign: "center", fontSize: 11, color: c.muted }}>{t("app.emulator")}</Text>
        </View>
      ) : null}
      {error ? (
        <Pressable onPress={() => setError(null)} accessibilityRole="alert" style={{ backgroundColor: c.danger, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: "#fff", fontSize: 13 }}>{t("app.errorDismiss", { error })}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function MoreMenu() {
  const c = usePalette();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t("nav.more")} style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
        <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={c.text} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={() => setOpen(false)} accessibilityLabel={t("common.close")}>
          <View style={{ position: "absolute", top: 56, right: 12, minWidth: 200, backgroundColor: c.surface, borderRadius: 14, paddingVertical: 6, borderWidth: 1, borderColor: c.border }}>
            {MENU.map((m) => (
              <Pressable
                key={m.href}
                accessibilityRole="menuitem"
                onPress={() => {
                  setOpen(false);
                  router.push(m.href);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11 }}
              >
                <Ionicons name={m.icon} size={18} color={c.text} />
                <Text style={{ fontSize: 14, color: c.text }}>{t(m.title)}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** 로그인 전에는 로그인 화면, 저장된 로그인을 읽는 동안은 잠깐 기다림 */
function AuthGate() {
  const { authChecked, user } = useData();
  if (!authChecked) return <AuthLoading />;
  if (!user) return <LoginScreen />;
  return (
    <WorkProvider>
      <DesktopRunsProvider>
        <AppTabs />
      </DesktopRunsProvider>
    </WorkProvider>
  );
}

function AppTabs() {
  const c = usePalette();
  const t = useT();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ErrorBanner />
      <DriveBanner />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTitleStyle: { color: c.text, fontWeight: "700" },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerRight: () => <MoreMenu />,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.muted,
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: t(tab.title), tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={color} size={size} /> }} />
        ))}
        {HIDDEN.map((h) => (
          <Tabs.Screen key={h.name} name={h.name} options={{ title: t(h.title), href: null }} />
        ))}
      </Tabs>
      <QuickAdd />
      <LocalDrivePickerHost />
      <ConfirmHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <DataProvider>
          <AuthGate />
        </DataProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
