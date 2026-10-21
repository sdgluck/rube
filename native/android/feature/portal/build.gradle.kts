// The Portal half's screens. Depends on the shared core only — never on the
// other half or on :app — so a screen can't reach the shell's sign-in.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "fyi.rube.portal"
    compileSdk = 35
    defaultConfig {
        minSdk = 35
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(project(":core:platform"))
    implementation(libs.navigation.compose)
    implementation(libs.serialization.json)
    debugImplementation(libs.compose.ui.tooling)
}
