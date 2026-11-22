import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 发布签名来自 android/keystore.properties（不进版本库）；没有该文件时退回 debug 证书
val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

android {
    namespace = "com.linyan.deepseek"
    buildFeatures {
        buildConfig = true
    }
    compileSdk = 36
    // 本机只装了 36.0.0 的 Build Tools
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.linyan.deepseek.alt"
        // WebViewAssetLoader + MediaStore.Downloads 都要求 API 29 起
        minSdk = 29
        targetSdk = 34
        // 每次要重新装包时都把这两个数字往上加，装完在「应用信息」里能核对
        versionCode = 44
        versionName = "3.1.4"
        // 每次构建自动生成，拼进资源 URL 防止 WebView 缓存旧页面
        buildConfigField("String", "BUILD_STAMP", "\"${System.currentTimeMillis()}\"")
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                val storePath = keystoreProps.getProperty("storeFile")
                    ?: error("keystore.properties 缺少 storeFile")
                storeFile = File(storePath).takeIf { it.isAbsolute } ?: rootProject.file(storePath)
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // 有 keystore.properties 就用它签名，否则退回 debug 证书
            signingConfig = if (keystoreProps.isNotEmpty()) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 网页资源不压缩，避免 assets 里的 js/css/字体被改坏
    androidResources {
        noCompress += listOf("html", "js", "css", "woff", "woff2", "ttf", "json")
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    // WebViewAssetLoader：用 https://appassets.androidplatform.net/ 这个安全来源提供本地资源
    implementation("androidx.webkit:webkit:1.11.0")
}
