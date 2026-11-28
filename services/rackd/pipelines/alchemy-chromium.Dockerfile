# Alchemy-Chromium build image: depot_tools + the packages Chromium's build needs. The source lives on a mounted LV, not in the image.
FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive PATH=/opt/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0 VPYTHON_BYPASS="manually managed python not supported by chrome operations"
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates python3 python3-pip python3-venv lsb-release sudo xz-utils unzip pkg-config \
    build-essential ninja-build gperf bison flex nodejs default-jdk-headless libgtk-3-dev libnss3-dev libasound2-dev libcups2-dev libdrm-dev libgbm-dev libxkbcommon-dev libxss-dev libxtst-dev libpci-dev libdbus-1-dev libglib2.0-dev libatk1.0-dev libatk-bridge2.0-dev libpulse-dev libkrb5-dev libudev-dev libffi-dev \
    ccache procps file rsync cpio python3-setuptools python3-httplib2 libxcomposite-dev libxdamage-dev libxrandr-dev libxi-dev libxcursor-dev libpango1.0-dev libcairo2-dev libexpat1-dev libbz2-dev libcap-dev libwayland-dev libxshmfence-dev libjpeg-dev libxml2-dev \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git /opt/depot_tools && chmod -R a+rwX /opt/depot_tools
# brand.py's logo step needs Pillow
RUN apt-get update && apt-get install -y --no-install-recommends python3-pil && rm -rf /var/lib/apt/lists/*
# depot_tools' own python (python3_bin_reldir.txt, cipd client): gn.py / vpython need it and a skipped gclient sync no longer creates it
RUN cd /opt/depot_tools && ./ensure_bootstrap && chmod -R a+rwX /opt/depot_tools
