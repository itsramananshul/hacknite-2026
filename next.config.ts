import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const config: NextConfig = {
  // Permit dev assets when another device opens this computer's LAN address.
  allowedDevOrigins: ["127.0.0.1", ...Object.values(networkInterfaces()).flatMap(addresses =>
    (addresses ?? []).filter(address => !address.internal && address.family === "IPv4")
      .map(address => address.address))],
};

export default config;
