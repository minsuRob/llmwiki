import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { usePalette } from "../components/theme.ts";
import { AppProvider } from "../lib/store.tsx";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: "index", title: "대화", icon: "chatbubble-ellipses-outline" },
  { name: "tasks", title: "할일", icon: "checkbox-outline" },
  { name: "calendar", title: "일정", icon: "calendar-outline" },
  { name: "notes", title: "기록", icon: "document-text-outline" },
  { name: "settings", title: "설정", icon: "settings-outline" },
];

export default function RootLayout() {
  const c = usePalette();
  return (
    <SafeAreaProvider>
      <AppProvider>
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
            <Tabs.Screen
              key={t.name}
              name={t.name}
              options={{ title: t.title, tabBarIcon: ({ color, size }) => <Ionicons name={t.icon} color={color} size={size} /> }}
            />
          ))}
        </Tabs>
      </AppProvider>
    </SafeAreaProvider>
  );
}
