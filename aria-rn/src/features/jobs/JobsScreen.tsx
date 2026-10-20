/**
 * 취준 — 그룹바이 · 인디스워크 공고(users/{uid}/jobs). 넣기 · 정리는 jobsSync 함수와 Admin 스크립트(functions/scripts/import-jobs.ts)가 한다.
 * 공고는 수천 건이라 대화용 구독(DataProvider)에 넣지 않고 이 탭을 열 때만 구독한다. 본문(jobTexts)은 펼칠 때 한 건씩 읽는다.
 */
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { JOB_SOURCE_NAMES, compareJobs, isExpired, type Job, type JobSource } from "../../../../packages/core/src/jobs.ts";
import { usePalette, type Palette } from "../../components/theme";
import { Btn, Tag } from "../../components/ui";
import { errorText } from "../../firebase/api";
import { db } from "../../firebase/client";
import { useData } from "../../firebase/data";

type Kind = "all" | "dev" | "nondev";

/** 사용자 날짜 "YYYY-MM-DD" */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dday(due: string, today: string): string {
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return days === 0 ? "오늘 마감" : `D-${days}`;
}

function useJobs(uid: string | null) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    setJobs(null);
    return onSnapshot(
      collection(db, "users", uid, "jobs"),
      (snap) => setJobs(snap.docs.map((d) => ({ ...(d.data() as Job), id: d.id }))),
      (e) => setError(`공고를 읽지 못했어요: ${errorText(e)}`),
    );
  }, [uid]);
  return { jobs, error };
}

function Chip({ c, label, on, onPress }: { c: Palette; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? c.accent : c.soft }}>
      <Text style={{ fontSize: 13, color: on ? c.accentText : c.text }}>{label}</Text>
    </Pressable>
  );
}

function Field({ c, label, value }: { c: Palette; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: c.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, color: c.text, lineHeight: 19 }}>{value}</Text>
    </View>
  );
}

function JobBody({ c, uid, job }: { c: Palette; uid: string; job: Job }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || text !== null) return;
    getDoc(doc(db, "users", uid, "jobTexts", job.id))
      .then((s) => setText((s.data()?.text as string | undefined) ?? "(본문이 없어요)"))
      .catch((e) => setText(`본문을 읽지 못했어요: ${errorText(e)}`));
  }, [open, text, uid, job.id]);
  if (!job.hasText) return null;
  return (
    <View style={{ gap: 6 }}>
      <Btn c={c} small label={open ? "본문 접기" : "본문 보기"} onPress={() => setOpen((o) => !o)} />
      {open ? (
        text === null ? (
          <ActivityIndicator color={c.muted} />
        ) : (
          <Text selectable style={{ fontSize: 13, color: c.text, lineHeight: 19, backgroundColor: c.row, borderRadius: 10, padding: 10 }}>
            {text}
          </Text>
        )
      ) : null}
    </View>
  );
}

function JobRow({ c, uid, job, today, open, onToggle }: { c: Palette; uid: string; job: Job; today: string; open: boolean; onToggle: () => void }) {
  const place = job.station ?? job.location;
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8, marginBottom: 10 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ gap: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: c.text, lineHeight: 21 }}>{job.title}</Text>
        <Text style={{ fontSize: 13, color: c.muted }}>
          {job.company} · {JOB_SOURCE_NAMES[job.source]}
          {job.postedAt ? ` · ${job.postedAt}` : ""}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {job.dueDate ? <Tag c={c} tone="accent" label={`${dday(job.dueDate, today)} · ${job.dueDate}`} /> : <Tag c={c} label={job.dueText.length > 18 ? `${job.dueText.slice(0, 18)}…` : job.dueText} />}
          <Tag c={c} tone={job.dev ? "ok" : "muted"} label={job.dev ? "개발" : "비개발"} />
          {job.ai ? <Tag c={c} tone="accent" label="AI" /> : null}
          {job.career ? <Tag c={c} label={job.career} /> : null}
          {place ? <Tag c={c} label={place.length > 20 ? `${place.slice(0, 20)}…` : place} /> : null}
        </View>
        {job.summary ? (
          <Text numberOfLines={open ? undefined : 2} style={{ fontSize: 13, color: c.text, lineHeight: 19 }}>
            {job.summary}
          </Text>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
          <Field c={c} label="기술" value={job.stack} />
          <Field c={c} label="특징" value={job.features} />
          <Field c={c} label="방향성" value={job.direction} />
          <Field c={c} label="근무지" value={job.location} />
          <Field c={c} label="가까운 역" value={job.station} />
          <Field c={c} label="마감" value={job.dueText} />
          <Field c={c} label="직무 분류" value={job.categories.length ? job.categories.join(", ") : null} />
          <Field c={c} label="개발 분류 이유" value={job.note} />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Btn c={c} small primary label="원문 열기" onPress={() => void Linking.openURL(job.url)} />
            {job.applyUrl ? <Btn c={c} small label="지원 링크" onPress={() => void Linking.openURL(job.applyUrl!)} /> : null}
          </View>
          <JobBody c={c} uid={uid} job={job} />
        </View>
      ) : null}
    </View>
  );
}

