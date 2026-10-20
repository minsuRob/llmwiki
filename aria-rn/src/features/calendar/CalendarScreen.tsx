/** 일정 — 앞으로 14일을 날짜별로. 마감 있는 할일도 같은 날 아래에 함께 보인다 */
import React from "react";
import { ScrollView, Text, View } from "react-native";

import { addDays, formatWhen, hasTime, ymd } from "../../../../packages/core/src/dates.ts";
import { liveTasks } from "../../../../packages/core/src/engine.ts";
import { usePalette } from "../../components/theme";
import { useData } from "../../firebase/data";
import { useT } from "../../i18n";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export default function CalendarScreen() {
  const c = usePalette();
  const tr = useT();
  const { state } = useData();
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, i) => addDays(now, i));
  const events = state.events.filter((e) => !e.deletedAt);
  const tasks = liveTasks(state).filter((t) => !t.done && t.due);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 10, maxWidth: 720, width: "100%", alignSelf: "center" }}>
      {days.map((d, i) => {
        const key = ymd(d);
        const evs = events.filter((e) => e.start.slice(0, 10) === key).sort((a, b) => a.start.localeCompare(b.start));
        const tks = tasks.filter((t) => t.due!.slice(0, 10) === key);
        const empty = evs.length === 0 && tks.length === 0;
        return (
          <View key={key} style={{ flexDirection: "row", gap: 12, opacity: empty ? 0.55 : 1 }}>
            <View style={{ width: 52, alignItems: "center", paddingTop: 2 }}>
              <Text style={{ fontSize: 12, color: d.getDay() === 0 ? c.danger : c.muted }}>{tr(i === 0 ? "calendar.today" : `calendar.weekdays.${WEEKDAYS[d.getDay()]}`)}</Text>
              <Text style={{ fontSize: 20, fontWeight: "800", color: c.text }}>{d.getDate()}</Text>
            </View>
            <View style={{ flex: 1, gap: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: c.border }}>
              {empty ? <Text style={{ color: c.muted, fontSize: 13, paddingTop: 6 }}>{tr("calendar.empty")}</Text> : null}
              {evs.map((e) => (
                <View key={e.id} style={{ backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                  <Text style={{ color: c.accentText, fontWeight: "700" }}>{e.title}</Text>
                  <Text style={{ color: c.accentText, fontSize: 12, opacity: 0.85 }}>{hasTime(e.start) ? formatWhen(e.start, now)?.split(" ").slice(1).join(" ") : tr("calendar.allDay")}</Text>
                </View>
              ))}
              {tks.map((t) => (
                <View key={t.id} style={{ backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: c.border }}>
                  <Text style={{ color: c.text }}>☐ {t.title}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
