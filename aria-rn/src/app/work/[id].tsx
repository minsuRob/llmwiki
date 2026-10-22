import { useLocalSearchParams } from "expo-router";
import React from "react";

import { PageRoute } from "../../features/work/PagesScreen";

export default function WorkPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PageRoute id={String(id ?? "")} />;
}
