/** Wire types of the pop-launcher JSON protocol. */

export interface SearchResult {
    id: number;
    name: string;
    description: string;
    icon?: IconSource;
    category_icon?: IconSource;
    window?: [number, number];
}

export type IconSource = { Name: string } | { Mime: string } | { Window: [number, number] };

export interface ContextOption {
    id: number;
    name: string;
}

export interface DesktopEntry {
    path: string;
    gpu_preference: 'Default' | 'NonDefault';
}

export type Response =
    | 'Close'
    | { Update: Array<SearchResult> }
    | { Fill: string }
    | { DesktopEntry: DesktopEntry }
    | { Context: { id: number; options: Array<ContextOption> } };
