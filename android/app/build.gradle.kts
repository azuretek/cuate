// The app module: the Kotlin shell that hosts core's own page in a WebView.
//
// core is copied into the APK's assets from the repository rather than kept as a
// second copy in this tree, the way the iOS project copies core's directories
// into the bundle. The page is core/app's own index.html and its modules import
// across app/, kit/ and the rules beside them, so the copied layout is core's
// own. test/ is deliberately not copied: it is not code a shell runs.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.azuretek.cuate"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.azuretek.cuate"
        minSdk = 26
        targetSdk = 35
        // The release pipeline passes both, derived from the one base in
        // package.json. The defaults below are the same next version that a local
        // build reports, so the APK never carries a second, stale copy of it.
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "0.0.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // The copied core tree is an asset root, so app/index.html, spec/naming.json,
    // build/engine.js and fixtures/ keep the layout they have in the repository.
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/coreAssets"))

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        // The release keystore is a CI secret (see .github/workflows/android.yml).
        // Nothing here names a path: the workflow writes the file and sets these
        // variables, and a build with no keystore produces an unsigned APK rather
        // than failing to configure.
        create("release") {
            val storePath = System.getenv("CUATE_ANDROID_KEYSTORE")
            if (!storePath.isNullOrBlank()) {
                storeFile = file(storePath)
                storePassword = System.getenv("CUATE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CUATE_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("CUATE_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("CUATE_ANDROID_KEYSTORE").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Copy core beside the app before the asset merger runs, so the APK carries the
// one owner of every spec, rule and fixture rather than a copy that can drift.
val copyCore by tasks.registering(Copy::class) {
    from(rootProject.file("../core/app")) { into("app") }
    from(rootProject.file("../core/kit")) { into("kit") }
    from(rootProject.file("../core/spec")) { into("spec") }
    from(rootProject.file("../core/build")) { into("build") }
    from(rootProject.file("../core/fixtures")) { into("fixtures") }
    into(layout.buildDirectory.dir("generated/coreAssets"))
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach { dependsOn(copyCore) }

// Every lint task reads the same copied assets, so every one waits for the copy.
// Left implicit, Gradle refuses the release build with an execution-time
// dependency validation error; the release analysis task was the first to catch
// it, and naming a single model task only moved the refusal to the next one.
tasks.matching { it.name.startsWith("lint") }.configureEach { dependsOn(copyCore) }

dependencies {
    // The web view host and its asset loader.
    implementation("androidx.webkit:webkit:1.12.1")
    // The embedded engine for the rules a shell needs with no page on screen.
    // docs/android.md records the measurement that chose it.
    implementation("androidx.javascriptengine:javascriptengine:1.1.1")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
}
