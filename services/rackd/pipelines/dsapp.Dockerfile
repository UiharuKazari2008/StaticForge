# DSApp-Kotlin build image: JDK 21 + Android SDK (platform 36). Runs as any uid; the SDK is world-writable so AGP can fetch pieces.
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 GRADLE_USER_HOME=/cache/gradle
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless git curl unzip ca-certificates bash && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/android-sdk/cmdline-tools && cd /tmp \
 && curl -fL --retry 3 -o cl.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q cl.zip -d /tmp/cl && mv /tmp/cl/cmdline-tools /opt/android-sdk/cmdline-tools/latest && rm -rf cl.zip /tmp/cl \
 && yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
 && chmod -R a+rwX /opt/android-sdk
