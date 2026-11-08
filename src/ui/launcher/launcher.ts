import * as search_dialog from './search_dialog.js';
import * as utils from '../../utils/utils.js';
import * as log from '../../utils/log.js';
import { LauncherService } from './service.js';

import type { Ext } from '../../extension.js';
import type * as JsonIPC from './protocol.js';

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix?version=2.0';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const app_sys = Shell.AppSystem.get_default();

const CLIPBOARD = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

const RIGHT_MOUSE_BUTTON = 3;
const LAUNCHER_COMMAND = 'pop-launcher';

interface ResultEntry {
    result: JsonIPC.SearchResult;
    menu: PopupMenu.PopupMenu;
}

/** Application launcher, window switcher, and calculator backed by the pop-launcher service. */
export class Launcher extends search_dialog.SearchDialog {
    private ext: Ext;
    private results = new Map<number, ResultEntry>();
    private results_array: Array<ResultEntry> = [];
    private service: LauncherService | null = null;
    private append_id: number | null = null;
    private active_menu: PopupMenu.PopupMenu | null = null;
    private opened = false;
    private current_accent_class = '';
    private settings_signal_ids: number[] = [];

    constructor(ext: Ext) {
        super();

        this.ext = ext;

        this.dialog.dialogLayout._dialog.x_align = Clutter.ActorAlign.CENTER;
        this.dialog.dialogLayout._dialog.y_align = Clutter.ActorAlign.CENTER;

        this.sync_appearance();

        if (this.ext.settings.int) {
            const int = this.ext.settings.int;
            this.settings_signal_ids.push(
                int.connect('changed::color-scheme', () => this.sync_appearance()),
                int.connect('changed::gtk-theme', () => this.sync_appearance()),
                int.connect('changed::accent-color', () => this.sync_appearance()),
            );
        }

        this.cancel = () => {
            ext.overlay.visible = false;
            this.stop_service();
            this.opened = false;
        };

        this.search = (pattern: string) => this.service?.query(pattern);

        this.select = (id: number) => {
            ext.overlay.visible = false;

            const entry = this.results_array[id];
            const entity = entry?.result.window;
            if (!entity) return;

            const win = ext.windows.get(entity);
            if (!win || win.workspace_id() !== ext.active_workspace()) return;

            ext.set_overlay(win.rect());
            ext.overlay.visible = true;
        };

        this.activate_id = (id: number) => {
            ext.overlay.visible = false;

            const entry = this.results_array[id];
            if (entry) this.service?.activate(entry.result.id);
        };

        this.complete = () => {
            const entry = this.results_array[this.active_id];
            if (entry) this.service?.complete(entry.result.id);
        };

        this.quit = (id: number) => {
            const entry = this.results_array[id];
            if (entry) this.service?.quit(entry.result.id);
        };

        this.copy = (id: number) => {
            const result = this.results_array[id]?.result;
            if (!result) return;

            const text = result.description || result.name;
            if (text) CLIPBOARD.set_text(CLIPBOARD_TYPE, text);
        };
    }

    is_open(): boolean {
        return this.dialog.is_visible();
    }

    close() {
        this.ext.overlay.visible = false;
        super.close();
    }

    open(ext: Ext) {
        ext.tiler.exit(ext);

        if (this.is_open()) return;

        if (!ext.settings.fullscreen_launcher() && ext.focus_window()?.meta.is_fullscreen()) return;

        this.sync_appearance();

        const currentMonitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
        if (currentMonitor) {
            (this.dialog as any)._monitorConstraint.index = currentMonitor.index;
            this.set_dialog_width(currentMonitor.width);
        }

        if (!this.open_dialog()) {
            this.clear();
            this.cancel();
            this.close();
            return;
        }

        this.opened = true;
        this.cleanup();

        if (!this.start_service()) {
            this.close();
            Main.notify('O-tiling', `Launcher needs '${LAUNCHER_COMMAND}'. Install it and try again.`);
            return;
        }

        this.search('');
    }

    sync_appearance() {
        const is_dark = this.ext.settings.is_dark();
        if (is_dark) {
            this.dialog.remove_style_class_name('light');
            this.dialog.add_style_class_name('dark');
        } else {
            this.dialog.remove_style_class_name('dark');
            this.dialog.add_style_class_name('light');
        }

        const accent_name = this.ext.settings.get_system_accent_name();
        if (this.current_accent_class) {
            this.dialog.remove_style_class_name(this.current_accent_class);
        }
        this.current_accent_class = `accent-${accent_name}`;
        this.dialog.add_style_class_name(this.current_accent_class);
    }

    stop_service() {
        if (this.service === null) return;

        log.info('stopping pop-launcher service');
        this.service.exit();
        this.service = null;
    }

    destroy() {
        if (this.ext.settings.int) {
            for (const id of this.settings_signal_ids) {
                this.ext.settings.int.disconnect(id);
            }
        }
        this.settings_signal_ids = [];
        this.stop_service();
        this.remove_pending_append();
        for (const { menu } of this.results_array) menu.destroy();
        super.destroy();
    }

