// The app itself: the shell (connecting, sign-in, the lock, settings, links)
// around the two feature modules. Its version is read from
// `../version.properties`, which `scripts/release.mjs` rewrites on every
// release so the Android build number moves in step with the server's.
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val release = Properties().apply { rootProject.file("version.properties").inputStream().use { load(it) } }

android {
    namespace = "dev.tinkerbell.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.tinkerbell.app"
        minSdk = 35
        targetSdk = 35
        versionCode = release.getProperty("versionCode").toInt()
        versionName = release.getProperty("versionName")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // The dev server, as the emulator reaches the host machine. Only the
        // instrumented tests read these.
        testInstrumentationRunnerArguments["devHost"] = "10.0.2.2"
    }

    buildTypes {
        release {
            // Signing and shrinking are set up when the app goes to a store;
            // until then a release build exists to prove the debug-only
            // switches really are off in it.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // compileSdk is pinned at 35 on purpose (see libs.versions.toml);
        // being told newer AndroidX exists is not a finding.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "OldTargetApi", "AndroidGradlePluginVersion")
        abortOnError = true
        warningsAsErrors = false
    }
}

dependencies {
    implementation(project(":core:platform"))
    implementation(project(":feature:portal"))
    implementation(project(":feature:admin"))
    implementation(libs.navigation.compose)
    implementation(libs.serialization.json)
    implementation(libs.biometric)
    implementation(libs.lifecycle.process)
    implementation(libs.code.scanner)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.okhttp)
    androidTestImplementation(libs.coroutines.core)
}
