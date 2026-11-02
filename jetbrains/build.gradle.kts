import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.tasks.RunIdeTask
import org.jetbrains.kotlin.gradle.dsl.JvmDefaultMode
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "dominikmech"
version = "1.0.1"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Lowest supported platform (2025.2). Runs in PhpStorm and every other IntelliJ-based IDE.
        intellijIdeaCommunity("2025.2.6")
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        // Inherit the platform interfaces' default methods instead of generating bridges to their internal members.
        jvmDefault.set(JvmDefaultMode.NO_COMPATIBILITY)
        // 2025.2 bundles the Kotlin 2.1 stdlib.
        apiVersion.set(KotlinVersion.KOTLIN_2_1)
        languageVersion.set(KotlinVersion.KOTLIN_2_1)
    }
}

intellijPlatform {
    // No GUI-designer forms or Java @NotNull to instrument; the step also trips over portable JDKs.
    instrumentCode = false
    pluginVerification {
        ides {
            create(IntelliJPlatformType.PhpStorm, "2025.2.6.3")
            create(IntelliJPlatformType.PhpStorm, "2026.2.4")
        }
    }
    pluginConfiguration {
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "252"
            untilBuild = provider { null }
        }
    }
}

// The dashboard UI (media/) and the strings / language table (shared/) come straight from the
// VS Code extension, so both editors render the same thing.
val sharedResources = tasks.register<Sync>("sharedResources") {
    from("../media") {
        include("dashboard.js", "dashboard.css")
        into("projecttiles/webview")
    }
    from("../shared") {
        into("projecttiles/shared")
    }
    into(layout.buildDirectory.dir("generated/sharedResources"))
}

// `gradlew runIde -PopenProject=<dir> -PappData=<dir>`: open a project, against a throwaway data folder.
tasks.named<RunIdeTask>("runIde") {
    providers.gradleProperty("openProject").orNull?.let {
        args(it)
        systemProperty("idea.trust.all.projects", "true")
    }
    providers.gradleProperty("appData").orNull?.let { environment("APPDATA", it) }
}

sourceSets {
    main {
        resources.srcDir(sharedResources)
    }
}
