/** 그래프 설정 — 옵시디언의 .obsidian/graph.json 처럼 기기에 남겨 둔다(웹은 localStorage) */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

import { DEFAULT_GRAPH_SETTINGS, normalizeSettings, type GraphSettings } from "../../../../packages/core/src/vault.ts";

const KEY = "graph.settings.v1";

export function useGraphSettings(): [GraphSettings, (patch: Partial<GraphSettings>) => void, () => void] {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings(normalizeSettings(JSON.parse(raw))))
      .catch(() => {});
  }, []);

  const save = useCallback((next: GraphSettings) => {
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    return next;
  }, []);

  const update = useCallback((patch: Partial<GraphSettings>) => setSettings((s) => save(normalizeSettings({ ...s, ...patch }))), [save]);
  const reset = useCallback(() => setSettings(save(DEFAULT_GRAPH_SETTINGS)), [save]);
  return [settings, update, reset];
}
