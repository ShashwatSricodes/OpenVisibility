import type { Metadata } from "next";
import { Host_Grotesk, DM_Sans } from "next/font/google";
import "./app.css";

const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-host-grotesk",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "OpenVisibility", template: "%s · OpenVisibility" },
  robots: { index: false },
};

/* root layout for the product; the landing page has its own in (marketing) */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${hostGrotesk.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
