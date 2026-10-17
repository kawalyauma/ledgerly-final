import type { BackendFeature } from "../types.js";
import { startEngine } from "./engine.js";
import { startGitDesk } from "./git-desk.js";
import { createLearningRoutes } from "./routes.js";
// Step handlers register themselves with the engine on import.
import "./schemes.js";
import "./captures.js";
import "./insights.js";

export const learningEngineFeature: BackendFeature = {
  key: "learning-engine",
  version: "0.1.0",
  mount(app, runtime) {
    app.route("/api/v1/learn", createLearningRoutes(runtime));
    // Scheme and lesson generation is intentionally serial: each result is quality-checked before the next
    // lesson is claimed, avoiding provider-limit bursts and keeping resource use predictable.
    startEngine(runtime, 1);
    // Publishes "git" provider calls to the resources bank on GitHub and imports the agents' answers.
    startGitDesk(runtime);
  },
};
