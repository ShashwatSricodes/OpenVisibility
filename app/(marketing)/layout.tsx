import type { Metadata, Viewport } from "next";
import { Host_Grotesk, DM_Sans } from "next/font/google";
import "./globals.css";

const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-host-grotesk",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenVisibility — open-source AI visibility tracking",
  description:
    "Track how your brand shows up in ChatGPT, Gemini, Google AI Mode and AI Overviews, then get cited: site audit, fixes, briefs and an outreach agent. Open source, from $0.0015 an answer.",
  openGraph: {
    title: "OpenVisibility — open-source AI visibility tracking",
    description:
      "See how AI answers talk about your brand, and what to do about it. Mention rate, share of voice, citations, recommendations and outreach.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${hostGrotesk.variable} ${dmSans.variable}`}>
      <body>
        {children}
        <div className="noise" aria-hidden="true" />
      </body>
    </html>
  );
}
