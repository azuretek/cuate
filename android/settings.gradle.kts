// The Gradle build for the Android shell. This file names the one module.
//
// Unlike the iOS side, the project files here are source rather than generated
// output: Gradle reads these directly, so there is no separate generator and no
// committed binary project file to drift.

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "Cuate"
include(":app")
