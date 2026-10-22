import XCTest

final class NoticeGroupReadinessTests: XCTestCase {
    // The retained injected-probe failure exposed this local notice as the collapsed group's only AX entry.
    private let collapsed = "Grouped, 1 minute ago, Fixture Late, Late fixture message"

    func testCollapsedLocalNoticeIsExpandedButNeverAcceptedAsTheInjectedTarget() {
        var readiness = NoticeGroupReadiness()
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, groupHittable: true), .expandGroup)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, groupHittable: true), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: nil, groupHittable: false), .observeTarget)
    }

    func testMissingOrUnrelatedGroupNeverAuthorizesAPress() {
        var readiness = NoticeGroupReadiness()
        for label in [nil, "Grouped, unrelated sender", "Fixture Late, Late fixture message"] as [String?] {
            XCTAssertEqual(readiness.action(targetExists: false, groupLabel: label, groupHittable: true), .waitForTarget)
        }
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, groupHittable: false), .waitForTarget)
        XCTAssertEqual(readiness.action(targetExists: false, groupLabel: collapsed, groupHittable: true), .expandGroup)
    }

    func testAnAlreadyExposedTargetDoesNotPressTheGroup() {
        var readiness = NoticeGroupReadiness()
        XCTAssertEqual(readiness.action(targetExists: true, groupLabel: collapsed, groupHittable: true), .observeTarget)
    }
}
