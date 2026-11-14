import path from "node:path";
import { readFile } from "node:fs/promises";

export function isRegisteredProjectLink(value, artifacts, projects) {
  if (typeof value !== "string" || value.length > 8192) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    return false;
  return (
    (artifacts?.items || []).some(
      (item) =>
        ["preview", "tool"].includes(item.kind) && item.target === value,
    ) ||
    (url.protocol === "https:" &&
      url.hostname === "github.com" &&
      (projects?.items || []).some((project) =>
        (project.pullRequests || []).some((pr) => pr.url === value),
      ))
  );
}
export async function registeredProjectLink(directory, url) {
  const load = async (name) => {
    try {
      return JSON.parse(await readFile(path.join(directory, name), "utf8"));
    } catch {
      return null;
    }
  };
  const [artifacts, projects] = await Promise.all([
    load("world-artifacts.json"),
    load("projects.json"),
  ]);
  return isRegisteredProjectLink(url, artifacts, projects);
}