    private start_service(): boolean {
        if (this.service !== null) return true;

        log.debug('starting pop-launcher service');
        const ipc = utils.async_process_ipc([LAUNCHER_COMMAND]);
        if (!ipc) return false;

        this.service = new LauncherService(ipc, (response) => this.on_response(response));
        return true;
    }

    private on_response(response: JsonIPC.Response) {
        if (response === 'Close') {
            this.close();
        } else if ('Update' in response) {
            this.show_results(response.Update);
        } else if ('Fill' in response) {
            this.set_text(response.Fill);
        } else if ('DesktopEntry' in response) {
            this.launch_desktop_entry(response.DesktopEntry);
            this.close();
        } else if ('Context' in response) {
            this.show_context_menu(response.Context.id, response.Context.options);
        } else {
            log.error(`unknown response from pop-launcher: ${JSON.stringify(response)}`);
        }
    }

    clear() {
        for (const { menu } of this.results_array) menu.destroy();
        this.active_menu = null;
        this.results.clear();
        this.results_array.splice(0);
        super.clear();
    }

    private remove_pending_append() {
        if (this.append_id === null) return;
        GLib.source_remove(this.append_id);
        this.append_id = null;
    }

    /** Replaces the list with new results, adding one row per idle tick to keep typing responsive. */
    private show_results(items: Array<JsonIPC.SearchResult>) {
        this.clear();
        this.remove_pending_append();

        if (items.length === 0) {
            this.cleanup();
            return;
        }

        const queue = [...items];

        this.append_id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            const item = queue.shift();
            if (item) this.append_result(item);

            if (queue.length > 0) return GLib.SOURCE_CONTINUE;

            this.append_id = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    private append_result(item: JsonIPC.SearchResult) {
        const option = new search_dialog.SearchOption(
            item.name,
            item.description,
            item.category_icon ?? null,
            item.icon ?? null,
            this.icon_size(),
        );

        const menu = this.attach_context_menu(option.widget, item.id);

        this.append_search_option(option);

        const entry = { result: item, menu };
        this.results.set(item.id, entry);
        this.results_array.push(entry);
    }

    private attach_context_menu(widget: St.Button, id: number): PopupMenu.PopupMenu {
        const menu = new PopupMenu.PopupMenu(widget, 0.0, St.Side.TOP);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        menu.actor.add_style_class_name('panel-menu');

        widget.connect('button-press-event', (_widget: St.Button, event: Clutter.Event) => {
            if (event.get_button() !== RIGHT_MOUSE_BUTTON) return;

            this.active_menu?.actor.hide();
            this.active_menu = menu;
            this.service?.context(id);
        });

        return menu;
    }

    private show_context_menu(id: number, options: Array<JsonIPC.ContextOption>) {
        const entry = this.results.get(id);
        if (!entry) {
            log.error(`pop-launcher sent a context menu for unknown result ${id}`);
            return;
        }

        entry.menu.removeAll();

        for (const option of options) {
            const item = new PopupMenu.PopupMenuItem(option.name);
            item.connect('activate', () => this.service?.activate_context(id, option.id));
            entry.menu.addMenuItem(item);
        }

        if (options.length > 0) entry.menu.toggle();
    }

    private launch_desktop_entry(entry: JsonIPC.DesktopEntry) {
        const desktop_entry_id = entry.path.substring(entry.path.indexOf('/applications/') + '/applications/'.length).replace('/', '-');
        const gpu = entry.gpu_preference === 'Default' ? Shell.AppLaunchGpu.DEFAULT : Shell.AppLaunchGpu.DISCRETE;

        log.debug(`launching desktop entry: ${desktop_entry_id}`);

        const app = app_sys.lookup_desktop_wmclass(desktop_entry_id) ?? app_sys.lookup_app(desktop_entry_id);

        if (!app) {
            this.launch_with_app_info(entry.path);
            return;
        }

        try {
            app.launch(0, -1, gpu);
        } catch (why) {
            log.error(`failed to launch application: ${why}`);
            return;
        }

        // gnome-control-center does not raise an existing window on launch.
        if (app.get_app_info()?.get_executable() === 'gnome-control-center') this.raise_control_center();
    }

    private launch_with_app_info(path: string) {
        log.error(`GNOME Shell cannot find a desktop entry for ${path}, using GioUnix.DesktopAppInfo instead`);

        const info = GioUnix.DesktopAppInfo.new_from_filename(path);
        if (!info) {
            log.error(`could not find desktop entry for ${path}`);
            return;
        }

        try {
            info.launch([], null);
        } catch (why) {
            log.error(`${path}: could not launch by app info: ${why}`);
        }
    }

    private raise_control_center() {
        const app = app_sys.lookup_app('gnome-control-center.desktop');
        if (!app) return;

        app.activate();

        const window = app.get_windows()[0];
        if (window) window.get_workspace().activate_with_focus(window, global.get_current_time());
    }
}
