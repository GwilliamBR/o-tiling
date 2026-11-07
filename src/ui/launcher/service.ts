import * as utils from '../../utils/utils.js';
import * as log from '../../utils/log.js';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type * as JsonIPC from './protocol.js';

/** Sends requests to the pop-launcher process and reads its JSON responses asynchronously.
 *
 * `exit()` must be called before dropping the service.
 */
export class LauncherService {
    private ipc: utils.AsyncIPC;

    constructor(ipc: utils.AsyncIPC, callback: (response: JsonIPC.Response) => void) {
        this.ipc = ipc;

        const read_next = (stdout: Gio.DataInputStream, result: Gio.AsyncResult) => {
            try {
                const [bytes] = stdout.read_line_finish(result);
                if (!bytes) return;

                callback(JSON.parse(new TextDecoder().decode(bytes)));
                this.ipc.stdout.read_line_async(0, this.ipc.cancellable, read_next);
            } catch (why) {
                if ((why as GLib.Error).matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                log.error(`failed to read response from pop-launcher: ${why}`);
            }
        };

        this.ipc.stdout.read_line_async(0, this.ipc.cancellable, read_next);
    }

    activate(id: number) {
        this.send({ Activate: id });
    }

    activate_context(id: number, context: number) {
        this.send({ ActivateContext: { id, context } });
    }

    complete(id: number) {
        this.send({ Complete: id });
    }

    context(id: number) {
        this.send({ Context: id });
    }

    query(search: string) {
        this.send({ Search: search });
    }

    quit(id: number) {
        this.send({ Quit: id });
    }

    /** Asks pop-launcher to exit, then closes the pipes once pending I/O has drained. */
    exit() {
        this.send('Exit');
        this.ipc.cancellable.cancel();
        const { stdin, stdout } = this.ipc;

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (stdout.has_pending() || stdin.has_pending()) return GLib.SOURCE_CONTINUE;

            for (const stream of [stdin, stdout]) {
                try {
                    stream.close(null);
                } catch (why) {
                    log.error(`failed to close pop-launcher stream: ${why}`);
                }
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    private send(request: string | object) {
        try {
            this.ipc.stdin.write_all(JSON.stringify(request) + '\n', null);
        } catch (why) {
            log.error(`failed to send request to pop-launcher: ${why}`);
        }
    }
}
