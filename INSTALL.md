# Local installation guide

This guide builds O-tiling from source and installs it for your user only. It covers the launcher too, which needs one extra program called `pop-launcher`.

## 1. Requirements

| Needed | Why |
|---|---|
| GNOME Shell 48, 49, 50 or 51 | Versions listed in `metadata.json` |
| `git`, `make`, `zip`, `glib-compile-schemas` | Build and packaging |
| Node.js and `pnpm` | Compiles the TypeScript |
| `pop-launcher` | Powers the launcher (apps, calculator, commands, files, windows) |

Package names for the build tools:

- Fedora: `sudo dnf install git make zip glib2-devel nodejs`
- Ubuntu or Debian: `sudo apt install git make zip libglib2.0-bin nodejs npm`
- Arch: `sudo pacman -S git make zip glib2 nodejs npm`

Install pnpm if you do not have it: `npm install -g pnpm`

## 2. Install pop-launcher

The launcher in O-tiling talks to the same `pop-launcher` program that Pop Shell uses. Without it, the shortcut shows a notice and nothing else.

- Arch: `sudo pacman -S pop-launcher` (or the AUR package `pop-launcher`)
- Pop!_OS: already installed.
- Debian, Ubuntu, Fedora: build it from source. You need `rust`, `cargo` and `just`:

```sh
git clone https://github.com/pop-os/launcher
cd launcher
just build-release
just install
```

By default `just install` puts the program in `~/.local/bin` and the plugins in `~/.local/share/pop-launcher/plugins`. No `sudo` is needed. Make sure `~/.local/bin` is in your `PATH` when the desktop session starts (log out and in once after the first install). For a system-wide install, use `sudo just rootdir=/ install` instead.

Check it worked: `which pop-launcher` must print a path.

The calculator needs `qalc` (package `libqalculate` on Fedora and Arch, `qalc` on Debian and Ubuntu). The window search needs the `pop_shell` plugin, which `just install` includes.

## 3. Build and install O-tiling

```sh
git clone https://github.com/oliwebd/o-tiling
cd o-tiling
pnpm install
pnpm run lint
pnpm run type-check
make install
```

`make install` builds `o-tiling@oliwebd.github.com.zip` and runs `gnome-extensions install --force` on it. The result goes to `~/.local/share/gnome-shell/extensions/o-tiling@oliwebd.github.com`.

## 4. Turn it on

GNOME only sees new extensions after a restart of the shell.

- **Wayland:** log out and log in again.
- **X11:** press `Alt+F2`, type `r`, press Enter.

Then enable it:

```sh
gnome-extensions enable o-tiling@oliwebd.github.com
```

## 5. Use the launcher

Press `Super + /`. Type to search.

| Key | Action |
|---|---|
| Up, Down, or `Ctrl+J`, `Ctrl+K` | Move selection |
| Enter | Run the selected result |
| `Ctrl + 1` to `Ctrl + 9` | Run a result by number |
| Tab | Complete the selection |
| `Ctrl + Q` | Quit the selected app or window |
| `Ctrl + C` | Copy the selected result |
| Right click | Show extra actions |
| Esc, or Super | Close |

Type `?` to see the other modes. The most useful ones:

| Type | Mode |
|---|---|
| a name | Apps and open windows |
| `=` or a number, for example `=2+2` | Calculator |
| `:` or `t:` followed by a command | Run a command in a terminal |
| `/` or `~` | Browse files |
| `find ` followed by a name | File search |

To change the shortcut, or allow the launcher over fullscreen windows, open the O-tiling preferences and go to the Shortcuts page.

## 6. Check that it works

```sh
gnome-extensions info o-tiling@oliwebd.github.com     # State should be ACTIVE
pnpm run log                                           # follow the extension log
busctl --user list | grep -i "OTiling\|PopShell"       # window search needs these names
```

`com.System76.PopShell` is the name pop-launcher uses for window search. O-tiling takes it unless the real Pop Shell is running. Do not run both extensions at once.

## 7. Update or remove

Update: `git pull`, then repeat step 3 and restart the shell.

Remove: `make uninstall`

## Troubleshooting

- **Nothing happens on Super + /:** check the shortcut is not used by another tool. Open the O-tiling preferences, Shortcuts page, and see if it shows a conflict.
- **Notice says the launcher needs pop-launcher:** step 2 was skipped, or `pop-launcher` is not in the `PATH` of the desktop session. Log out and in after installing.
- **Window search is empty:** the `pop_shell` plugin is missing, or Pop Shell owns the D-Bus name. Run the `busctl` check above.
- **Errors in the log:** run `pnpm run log` while opening the launcher.
