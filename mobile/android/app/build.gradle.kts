plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Optional, deliberately debug-only exception for one administrator-approved
// temporary IPv4 endpoint. The host comes from the local build process; source
// archives contain neither a live address nor a global cleartext permission.
val temporaryHttpHost = providers.gradleProperty("temporaryHttpHost").orNull.orEmpty()
require(temporaryHttpHost.isEmpty() || (
    Regex("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}").matches(temporaryHttpHost) &&
    temporaryHttpHost.split('.').all { it.toInt() in 0..255 && it.toInt().toString() == it }
)) { "Temporary HTTP access requires one explicit IPv4 address." }
val temporaryNetworkRes = layout.buildDirectory.dir("generated/mobile-network-security/res")
val generateTemporaryNetworkPolicy = tasks.register("generateTemporaryNetworkPolicy") {
    inputs.property("temporaryHttpHost", temporaryHttpHost)
    outputs.dir(temporaryNetworkRes)
    doLast {
        val target = temporaryNetworkRes.get().file("xml/mobile_test_network_security.xml").asFile
        target.parentFile.mkdirs()
        val hostRule = if (temporaryHttpHost.isEmpty()) "" else
            "<domain-config cleartextTrafficPermitted=\"true\"><domain includeSubdomains=\"false\">$temporaryHttpHost</domain></domain-config>"
        target.writeText("""<?xml version="1.0" encoding="utf-8"?>
<network-security-config><base-config cleartextTrafficPermitted="false"/>$hostRule</network-security-config>
""")
    }
}

android {
    namespace = "net.fibernetlb.bills.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Provisional app identifier. Confirm ownership before store registration.
        applicationId = "net.fibernetlb.bills.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // Store signing is intentionally not configured. Never publish a
            // debug-signed app as a production release. Pilot delivery is debug.
        }
    }
    // AGP 9 rejects Provider objects here; resolve the generated directory.
    // The explicit preDebugBuild dependency below guarantees generation first.
    sourceSets.getByName("debug").res.srcDir(temporaryNetworkRes.get().asFile)
}

tasks.matching { it.name == "preDebugBuild" }.configureEach {
    dependsOn(generateTemporaryNetworkPolicy)
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
