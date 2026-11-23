import {worldText} from './i18n-world.js';
export const jobLabel = (job) =>
  (({
    prepare: worldText("準備"),
    plan: worldText("調査"),
    implement: worldText("建築"),
    verify: worldText("検証"),
    publish: worldText("PR作成"),
  })[job.kind] || worldText("作業")) +
  " · " +
  ({
    queued: worldText("順番待ち"),
    preparing: worldText("準備中"),
    running: job.retries ? worldText("修理中") : worldText("作業中"),
    blocked: worldText("相談待ち"),
    paused: worldText("休止中"),
    done: worldText("完了"),
  }[job.status] || job.status);
export function projectBuildings(project) {
  const repos = project.repositories.map((repo, index) => {
    const jobs = project.jobs.filter((job) => job.repoId === repo.id);
    return {
      id: repo.id,
      repoId: repo.id,
      name: repo.name,
      x: 240 + (index % 2) * 480,
      y: 220 + Math.floor(index / 2) * 170,
      seed: project.id + repo.id,
      stage: jobs.some((j) => j.kind === "publish" && j.status === "done")
        ? "finished"
        : jobs.some(
              (j) =>
                j.kind === "verify" && ["running", "done"].includes(j.status),
            )
          ? "testing"
          : jobs.some((j) => j.kind === "implement" && j.status !== "queued")
            ? "building"
            : "planned",
      activity: jobs.some((j) => ["preparing", "running"].includes(j.status))
        ? "working"
        : "idle",
    };
  });
  const features = project.jobs
    .filter((j) => j.kind === "implement")
    .map((job, i) => ({
      id: job.id,
      repoId: job.repoId,
      jobId: job.id,
      name: job.title,
      x: 95 + (i % 4) * 210,
      y: 480 + Math.floor(i / 4) * 90,
      seed: project.id + job.id,
      stage:
        job.status === "done"
          ? "finished"
          : job.status === "queued"
            ? "planned"
            : "building",
      activity: job.status === "running" ? "working" : "idle",
    }));
  return [...repos, ...features];
}
export function buildingObstacles(places, projects, buildingsFor=projectBuildings) {
  return projects.flatMap((p) => [
    ...buildingsFor(p).map((b) => ({
      left: places[p.id].x + b.x - 55,
      right: places[p.id].x + b.x + 55,
      top: places[p.id].y + b.y - 65,
      bottom: places[p.id].y + b.y + 12,
    })),
  ]);
}
// Use the rendered building footprints, including room for scaffolding and a
// person's body, when placing residents or choosing where two people can face.
export function sceneBuildingObstacles(scene, clearance = 12) {
  // Decorative homes have real walls too. Their shared renderer uses a
  // 38×28 body centered ten units behind the cottage's ground anchor.
  const cottages=(scene.scenery||[]).filter(item=>item.kind==='cottage').map(item=>({
    x:item.x,y:item.y-10,width:38,depth:28,
  }));
  return [...(scene.buildings || []),...cottages].map(building => ({
    left: building.x - building.width / 2 - clearance,
    right: building.x + building.width / 2 + clearance,
    top: building.y - building.depth / 2 - clearance,
    bottom: building.y + building.depth / 2 + clearance,
  }));
}
export const facilities = [
  { id: "tavern", get name(){return worldText("旅立ちの酒場");}, get host(){return worldText("酒場の主人");}, x: -420, y: 340 },
  { id: "castle", get name(){return worldText("王城");}, get host(){return worldText("王様");}, x: 500, y: -620 },
  {
    id: "weapon",
    get name(){return worldText("スキルの武器屋");},
    get host(){return worldText("武器屋の店主");},
    x: -420,
    y: -240,
  },
];
