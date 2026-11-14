import test from "node:test";
import assert from "node:assert/strict";
import { buildingPullRequests, createArtifactView } from "../public/world-artifact-view.js";

function project() {
  return {
    id: "project-one",
    jobs: [
      { id: "feature-a", repoId: "repo-a", kind: "implement", status: "done", commit: "a" },
      { id: "feature-next", repoId: "repo-a", kind: "implement", status: "done", commit: "next" },
      { id: "verify-a", repoId: "repo-a", kind: "verify", dependencies: ["feature-a"] },
      { id: "publish-a", repoId: "repo-a", kind: "publish", status: "done", dependencies: ["verify-a"], url: "https://github.com/test/repo-a/pull/1" },
      { id: "feature-b", repoId: "repo-b", kind: "implement", status: "done", commit: "b" },
      { id: "publish-b", repoId: "repo-b", kind: "publish", status: "done", dependencies: ["feature-b"], url: "https://github.com/test/repo-b/pull/1" },
    ],
    pullRequests: [
      { repoId: "repo-a", url: "https://github.com/test/repo-a/pull/1" },
      { repoId: "repo-b", url: "https://github.com/test/repo-b/pull/1" },
      { url: "https://github.com/test/unknown/pull/1" },
    ],
  };
}

test("repository buildings show only their own PRs, including saved older PRs", () => {
  const p = project();
  p.pullRequests.push({ repoId: "repo-a", url: "https://github.com/test/repo-a/pull/2" });
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a" }), [p.pullRequests[0], p.pullRequests[3]]);
  assert.deepEqual(buildingPullRequests(p, {}), []);
});

test("a feature only opens a published PR whose dependency chain contains that feature", () => {
  const p = project();
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a", jobId: "feature-a" }), [p.pullRequests[0]]);
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a", jobId: "feature-next" }), []);
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-b", jobId: "feature-a" }), []);
  p.jobs.find((job) => job.id === "publish-a").status = "blocked";
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a", jobId: "feature-a" }), []);
});

test("incomplete or cyclic saved dependencies do not invent feature PR ownership", () => {
  const p = project();
  p.jobs.find((job) => job.id === "verify-a").dependencies = ["publish-a", "missing"];
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a", jobId: "feature-a" }), []);
  p.jobs.find((job) => job.id === "verify-a").dependencies.push("feature-a");
  p.pullRequests.push({ ...p.pullRequests[0] });
  assert.deepEqual(buildingPullRequests(p, { repoId: "repo-a", jobId: "feature-a" }), [p.pullRequests[0]]);
});

test("the building view renders only links belonging to the selected work", (t) => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener() {}
  }
  const previous = new Map(["document", "window"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    body: new Element("body"), createElement: (tag) => new Element(tag),
  }});
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const view = createArtifactView({ demo: true, getWorld: () => ({ artifacts: [] }) });
  const container = new Element("div");
  view.building(container, project(), { id: "feature-a", repoId: "repo-a", jobId: "feature-a" });
  assert.deepEqual(container.children.filter((child) => child.tagName === "a").map((link) => link.href),
    ["https://github.com/test/repo-a/pull/1"]);
});
