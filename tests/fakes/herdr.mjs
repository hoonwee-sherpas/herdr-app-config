// Fake "herdr" for tests: every function reads or records `host`, which a test
// sets up (host.reset() in beforeEach) and inspects afterwards.

const THEME_NAMES = ["background", "surface", "canvas", "chrome", "popover", "raised", "hover", "selected", "border",
  "input", "foreground", "muted", "dim", "accent", "accent_foreground", "solid", "solid_foreground", "selection",
  "working", "blocked", "done", "idle", "unknown", ...Array.from({ length: 16 }, (_, i) => `ansi${i}`)];
export const LIGHT = Object.fromEntries(THEME_NAMES.map((n) => [n, "#f4f4f4"]));
Object.assign(LIGHT, { background: "#ffffff", foreground: "#1e1e1e" });
export const DARK = Object.fromEntries(THEME_NAMES.map((n) => [n, "#202020"]));
Object.assign(DARK, { background: "#16181d", foreground: "#e6e6e6" });

function waiter(list) {
  return new Promise((resolve) => list.push(resolve));
}

export const host = {
  reset() {
    Object.assign(this, {
      spaces: [], panes: [], agents: [], terminals: [], machines: [], focused: null,
      layout: { id: "root", type: "row", children: [] },
      theme: { ...LIGHT }, settings: { zoom: 1 }, window: { active: true, platform: "macos" },
      props: {}, shared: {}, keys: [], home: "/home/test", appHome: "/app",
      runs: [], notices: [], overlays: [], closedOverlays: [], execs: [], agentOrder: null,
      files: new Map(), watchers: [], commands: [],
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      hc: async () => ({ code: 0, stdout: "{}", stderr: "" }),
    });
  },
  /** Wakes every watchFolder() waiting, as if files changed. */
  fireWatch(paths = []) { const w = this.watchers.splice(0); for (const r of w) r(paths); },
  /** Delivers a command to nextCommand(). */
  command(c) { const w = this.commands.splice(0); for (const r of w) r(c); },
  ran(name) { return this.runs.filter(([n]) => n === name).map(([, a]) => a); },
};
host.reset();

export const spaces = () => host.spaces;
export const panes = () => host.panes;
export const agents = () => host.agents;
export const terminals = () => host.terminals;
export const machines = () => host.machines;
export const focused = () => host.focused;
export const layout = () => host.layout;
export const theme = () => host.theme;
export const settings = () => host.settings;
export const window = () => host.window;
export const keys = () => host.keys;
export const props = () => host.props;
export const home = () => host.home;
export const appHome = () => host.appHome;
export const shared = (k) => host.shared[k];
export const setShared = (k, v) => { host.shared[k] = v; return null; };
export const run = (name, args) => { host.runs.push([name, args]); return null; };
export const openOverlay = (o) => { host.overlays.push(o); return null; };
export const closeOverlay = (o) => { host.closedOverlays.push(o); return null; };
export const setAgentOrder = (list) => { host.agentOrder = list; return null; };
export const exec = (cmd, args = [], options) => { host.execs.push([cmd, args, options]); return host.exec(cmd, args, options); };
export const hc = (args) => host.hc(args);
export const readTextFile = async (path) => host.files.get(path) ?? null;
export async function writeTextFile(path, text, expected) {
  if ((host.files.get(path) ?? null) !== expected) throw new Error("stale snapshot");
  host.files.set(path, text);
  return null;
}
export const watchFolder = () => waiter(host.watchers);
export const nextCommand = () => waiter(host.commands);
export const playSound = () => null;
export const notify = (n) => { host.notices.push(n); return `n${host.notices.length}`; };
export const pickFolder = async () => null;
export const knownAgents = async () => [];
export const themes = () => [];
export const fonts = () => [];
