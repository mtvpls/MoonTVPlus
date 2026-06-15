plugins {
    id("com.android.application")
}

fun propOrEnv(propName: String, envName: String, defaultValue: String): String {
    return (project.findProperty(propName) as String?)
        ?: System.getenv(envName)
        ?: defaultValue
}

val rawBaseUrl = propOrEnv("BASE_URL", "BASE_URL", "http://192.168.1.10:3000")
val appDisplayName = propOrEnv("APP_NAME", "APP_NAME", "MoonTVPlus TV")
val versionNameValue = propOrEnv("VERSION_NAME", "VERSION_NAME", "1.0.0")
val versionCodeValue = propOrEnv("VERSION_CODE", "VERSION_CODE", "1").toIntOrNull() ?: 1
val minSdkValue = propOrEnv("MIN_SDK", "MIN_SDK", "23").toIntOrNull() ?: 23
val geckoViewVersion = propOrEnv("GECKOVIEW_VERSION", "GECKOVIEW_VERSION", "126.0.20240526221752")

fun escapeJavaString(value: String): String = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

fun escapeXmlString(value: String): String = value
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace("'", "\\'")
    .replace("\"", "\\\"")

android {
    namespace = "com.moontvplus.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.moontvplus.tv"
        minSdk = minSdkValue
        targetSdk = 35
        versionCode = versionCodeValue
        versionName = versionNameValue

        buildConfigField("String", "BASE_URL", "\"${escapeJavaString(rawBaseUrl)}\"")
        resValue("string", "app_name", escapeXmlString(appDisplayName))
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    flavorDimensions += "engine"

    productFlavors {
        create("webview") {
            dimension = "engine"
            buildConfigField("String", "ENGINE_NAME", "\"WebView\"")
            resValue("string", "engine_name", "WebView")
        }
        create("gecko") {
            dimension = "engine"
            applicationIdSuffix = ".gecko"
            buildConfigField("String", "ENGINE_NAME", "\"GeckoView\"")
            resValue("string", "engine_name", "GeckoView")
        }
    }

    signingConfigs {
        create("release") {
            val storeFilePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank() && file(storeFilePath).exists()) {
                storeFile = file(storeFilePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            val storeFilePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!storeFilePath.isNullOrBlank() && file(storeFilePath).exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

dependencies {
    add("geckoImplementation", "org.mozilla.geckoview:geckoview:$geckoViewVersion")
}
