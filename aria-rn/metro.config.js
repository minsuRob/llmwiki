// Anthropic SDK 의 ESM 빌드는 Metro 에서 모듈 초기화 순서 오류가 난다
// ("Cannot access 'BETA_BROWSER_MEMBER_NAME_VALUES' before initialization") — 이 패키지만 CommonJS 빌드로 고른다.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@anthropic-ai/sdk" || moduleName.startsWith("@anthropic-ai/sdk/")) {
    return context.resolveRequest({ ...context, unstable_conditionNames: ["require", "react-native", "browser"] }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
