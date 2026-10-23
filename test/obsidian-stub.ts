// Minimal stand-in for the "obsidian" module so pure modules can be tested in Node.
export class PluginSettingTab {}
export class Setting {}
export type App = unknown;
export class TFile {}
export const Platform = { isDesktopApp: true };
export class Modal { constructor(public app?: unknown) {} open() {} close() {} }
export class Notice { constructor(_m?: unknown, _t?: number) {} hide() {} }
export const setIcon = (_el: unknown, _name: string): void => undefined;
export const getIcon = (_name: string): null => null;
export const getIconIds = (): string[] => [];
