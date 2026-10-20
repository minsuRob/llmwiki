/**
 * Firebase 한 벌 — Auth · Firestore · Functions. 에뮬레이터 모드면 로컬에 붙는다.
 * 앱은 Firestore 를 **읽기만** 하고(규칙이 막는다), 바꾸는 일은 api.ts 의 함수 호출로만 한다.
 */
import { initializeApp } from "firebase/app";
import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

import { createAuth } from "./auth";
import { EMULATOR_HOST, EMULATOR_PORTS, FUNCTIONS_REGION, USE_EMULATORS, firebaseConfig } from "./config";

export const app = initializeApp(firebaseConfig);
export const auth = createAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
}
