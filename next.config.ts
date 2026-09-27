import type { NextConfig } from "next";
import {withWorkflow} from "workflow/next";
import { networkInterfaces } from "node:os";

const config: NextConfig = {
  outputFileTracingIncludes:{"/**/*":["./scripts/render-explanation.py","./scripts/video_layout.py","./scripts/render-cloud-video.py","./public/brand/chalk-logo.png"]},
  // Permit dev assets when another device opens this computer's LAN address.
  allowedDevOrigins: ["127.0.0.1", ...Object.values(networkInterfaces()).flatMap(addresses =>
    (addresses ?? []).filter(address => !address.internal && address.family === "IPv4")
      .map(address => address.address))],
};

export default withWorkflow(config);
