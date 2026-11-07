import * as Lib from '../../utils/lib.js';
import * as rect from '../../utils/rectangle.js';

import type * as JsonIPC from './protocol.js';

import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Gdk from 'gi://Gdk';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ModalDialog } from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const { wm } = Main;

const ICON_SIZE = 34;
const MIN_DIALOG_WIDTH = 640;
const KEY_REPEAT_DELAY_MS = 100;
const MAX_SHORTCUT_OPTIONS = 9;

/** Search box and result list shown by the launcher. Behavior is supplied through the callback fields. */
export class SearchDialog {
    dialog = new ModalDialog({
        styleClass: 'o-tiling-search modal-dialog',
        destroyOnClose: false,
        shellReactive: true,
        shouldFadeIn: false,
        shouldFadeOut: false,
    });

    active_id = 0;

    private entry: St.Entry;
    private list: St.BoxLayout;
    private text: Clutter.Text;
    private widgets: Array<St.Widget> = [];
    private scroller: St.ScrollView;
    private children_to_abandon: Array<Clutter.Actor> | null = null;
    private last_trigger = 0;
    private text_changed_id: number | null = null;

    activate_id: (index: number) => void = () => {};
    cancel: () => void = () => {};
    complete: () => void = () => {};
    search: (search: string) => void = () => {};
    select: (id: number) => void = () => {};
    quit: (id: number) => void = () => {};
    copy: (id: number) => void = () => {};

    constructor() {
        this.entry = new St.Entry({
            style_class: 'o-tiling-entry',
            can_focus: true,
            x_expand: true,
        });
        this.entry.set_hint_text("  Type to search apps, or type '?' for more options.");

        this.text = this.entry.get_clutter_text();
        this.dialog.setInitialKeyFocus(this.entry);

        this.text.connect('activate', () => this.activate_id(this.active_id));
        this.text.connect('text-changed', () => this.on_text_changed());
        this.text.connect('key-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            this.on_key_press(event);
        });

        this.list = new St.BoxLayout({ style_class: 'o-tiling-search-list', vertical: true });

        this.scroller = new St.ScrollView();
        this.scroller.add_child(this.list);

        this.dialog.contentLayout.add_child(this.entry);
        this.dialog.contentLayout.add_child(this.scroller);

        this.dialog.contentLayout.width = Math.max(Lib.current_monitor().width / 4, MIN_DIALOG_WIDTH);

