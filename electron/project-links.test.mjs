import test from "node:test";
import assert from "node:assert/strict";
import { isRegisteredProjectLink } from "./project-links.mjs";

test("Desktop opens exact saved artifacts and project PRs without widening the login allowlist", () => {
  const artifacts = {
    items: [
      { kind: "preview", target: "http://127.0.0.1:5132/" },
      { kind: "tool", target: "https://example.com/my-tool" },
    ],
  };
  const projects = {
    items: [
      { pullRequests: [{ url: "https://github.com/owner/repo/pull/1" }] },
    ],
  };
  for (const url of [
    "http://127.0.0.1:5132/",
    "https://example.com/my-tool",
    "https://github.com/owner/repo/pull/1",
  ])
    assert(isRegisteredProjectLink(url, artifacts, projects));
  for (const url of [
    "http://127.0.0.1:5132/admin",
    "https://example.com/",
    "https://github.com/owner/repo/pull/2",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "http://169.254.169.254/",
  ])
    assert(!isRegisteredProjectLink(url, artifacts, projects));
  for (const target of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:secret@example.com/",
  ])
    assert(
      !isRegisteredProjectLink(
        target,
        { items: [{ kind: "preview", target }] },
        projects,
      ),
    );
});
