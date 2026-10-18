// The Android half of the shared core: where secrets are kept, the two
// connections, the app lock, images, appearance — and the Compose pieces every
// screen is built from (theme, load states, the shell's account menu), so the
// two feature modules look like one app without depending on each other.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.tinkerbell.platform"
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
    api(project(":core:api"))
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.foundation)
    api(libs.compose.material3)
    api(libs.compose.material3.navigation.suite)
    api(libs.compose.material.icons)
    api(libs.compose.ui.tooling.preview)
    api(libs.activity.compose)
    api(libs.lifecycle.runtime.compose)
    api(libs.coroutines.android)
    api(libs.coil.compose)
    implementation(libs.coil.okhttp)
    implementation(libs.core.ktx)
    implementation(libs.datastore.preferences)
    implementation(libs.biometric)
    implementation(libs.browser)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
}
