import AppKit
import CuateHelperCore

private final class ActionBox: NSObject {
    let action: MenuBarAction
    init(_ action: MenuBarAction) {
        self.action = action
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let info: HelperInfo
    private let socketPath: String?
    private let openSetup: Bool
    private var statusItem: NSStatusItem?
    private var server: SocketServer?
    private var setupController: SetupWindowController?
    private var refreshTimer: Timer?
    private var lastCapabilities: Capabilities

    init(info: HelperInfo, socketPath: String?, openSetup: Bool) {
        self.info = info
        self.socketPath = socketPath
        self.openSetup = openSetup
        self.lastCapabilities = Capabilities.current(version: info.version, build: info.build)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.imagePosition = .imageOnly
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
        updateStatusItem()

        if let socketPath {
            let server = SocketServer(path: socketPath)
            server.start()
            self.server = server
        }
        if openSetup {
            showSetup()
        }

        let timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Opening the app again is a person asking for the setup screen. The
    /// launchd agent is started with --socket, so it never reaches this path.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSetup()
        return true
    }

    func menuWillOpen(_ menu: NSMenu) {
        refresh()
        populate(menu)
    }

    private func refresh() {
        lastCapabilities = Capabilities.current(version: info.version, build: info.build)
        updateStatusItem()
        setupController?.refresh(capabilities: lastCapabilities)
    }

    private func updateStatusItem() {
        statusItem?.button?.image = StatusIcon.image(badge: lastCapabilities.badge)
        statusItem?.button?.toolTip = MenuBarModel(capabilities: lastCapabilities, signing: .current()).tooltip
    }

    private func populate(_ menu: NSMenu) {
        menu.removeAllItems()
        let model = MenuBarModel(capabilities: lastCapabilities, signing: .current())

        let running = NSMenuItem(title: model.statusLine, action: nil, keyEquivalent: "")
        running.isEnabled = false
        menu.addItem(running)

        let version = NSMenuItem(title: model.versionLine, action: nil, keyEquivalent: "")
        version.isEnabled = false
        menu.addItem(version)

        let signing = NSMenuItem(title: model.signingLine, action: nil, keyEquivalent: "")
        signing.isEnabled = false
        menu.addItem(signing)
        menu.addItem(.separator())

        for row in model.permissionRows {
            menu.addItem(item(for: row))
        }
        menu.addItem(.separator())
        for row in model.commandRows {
            let entry = item(for: row)
            if row.action.kind == .quit { entry.keyEquivalent = "q" }
            menu.addItem(entry)
        }
    }

    private func item(for row: MenuBarRow) -> NSMenuItem {
        let entry = NSMenuItem(title: row.title, action: #selector(performAction(_:)), keyEquivalent: "")
        entry.target = self
        entry.representedObject = ActionBox(row.action)
        if let state = row.state {
            entry.state = (state == .granted || state == .notRequired) ? .on : .off
        }
        if let permission = row.action.permission {
            entry.toolTip = permission.paneName
        }
        return entry
    }

    @objc private func performAction(_ sender: NSMenuItem) {
        guard let box = sender.representedObject as? ActionBox else { return }
        switch box.action.kind {
        case .openPermissionPane:
            if let permission = box.action.permission { openPane(permission) }
        case .openSetup:
            showSetup()
        case .checkAgain:
            refresh()
        case .restart:
            restartHelper()
        case .quit:
            quitHelper()
        }
    }

    private func showSetup() {
        if setupController == nil {
            setupController = SetupWindowController(info: info, onClose: { [weak self] in
                self?.setupController = nil
            })
        }
        setupController?.refresh(capabilities: lastCapabilities)
        setupController?.showWindow(nil)
        setupController?.window?.makeKeyAndOrderFront(nil)
        // The person started this screen, so bringing it forward is expected.
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openPane(_ permission: Permission) {
        for string in permission.systemSettingsURLs {
            if let url = URL(string: string), NSWorkspace.shared.open(url) { return }
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    private func restartHelper() {
        let label = ProcessInfo.processInfo.environment["CUATE_HELPER_LABEL"] ?? "com.azuretek.cuate.helper"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["kickstart", "-k", "gui/" + String(getuid()) + "/" + label]
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            // Not under launchd: start a fresh copy and end this one.
        }
        if process.terminationStatus != 0 {
            let reopen = Process()
            reopen.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            reopen.arguments = ["-a", Bundle.main.bundlePath]
            try? reopen.run()
            NSApp.terminate(nil)
        }
    }

    private func quitHelper() {
        let label = ProcessInfo.processInfo.environment["CUATE_HELPER_LABEL"] ?? "com.azuretek.cuate.helper"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["bootout", "gui/" + String(getuid()) + "/" + label]
        try? process.run()
        process.waitUntilExit()
        NSApp.terminate(nil)
    }
}
