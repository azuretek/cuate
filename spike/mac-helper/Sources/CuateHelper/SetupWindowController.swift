import AppKit
import Contacts
import CuateHelperCore

final class SetupWindowController: NSWindowController, NSWindowDelegate {
    private let info: HelperInfo
    private let onClose: () -> Void
    private let stack = NSStackView()
    private var rowViews: [Permission: SetupRowView] = [:]

    init(info: HelperInfo, onClose: @escaping () -> Void) {
        self.info = info
        self.onClose = onClose
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 660),
                              styleMask: [.titled, .closable],
                              backing: .buffered,
                              defer: false)
        window.title = "Set Up Cuate Helper"
        window.center()
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        build()
        refresh(capabilities: Capabilities.current(version: info.version, build: info.build))
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func build() {
        guard let content = window?.contentView else { return }
        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false

        let document = NSView()
        document.translatesAutoresizingMaskIntoConstraints = false

        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.orientation = .vertical
        stack.alignment = .width
        stack.spacing = 18
        document.addSubview(stack)
        scroll.documentView = document
        content.addSubview(scroll)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            document.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            document.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24),
        ])

        let title = NSTextField(labelWithString: "Set Up Cuate Helper")
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        stack.addArrangedSubview(title)

        let intro = NSTextField(wrappingLabelWithString: "Cuate Helper needs these permissions to work with Messages. Nothing is asked until you choose a button, and you can close this window at any time.")
        intro.textColor = .secondaryLabelColor
        stack.addArrangedSubview(intro)

        for permission in Permission.allCases {
            let row = SetupRowView(permission: permission, target: self,
                                   action: #selector(permissionButton(_:)))
            rowViews[permission] = row
            stack.addArrangedSubview(row)
        }

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 12
        let check = NSButton(title: "Check Again", target: self, action: #selector(checkAgain))
        let close = NSButton(title: "Close", target: self, action: #selector(closeWindow))
        buttons.addArrangedSubview(check)
        buttons.addArrangedSubview(close)
        stack.addArrangedSubview(buttons)

        let footer = NSTextField(wrappingLabelWithString: "If you say no, Cuate keeps working. Names fall back to addresses, and anything that needs a missing permission says which setting fixes it.")
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = .secondaryLabelColor
        stack.addArrangedSubview(footer)
    }

    func refresh(capabilities: Capabilities) {
        let model = SetupModel(capabilities: capabilities)
        for row in model.rows {
            rowViews[row.permission]?.update(row: row)
        }
    }

    @objc private func checkAgain() {
        refresh(capabilities: Capabilities.current(version: info.version, build: info.build))
    }

    @objc private func closeWindow() {
        close()
    }

    @objc private func permissionButton(_ sender: NSButton) {
        guard let raw = sender.identifier?.rawValue, let permission = Permission(rawValue: raw) else { return }
        let capabilities = Capabilities.current(version: info.version, build: info.build)
        let state = capabilities.displayState(for: permission)
        switch permission {
        case .fullDiskAccess:
            openPane(permission)
        case .automationMessages:
            if state == .notAsked { askAutomation() } else { openPane(permission) }
        case .contacts:
            if state == .notAsked { askContacts() } else { openPane(permission) }
        }
    }

    private func askAutomation() {
        rowViews[.automationMessages]?.showAsking()
        DispatchQueue.global(qos: .userInitiated).async {
            _ = SystemGrantProbe().automationRawValue(ask: true)
            DispatchQueue.main.async {
                self.checkAgain()
            }
        }
    }

    private func askContacts() {
        rowViews[.contacts]?.showAsking()
        CNContactStore().requestAccess(for: .contacts) { _, _ in
            DispatchQueue.main.async {
                self.checkAgain()
            }
        }
    }

    private func openPane(_ permission: Permission) {
        for string in permission.systemSettingsURLs {
            if let url = URL(string: string), NSWorkspace.shared.open(url) { return }
        }
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
    }

    func windowWillClose(_ notification: Notification) {
        onClose()
    }
}

private final class SetupRowView: NSView {
    private let permission: Permission
    private let purposeLabel = NSTextField(wrappingLabelWithString: "")
    private let stateLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")
    private let button: NSButton

    init(permission: Permission, target: AnyObject, action: Selector) {
        self.permission = permission
        self.button = NSButton(title: "", target: target, action: action)
        super.init(frame: .zero)
        button.identifier = NSUserInterfaceItemIdentifier(permission.rawValue)
        button.bezelStyle = .rounded

        let title = NSTextField(labelWithString: permission.title)
        title.font = .systemFont(ofSize: 14, weight: .semibold)
        purposeLabel.stringValue = permission.purpose
        purposeLabel.textColor = .labelColor
        detailLabel.font = .systemFont(ofSize: 11)
        detailLabel.textColor = .secondaryLabelColor

        let stateLine = NSStackView()
        stateLine.orientation = .horizontal
        stateLine.spacing = 12
        stateLine.alignment = .centerY
        stateLabel.font = .systemFont(ofSize: 12, weight: .medium)
        stateLine.addArrangedSubview(stateLabel)
        stateLine.addArrangedSubview(button)

        let column = NSStackView(views: [title, purposeLabel, stateLine, detailLabel])
        column.translatesAutoresizingMaskIntoConstraints = false
        column.orientation = .vertical
        column.alignment = .width
        column.spacing = 6
        addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: leadingAnchor),
            column.trailingAnchor.constraint(equalTo: trailingAnchor),
            column.topAnchor.constraint(equalTo: topAnchor),
            column.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func update(row: SetupRow) {
        purposeLabel.stringValue = row.purpose
        stateLabel.stringValue = row.state.displayName
        switch row.state {
        case .granted, .notRequired: stateLabel.textColor = .systemGreen
        case .denied: stateLabel.textColor = .systemOrange
        case .notAsked: stateLabel.textColor = .secondaryLabelColor
        }
        detailLabel.stringValue = row.reason + " " + row.action
        button.title = row.buttonTitle
        button.isEnabled = row.buttonEnabled
    }

    func showAsking() {
        stateLabel.stringValue = "Asking..."
        stateLabel.textColor = .secondaryLabelColor
        button.isEnabled = false
    }
}