export default function JobsScreen() {
  const c = usePalette();
  const { user } = useData();
  const uid = user?.uid ?? null;
  const { jobs, error } = useJobs(uid);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<JobSource | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [aiOnly, setAiOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayStr();

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (jobs ?? [])
      .filter((j) => !isExpired(j, today))
      .filter((j) => !source || j.source === source)
      .filter((j) => kind === "all" || (kind === "dev" ? j.dev : !j.dev))
      .filter((j) => !aiOnly || j.ai)
      .filter((j) => !dueOnly || !!j.dueDate)
      .filter((j) => {
        if (!words.length) return true;
        const hay = [j.company, j.title, j.summary, j.stack, j.location, j.station, j.features, j.direction, ...j.categories].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort(compareJobs);
  }, [jobs, q, source, kind, aiOnly, dueOnly, today]);

  const header = (
    <View style={{ gap: 10, marginBottom: 12 }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="회사 · 직무 · 기술 · 지역 검색"
        placeholderTextColor={c.muted}
        accessibilityLabel="공고 검색"
        style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: c.text }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip c={c} label="전체 출처" on={!source} onPress={() => setSource(null)} />
        <Chip c={c} label="그룹바이" on={source === "groupby"} onPress={() => setSource("groupby")} />
        <Chip c={c} label="인디스워크" on={source === "inthiswork"} onPress={() => setSource("inthiswork")} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip c={c} label="전체 직군" on={kind === "all"} onPress={() => setKind("all")} />
        <Chip c={c} label="개발" on={kind === "dev"} onPress={() => setKind("dev")} />
        <Chip c={c} label="비개발" on={kind === "nondev"} onPress={() => setKind("nondev")} />
        <Chip c={c} label="AI 직무" on={aiOnly} onPress={() => setAiOnly((v) => !v)} />
        <Chip c={c} label="마감일 있음" on={dueOnly} onPress={() => setDueOnly((v) => !v)} />
      </ScrollView>
      <Text style={{ fontSize: 12, color: c.muted }}>
        {jobs === null ? "불러오는 중…" : `${shown.length}건 / 전체 ${jobs.length}건 · 마감 지난 공고는 넣지 않아요`}
      </Text>
      {error ? <Text style={{ fontSize: 13, color: c.danger }}>{error}</Text> : null}
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}
      data={shown}
      keyExtractor={(j) => j.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        jobs === null ? (
          <ActivityIndicator color={c.muted} />
        ) : (
          <Text style={{ color: c.muted, textAlign: "center", marginTop: 24 }}>{jobs.length ? "조건에 맞는 공고가 없어요" : "아직 넣은 공고가 없어요"}</Text>
        )
      }
      renderItem={({ item }) => (uid ? <JobRow c={c} uid={uid} job={item} today={today} open={openId === item.id} onToggle={() => setOpenId((o) => (o === item.id ? null : item.id))} /> : null)}
      initialNumToRender={15}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
    />
  );
}
