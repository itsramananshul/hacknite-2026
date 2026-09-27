import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chalk",
  description:
    "Chalk is a physics teaching board. It shows a chalkboard diagram next to the exact closed form answer for a mechanics problem, with the assumptions written out underneath.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0c1813",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#simulation">
          Skip to the simulation
        </a>
        {children}
      </body>
    </html>
  );
}
