// The Android app, in the same repo as the server it talks to, so the
// generated models in :core:model can't drift from the schemas they come from
// without `pnpm verify` noticing.
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

rootProject.name = "rube"

include(":core:model")
include(":core:api")
include(":core:platform")
include(":feature:portal")
include(":feature:admin")
include(":app")
