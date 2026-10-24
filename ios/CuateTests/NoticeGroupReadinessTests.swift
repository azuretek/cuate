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
}
