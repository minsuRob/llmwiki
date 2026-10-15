import { useColorScheme } from "react-native";

export interface Palette {
  bg: string;
  surface: string;
  card: string;
  row: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  soft: string;
  danger: string;
  ok: string;
  border: string;
  userBubble: string;
  userText: string;
}

const light: Palette = {
  bg: "#f6f5f2",
  surface: "#ffffff",
  card: "#ffffff",
  row: "#f3f2ee",
  text: "#1c1b19",
  muted: "#77736b",
  accent: "#2f5d50",
  accentText: "#ffffff",
  soft: "#ebe9e3",
  danger: "#b3402e",
  ok: "#2f7a4a",
  border: "#e4e1da",
  userBubble: "#2f5d50",
  userText: "#ffffff",
};

const dark: Palette = {
  bg: "#141413",
  surface: "#1d1d1b",
  card: "#222220",
  row: "#2a2a27",
  text: "#f1efe9",
  muted: "#a29e95",
  accent: "#8fc7b1",
  accentText: "#10201a",
  soft: "#33332f",
  danger: "#ef8a78",
  ok: "#86d49f",
  border: "#30302c",
  userBubble: "#3b6b5d",
  userText: "#ffffff",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}
