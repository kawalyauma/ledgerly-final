import type {BackendFeature} from "../types.js";
import {createFileManagerRoutes} from "./routes.js";
export const fileManagerFeature:BackendFeature={key:"file-manager",version:"1.0.0",mount(app,runtime){app.route("/api/v1/files",createFileManagerRoutes(runtime));}};
