// A stand-in for gpui-kit elements: every builder call is recorded and returns
// the same element, so a test can walk the tree a mod's render() describes and
// fire the handlers it attached (on_click, on_mouse_down:left, on_key_down…).

const OWN = new Set(["kind", "arg", "props", "calls", "kids", "handlers"]);

export function el(kind, arg) {
  const target = { kind, arg, props: {}, calls: [], kids: [], handlers: {} };
  const proxy = new Proxy(target, {
    get(t, name) {
      if (OWN.has(name)) return t[name];
      if (name === "then" || typeof name === "symbol") return undefined;
      return (...args) => {
        t.calls.push([name, args]);
        if (name === "child") { if (args[0] != null && args[0] !== false) t.kids.push(args[0]); }
        else if (name === "children") { for (const k of args[0] ?? []) if (k != null && k !== false) t.kids.push(k); }
        else if (name === "when") { if (args[0]) args[1](proxy); }
        else if (name.startsWith("on_")) {
          const fn = args.at(-1);
          t.handlers[args.length > 1 ? `${name}:${args[0]}` : name] = fn;
        } else t.props[name] = args.length <= 1 ? args[0] : args;
        return proxy;
      };
    },
  });
  return proxy;
}

export const isEl = (x) => x && typeof x === "object" && Array.isArray(x.kids) && "kind" in x;

export function* walk(root) {
  if (!isEl(root)) return;
  yield root;
  for (const k of root.kids) yield* walk(k);
}

/** All text in an element and its children, joined by spaces. */
export function text(root) {
  if (typeof root === "string" || typeof root === "number") return String(root);
  if (!isEl(root)) return "";
  return root.kids.map(text).filter(Boolean).join(" ");
}

export const byId = (root, id) => [...walk(root)].find((e) => e.props.id === id) ?? null;
export const all = (root, pred) => [...walk(root)].filter(pred);
