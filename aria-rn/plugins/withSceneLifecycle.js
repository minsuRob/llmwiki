// iOS 27 은 UIScene 수명주기를 쓰지 않는 앱을 실행 직후 죽인다
// (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Expo 템플릿 AppDelegate 는 창을 직접 만들므로, 창 만들기를 SceneDelegate 로 옮긴다.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START_BLOCK = /\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n/;

const SCENE_DELEGATE = `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    appDelegate.reactNativeFactory?.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    if let url = connectionOptions.urlContexts.first?.url {
      _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
}
`;

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('class SceneDelegate')) return cfg;
    if (cfg.modResults.language !== 'swift' || !START_BLOCK.test(src)) {
      throw new Error('withSceneLifecycle: AppDelegate.swift 모양이 예상과 다르다');
    }
    src = src.replace(START_BLOCK, '\n    // 창은 SceneDelegate 가 만든다\n');
    cfg.modResults.contents = src + SCENE_DELEGATE;
    return cfg;
  });
}

module.exports = withSceneLifecycle;
