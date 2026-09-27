import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  openGraph:{title:"Chalk",images:[{url:"/brand/chalk-logo.png",width:1254,height:1254,alt:"Chalk"}]},
  twitter:{card:"summary",title:"Chalk",images:["/brand/chalk-logo.png"]},
  title: "Chalk",
  description:
    "Explore physics, chemistry and mathematics through interactive simulations, worked solutions, and explanation videos.",
};

export const viewport: Viewport = {
  colorScheme: "light",
    themeColor: "#FCFBF8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Caveat:wght@600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <a className="skip-link" href="#simulation">
          Skip to the simulation
        </a>
        {children}
      </body>
    </html>
  );
}
