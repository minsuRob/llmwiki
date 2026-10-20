import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePalette } from "../components/theme";
import LoginScreen, { AuthLoading } from "../features/auth/LoginScreen";
import { DataProvider, useData } from "../firebase/data";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "대화", icon: "chatbubble-ellipses-outline" },
  { name: "tasks", title: "할일", icon: "checkbox-outline" },
  { name: "calendar", title: "일정", icon: "calendar-outline" },
  { name: "notes", title: "기록", icon: "document-text-outline" },
  { name: "jobs", title: "취준", icon: "briefcase-outline" },
  { name: "synapse", title: "시냅스", icon: "git-network-outline" },
  { name: "settings", title: "설정", icon: "settings-outline" },
];

/** 함수 호출 · 구독이 실패하면 화면 위에 한 줄로 알린다(누르면 닫힌다) */
function ErrorBanner() {
  const c = usePalette();
  const { error, setError, mode } = useData();
  return (
    <>
      {mode === "emulator" ? (
        <View style={{ backgroundColor: c.soft, paddingVertical: 3 }}>
          <Text style={{ textAlign: "center", fontSize: 11, color: c.muted }}>로컬 에뮬레이터</Text>
        </View>
      ) : null}
      {error ? (
        <Pressable onPress={() => setError(null)} accessibilityRole="alert" style={{ backgroundColor: c.danger, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: "#fff", fontSize: 13 }}>{error} (눌러서 닫기)</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** 로그인 전에는 로그인 화면, 저장된 로그인을 읽는 동안은 잠깐 기다림 */
function AuthGate() {
  const { authChecked, user } = useData();
  if (!authChecked) return <AuthLoading />;
  if (!user) return <LoginScreen />;
  return <AppTabs />;
}

function AppTabs() {
  const c = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ErrorBanner />
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.surface },
          headerTitleStyle: { color: c.text, fontWeight: "700" },
          headerShadowVisible: false,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
          tabBarActiveTintColor: c.accent,
          tabBarInactiveTintColor: c.muted,
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        {TABS.map((t) => (
          <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} color={color} size={size} /> }} />
        ))}
      </Tabs>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DataProvider>
        <AuthGate />
      </DataProvider>
    </SafeAreaProvider>
  );
}
