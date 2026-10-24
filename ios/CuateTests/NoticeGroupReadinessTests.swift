import XCTest

final class NoticeGroupReadinessTests: XCTestCase {
    // The retained injected-probe failure exposed this local notice as the collapsed group's only AX entry.
    private let collapsed = "Grouped, 1 minute ago, Fixture Late, Late fixture message"

    func testCollapsedLocalNoticeIsExpandedButNeverAcceptedAsTheInjectedTarget() {
        var readiness = NoticeGroupReadiness()
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: true), .expandGroup)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: true), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: nil, expansionButtonHittable: false), .observeTarget)
    }

    func testMissingOrUnrelatedGroupNeverAuthorizesAPress() {
        var readiness = NoticeGroupReadiness()
        for label in [nil, "Grouped, unrelated sender", "Fixture Late, Late fixture message"] as [String?] {
            XCTAssertEqual(readiness.action(targetExists: false, groupLabel: label, expansionButtonHittable: true), .waitForTarget)
        }
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: false), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: true), .expandGroup)
    }

    func testAHittableContainerWithoutItsContentButtonDoesNotConsumeExpansion() {
        var readiness = NoticeGroupReadiness()
        // The failed native run tapped a hittable ListCell scroll view, leaving the group collapsed.
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: false), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: true), .expandGroup)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, expansionButtonHittable: true), .waitForTarget)
    }

    func testAnAlreadyExposedTargetDoesNotPressTheGroup() {
        var readiness = NoticeGroupReadiness()
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: collapsed, expansionButtonHittable: true), .observeTarget)
    }

    func testMovingExpansionButtonDoesNotConsumeTheSinglePress() {
        var readiness = NoticeGroupReadiness()
        var expansion = NoticeExpansionReadiness()
        let screen = CGRect(x: 0, y: 0, width: 402, height: 874)
        // Retained native video: the first press expands the compact list and moves the still-collapsed app group.
        let old = CGRect(x: 14, y: 648, width: 374, height: 66)
        let settled = CGRect(x: 14, y: 576.8, width: 374, height: 66)
        XCTAssertFalse(settled.contains(CGPoint(x: 201, y: 681)))
        for frame in [old, old, settled, settled] {
            XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
                expansionButtonHittable: expansion.observe(frame, screen: screen)), .waitForTarget)
        }
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: expansion.observe(settled, screen: screen)), .expandGroup)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: expansion.observe(settled, screen: screen)), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: nil,
            expansionButtonHittable: false), .observeTarget)
    }

    func testMissingOrOffscreenExpansionButtonResetsStability() {
        let screen = CGRect(x: 0, y: 0, width: 402, height: 874)
        let button = CGRect(x: 14, y: 576.8, width: 374, height: 66)
        var expansion = NoticeExpansionReadiness()
        XCTAssertFalse(expansion.observe(button, screen: screen))
        XCTAssertFalse(expansion.observe(button, screen: screen))
        for invalid in [nil, CGRect.zero, CGRect(x: 14, y: -70, width: 374, height: 66)] as [CGRect?] {
            XCTAssertFalse(expansion.observe(invalid, screen: screen))
            XCTAssertFalse(expansion.observe(button, screen: screen))
            XCTAssertFalse(expansion.observe(button, screen: screen))
        }
        XCTAssertTrue(expansion.observe(button, screen: screen))
    }

    func testCompactListTransitionAllowsOneSettledAppGroupPressButNeverAcceptsALocalNotice() {
        var readiness = NoticeGroupReadiness()
        let compact = CGRect(x: 14, y: 648, width: 374, height: 66)
        let appGroup = CGRect(x: 14, y: 576.8, width: 374, height: 66)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: true, expansionButtonFrame: compact), .expandGroup)
        // An ineffective press or an unsettled transition must not authorize a duplicate tap.
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: true, expansionButtonFrame: compact), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: false, expansionButtonFrame: appGroup), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
            expansionButtonHittable: true, expansionButtonFrame: appGroup), .expandGroup)
        for frame in [appGroup, compact] {
            XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed,
                expansionButtonHittable: true, expansionButtonFrame: frame), .waitForTarget)
        }
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: nil,
            expansionButtonHittable: false), .observeTarget)
    }

}
