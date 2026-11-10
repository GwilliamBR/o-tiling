#!/usr/bin/env bash
set -euo pipefail

UUID="o-tiling@oliwebd.github.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure not running as root
if [ "$(id -u)" -eq 0 ]; then
    echo "Error: Do not run this script as root or with sudo."
    echo "GNOME extensions must be installed into your user directory."
    exit 1
fi

prompt_user() {
    local question="$1"
    local default_yes="${2:-true}"
    local reply=""

    if [ -c /dev/tty ]; then
        read -r -p "$question " reply </dev/tty
    elif [ -t 0 ]; then
        read -r -p "$question " reply
    else
        # Non-interactive session, default to yes if specified
        if [ "$default_yes" = true ]; then
            return 0
        else
            return 1
        fi
    fi

    case "$reply" in
        [nN][oO]|[nN])
            return 1
            ;;
        *)
            return 0
            ;;
    esac
}

build_pop_launcher_from_source() {
    echo "Cloning and building pop-launcher from source..."
    local build_dir
    build_dir=$(mktemp -d)
    (
        cd "$build_dir"
        git clone --depth 1 https://github.com/pop-os/launcher.git
        cd launcher
        just build-release
        just install
    )
    rm -rf "$build_dir"
    echo "pop-launcher installed to ~/.local/bin."
    echo "Please ensure ~/.local/bin is in your PATH."
}

check_pop_launcher() {
    if command -v pop-launcher >/dev/null 2>&1; then
        echo "Found pop-launcher: $(command -v pop-launcher)"
        return 0
    fi

    echo ""
    echo "Note: pop-launcher was not found in your PATH."
    echo "O-Tiling's Launcher feature (Super + /) requires pop-launcher to search apps, files, and math formulas."
    echo ""

    local distro=""
    local id_like=""
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        distro="${ID:-}"
        id_like="${ID_LIKE:-}"
    fi

    if [[ "$distro" =~ ^(arch|cachyos|manjaro|endeavouros)$ ]] || [[ "$id_like" =~ arch ]]; then
        echo "Arch Linux based system detected ($distro)."
        if prompt_user "Install pop-launcher now via pacman? [Y/n]"; then
            echo "Running: sudo pacman -S --needed pop-launcher libqalculate"
            sudo pacman -S --needed pop-launcher libqalculate || {
                echo "Package installation failed or was skipped."
                echo "You can install it manually later. See INSTALL.md."
            }
        else
            echo "Skipped pop-launcher installation."
        fi
    elif [[ "$distro" =~ ^(pop)$ ]]; then
        echo "Pop!_OS detected. Please ensure pop-launcher is in your PATH."
    elif [[ "$distro" =~ ^(fedora|rhel|centos)$ ]] || [[ "$id_like" =~ fedora ]]; then
        echo "Fedora based system detected ($distro)."
        if command -v cargo >/dev/null 2>&1 && command -v just >/dev/null 2>&1; then
            if prompt_user "Build and install pop-launcher to ~/.local/bin now? [Y/n]"; then
                build_pop_launcher_from_source
            else
                echo "Skipped pop-launcher installation."
            fi
        else
            echo "To enable the launcher on Fedora, please see INSTALL.md for instructions."
        fi
    elif [[ "$distro" =~ ^(ubuntu|debian|linuxmint)$ ]] || [[ "$id_like" =~ (ubuntu|debian) ]]; then
        echo "Debian / Ubuntu based system detected ($distro)."
        if command -v cargo >/dev/null 2>&1 && command -v just >/dev/null 2>&1; then
            if prompt_user "Build and install pop-launcher to ~/.local/bin now? [Y/n]"; then
                build_pop_launcher_from_source
            else
                echo "Skipped pop-launcher installation."
            fi
        else
            echo "To enable the launcher on Ubuntu / Debian, please see INSTALL.md for instructions."
        fi
    else
        echo "See INSTALL.md for instructions on setting up pop-launcher for your distribution."
    fi
}

install_extension() {
    # Check if inside repository root
    if [ -f "$SCRIPT_DIR/metadata.json" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
        echo "Installing from local source..."
        if command -v make >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1; then
            (cd "$SCRIPT_DIR" && make install)
        elif [ -f "$SCRIPT_DIR/$UUID.zip" ]; then
            gnome-extensions install --force "$SCRIPT_DIR/$UUID.zip"
        else
            echo "Building extension requires make and pnpm."
            (cd "$SCRIPT_DIR" && pnpm install && pnpm run build && make install)
        fi
    else
        echo "Downloading latest release package..."
        local tmp_dir
        tmp_dir=$(mktemp -d)
        local zip_path="$tmp_dir/$UUID.zip"

        local release_url
        release_url=$(curl -sSL "https://api.github.com/repos/oliwebd/o-tiling/releases/latest" \
            | grep "browser_download_url.*zip" \
            | cut -d : -f 2,3 \
            | tr -d '"' \
            | head -n 1)

        if [ -z "$release_url" ]; then
            echo "Error: Could not retrieve release URL from GitHub."
            rm -rf "$tmp_dir"
            exit 1
        fi

        echo "Downloading from $release_url..."
        curl -sSL "$release_url" -o "$zip_path"

        echo "Installing extension..."
        gnome-extensions install --force "$zip_path"
        rm -rf "$tmp_dir"
    fi

    echo "Enabling $UUID..."
    gnome-extensions enable "$UUID" 2>/dev/null || true
}

main() {
    echo "=== O-Tiling Installer ==="
    echo ""

    check_pop_launcher

    echo ""
    install_extension

    echo ""
    echo "=== Installation Finished ==="
    echo "If you are on Wayland, log out and log back in to activate the extension."
}

main "$@"
