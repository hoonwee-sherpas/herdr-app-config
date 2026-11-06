import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, serialize } from "../../mods/Sketch/main.js";

test("serialize writes one shape per line and parse reads it back", () => {
  const shapes = [{ id: "a", type: "rect", x: 0, y: 0, w: 10, h: 10 }, { id: "b", type: "arrow", from: "a", to: "a" }];
  const text = serialize(shapes);
  assert.equal(text.split("\n").filter((l) => l.trim().startsWith("{\"id\"")).length, 2);
  assert.deepEqual(parse(text), shapes);
  assert.equal(JSON.parse(text).version, 1);
});

test("parse accepts a bare list of shapes", () => {
  assert.deepEqual(parse('[{"id":"a","type":"text","x":1,"y":2,"text":"hi"}]'), [{ id: "a", type: "text", x: 1, y: 2, text: "hi" }]);
});

test("parse gives shapes without an id one, and drops entries without a type", () => {
  const out = parse('{"shapes":[{"type":"rect","x":0,"y":0,"w":1,"h":1},{"x":1},null,"junk"]}');
  assert.equal(out.length, 1);
  assert.match(out[0].id, /^s/);
});

test("parse rejects a file with no shapes list, and broken JSON", () => {
  assert.throws(() => parse('{"version":1}'), /shapes/);
  assert.throws(() => parse("{nope"));
});
