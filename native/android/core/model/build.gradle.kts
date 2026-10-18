// The server's types, generated (`generated/Api.kt`) plus the few hand-written
// pieces the generated file refers to (`Support.kt`). Pure JVM, so the wire
// tests run in seconds with no device.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    // Bytecode the Android modules can dex without desugaring surprises.
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    api(libs.serialization.json)
    testImplementation(libs.junit)
}
