# DreamOS image build (mkosi 25 on Debian trixie, as the dreamos-build VM): runs privileged as root (loop devices, systemd-repart, mounts).
# The release signing key is never in this image or in the plain build container (see dreamos-release.json).
FROM debian:trixie
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    mkosi systemd-repart systemd-boot-efi systemd-ukify systemd-container erofs-utils dosfstools mtools cryptsetup-bin xorriso qemu-utils \
    git curl zstd xz-utils python3 python3-pip debian-archive-keyring fdisk rsync build-essential pkg-config ca-certificates gnupg kmod cpio apt-utils \
    sudo openssl jq procps util-linux e2fsprogs squashfs-tools btrfs-progs sbsigntool bubblewrap dpkg-dev ccache libudev-dev libdbus-1-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*
# Rust for CaféReady and the native boot stages (tools/build-image.sh sources $HOME/.cargo/env of the user it runs as: root, /root)
ENV RUSTUP_HOME=/root/.rustup CARGO_HOME=/root/.cargo PATH=/root/.cargo/bin:$PATH
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable && rustup target add x86_64-unknown-uefi
