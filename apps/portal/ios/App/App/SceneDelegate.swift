import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// The bridge, with the two WebView defaults that give away a web app.
///
/// - Edge-swipe-back: the SPAs navigate with pushState, and WKWebView will
///   animate a swipe back through those entries with the system's own
///   interactive gesture and page snapshot — exactly the native feel a
///   hand-rolled JavaScript swipe can't match. It is off unless asked for.
/// - Link previews: a long press on any link otherwise pops a Safari preview
///   of a URL inside the app's own bundle.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
        webView?.allowsLinkPreview = false
    }
}
