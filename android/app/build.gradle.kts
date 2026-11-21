plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.linyan.deepseek"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.linyan.deepseek"
        // WebViewAssetLoader + MediaStore.Downloads 都要求 API 29 起
        minSdk = 29
        targetSdk = 34
        // 每次要重新装包时都把这两个数字往上加，装完在「应用信息」里能核对
        versionCode = 44
        versionName = "3.1.4"
    }

    buildTypes {
        release {
            // 用 debug 签名，方便直接装到手机上试；要正式发布再换自己的 keystore
            signingConfig = signingConfigs.getByName("debug")
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
    // FileProvider 直接来自 androidx.core，显式声明避免依赖树变化时编译失败
    implementation("androidx.core:core-ktx:1.13.1")
    // WebViewAssetLoader：用 https://appassets.androidplatform.net/ 这个安全来源提供本地资源
    implementation("androidx.webkit:webkit:1.11.0")
}