        this.dialog.connect('event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const { width, height } = this.dialog.dialogLayout._dialog;
            const { x, y } = this.dialog.dialogLayout;
            const area = new rect.Rectangle([x, y, width, height]);

            const clicked_outside =
                this.dialog.visible &&
                event.type() === Clutter.EventType.BUTTON_PRESS &&
                !area.contains(Lib.cursor_rect());

            if (clicked_outside) this.dismiss();

            return Clutter.EVENT_PROPAGATE;
        });

        this.dialog.connect('closed', () => this.cancel());
    }

    get_text(): string {
        return this.text.get_text();
    }

    set_text(text: string) {
        this.text.set_text(text);
    }

    icon_size(): number {
        return ICON_SIZE;
    }

    /** Resets, closes, and notifies the owner that the dialog was dismissed by the user. */
    dismiss() {
        this.reset();
        this.close();
        this.cancel();
    }

    cleanup() {
        if (!this.children_to_abandon) return;

        for (const child of this.children_to_abandon) child.destroy();
        this.children_to_abandon = null;
    }

    clear() {
        this.cleanup();
        this.children_to_abandon = this.list.get_children();
        this.widgets = [];
        this.active_id = 0;
    }

    reset() {
        this.clear();
        this.text.set_text(null);
    }

    close() {
        this.reset();
        this.dialog.close();

        wm.allowKeybinding('overlay-key', Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
    }

    destroy() {
        if (this.text_changed_id !== null) GLib.source_remove(this.text_changed_id);
        this.text_changed_id = null;

        this.close();
        this.dialog.destroy();
    }

    protected open_dialog() {
        this.dialog.open();

        // Lets the Super key reach the Overview toggle, which closes this dialog.
        wm.allowKeybinding('overlay-key', Shell.ActionMode.ALL);
    }

    select_id(id: number) {
        this.widgets[this.active_id]?.remove_style_pseudo_class('select');
        this.active_id = id;
        this.highlight_selected();
    }

    append_search_option(option: SearchOption) {
        const id = this.widgets.length;

        if (id !== 0) this.list.add_child(Lib.separator());

        const { widget, shortcut } = option;

        if (id < MAX_SHORTCUT_OPTIONS) {
            shortcut.set_text(`Ctrl + ${id + 1}`);
            shortcut.show();
        } else {
            shortcut.hide();
        }

        const initial_cursor = Lib.cursor_rect();

        widget.connect('clicked', () => this.activate_id(id));
        widget.connect('notify::hover', () => {
            // Ignore hover caused by the list moving under a stationary cursor.
            const { x, y } = Lib.cursor_rect();
            if (x === initial_cursor.x && y === initial_cursor.y) return;
            this.select_id(id);
            this.select(id);
        });

        this.widgets.push(widget);
        this.list.add_child(widget);

        this.cleanup();

        this.list.show();
        this.scroller.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        if (id !== 0) return;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this.highlight_selected();
            this.select(0);
            return GLib.SOURCE_REMOVE;
        });
    }

    private highlight_selected() {
        const widget = this.widgets[this.active_id];
        if (!widget) return;

        widget.add_style_pseudo_class('select');

        // The widget may not be allocated yet.
        try {
            Util.ensureActorVisibleInScrollView(this.scroller, widget);
        } catch (_error) {
            // Highlight still applies; only the scroll-into-view step is skipped.
        }
    }

    private on_text_changed() {
        if (this.text_changed_id !== null) GLib.source_remove(this.text_changed_id);
        this.text_changed_id = null;

        const text = this.text.get_text().trim();

        const update = () => {
            this.clear();
            this.search(text);
        };

        if (text.length === 0) {
            update();
            return;
        }

        this.text_changed_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            this.text_changed_id = null;
            update();
            return GLib.SOURCE_REMOVE;
        });
    }

    private move_selection(step: 1 | -1) {
        const count = this.widgets.length;
        if (count === 0) return;
        this.select_id((this.active_id + step + count) % count);
    }

    private on_key_press(event: Clutter.Event) {
        const key = Gdk.keyval_name(Gdk.keyval_to_upper(event.get_key_symbol())) ?? '';
        const ctrl = Boolean(event.get_state() & Clutter.ModifierType.CONTROL_MASK);

        const is_down = key === 'Down' || (ctrl && (key === 'J' || key === 'N'));
        const is_up = key === 'Up' || key === 'ISO_Left_Tab' || (ctrl && (key === 'K' || key === 'P'));

        // Throttle held-down keys so the selection does not race past the user.
        if (event.get_flags() !== Clutter.EventFlags.NONE) {
            const now = global.get_current_time();
            if (now - this.last_trigger < KEY_REPEAT_DELAY_MS) return;
            this.last_trigger = now;

            if (is_up) this.move_selection(-1);
            else if (is_down) this.move_selection(1);
            else return;

            this.select(this.active_id);
            return;
        }

        this.last_trigger = global.get_current_time();

        if (key === 'Escape') {
            this.dismiss();
            return;
        }

        if (key === 'Tab') {
            this.complete();
            return;
        }

        if (is_up) {
            this.move_selection(-1);
        } else if (is_down) {
            this.move_selection(1);
        } else if (ctrl && /^[1-9]$/.test(key)) {
            this.activate_id(Number(key) - 1);
            return;
        } else if (ctrl && key === 'Q') {
            this.quit(this.active_id);
            return;
        } else if (key === 'Copy' || (ctrl && (key === 'C' || key === 'Insert'))) {
            // With text selected, behave as a normal copy.
            if (this.text.get_selection()) return;

            this.copy(this.active_id);
            this.close();
            this.cancel();
        }

        this.select(this.active_id);
    }
}

export class SearchOption {
    widget: St.Button;

    shortcut = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        style: 'padding-left: 6px;padding-right: 6px',
    });

    constructor(
        title: string,
        description: string | null,
        category_icon: JsonIPC.IconSource | null,
        icon: JsonIPC.IconSource | null,
        icon_size: number,
    ) {
        const layout = new St.BoxLayout({ x_expand: true });

        attach_icon(layout, category_icon, icon_size / 2);

        const label = new St.Label({ text: title });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        attach_icon(layout, icon, icon_size);

        const info_box = new St.BoxLayout({
            y_align: Clutter.ActorAlign.CENTER,
            vertical: true,
            x_expand: true,
        });
        info_box.add_child(label);

        if (description) {
            info_box.add_child(new St.Label({ text: description, style: 'font-size: small' }));
        }

        layout.add_child(info_box);
        layout.add_child(this.shortcut);

        this.widget = new St.Button({ style_class: 'o-tiling-search-element' });
        this.widget.set_child(layout);
    }
}

function attach_icon(layout: St.BoxLayout, icon: JsonIPC.IconSource | null, icon_size: number) {
    if (!icon) return;

    const generated = generate_icon(icon, icon_size);
    if (!generated) return;

    generated.set_y_align(Clutter.ActorAlign.CENTER);
    layout.add_child(generated);
}

function generate_icon(icon: JsonIPC.IconSource, icon_size: number): St.Icon | null {
    let app_icon: St.Icon;

    if ('Name' in icon) {
        const is_file = Gio.File.new_for_path(icon.Name).query_exists(null);
        app_icon = is_file
            ? new St.Icon({ gicon: Gio.icon_new_for_string(icon.Name), icon_size })
            : new St.Icon({ icon_name: icon.Name, icon_size });
    } else if ('Mime' in icon) {
        app_icon = new St.Icon({ gicon: Gio.content_type_get_icon(icon.Mime), icon_size });
    } else {
        return null;
    }

    app_icon.style_class = 'o-tiling-search-icon';
    return app_icon;
}
