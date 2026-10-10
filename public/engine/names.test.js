import test from "node:test";
import assert from "node:assert/strict";
import { checkName, cleanName, defaultName, ADJECTIVES, ANIMALS, NAME_MAX } from "./names.js";
import { localPair } from "./channel.js";
import { openSession } from "./session.js";

const ZWNJ = String.fromCodePoint(0x200c);
const cyr = (code) => String.fromCodePoint(code);
const problem = (name) => checkName(name).problem;
const DEFAULT = /^[A-Z][a-z]+ [A-Z][a-z]+$/;

test("names in many scripts are allowed as typed", () => {
  const names = [
    "Ada", "Bo", "Mary-Jane", "D'Angelo", "x_y.z", "Player 1", "Dr. Who", "Ana L.",
    "Zoë", "José María", "Đặng Thị", "Ольга", "Ελένη", "فائزه", `علی${ZWNJ}رضا`, "דנה",
    "李小龙", "さくら", "김민준", "नमस्ते", "สมชาย", "٣ أحمد",
  ];
  for (const name of names) assert.deepEqual(checkName(name), { name, problem: null }, name);
});

test("ordinary names that contain a blocked word are allowed", () => {
  for (const name of ["Nazir", "Peacock", "Hancock", "Essex", "Sussex", "Therapist", "Raccoon", "Spicy", "Dickens",
    "Cassandra", "Titan", "Cumberbatch", "Matsushita", "Scott", "Grape", "Classic", "Sam Ash", "Assam", "Hello"]) {
    assert.equal(problem(name), null, name);
  }
});

test("offensive words are blocked in any case, inside other words and spelled out", () => {
  for (const name of ["fuck", "FuCk", "fuckface", "MotherFucker", "f.u.c.k", "f u c k", "f-u-c-k", "fuuuuck",
    "shit", "shitty", "Bullshit", "ass", "asses", "BigAss", "big ass", "a s s", "Nazi", "hitler", "kys", "k.y.s",
    "bitch", "slut", "retard", "porno"]) {
    assert.equal(problem(name), "word", name);
  }
});

test("look-alike swaps don't get past the blocklist", () => {
  const swapped = ["sh1t", "5h1t", "$hit", "b1tch", "c0ck",
    "4ss", "a55", "n4zi", "H1tl3r", "s1ut", "sIut", "p0rn", "rap1st", "dumb4ss", "fück"];
  for (const name of swapped) assert.equal(problem(name), "word", name);
  // Cyrillic letters that look Latin: f, u, Cyrillic es (c), k.
  assert.equal(problem(`fu${cyr(0x0441)}k`), "word");
  assert.equal(problem(`${cyr(0x0430)}ss`), "word");
  // A swap that spells a harmless word stays allowed.
  assert.equal(problem("sl0t"), null);
});

test("links and @handles are blocked", () => {
  for (const name of ["evil.com", "EVIL.COM", "evil . com", "www.x", "bit.ly", "discord.gg", "http://a", "me@x", "@bo", "x dot com"]) {
    assert.equal(problem(name), "link", name);
  }
  assert.equal(problem("Mia.K"), null);
  assert.equal(problem("Jo.Me"), null);
});

test("only letters, digits, spaces and . _ - ' are allowed", () => {
  for (const name of ["<b>", "a+b", "Bo!", "Bo?", "a/b", "a#1", "a,b", "😀", "Bo 🎲", "a\"b", `a${cyr(0x202e)}b`]) {
    assert.equal(problem(name), "chars", name);
  }
  assert.equal(problem(`a${ZWNJ}b`), null, "zero-width non-joiner, used inside Persian words");
});

test("names are trimmed, cleaned of control characters and capped at 20 characters", () => {
  assert.equal(NAME_MAX, 20);
  assert.deepEqual(checkName("  Bo  "), { name: "Bo", problem: null });
  assert.deepEqual(checkName(`B${cyr(0)}o${cyr(7)}${cyr(0x9b)}`), { name: "Bo", problem: null });
  assert.deepEqual(checkName("Bo \t\n Cy"), { name: "Bo Cy", problem: null });
  assert.deepEqual(checkName(`O${cyr(0x2019)}Brien`), { name: "O'Brien", problem: null }, "curly apostrophe");
  assert.equal(checkName("a".repeat(30)).name, "a".repeat(20));
  assert.equal(checkName(`${"a".repeat(19)} b`).name, "a".repeat(19), "no trailing space after the cut");
  // Characters, not UTF-16 units: a letter outside the BMP is never cut in half.
  const math = String.fromCodePoint(0x1d49c);
  assert.deepEqual(checkName(math.repeat(25)), { name: math.repeat(20), problem: null });
  for (const empty of [undefined, null, "", "   ", cyr(1)]) assert.deepEqual(checkName(empty), { name: "", problem: null });
  assert.equal(checkName(12345).name, "12345");
});

test("cleanName keeps a good name and swaps a blocked or empty one for the default", () => {
  assert.equal(cleanName(" Ada ", "Player"), "Ada");
  assert.equal(cleanName("sh1t", "Player"), "Player");
  assert.equal(cleanName("evil.com", "Friend"), "Friend");
  assert.equal(cleanName("Bo!", "Player"), "Player");
  assert.equal(cleanName("", "Player"), "Player");
  assert.equal(cleanName({ toString: () => "Cy" }, "Player"), "Cy");
});

test("the peer-to-peer handshake applies the same rule, so a modified page can't skip the server's", async () => {
  const [x, y] = localPair();
  const [host, guest] = await Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "evil.com", game: "race" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "sh1t", game: "race" }),
  ]);
  const [hostSees, guestSees] = [host, guest].map((s) => s.players.map((p) => p.name));
  assert.equal(hostSees[0], "evil.com");
  assert.match(hostSees[1], DEFAULT, "the host cleans the guest's $hello into a default name");
  assert.match(guestSees[0], DEFAULT, "guests clean the host's $start");
  assert.equal(guestSees[1], hostSees[1]);
  host.leave();
});

test("every default name is two capitalised words that pass the nickname rules and fit 20 characters", () => {
  for (const adjective of ADJECTIVES) {
    for (const animal of ANIMALS) {
      const name = `${adjective} ${animal}`;
      assert.match(name, DEFAULT);
      assert.ok(name.length <= NAME_MAX, name);
      assert.deepEqual(checkName(name), { name, problem: null });
    }
  }
  for (let i = 0; i < 1000; i++) {
    const [adjective, animal] = defaultName().split(" ");
    assert.ok(ADJECTIVES.includes(adjective) && ANIMALS.includes(animal));
  }
});
