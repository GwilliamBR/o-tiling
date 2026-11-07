import Gio from 'gi://Gio';
import * as log from '../utils/log.js';

/**
 * pop-launcher's "Pop Shell Windows" plugin talks to this D-Bus name. Exporting it as well lets
 * the window search work without changes to pop-launcher. If Pop Shell already owns the name,
 * this one is simply not acquired.
 */
const POP_SHELL_BUS_NAME = 'com.System76.PopShell';
const POP_SHELL_PATH = '/com/System76/PopShell';

const OWN_BUS_NAME = 'org.gnome.shell.extensions.OTiling';
const OWN_PATH = '/org/gnome/shell/extensions/OTiling';

function interface_xml(name: string): string {
    return `<node>
  <interface name="${name}">
    <method name="FocusLeft"/>
    <method name="FocusRight"/>
    <method name="FocusUp"/>
    <method name="FocusDown"/>
    <method name="Launcher"/>
    <method name="WindowFocus">
        <arg type="(uu)" direction="in" name="window"/>
    </method>
    <method name="WindowHighlight">
        <arg type="(uu)" direction="in" name="window"/>
    </method>
    <method name="WindowList">
        <arg type="a((uu)sss)" direction="out" name="args"/>
    </method>
    <method name="WindowQuit">
        <arg type="(uu)" direction="in" name="window"/>
    </method>
  </interface>
</node>`;
}

interface Export {
    object: Gio.DBusExportedObject;
    owner_id: number;
}

export class Service {
    private exports: Array<Export> = [];

    FocusLeft: () => void = () => {};
    FocusRight: () => void = () => {};
    FocusUp: () => void = () => {};
    FocusDown: () => void = () => {};
    Launcher: () => void = () => {};
    WindowFocus: (window: [number, number]) => void = () => {};
    WindowHighlight: (window: [number, number]) => void = () => {};
    WindowList: () => Array<[[number, number], string, string, string]> = () => [];
    WindowQuit: (window: [number, number]) => void = () => {};

    constructor() {
        this.export_as(OWN_BUS_NAME, OWN_PATH);
        this.export_as(POP_SHELL_BUS_NAME, POP_SHELL_PATH);
    }

    private export_as(bus_name: string, path: string) {
        const object = Gio.DBusExportedObject.wrapJSObject(interface_xml(bus_name), this);

        const owner_id = Gio.bus_own_name(
            Gio.BusType.SESSION,
            bus_name,
            Gio.BusNameOwnerFlags.NONE,
            (connection: Gio.DBusConnection) => object.export(connection, path),
            null,
            () => log.debug(`D-Bus name ${bus_name} is not available`),
        );

        this.exports.push({ object, owner_id });
    }

    destroy() {
        for (const { object, owner_id } of this.exports.splice(0)) {
            Gio.bus_unown_name(owner_id);
            object.unexport();
        }
    }
}
