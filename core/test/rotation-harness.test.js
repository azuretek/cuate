import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
test('native fixture supplies the message arrays consumed by the conversation', async () => {
  const body = {};
  const root = {
    phase: 'onboarding',
    get updateComplete() {
      for (const message of this.messages) {
        assert.equal(message.attachments.length, 0);
        assert.equal(message.reactions.length, 0);
        assert.equal(message.replyTo, null);
      }
      throw new Error('render contract reached');
    },
  };
  const window = {};
  vm.runInNewContext(read('core/test/rotation-fixture.js'), {
    customElements: { whenDefined: async () => {} }, document: { querySelector: () => root, body },
    performance: { now: () => 0 }, window,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.messages.length, 100);
  assert.equal(window.rotationProof.error, 'render contract reached');
  assert.equal(window.rotationProof.ok, false);
});

const naming = JSON.parse(read('core/spec/naming.json'));
const android = 'android/app/src/';
const packagePath = naming.ids.android.replaceAll('.', '/');

test('native rotation fixtures cannot be activated in a release build', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--rotation-fixture[\s\S]*#endif/);
  const project = read('ios/project.yml');
  assert.match(project, /CONFIGURATION.*Debug[\s\S]*core\/test\/rotation-fixture/);
  assert.match(project, /type: bundle.ui-testing/);
  assert.ok(project.includes('- ' + naming.product + 'UITests'));
  const gradle = read('android/app/build.gradle.kts');
  assert.match(gradle, /sourceSets.getByName\("androidTest"\).assets.srcDir/);
  assert.doesNotMatch(read(android + 'main/kotlin/' + packagePath + '/MainActivity.kt'), /rotation-fixture|rotationProof/);
  assert.doesNotMatch(read('core/app/main.js'), /rotation-fixture|rotationProof/);
});

test('both native tests turn the actual device and preserve their CI results', () => {
  assert.match(read('ios/' + naming.product + 'UITests/RotationTests.swift'), /XCUIDevice.shared.orientation = orientation/);
  assert.match(read(android + 'androidTest/kotlin/' + packagePath + '/RotationTest.kt'), /requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE/);
  assert.match(read('.github/workflows/ios.yml'), /resultBundlePath proof\/rotation.xcresult/);
  assert.match(read('.github/workflows/android.yml'), /connectedDebugAndroidTest/);
});
