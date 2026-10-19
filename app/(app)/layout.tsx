import type { Metadata } from "next";
import { Host_Grotesk, Inter } from "next/font/google";
import "./app.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-host-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "OpenVisibility", template: "%s · OpenVisibility" },
  robots: { index: false },
};

/* Dark by default; a saved "light" choice wins. Runs before first paint so there is no flash. */
const themeScript = `try{if(localStorage.getItem("ov-theme")!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

/* Root layout for the product (fonts, theme); the landing page has its own in (marketing).
   Signed-in pages add the sidebar in (workspace)/layout.tsx. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${hostGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
