import path from "node:path";
import { LocalStore } from "./local-store.mjs";
import {
  placeDistricts,
  affinity,
  districtRoute,
  worldRoads,
  topicNames,
} from "./public/world-geography.js";
import { residentReport, acknowledgeResidentReport } from "./public/world-dialogue.js";
import { WorldArtifacts } from "./world-artifacts.mjs";

export class WorldState extends LocalStore {
  constructor(
    directory,
    { getProjects, getChats, adventure, onChange = () => {} },
  ) {
    super(
      path.join(directory, "world.json"),
      {
        version: 1,
        revision: 0,
        layoutVersion: 1,
        places: {},
        links: {},
        visits: {},
        journeys: {},
      },
      onChange,
    );
    Object.assign(this, { getProjects, getChats, adventure });
    this.artifacts = new WorldArtifacts(directory, getProjects, onChange);
  }
  async load() {
    await super.load((value) => {
      if (
        value?.version !== 1 ||
        !value.places ||
        !value.visits ||
        !value.links ||
        !value.journeys
      )
        throw Error("世界の保存内容を確認してください。");
    });
    await this.artifacts.load();
    return this;
  }
  public() {
    return {
      ...super.public(),
      artifacts: this.artifacts?.public().items || [],
    };
  }
  chats() {
    return this.getChats().map((c) =>
      this.value.links[c.id]
        ? { ...c, project: { id: this.value.links[c.id] } }
        : c,
    );
  }
  observe(options = {}) {
    this.observing = (this.observing || Promise.resolve())
      .catch(() => {})
      .then(() => this.observeNow(options));
    return this.observing;
  }
  async observeNow({ migration = false } = {}) {
    const projects = this.getProjects(),
      chats = this.chats();
    const migrating =
      migration &&
      !Object.keys(this.value.places).length &&
      projects.length > 0;
    const places = migrating
      ? Object.fromEntries(
          projects.map((p, i) => [
            p.id,
            { x: (i % 2) * 1120, y: Math.floor(i / 2) * 780, evidence: [] },
          ]),
        )
      : placeDistricts(projects, chats, this.value.places);
    const journeys = { ...this.value.journeys };
    for (const chat of chats) {
      const from = chat.project?.id;
      if (!places[from] || journeys[chat.id]) continue;
      const related = Object.keys(places)
        .filter(
          (id) =>
            id !== from &&
            affinity(places[from].evidence, places[id].evidence) > 0,
        )
        .sort(
          (a, b) =>
            affinity(places[from].evidence, places[b].evidence) -
            affinity(places[from].evidence, places[a].evidence),
        );
      if (related.length) {
        const to = related[0];
        journeys[chat.id] = {
          from,
          to,
          points: districtRoute(from, to, places),
          source: places[from].evidence,
          createdAt: Date.now(),
        };
      }
    }
    const roads = worldRoads(places);
    if (
      JSON.stringify(places) !== JSON.stringify(this.value.places) ||
      JSON.stringify(journeys) !== JSON.stringify(this.value.journeys) ||
      JSON.stringify(roads) !== JSON.stringify(this.value.roads)
    )
      await this.mutate((value) => {
        value.places = places;
        value.roads = roads;
        value.journeys = journeys;
        if (migrating) value.layoutVersion = 0;
      });
    for (const p of projects)
      for (const job of p.jobs.filter((j) => j.status === "done" && j.commit))
        for (const artifact of job.artifacts || []) {
          if (
            this.artifacts.value.items.some(
              (a) =>
                a.projectId === p.id &&
                a.jobId === job.id &&
                a.commit === job.commit &&
                a.target === artifact.target,
            )
          )
            continue;
          // A proposed link is never health-checked, started or executed implicitly.
          try {
            await this.artifacts.register({
              ...artifact,
              projectId: p.id,
              jobId: job.id,
            });
          } catch {
            /* Invalid suggestions remain in the engineering report, never usable links. */
          }
        }
  }
  async handle(route, input) {
    const projects = this.getProjects();
    const project = () => {
      const p = projects.find((p) => p.id === input.projectId);
      if (!p) throw Error("地区が見つかりません。");
      return p;
    };
    if (route === "sync") {
      await this.observe();
      return this.public();
    }
    if (route === "layout-preview")
      return {
        revision: this.value.revision,
        places: placeDistricts(
          projects,
          this.chats(),
          Object.fromEntries(
            Object.entries(this.value.places).filter(([, p]) => p.pinned),
          ),
        ),
        previous: this.value.places,
      };
    if (route === "layout-apply") {
      await this.mutate((value) => {
        if (value.revision !== input.revision)
          throw Error(
            "地区の情報が変わりました。配置をもう一度確認してください。",
          );
        value.places = placeDistricts(
          projects,
          this.chats(),
          Object.fromEntries(
            Object.entries(value.places).filter(([, p]) => p.pinned),
          ),
        );
        value.layoutVersion = 1;
        value.journeys = {};
      });
      await this.observe();
      return this.public();
    }
    if (route === "topics") {
      const p = project();
      if (
        !Array.isArray(input.topics) ||
        input.topics.some((t) => !Object.hasOwn(topicNames, t))
      )
        throw Error("地区の話題を選んでください。");
      await this.mutate((value) => {
        const place = value.places[p.id];
        if (!place) throw Error("地図を更新してください。");
        place.topics = [...new Set(input.topics)];
        place.pinned = Boolean(input.pinned);
        value.journeys = {};
      });
      await this.observe();
      return this.public();
    }
    if (route === "link") {
      const p = project(),
        chat = this.getChats().find((c) => c.id === input.conversationId);
      if (!chat) throw Error("会話が見つかりません。");
      if (chat.project && chat.project.id !== p.id)
        throw Error("作業中の所属会話は別の地区へ移せません。");
      await this.mutate((value) => {
        value.links[chat.id] = p.id;
        delete value.journeys[chat.id];
      });
      await this.observe();
      return this.public();
    }
    if (route === "speech" || route === "heard") {
      const chat = this.chats().find((c) => c.id === input.conversationId);
      if (!chat) throw Error("住民が見つかりません。");
      const p = projects.find((p) => p.id === chat.project?.id),
        report = residentReport(chat, p, this.value.visits[chat.id]);
      if (route === "speech") return report;
      if (
        typeof input.version !== "string" ||
        input.version.length > 20000 ||
        input.version !== report.version
      )
        throw Error("新しい報告が届きました。もう一度話しかけてください。");
      await this.mutate((value) => {
        value.visits[chat.id] = acknowledgeResidentReport(value.visits[chat.id], report);
      });
      return { ok: true };
    }
    if (route === "artifact/register") {
      const result = await this.artifacts.register(input);
      return { artifact: result, world: this.public() };
    }
    if (route === "artifact/check")
      return {
        artifact: await this.artifacts.check(input),
        world: this.public(),
      };
    if (route === "artifact/use") return this.artifacts.use(input);
    if (route === "reward") {
      const p = project();
      if (
        p.status !== "delivered" ||
        !p.jobs.filter((j) => j.kind === "verify").length ||
        p.jobs
          .filter((j) => j.kind === "verify")
          .some((j) => j.status !== "done")
      )
        throw Error("検証とPR作成が完了した地区の成果を確認してください。");
      return this.adventure.acceptProject(p);
    }
    return undefined;
  }
}
