// 공용 로직(../packages/core)을 앱 밖에서 가져온다 — Metro 가 그 폴더도 보게 한다.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../packages")];

module.exports = config;
