import type { BackendFeature } from "../types.js";
import { startEngine } from "./engine.js";
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
    startEngine(runtime);
  },
};
